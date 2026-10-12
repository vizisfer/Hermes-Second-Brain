import test from 'node:test';
import assert from 'node:assert/strict';
import { ALADHAN_INTENTS, callAladhan, createAladhanTools, SageSessionContext } from '../src/tools/aladhan-mvp.mjs';
test('location missing prompts; remembered city/country scoped to session', async () => {
 const a=new SageSessionContext(), b=new SageSessionContext(); let calls=0;
 await assert.rejects(callAladhan('prayer_times',{}, {context:a,fetchImpl:async()=>{calls++;}}), /What city and country/);
 a.rememberLocation({city:'Istanbul',country:'Türkiye'});
 let url; const fetchImpl=async u=>{url=u;return {ok:true,json:async()=>({data:{timings:{Fajr:'05:00',Sunrise:'06:00',Dhuhr:'12:00',Asr:'15:00',Maghrib:'18:00',Isha:'20:00'},date:{gregorian:{date:'01-01-2026'}}}})}};
 await callAladhan('prayer_times',{}, {context:a,fetchImpl}); assert.equal(url.searchParams.get('city'),'Istanbul');
 await assert.rejects(callAladhan('prayer_times',{}, {context:b,fetchImpl}), /What city and country/); assert.equal(calls,0);
});
test('only approved read-only intents map to reviewed Aladhan GET endpoints', async () => {
 assert.deepEqual([...ALADHAN_INTENTS],['prayer_times','next_prayer','qibla','hijri_calendar','hijri_conversion','calculation_methods']);
 const c=new SageSessionContext(); c.rememberLocation({city:'Ankara',country:'Türkiye'}); const paths=[];
 const fetchImpl=async u=>{paths.push(u.pathname); let data={}; if(u.pathname.endsWith('/timingsByCity')) data={timings:{Fajr:'04:00',Sunrise:'05:00',Dhuhr:'12:00',Asr:'15:00',Maghrib:'18:00',Isha:'20:00'},date:{gregorian:{date:'01-01-2026'}}}; else if(u.pathname.includes('/qibla/')) data={direction:151.2}; else if(u.pathname.endsWith('/gToH/01-01-2026')) data={gregorian:{date:'01-01-2026'},hijri:{date:'11-07-1447',month:{en:'Rajab'},year:'1447'}}; else if(u.pathname.endsWith('/methods')) data={'1':{id:1,name:'MWL'}}; else if(u.pathname.endsWith('/calendarByCity')) data=[]; else throw Error('unapproved'); return {ok:true,json:async()=>({data})};};
 const tools=createAladhanTools(c,{fetchImpl,now:new Date('2026-01-01T03:00:00Z')});
 assert.equal((await tools.qibla({latitude:41,longitude:29})).direction,151.2);
 assert.equal((await tools.hijri_conversion({date:'01-01-2026',direction:'to_hijri'})).hijri,'11-07-1447');
 assert.deepEqual(await tools.calculation_methods({}),[{id:1,name:'MWL'}]);
 await tools.prayer_times({}); await tools.next_prayer({}); await tools.hijri_calendar({month:1,year:2026}); assert.equal(paths.length,6);
});
test('write/unknown intents and invalid bounds are rejected before network', async()=>{let calls=0;const opts={context:new SageSessionContext(),fetchImpl:async()=>{calls++;}}; for(const i of ['create_event','set_location','timings','unknown']) await assert.rejects(callAladhan(i,{},opts)); await assert.rejects(callAladhan('qibla',{latitude:91,longitude:0},opts)); await assert.rejects(callAladhan('qibla',{latitude:0,longitude:0,extra:'x'},opts)); assert.equal(calls,0);});
test('upstream error is reduced to safe controlled failure', async()=>{const c=new SageSessionContext();c.rememberLocation({city:'X',country:'Y'});await assert.rejects(callAladhan('prayer_times',{}, {context:c,fetchImpl:async()=>({ok:false})}),/Aladhan lookup failed/);});
