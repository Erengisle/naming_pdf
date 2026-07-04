# naming_pdf

Google Apps Script som läser skannade PDF:er i valda Google Drive-mappar med
OCR och döper om dem efter rubriken som verkar inleda dokumentet.

Skriptet körs helt inne i Google (script.google.com) – ingen lokal
installation, inget Google Cloud-projekt eller fakturering krävs. Det
använder Drives inbyggda OCR-konvertering (kopierar PDF:en till ett
tillfälligt Google Dokument med OCR, läser texten, tar sedan bort kopian).

## Så fungerar det

1. Skriptet går igenom PDF-filer i de mappar (och undermappar) du anger.
2. För varje fil skapas en tillfällig OCR-tolkad Google Docs-kopia.
3. Den första rad i texten som ser ut som en rubrik (inte tom, inte bara
   siffror/datum) används som nytt filnamn.
4. Filen döps om (originalfilen – inga kopior skapas för de riktiga
   filerna) och märks i sin beskrivning så att den inte behandlas igen.
5. Alla resultat loggas i ett kalkylark som heter "PDF-namnbyten logg" i din
   Drive, så du kan granska både förslag och faktiska byten.

## Installation

1. Gå till [script.google.com](https://script.google.com/) och skapa ett
   nytt projekt.
2. Skapa en fil `Code.gs` i projektet och klistra in innehållet från
   [`apps-script/Code.gs`](apps-script/Code.gs).
3. Öppna projektinställningarna (kugghjulet) och kryssa i "Visa filen
   appsscript.json i editorn". Klistra sedan in innehållet från
   [`apps-script/appsscript.json`](apps-script/appsscript.json) i den filen.
   Detta aktiverar den avancerade Drive-tjänsten (v2) som behövs för
   OCR-konverteringen.
4. Redigera `CONFIG.FOLDER_IDS` i `Code.gs` och ange ID:n för de mappar som
   ska genomsökas. Mapp-ID:t är delen efter `/folders/` i mappens
   webbadress, t.ex. `https://drive.google.com/drive/folders/ABC123` →
   `ABC123`.
5. Justera vid behov `OCR_LANGUAGE` (standard `'sv'`) och
   `INCLUDE_SUBFOLDERS`.

## Användning

1. Kör funktionen **`dryRunRenameAll`** först (välj den i
   funktionsväljaren och klicka Kör). Första gången ber Google om
   behörighet – klicka "Avancerat" → "Gå till (projektnamn)" eftersom det
   är ditt eget skript.
2. Öppna kalkylarket **"PDF-namnbyten logg"** som skapas i din Drive och
   granska de föreslagna namnen. Inget har bytts ännu i detta läge.
3. Ser förslagen bra ut, kör **`renameAll`** för att verkställa bytena på
   riktigt.
4. Filer som redan döpts om av skriptet hoppas automatiskt över vid senare
   körningar, så det går bra att köra om skriptet för att fånga upp nya
   filer som lagts till i mapparna.
5. Har du väldigt många filer kan Apps Scripts körtidsgräns (ca 6 minuter)
   nås innan alla filer hunnit behandlas. Skriptet avbryter då snyggt och
   loggar det – kör bara samma funktion igen så fortsätter det med
   återstående filer.

## Begränsningar

- OCR-kvaliteten beror på hur tydlig skanningen är. Filer där ingen rimlig
  rubrikrad hittas lämnas oförändrade och loggas som sådana – granska dessa
  manuellt.
- Rubriklogiken är enkel (första rimliga textraden). Justera funktionen
  `pickHeadingLine` i `Code.gs` om dina dokument har en annan struktur, t.ex.
  om rubriken alltid ligger på rad 2 eller är skriven med versaler.
- Skriptet behöver full Drive-åtkomst (för att döpa om filer) och åtkomst
  till Google Dokument (för att läsa OCR-texten) samt Kalkylark (för
  loggen).
