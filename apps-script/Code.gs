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

  // Lämnar marginal under Apps Scripts körtidsgräns (6 minuter för
  // konsumentkonton, 30 för Google Workspace). Om gränsen börjar närma sig
  // avbryts förhandsgranskningen snyggt och kan fortsätta senare (manuellt
  // eller via triggern, se startAutoPreviewDialog).
  MAX_RUNTIME_MINUTES: 25,

  // Bearbeta bara filer vars NUVARANDE namn innehåller något av orden i
  // RAW_SCAN_NAME_KEYWORDS (skiftlägesokänsligt) – dvs. filer som fortfarande
  // har ett oredigerat skannernamn, som "skannat_hakhil_..." eller
  // "Adobe Scan 03 apr. 2024.pdf". Filer som redan bytt namn till något
  // annat (manuellt, eller av ett tidigare verktyg) hoppas då över utan
  // OCR. Sätt till false för att bearbeta alla PDF:er oavsett namn.
  ONLY_RAW_SCAN_NAMES: true,
  RAW_SCAN_NAME_KEYWORDS: ['scan', 'skannat'],
};

// Sätts i filens beskrivning efter ett lyckat namnbyte så att filen inte
// OCR-tolkas och döps om igen vid en senare körning.
const PROCESSED_MARKER = '[OCR-omdöpt]';

const MAX_RUNTIME_MS = CONFIG.MAX_RUNTIME_MINUTES * 60 * 1000;

const FOLDERS_PROPERTY_KEY = 'FOLDER_LIST';
const PREVIEW_TRIGGER_FOLDER_PROPERTY_KEY = 'PREVIEW_TRIGGER_FOLDER_ID';
const PREVIEW_TICK_HANDLER = 'autoPreviewTick';
const PREVIEW_TRIGGER_INTERVAL_MINUTES = 10;
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
    .addItem('Förhandsgranska alla mappar', 'dryRunRenameAll')
    .addItem('Förhandsgranska en mapp…', 'dryRunOneFolder')
    .addSeparator()
    .addItem('Förhandsgranska automatiskt (mapp)…', 'startAutoPreviewDialog')
    .addItem('Stoppa automatisk förhandsgranskning', 'stopAutoPreviewDialog')
    .addSeparator()
    .addItem('Döp om enligt Logg (efter granskning)', 'applyReviewedNamesFromLog')
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

/**
 * Visar en dialogruta för att välja en av de tillagda mapparna (behövs
 * inte om bara en mapp finns – då returneras den direkt).
 */
function selectFolderDialog(promptTitle) {
  const ui = SpreadsheetApp.getUi();
  const folders = getConfiguredFolders();
  if (folders.length === 0) {
    ui.alert('Inga mappar är tillagda. Lägg till minst en mapp via menyn först.');
    return null;
  }
  if (folders.length === 1) return folders[0];

  const list = folders.map(function (f, i) { return (i + 1) + '. ' + f.name; }).join('\n');
  const response = ui.prompt(promptTitle, 'Ange numret på mappen:\n\n' + list, ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return null;

  const index = parseInt(response.getResponseText().trim(), 10) - 1;
  if (isNaN(index) || index < 0 || index >= folders.length) {
    ui.alert('Ogiltigt nummer.');
    return null;
  }
  return folders[index];
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
  processFoldersList(getConfiguredFolders());
}

function dryRunOneFolder() {
  const folder = selectFolderDialog('Förhandsgranska en mapp');
  if (!folder) return;
  processFoldersList([folder]);
}

/**
 * Går igenom filerna och skriver förslag till Logg. Döper aldrig om något
 * själv – det enda sättet att verkställa ett namnbyte är
 * applyReviewedNamesFromLog(), så att redigeringar i loggen aldrig kan
 * bli överkörda av en parallell "skarp" väg.
 */
function processFoldersList(configuredFolders) {
  const ui = SpreadsheetApp.getUi();
  if (configuredFolders.length === 0) {
    ui.alert('Inga mappar är tillagda. Lägg till minst en mapp via menyn "Lägg till mapp" först.');
    return;
  }

  runPreview_(configuredFolders);
  ui.alert('Förhandsgranskning klar. Öppna fliken "Logg", granska/redigera förslagen och klicka sedan "Döp om enligt Logg" när du är nöjd.');
}

/**
 * Kärnlogiken i förhandsgranskningen, utan UI-anrop, så att den kan köras
 * både från menyn och från en tidsstyrd trigger (se autoPreviewTick).
 * Filer som redan har en rad i Logg (oavsett status) hoppas över utan
 * OCR, så upprepade körningar mot samma mapp varken skapar dubbletter i
 * loggen eller OCR-tolkar samma fil två gånger.
 */
function runPreview_(configuredFolders) {
  const sheet = getOrCreateLogSheet();
  const state = {
    startTime: Date.now(),
    stopped: false,
    skippedAlreadyProcessed: 0,
    skippedAlreadyLogged: 0,
    skippedNotRawScanName: 0,
    newlyLogged: 0,
    alreadyLogged: getAlreadyLoggedFileIds_(sheet),
  };

  configuredFolders.forEach(function (folderInfo) {
    if (state.stopped) return;
    try {
      const folder = DriveApp.getFolderById(folderInfo.id);
      processFolder(folder, sheet, state);
    } catch (e) {
      logRow(sheet, '', '', folderInfo.name || folderInfo.id, 'FEL: kunde inte öppna mapp – ' + e.message, '');
    }
  });

  if (state.skippedNotRawScanName > 0) {
    logRow(sheet, '', '', '', 'Hoppade tyst över ' + state.skippedNotRawScanName + ' fil(er) vars namn inte ser ut som ett oredigerat skannernamn (redan namngivna).', '');
  }
  if (state.skippedAlreadyProcessed > 0) {
    logRow(sheet, '', '', '', 'Hoppade tyst över ' + state.skippedAlreadyProcessed + ' redan omdöpt(a) fil(er).', '');
  }
  if (state.stopped) {
    logRow(sheet, '', '', '', 'Tidsgränsen närmade sig – kör samma menyval igen för att fortsätta.', '');
  }
  SpreadsheetApp.flush();
  return state;
}

function getAlreadyLoggedFileIds_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return new Set();
  const idCol = LOG_HEADERS.indexOf('Fil-ID') + 1;
  const ids = sheet.getRange(2, idCol, lastRow - 1, 1).getValues().flat();
  return new Set(ids.filter(String));
}

/** Se CONFIG.ONLY_RAW_SCAN_NAMES / RAW_SCAN_NAME_KEYWORDS. */
function looksLikeRawScanName_(fileName) {
  if (!CONFIG.ONLY_RAW_SCAN_NAMES) return true;
  const lower = fileName.toLowerCase();
  return CONFIG.RAW_SCAN_NAME_KEYWORDS.some(function (kw) {
    return lower.indexOf(kw.toLowerCase()) !== -1;
  });
}

function processFolder(folder, sheet, state) {
  if (state.stopped) return;

  const files = folder.getFilesByType(MimeType.PDF);
  while (files.hasNext()) {
    const file = files.next();
    if (!looksLikeRawScanName_(file.getName())) {
      state.skippedNotRawScanName++;
      continue;
    }
    if (state.alreadyLogged.has(file.getId())) {
      state.skippedAlreadyLogged++;
      continue;
    }
    if (timeIsRunningOut(state)) {
      state.stopped = true;
      return;
    }
    processFile(file, folder, sheet, state);
  }

  if (CONFIG.INCLUDE_SUBFOLDERS) {
    const subfolders = folder.getFolders();
    while (subfolders.hasNext()) {
      if (state.stopped) return;
      processFolder(subfolders.next(), sheet, state);
    }
  }
}

function processFile(file, folder, sheet, state) {
  const originalName = file.getName();
  const description = file.getDescription() || '';
  const fileId = file.getId();

  if (description.indexOf(PROCESSED_MARKER) !== -1) {
    state.skippedAlreadyProcessed++;
    return;
  }

  let heading;
  try {
    heading = extractHeadingFromPdf(file);
  } catch (e) {
    logRow(sheet, originalName, '', folder.getName(), 'FEL vid OCR: ' + e.message, fileId);
    state.newlyLogged++;
    return;
  }

  const cleanName = sanitizeFilename(heading);
  if (!cleanName) {
    logRow(sheet, originalName, '', folder.getName(), 'Ingen rubrik hittades – oförändrat', fileId);
    state.newlyLogged++;
    return;
  }

  const newFullName = ensureUniqueName(folder, cleanName, 'pdf', fileId);
  logRow(sheet, originalName, newFullName, folder.getName(), 'FÖRESLAGET', fileId);
  state.newlyLogged++;
}

/* ================= Automatisk förhandsgranskning (trigger) ================= */

/**
 * Kör en gång via menyn: väljer en mapp och ställer in en tidsstyrd
 * trigger som fortsätter förhandsgranska den mappen (inkl. undermappar)
 * var 10:e minut tills alla filer är genomgångna. Triggern tar bort sig
 * själv när den är klar. Döper aldrig om något – det steget är fortfarande
 * manuellt via "Döp om enligt Logg".
 */
function startAutoPreviewDialog() {
  const folder = selectFolderDialog('Automatisk förhandsgranskning – välj mapp');
  if (!folder) return;

  PropertiesService.getDocumentProperties().setProperty(PREVIEW_TRIGGER_FOLDER_PROPERTY_KEY, folder.id);
  deleteTriggersForHandler_(PREVIEW_TICK_HANDLER);
  ScriptApp.newTrigger(PREVIEW_TICK_HANDLER)
    .timeBased()
    .everyMinutes(PREVIEW_TRIGGER_INTERVAL_MINUTES)
    .create();

  SpreadsheetApp.getUi().alert(
    'Automatisk förhandsgranskning igång för mappen "' + folder.name + '" (inkl. undermappar). ' +
    'Körs var ' + PREVIEW_TRIGGER_INTERVAL_MINUTES + ':e minut tills alla filer är genomgångna, ' +
    'och stoppar sig själv då. Inget döps om automatiskt – granska fliken Logg och klicka ' +
    '"Döp om enligt Logg" manuellt när du är klar.'
  );
}

function stopAutoPreviewDialog() {
  deleteTriggersForHandler_(PREVIEW_TICK_HANDLER);
  SpreadsheetApp.getUi().alert('Automatisk förhandsgranskning stoppad.');
}

/** Körs av den tidsstyrda triggern. Får aldrig anropa SpreadsheetApp.getUi(). */
function autoPreviewTick() {
  const folderId = PropertiesService.getDocumentProperties().getProperty(PREVIEW_TRIGGER_FOLDER_PROPERTY_KEY);
  const folders = folderId ? [{ id: folderId, name: safeFolderName_(folderId) }] : getConfiguredFolders();

  if (folders.length === 0) {
    Logger.log('Automatisk förhandsgranskning: inga mappar konfigurerade, stoppar triggern.');
    deleteTriggersForHandler_(PREVIEW_TICK_HANDLER);
    return;
  }

  const state = runPreview_(folders);
  Logger.log(
    state.newlyLogged + ' ny(a) fil(er) förhandsgranskade denna körning, ' +
    state.skippedAlreadyLogged + ' redan i loggen sedan tidigare.'
  );

  if (!state.stopped) {
    Logger.log('Klart! Alla filer i mappen är genomgångna. Tar bort triggern.');
    deleteTriggersForHandler_(PREVIEW_TICK_HANDLER);
  }
}

function safeFolderName_(folderId) {
  try {
    return DriveApp.getFolderById(folderId).getName();
  } catch (e) {
    return folderId;
  }
}

function deleteTriggersForHandler_(handlerName) {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === handlerName) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
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

const LOG_HEADERS = ['Tidpunkt', 'Ursprungligt namn', 'Nytt namn', 'Mapp', 'Status', 'Fil-ID'];

/**
 * Hämtar (eller skapar) loggfliken och ser till att rubrikraden alltid
 * matchar den kolumnuppsättning koden förväntar sig – även om fliken
 * skapades av en äldre version av skriptet med andra kolumner. Befintliga
 * datarader rörs inte.
 */
function getOrCreateLogSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(LOG_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(LOG_SHEET_NAME);

  const currentHeader = sheet.getRange(1, 1, 1, LOG_HEADERS.length).getValues()[0];
  const headerMatches = LOG_HEADERS.every(function (h, i) { return currentHeader[i] === h; });
  if (!headerMatches) {
    sheet.getRange(1, 1, 1, LOG_HEADERS.length).setValues([LOG_HEADERS]);
  }
  return sheet;
}

function logRow(sheet, originalName, newName, folderName, status, fileId) {
  sheet.appendRow([new Date(), originalName, newName, folderName, status, fileId || '']);
}
