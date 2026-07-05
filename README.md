# naming_pdf

Google Apps Script som läser skannade PDF:er i valda Google Drive-mappar med
OCR och döper om dem efter rubriken som verkar inleda dokumentet.

Skriptet är bundet till ett Google Kalkylark som fungerar som
kontrollpanel: en meny i kalkylarket låter dig lägga till mappar genom att
klistra in deras webbadress i en dialogruta – du behöver aldrig redigera
koden för att ange vilka mappar som ska genomsökas. Allt körs inne i Google
(inget lokalt program, inget Google Cloud-projekt eller fakturering krävs).

## Så fungerar det

Skriptet döper aldrig om något automatiskt i samma steg som det läser
filerna – det finns bara **en** väg till en faktisk omdöpning, för att det
inte ska gå att av misstag hoppa förbi egna rättningar:

1. **Förhandsgranska** går igenom PDF-filer i de mappar (och undermappar)
   du lagt till via menyn. För varje fil skapas en tillfällig OCR-tolkad
   Google Docs-kopia med hjälp av Drives inbyggda OCR, och bland de första
   styckena väljs den mest troliga rubriken (OCR-igenkänd rubrikstil
   prioriteras, annars raden med störst typsnittsstorlek). Förslaget
   skrivs till fliken **Logg** – inget byts i Drive ännu.
2. Du granskar fliken **Logg** och rättar vid behov kolumnen "Nytt namn"
   för de filer som blev fel.
3. **Döp om enligt Logg** läser igenom loggen och döper om exakt de filer
   som har ett värde i "Nytt namn" – vare sig det är det automatiska
   förslaget eller din egen rättning. Filer märks i sin beskrivning så att
   de inte behandlas igen vid nästa förhandsgranskning.

## Installation

1. Skapa ett nytt Google Kalkylark, t.ex. döpt "PDF-namngivning".
2. Öppna **Tillägg → Apps Script**.
3. Skapa en fil `Code.gs` i projektet och klistra in innehållet från
   [`apps-script/Code.gs`](apps-script/Code.gs) (skriv över eventuellt
   exempelinnehåll).
4. Öppna projektinställningarna (kugghjulet) och kryssa i "Visa filen
   appsscript.json i editorn". Klistra sedan in innehållet från
   [`apps-script/appsscript.json`](apps-script/appsscript.json) i den
   filen. Detta aktiverar den avancerade Drive-tjänsten (v3) som behövs för
   OCR-konverteringen.
5. Spara projektet och gå tillbaka till kalkylarket (uppdatera fliken om
   den redan var öppen).

## Användning

1. I kalkylarket ska en ny meny **"Namnge pdf"** ha dykt upp.
2. Klicka **"Lägg till mapp (klistra in URL)…"** och klistra in webbadressen
   till en Drive-mapp, t.ex.
   `https://drive.google.com/drive/folders/1AbCDeFGhIJKlmnOPQrstUVwxYZ`
   (det räcker även att klistra in bara ID-delen). Upprepa för varje mapp
   du vill genomsöka.
   - Första gången du klickar på ett menyval ber Google om behörighet –
     klicka "Avancerat" → "Gå till (projektnamn)" eftersom det är ditt
     eget skript. Klicka sedan på menyvalet en gång till om dialogrutan
     inte dyker upp direkt efter godkännandet.
   - Tillagda mappar visas i fliken **Mappar**. Använd **"Ta bort en
     mapp…"** för att ta bort en mapp ur listan igen.
3. Klicka **"Förhandsgranska alla mappar"** för att gå igenom samtliga
   tillagda mappar, eller **"Förhandsgranska en mapp…"** för att bara köra
   en specifik mapp (praktiskt när du precis lagt till en ny mapp och inte
   vill vänta på att alla andra körs om). Inget byts än i Drive.
4. Öppna fliken **Logg** och granska förslagen i kolumnen "Nytt namn". Är
   ett förslag fel eller saknas (t.ex. för att OCR:en inte hittade någon
   tydlig rubrik) – skriv in ett bättre namn själv, eller be en AI läsa
   den skannade texten och föreslå en rubrik. Vill du att en fil ska
   lämnas helt orörd, se till att "Nytt namn" är tomt för den raden.
5. Klicka **"Döp om enligt Logg (efter granskning)"**. Den döper om exakt
   de filer som har ett värde i "Nytt namn" i loggen – både automatiska
   förslag du lämnat orörda och egna rättningar – och markerar tomma
   rader som överhoppade.
6. Filer som redan döpts om hoppas automatiskt över vid senare
   förhandsgranskningar, så det går bra att köra om skriptet för att fånga
   upp nya filer som lagts till i mapparna.
7. Har du väldigt många filer kan Apps Scripts körtidsgräns (ca 6 minuter)
   nås innan alla hunnit förhandsgranskas. Körningen avbryts då snyggt och
   loggas – klicka bara på samma menyval igen så fortsätter det med
   återstående filer.

Kolumnen **"Fil-ID"** i loggen används internt för att hitta rätt fil
oavsett filnamn – rör den inte.

## Begränsningar

- OCR-kvaliteten beror på hur tydlig skanningen är. Filer där ingen rimlig
  rubrikrad hittas lämnas oförändrade och loggas som sådana – granska dessa
  manuellt (se ovan).
- Rubriklogiken bygger på styckets rubrikstil och typsnittsstorlek från
  OCR-tolkningen, vilket fungerar bra för de flesta skannade dokument men
  inte alla. Justera funktionen `pickHeadingFromBody` i `Code.gs` om dina
  dokument har en särskild struktur.
- Skriptet behöver full Drive-åtkomst (för att döpa om filer), åtkomst till
  Google Dokument (för att läsa OCR-texten) samt till kalkylarket självt
  (för meny, logg och mapplista).
