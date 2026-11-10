PLANNER – PROTOTIPI v0.1 (PWA)
==============================

SKEDARËT
  index.html            faqja
  styles.css            pamja (edhe dark mode)
  app.js                e gjithë logjika
  sw.js                 service worker (offline + njoftime)
  manifest.webmanifest  instalimi si aplikacion
  icons\                ikonat
  serve.ps1             server lokal për provë në kompjuter

PROVA NË KOMPJUTER
  powershell -ExecutionPolicy Bypass -File serve.ps1
  pastaj hap http://localhost:8080 në Chrome
  (F12 → ikona e telefonit për ta parë në madhësi celulari)

PUBLIKIMI
  GitHub Pages nga branch "main" (rrënja e repo-s).
  Çdo push në main e përditëson app-in. Kur ndryshon skedarët,
  rrite CACHE te sw.js (p.sh. planner-v2) që telefoni ta marrë versionin e ri.

INSTALIMI NË ANDROID
  Hap linkun e GitHub Pages në Chrome → ⋮ → "Instalo aplikacionin"
  (ose "Shto në ekranin bazë").

ÇKA PUNON NË v0.1
  - Faqet PUNË / PERSONALE / TË GJITHA
  - Ekrani "Sot": shkrim i shpejtë, takimet e ditës, detyrat me tick
  - Bartja automatike: detyra e pakryer del nesër me "nga dje" / "e vonuar N ditë"
    dhe afatin origjinal
  - Detyra të përsëritura (çdo ditë / javë / muaj / ditë të caktuara);
    nëse humbet disa ditë, del NJË herë si e vonuar (pa dyfishime)
  - Detyra "këtë javë" / "këtë muaj"
  - Takime me orë, kohëzgjatje, vend, përsëritje dhe kujtesë
  - Kalendari mujor me pika për takimet/detyrat
  - Backup: eksport/import JSON (Cilësimet ⚙)

ÇKA U SHTUA NË v0.2
  - Detyrat kanë orë fillimi (opsionale) dhe kohëzgjatje në minuta (çfarëdo numri);
    "Fillon + Minuta" llogarit "Mbaron", dhe "Mbaron" llogarit minutat
  - Takimet dalin bashkë me detyrat në planin e ditës, të renditura sipas orës
  - Ngarkesa e ditës me ngjyra: e lehtë (≤50%) · mesatare (≤80%) · e plotë (≤100%) · e mbingarkuar
    Llogaritet nga kapaciteti ditor (⚙: Hë–Pr 8h, Sh–Di 3h si parazgjedhje).
    Oraret që mbivendosen numërohen një herë dhe shënohen me ⚠.
  - Faqja "Java": ngarkesa e secilës ditë + totali i javës; prek ditën për planin
  - Kalendari: ditët me ngjyrë sipas ngarkesës

ÇKA U SHTUA NË v0.3
  - Rezervimi i orëve: detyra/takimi me orë + minuta e zë atë slot.
    Nuk ruhet diçka tjetër që bie mbi të (edhe mes Punë dhe Personale);
    forma tregon kush e zë dhe propozon orën e parë të lirë.
  - "Sa kohë merr?" del e para në formë, me butona të shpejtë
  - Orët e lira të ditës në formë dhe në plan ("E lirë · 1h 30m  + Rezervo")
  - Shkrim i shpejtë me kohë: "Thirr Arbenin 30m @10", "Raport 1h30 ora 14"
  - Orari i ditës te ⚙ (parazgjedhje 08:00–17:00)
  - Detyrat e vonuara nuk e mbajnë orën e vjetër (nuk bllokojnë slot sot)

KUFIZIMET E v0.1
  - Të dhënat ruhen vetëm në pajisje (pa sinkronizim telefon ↔ kompjuter)
  - Kujtesat dalin vetëm kur app-i është i hapur ose ka qenë i hapur së fundmi;
    njoftimet edhe kur app-i është mbyllur kërkojnë server (faza 2)
  - Ende pa modulin e shënimeve (stil ColorNote)

FAZAT E ARDHSHME
  2. Sinkronizim + njoftime nga serveri (push)
  3. Shënimet me ngjyra (ColorNote)
  4. Pamja e javës në kalendar, statistika
