# naming_pdf

Google Apps Script som läser skannade PDF:er i valda Google Drive-mappar med
OCR och döper om dem efter rubriken som verkar inleda dokumentet.

Skriptet är bundet till ett Google Kalkylark som fungerar som
kontrollpanel: en meny i kalkylarket låter dig lägga till mappar genom att
klistra in deras webbadress i en dialogruta – du behöver aldrig redigera
koden för att ange vilka mappar som ska genomsökas. Allt körs inne i Google
(inget lokalt program, inget Google Cloud-projekt eller fakturering krävs).

## Så fungerar det

1. Skriptet går igenom PDF-filer i de mappar (och undermappar) du lagt till
   via menyn.
2. För varje fil skapas en tillfällig OCR-tolkad Google Docs-kopia med
   hjälp av Drives inbyggda OCR.
3. Bland de första styckena i texten väljs den mest troliga rubriken: en
   OCR-igenkänd rubrikstil prioriteras, annars den rad med störst
   typsnittsstorlek (oftast den mest framträdande texten överst i
   skanningen). Rena siffer-/datumrader hoppas alltid över.
4. Filen döps om (originalfilen – inga kopior skapas av de riktiga
   filerna) och märks i sin beskrivning så att den inte behandlas igen.
5. Alla resultat loggas i fliken **Logg** i kalkylarket, så du kan granska
   både förslag och faktiska byten.

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
3. Klicka **"Förhandsgranska (dry run)"**. Inget byts än – öppna fliken
   **Logg** och granska de föreslagna namnen.
4. Ser förslagen bra ut, klicka **"Döp om nu (skarpt läge)"** och bekräfta
   dialogrutan för att verkställa bytena på riktigt.
5. Filer som redan döpts om hoppas automatiskt över vid senare körningar,
   så det går bra att köra om skriptet för att fånga upp nya filer som
   lagts till i mapparna.
6. Har du väldigt många filer kan Apps Scripts körtidsgräns (ca 6 minuter)
   nås innan alla hunnit behandlas. Körningen avbryts då snyggt och loggas
   – klicka bara på samma menyval igen så fortsätter det med återstående
   filer.

## Granska och rätta felaktiga förslag manuellt

Ingen automatisk OCR-tolkning blir perfekt för alla skanningar. Filer där
förslaget blev fel eller ingen rubrik alls hittades kan du rätta till för
hand i fliken **Logg**, utan att skriva om koden:

1. Kör **"Förhandsgranska (dry run)"** och öppna fliken **Logg**.
2. För de rader du vill ändra: skriv in ett bättre namn i kolumnen
   **"Nytt namn"** (t.ex. genom att själv titta på PDF:en, eller be en AI
   läsa den skannade texten och föreslå en rubrik).
3. Rader du vill lämna helt orörda: se till att "Nytt namn" är tomt – de
   markeras då som överhoppade i stället för att döpas om.
4. Klicka **"Tillämpa granskade namn (från Logg)"**. Den döper om exakt de
   filer som har ett värde i "Nytt namn" (och som inte redan behandlats),
   och uppdaterar statusen i loggen.

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
