# Soma Demo 0.3.1 – ENDAST FIKTIVA DATA

**Status: testad i Chromium på dator (88 av 88 automatiska kontroller, `tests/beta03_browsertest.js`, även under undersökväg). EJ testad på riktig iPhone/Android. Håll-och-dra-gesten är bara simulerad med mus/pekare i Chromium.** 0.1 och 0.2 ligger orörda i `../beta_01/` och `../beta_02/`.

## Nytt jämfört med 0.2 (utifrån din första iPhone-feedback)
1. **Tre flikar i stället för sex:** Idag, Kalender, Mönster. Inställningar och data ligger bakom kugghjulet uppe till höger.
2. **Idag:** all registrering på ett ställe. Check-in och händelse är samma flöde. Knapparna visar dagens värde. Två grupper: "Hur mår du?" och "Något hände".
3. **Tryck eller håll och dra:** tryck på en knapp öppnar ett ark (reglage 1–10 med synligt värde, tid, valfri sluttid för händelser, anteckning). På skalor 1–10: håll in en knapp (≈0,35 s) och dra upp/ned, släpp sparar direkt (start 5, 24 px per steg). Håll utan att dra öppnar arket. Dra långt åt sidan avbryter. Rör du fingret innan håll är det vanlig scroll.
4. **Ångra:** efter varje sparning visas "Ångra" i några sekunder.
5. **Kalender i stället för historik:** månadsvy där dagar färgas i tre nyanser efter hur mycket som loggats, och streckade dagar där inget loggats (från första loggade dag till idag). Tryck på en dag för att se och ta bort poster.
6. Mönster, export/import, CSV, fiktivt halvår och lagring är oförändrade (samma databas och JSON-format).

## Ändrat utseende/text
Skalvärden visas som "6 av 10". Datum skrivs "Söndag 15 november".

## Känt / ej verifierat
- Håll-och-dra på riktig iPhone: risk för konflikt med scroll, textmarkering eller systemgester. Måste provas.
- Registrering görs med klockslag (inte bara dag). Flera registreringar samma dag av samma sak är tillåtna.
- Heatmapen räknar antal poster, inte hur "bra" en dag var.
- Tidigare 6-flikars historikvy är borttagen. Radering sker i kalenderns dagdetalj eller i listan på Idag.
- Platshållare i Mönster är oförändrade (`MIN_N = 6`, `STRONG_DIFF = 20`).
- **0.3.1: mörkt tema** (svart/mörkgrått med lila nyanser). Alla textfärgspar har räknats mot WCAG 4,5:1 och grafiska element mot 3:1 (se `tests/`-skärmbilder `beta03_mork_*.png`). Appen är bara mörk, följer inte telefonens ljusa läge. Ikonen (`icon-*.png`) har fortfarande ljus bakgrund och är inte ändrad. Ej testat på riktig telefon.
- Kalender: vald dag har vit ram, idag är understruken.
