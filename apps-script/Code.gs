/**
 * Läser skannade PDF:er i valda Google Drive-mappar med OCR och döper om
 * filerna efter den rubrik som verkar inleda dokumentet.
 *
 * Detta skript är bundet till ett Google Kalkylark som fungerar som
 * kontrollpanel: en meny i kalkylarket låter dig lägga till mappar genom
 * att klistra in deras URL i en dialogruta, i stället för att redigera
 * koden. Se README.md för installation.
 */

const CONFIG = {
  // Genomsök även undermappar till de tillagda mapparna.
  INCLUDE_SUBFOLDERS: true,

  // Språk för OCR-tolkningen (ISO 639-1), t.ex. 'sv' eller 'en'.
  OCR_LANGUAGE: 'sv',

  // Max längd på det nya filnamnet, exklusive filändelsen ".pdf".
  MAX_FILENAME_LENGTH: 90,
};

// Sätts i filens beskrivning efter ett lyckat namnbyte så att filen inte
// OCR-tolkas och döps om igen vid en senare körning.
const PROCESSED_MARKER = '[OCR-omdöpt]';

// Lämnar marginal under Apps Scripts körtidsgräns (6 minuter för
// konsumentkonton). Om gränsen börjar närma sig avbryts körningen snyggt;
// kör bara samma meny-alternativ igen för att fortsätta där den slutade.
const MAX_RUNTIME_MS = 5 * 60 * 1000;

const FOLDERS_PROPERTY_KEY = 'FOLDER_LIST';
const LOG_SHEET_NAME = 'Logg';
const FOLDERS_SHEET_NAME = 'Mappar';

/**
 * Körs automatiskt när kalkylarket öppnas och skapar menyn. Att skapa en
 * meny kräver ingen behörighet, så den syns direkt även innan du godkänt
 * åtkomst till Drive.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Namnge pdf')
    .addItem('Lägg till mapp (klistra in URL)…', 'addFolderDialog')
    .addItem('Ta bort en mapp…', 'removeFolderDialog')
    .addSeparator()
    .addItem('Förhandsgranska (dry run)', 'dryRunRenameAll')
    .addItem('Döp om nu (skarpt läge)', 'renameAllConfirm')
    .addItem('Tillämpa granskade namn (från Logg)', 'applyReviewedNamesFromLog')
    .addToUi();
}

/* ================= Mapphantering via dialogrutor ================= */

function addFolderDialog() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt(
    'Lägg till mapp',
    'Klistra in webbadressen till Drive-mappen (eller bara mapp-ID:t):',
    ui.ButtonSet.OK_CANCEL
  );
  if (response.getSelectedButton() !== ui.Button.OK) return;

  const input = response.getResponseText().trim();
  const folderId = extractFolderId(input);
  if (!folderId) {
    ui.alert('Kunde inte hitta ett mapp-ID i det du klistrade in. Kontrollera att hela länken kom med.');
    return;
  }

  let folder;
  try {
    folder = DriveApp.getFolderById(folderId);
  } catch (e) {
    ui.alert('Hittade ingen mapp med det ID:t, eller så saknar du åtkomst till den.');
    return;
  }

  const folders = getConfiguredFolders();
  if (folders.some(function (f) { return f.id === folderId; })) {
    ui.alert('Mappen "' + folder.getName() + '" är redan tillagd.');
    return;
  }

  folders.push({ id: folderId, name: folder.getName() });
  saveConfiguredFolders(folders);
  ui.alert('Mappen "' + folder.getName() + '" har lagts till.');
}

function removeFolderDialog() {
  const ui = SpreadsheetApp.getUi();
  const folders = getConfiguredFolders();
  if (folders.length === 0) {
    ui.alert('Inga mappar är tillagda än.');
    return;
  }

  const list = folders.map(function (f, i) { return (i + 1) + '. ' + f.name; }).join('\n');
  const response = ui.prompt('Ta bort mapp', 'Ange numret på mappen du vill ta bort:\n\n' + list, ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return;

  const index = parseInt(response.getResponseText().trim(), 10) - 1;
  if (isNaN(index) || index < 0 || index >= folders.length) {
    ui.alert('Ogiltigt nummer.');
    return;
  }

  const removed = folders.splice(index, 1)[0];
  saveConfiguredFolders(folders);
  ui.alert('Mappen "' + removed.name + '" har tagits bort.');
}

/** Plockar ut Drive-ID:t ur en fullständig mapp-URL, eller ur ett redan bart ID. */
function extractFolderId(input) {
  const match = input.match(/[-\w]{25,}/);
  return match ? match[0] : '';
}

function getConfiguredFolders() {
  const raw = PropertiesService.getDocumentProperties().getProperty(FOLDERS_PROPERTY_KEY);
  return raw ? JSON.parse(raw) : [];
}

function saveConfiguredFolders(folders) {
  PropertiesService.getDocumentProperties().setProperty(FOLDERS_PROPERTY_KEY, JSON.stringify(folders));
  writeFoldersSheet(folders);
}

/** Speglar den sparade mapplistan i en flik, bara för överblick. */
function writeFoldersSheet(folders) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(FOLDERS_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(FOLDERS_SHEET_NAME);
  sheet.clear();
  sheet.appendRow(['Mappnamn', 'Mapp-ID']);
  folders.forEach(function (f) { sheet.appendRow([f.name, f.id]); });
}

/* ================= Namnbyte ================= */

function dryRunRenameAll() {
  processAllFolders(true);
}

function renameAllConfirm() {
  const ui = SpreadsheetApp.getUi();
  const folders = getConfiguredFolders();
  if (folders.length === 0) {
    ui.alert('Inga mappar är tillagda. Lägg till minst en mapp via menyn först.');
    return;
  }
  const response = ui.alert(
    'Döp om på riktigt?',
    'Det här döper om PDF-filer i ' + folders.length + ' mapp(ar) permanent. Har du kört "Förhandsgranska" och granskat fliken Logg först?',
    ui.ButtonSet.YES_NO
  );
  if (response !== ui.Button.YES) return;
  processAllFolders(false);
}

function processAllFolders(dryRun) {
  const ui = SpreadsheetApp.getUi();
  const configuredFolders = getConfiguredFolders();
  if (configuredFolders.length === 0) {
    ui.alert('Inga mappar är tillagda. Lägg till minst en mapp via menyn "Lägg till mapp" först.');
    return;
  }

  const sheet = getOrCreateLogSheet();
  const state = { startTime: Date.now(), stopped: false };

  configuredFolders.forEach(function (folderInfo) {
    if (state.stopped) return;
    try {
      const folder = DriveApp.getFolderById(folderInfo.id);
      processFolder(folder, dryRun, sheet, state);
    } catch (e) {
      logRow(sheet, '', '', folderInfo.name || folderInfo.id, 'FEL: kunde inte öppna mapp – ' + e.message, dryRun, '');
    }
  });

  if (state.stopped) {
    logRow(sheet, '', '', '', 'Tidsgränsen närmade sig – kör samma menyval igen för att fortsätta.', dryRun, '');
  }
  SpreadsheetApp.flush();
  ui.alert((dryRun ? 'Förhandsgranskning' : 'Omdöpning') + ' klar. Se fliken "Logg".');
}

function processFolder(folder, dryRun, sheet, state) {
  if (state.stopped) return;

  const files = folder.getFilesByType(MimeType.PDF);
  while (files.hasNext()) {
    if (timeIsRunningOut(state)) {
      state.stopped = true;
      return;
    }
    processFile(files.next(), folder, dryRun, sheet);
  }

  if (CONFIG.INCLUDE_SUBFOLDERS) {
    const subfolders = folder.getFolders();
    while (subfolders.hasNext()) {
      if (state.stopped) return;
      processFolder(subfolders.next(), dryRun, sheet, state);
    }
  }
}

function processFile(file, folder, dryRun, sheet) {
  const originalName = file.getName();
  const description = file.getDescription() || '';
  const fileId = file.getId();

  if (description.indexOf(PROCESSED_MARKER) !== -1) {
    logRow(sheet, originalName, '(oförändrat)', folder.getName(), 'Hoppar över – redan behandlad', dryRun, fileId);
    return;
  }

  let heading;
  try {
    heading = extractHeadingFromPdf(file);
  } catch (e) {
    logRow(sheet, originalName, '', folder.getName(), 'FEL vid OCR: ' + e.message, dryRun, fileId);
    return;
  }

  const cleanName = sanitizeFilename(heading);
  if (!cleanName) {
    logRow(sheet, originalName, '', folder.getName(), 'Ingen rubrik hittades – oförändrat', dryRun, fileId);
    return;
  }

  const newFullName = ensureUniqueName(folder, cleanName, 'pdf', fileId);

  if (dryRun) {
    logRow(sheet, originalName, newFullName, folder.getName(), 'FÖRESLAGET (dry run)', dryRun, fileId);
    return;
  }

  file.setName(newFullName);
  file.setDescription((description + ' ' + PROCESSED_MARKER + ' ' + new Date().toISOString()).trim());
  logRow(sheet, originalName, newFullName, folder.getName(), 'OMDÖPT', dryRun, fileId);
}

/**
 * Låter dig granska och redigera förslagen i fliken Logg innan de
 * tillämpas. Kör efter att du justerat kolumnen "Nytt namn" för de rader
 * du vill ändra (och ev. rensat den för rader du vill hoppa över helt).
 */
function applyReviewedNamesFromLog() {
  const ui = SpreadsheetApp.getUi();
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(LOG_SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 2) {
    ui.alert('Loggen är tom. Kör "Förhandsgranska" först.');
    return;
  }

  const data = sheet.getDataRange().getValues();
  const header = data[0];
  const col = {
    newName: header.indexOf('Nytt namn'),
    status: header.indexOf('Status'),
    fileId: header.indexOf('Fil-ID'),
  };

  if (col.fileId === -1) {
    ui.alert('Loggen saknar kolumnen "Fil-ID" (från en äldre version av skriptet). Kör "Förhandsgranska" på nytt för att skapa en ny logg.');
    return;
  }

  let applied = 0;
  let skipped = 0;
  const alreadyDone = /OMDÖPT|Överhoppad|FEL vid tillämpning|Hoppar över/;

  for (let row = 1; row < data.length; row++) {
    const status = String(data[row][col.status] || '');
    const fileId = data[row][col.fileId];
    if (!fileId || alreadyDone.test(status)) continue;

    const desiredName = String(data[row][col.newName] || '').trim();
    if (!desiredName) {
      sheet.getRange(row + 1, col.status + 1).setValue('Överhoppad av användare');
      skipped++;
      continue;
    }

    try {
      const file = DriveApp.getFileById(fileId);
      const parents = file.getParents();
      const folder = parents.hasNext() ? parents.next() : null;
      const baseName = sanitizeFilename(desiredName).replace(/\.pdf$/i, '');
      const finalName = folder ? ensureUniqueName(folder, baseName, 'pdf', fileId) : baseName + '.pdf';

      file.setName(finalName);
      file.setDescription(((file.getDescription() || '') + ' ' + PROCESSED_MARKER + ' ' + new Date().toISOString()).trim());

      sheet.getRange(row + 1, col.newName + 1).setValue(finalName);
      sheet.getRange(row + 1, col.status + 1).setValue('OMDÖPT (granskat)');
      applied++;
    } catch (e) {
      sheet.getRange(row + 1, col.status + 1).setValue('FEL vid tillämpning: ' + e.message);
    }
  }

  ui.alert('Klart. ' + applied + ' fil(er) omdöpta, ' + skipped + ' överhoppade.');
}

/**
 * Skapar en temporär Google Docs-kopia av PDF:en med OCR påslaget, läser ut
 * texten och tar sedan bort den temporära kopian igen.
 */
function extractHeadingFromPdf(file) {
  const tempResource = {
    name: 'TEMP_OCR_' + file.getId(),
    mimeType: MimeType.GOOGLE_DOCS,
  };

  let tempFile;
  try {
    tempFile = Drive.Files.copy(tempResource, file.getId(), {
      ocrLanguage: CONFIG.OCR_LANGUAGE,
    });
    const body = DocumentApp.openById(tempFile.id).getBody();
    return pickHeadingFromBody(body);
  } finally {
    if (tempFile && tempFile.id) {
      try {
        Drive.Files.remove(tempFile.id);
      } catch (e) {
        // Kunde inte städa bort tillfällig fil – inte kritiskt.
      }
    }
  }
}

// Antal stycken från dokumentets början som räknas som kandidater till rubrik.
const HEADING_CANDIDATE_LIMIT = 15;

/**
 * Letar bland de första styckena efter den mest troliga rubriken: en
 * OCR-igenkänd rubrikstil (Titel/Rubrik 1/Rubrik 2) prioriteras alltid,
 * annars väljs den rad som har störst typsnittsstorlek (vanligtvis den
 * mest framträdande texten överst i en skanning), i turordning om flera
 * rader har samma storlek.
 */
function pickHeadingFromBody(body) {
  const candidates = [];
  const numChildren = Math.min(body.getNumChildren(), HEADING_CANDIDATE_LIMIT);

  for (let i = 0; i < numChildren; i++) {
    const child = body.getChild(i);
    if (child.getType() !== DocumentApp.ElementType.PARAGRAPH) continue;

    const paragraph = child.asParagraph();
    const text = paragraph.getText().trim();
    if (!isPlausibleHeading(text)) continue;

    let fontSize = 0;
    try {
      fontSize = paragraph.editAsText().getFontSize(0) || 0;
    } catch (e) {
      // Stycket saknar läsbar formatering – behandla som storlek 0.
    }

    const heading = paragraph.getHeading();
    const isStyledHeading =
      heading === DocumentApp.ParagraphHeading.TITLE ||
      heading === DocumentApp.ParagraphHeading.HEADING1 ||
      heading === DocumentApp.ParagraphHeading.HEADING2;

    candidates.push({ text: text, fontSize: fontSize, isStyledHeading: isStyledHeading, index: i });
  }

  if (candidates.length === 0) return '';

  candidates.sort(function (a, b) {
    if (a.isStyledHeading !== b.isStyledHeading) return a.isStyledHeading ? -1 : 1;
    if (b.fontSize !== a.fontSize) return b.fontSize - a.fontSize;
    return a.index - b.index;
  });

  return candidates[0].text;
}

/** Filtrerar bort tomma rader och rena siffror/datum/sidnummer. */
function isPlausibleHeading(line) {
  if (!line || line.length < 3) return false;
  if (/^[\d\s./-]+$/.test(line)) return false;
  return true;
}

function sanitizeFilename(rawTitle) {
  if (!rawTitle) return '';
  let name = rawTitle
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (name.length > CONFIG.MAX_FILENAME_LENGTH) {
    name = name.substring(0, CONFIG.MAX_FILENAME_LENGTH).trim();
  }
  return name;
}

function ensureUniqueName(folder, baseName, extension, excludeFileId) {
  let candidate = baseName + '.' + extension;
  let counter = 2;
  while (nameExistsInFolder(folder, candidate, excludeFileId)) {
    candidate = baseName + ' (' + counter + ').' + extension;
    counter++;
  }
  return candidate;
}

function nameExistsInFolder(folder, name, excludeFileId) {
  const it = folder.getFilesByName(name);
  while (it.hasNext()) {
    if (it.next().getId() !== excludeFileId) return true;
  }
  return false;
}

function timeIsRunningOut(state) {
  return Date.now() - state.startTime > MAX_RUNTIME_MS;
}

function getOrCreateLogSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(LOG_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(LOG_SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['Tidpunkt', 'Ursprungligt namn', 'Nytt namn', 'Mapp', 'Status', 'Läge', 'Fil-ID']);
  }
  return sheet;
}

function logRow(sheet, originalName, newName, folderName, status, dryRun, fileId) {
  sheet.appendRow([new Date(), originalName, newName, folderName, status, dryRun ? 'DRY RUN' : 'LIVE', fileId || '']);
}
