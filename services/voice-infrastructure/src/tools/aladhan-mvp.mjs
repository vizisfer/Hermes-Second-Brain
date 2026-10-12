import { z } from 'zod';
import { llm } from '@livekit/agents';

const locationSchema = z.object({ city: z.string().trim().min(1).max(80), country: z.string().trim().min(1).max(80) }).strict();
const dateSchema = z.string().regex(/^\d{2}-\d{2}-\d{4}$/);
export const ALADHAN_INTENTS = Object.freeze(['prayer_times', 'next_prayer', 'qibla', 'hijri_calendar', 'hijri_conversion', 'calculation_methods']);
const schemas = {
  prayer_times: z.object({ city: z.string().trim().min(1).max(80).optional(), country: z.string().trim().min(1).max(80).optional() }).strict(),
  next_prayer: z.object({ city: z.string().trim().min(1).max(80).optional(), country: z.string().trim().min(1).max(80).optional() }).strict(),
  qibla: z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }).strict(),
  hijri_calendar: z.object({ city: z.string().trim().min(1).max(80).optional(), country: z.string().trim().min(1).max(80).optional(), month: z.number().int().min(1).max(12), year: z.number().int().min(1970).max(2100) }).strict(),
  hijri_conversion: z.object({ date: dateSchema, direction: z.enum(['to_hijri', 'to_gregorian']) }).strict(),
  calculation_methods: z.object({}).strict(),
};
const BASE = 'https://api.aladhan.com/v1';
const prayerKeys = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
const safe = (x) => typeof x === 'string' ? x.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 160) : '';

export class SageSessionContext {
  #location;
  constructor() { this.#location = null; }
  rememberLocation(input) { this.#location = locationSchema.parse(input); return { ...this.#location }; }
  get location() { return this.#location ? { ...this.#location } : null; }
  requireLocation(input = {}) {
    if (input.city && input.country) return this.rememberLocation(input);
    if (input.city || input.country) throw new Error('Please provide both your city and country.');
    if (!this.#location) throw new Error('What city and country should I use for your prayer information?');
    return { ...this.#location };
  }
}

export async function callAladhan(intent, raw, { context, fetchImpl = fetch, now = new Date() } = {}) {
  if (!Object.hasOwn(schemas, intent)) throw new Error('Unsupported Aladhan intent.');
  const args = schemas[intent].parse(raw);
  let path, params = {};
  if (intent === 'prayer_times' || intent === 'next_prayer') {
    const { city, country } = context.requireLocation(args);
    path = 'timingsByCity'; params = { city, country };
  } else if (intent === 'hijri_calendar') {
    const { city, country } = context.requireLocation(args);
    path = 'calendarByCity'; params = { city, country, month: args.month, year: args.year };
  } else if (intent === 'qibla') { path = `qibla/${args.latitude}/${args.longitude}`; }
  else if (intent === 'hijri_conversion') { path = args.direction === 'to_hijri' ? `gToH/${args.date}` : `hToG/${args.date}`; }
  else { path = 'methods'; }
  const url = new URL(`${BASE}/${path}`);
  for (const [k,v] of Object.entries(params)) url.searchParams.set(k, String(v));
  try {
    const response = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error();
    const payload = await response.json();
    const data = payload?.data;
    if (intent === 'prayer_times' || intent === 'next_prayer') {
      const timings = data?.timings;
      if (!timings) throw new Error();
      const result = Object.fromEntries(['Fajr','Sunrise','Dhuhr','Asr','Maghrib','Isha'].filter(k => timings[k]).map(k => [k, safe(timings[k])]));
      if (intent === 'prayer_times') return { date: safe(data.date?.gregorian?.date), timings: result };
      const current = now.toTimeString().slice(0,5);
      const upcoming = prayerKeys.map(name => ({ name, time: result[name] })).filter(x => x.time && /^\d{2}:\d{2}/.test(x.time) && x.time.slice(0,5) > current);
      return upcoming[0] ?? (result.Fajr ? { name: 'Fajr', time: result.Fajr, day: 'next' } : { unavailable: true });
    }
    if (intent === 'qibla') { if (!Number.isFinite(data?.direction)) throw new Error(); return { direction: data.direction }; }
    if (intent === 'hijri_conversion') {
      if (!data?.hijri || !data?.gregorian) throw new Error();
      return { gregorian: safe(data.gregorian.date), hijri: safe(data.hijri.date), hijriMonth: safe(data.hijri.month?.en), hijriYear: safe(data.hijri.year) };
    }
    if (intent === 'hijri_calendar') {
      if (!Array.isArray(data)) throw new Error();
      return data.slice(0,31).map(d => ({ date: safe(d.date?.gregorian?.date), hijri: safe(d.date?.hijri?.date), timings: Object.fromEntries(['Fajr','Dhuhr','Asr','Maghrib','Isha'].filter(k => d.timings?.[k]).map(k => [k,safe(d.timings[k])])) }));
    }
    const methods = Array.isArray(data) ? data : Object.values(data ?? {});
    return methods.slice(0,40).map(m => ({ id: Number(m.id), name: safe(m.name) })).filter(m => Number.isInteger(m.id) && m.name);
  } catch { throw new Error('Aladhan lookup failed; please try again later.'); }
}

export function createAladhanTools(context, options) {
  const run = (intent) => (args) => callAladhan(intent, args, { ...options, context });
  return Object.freeze(Object.fromEntries(ALADHAN_INTENTS.map(intent => [intent, run(intent)])));
}

// Called once per LiveKit room/session; the private context cannot leak between calls.
export function createLiveKitAladhanTools(context, options) {
  const defs = {
    prayer_times: [z.object({ city: z.string().trim().min(1).max(80).optional(), country: z.string().trim().min(1).max(80).optional() }).strict(), 'Read daily prayer times; asks for city and country if no location is known.'],
    next_prayer: [z.object({ city: z.string().trim().min(1).max(80).optional(), country: z.string().trim().min(1).max(80).optional() }).strict(), 'Find the next prayer time for the caller location.'],
    qibla: [schemas.qibla, 'Read Qibla direction in degrees for supplied coordinates.'],
    hijri_calendar: [schemas.hijri_calendar, 'Read one month of Hijri and prayer calendar data.'],
    hijri_conversion: [schemas.hijri_conversion, 'Convert a date between Gregorian and Hijri calendars.'],
    calculation_methods: [schemas.calculation_methods, 'List Aladhan calculation methods.'],
  };
  return Object.freeze(Object.fromEntries(ALADHAN_INTENTS.map(name => [name, llm.tool({
    description: defs[name][1], parameters: defs[name][0], execute: async (args) => {
      try { return await callAladhan(name, args, { ...options, context }); }
      catch (error) { return { error: error.message }; }
    },
  })])));
}

