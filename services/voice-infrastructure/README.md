# Agentsfer Voice Infrastructure

## Mimari

- Twilio PSTN/SIP → LiveKit Cloud oda/oturum → bu sunucuda çalışan LiveKit Agent worker → seçili gerçek zamanlı ses sağlayıcısı.
- `VOICE_PROVIDER=gemini` şu anda `@livekit/agents-plugin-google` üzerinden `gemini-3.8-live` kullanır. Yeni sağlayıcılar `src/providers/` altında aynı adapter sınırına eklenir; OpenAI Realtime yapılandırılmamıştır.
- Hermes, LiveKit Agent'ın aynı sunucudaki yerel process'idir; telefon sesini/metnini otomatik olarak Hermes'e aktaran bir köprü yoktur. Başlangıçta yalnızca operatör kimliği allowlist'e alınırsa salt-okunur profil durumu aracı açılır.
- LiveKit Agent kayıt/transkript tutmayı `record: false` ile kapatır. Twilio/SIP/webhook/routing ayarları bu projeden değiştirilmez.

## Çalıştırma ve doğrulama

```bash
npm ci
npm test
npm run check:gemini-live
npm run dev
```

`check:gemini-live`, Hermes profilinin `.env` dosyasını okur, Gemini Live WebSocket kurulumunu `gemini-3.8-live` ile doğrular ve prompt/ses göndermeden oturumu kapatır. Gerçek konuşma, ses üretimi veya telefon araması testi değildir.

## Kimlik bilgileri

Worker başlangıçta şu salt-okunur komutla seçili Hermes profilinin env dosya yolunu bulur:

```bash
hermes -p voice-infrastructure-bot config env-path
```

Dosya içeriği hiçbir zaman terminale basılmaz. Gerekli adlar: `GOOGLE_API_KEY`, `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`. Mevcut profil dosyası izinleri `0600` olmalıdır. Üretim container'ına geçerken aynı değişkenler secret store/secret mount üzerinden verilmeli; Hermes profile dosyasını container'a kopyalamayın.

## Operatör aracı

`hermes_readiness_status` aracı varsayılan olarak kapalıdır. Açmak için `HERMES_STATUS_TOOL=true` ve `VOICE_ADMIN_IDENTITIES` içinde LiveKit participant identity allowlist'i gerekir. Araç sabit, salt-okunur `hermes profile show` çağrısı yapar; shell komutu veya telefon konuşması metni kabul etmez. SIP identity doğrulanıp gözden geçirilmeden üretimde açmayın.

## Durum sınırları

Bu dizin, mevcut production baseline'dan ayrı Gateway release candidate'idir; bu candidate LiveKit'e deploy edilmemiştir. `release-baselines/production/voice-infrastructure/` altında mevcut kaynak snapshot'ı korunur. Bu checkout'tan çalışan servisleri yeniden başlatmayın; SIP trunk, dispatch rule, Twilio webhook veya telefon numarası değiştirmeyin. Telefon testi bu release doğrulamasının kapsamı dışındadır.
