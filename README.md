# Soma Demo 0.2 – ENDAST FIKTIVA DATA

**Status: testad i Chromium på dator (61 av 61 automatiska kontroller, `tests/beta02_browsertest.js`). EJ testad på Android eller med riktig installation.** Beta 0.1 ligger orörd i `../beta_01/`.

## Nytt jämfört med 0.1
- Lagringslager (`store`): appen rör inte IndexedDB direkt, så lagringen kan bytas (t.ex. mot SQLite) senare.
- Strikt importvalidering: värdet måste passa kategorins typ (skala 1–10, tal, ja/nej); okända fält kastas; import sker i en transaktion (allt eller inget).
- Händelser kan få valfri sluttid (`endedAt`).
- Fliken **Mönster**: välj två saker (A och B). Visar hur många tillfällen av A som ligger nära B, jämfört med vad slumpen ger, med antal och försiktig text. Se `../../docs/` för bakgrund.
- **Fiktivt halvår**: knapp i Mer-fliken som fyller appen med påhittad data (markerad `source: demo`, kan tas bort separat).
- **CSV-export**: svensk Excel (semikolon, decimalkomma) och internationell (komma, decimalpunkt). Båda med UTF-8 BOM.
- Service worker: nätverk först med cache som reserv, gamla cachar rensas. Ingen manuell versionsbump behövs för att få nya filer.
- Ingen hårdkodad personlig hälsning.

- Sidan har `noindex` (ska inte listas i sökmotorer) och använder bara relativa sökvägar, så den fungerar under en undersökväg som `/soma-demo/`.

## Samma som 0.1
Databasnamn `soma-demo-v1` och JSON-formatet `soma-observations-v1` (version 1, `endedAt` är ett valfritt tillägg), så data från 0.1 finns kvar.

## Platshållare att validera (kod: konstanter överst i app.js)
`MIN_N = 6` (för få tillfällen), `STRONG_DIFF = 20` (procentenheter över slumpen för "värt att följa"). Båda är gissningar.

## Kända begränsningar
Inga konton, ingen kryptering, ingen synk. Tidszon: poster sparas som lokal tid utan zon; mönstren räknar kalenderdagar. Inte testad på Android/iOS. Bottenmenyn har 6 flikar och kontrollerades bara visuellt på 390 px bredd i Chromium.
