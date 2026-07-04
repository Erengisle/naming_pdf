/**
 * Läser skannade PDF:er i valda Google Drive-mappar med OCR och döper om
 * filerna efter den rubrik som verkar inleda dokumentet.
 *
 * Kör dryRunRenameAll() först för att se förslag i en loggflik utan att
 * något byts, och renameAll() när du vill verkställa bytena.
 */

const CONFIG = {
  // Mapp-ID:n för de Drive-mappar som ska genomsökas.
  // ID:t är delen efter /folders/ i mappens webbadress.
  FOLDER_IDS: [
    'KLISTRA_IN_MAPP_ID_1',
    'KLISTRA_IN_MAPP_ID_2',
  ],

  // Genomsök även undermappar till mapparna ovan.
  INCLUDE_SUBFOLDERS: true,

  // Språk för OCR-tolkningen (ISO 639-1), t.ex. 'sv' eller 'en'.
  OCR_LANGUAGE: 'sv',

  // Max längd på det nya filnamnet, exklusive filändelsen ".pdf".
  MAX_FILENAME_LENGTH: 90,

  // Namn på kalkylarket där körningen loggas (skapas automatiskt).
  LOG_SHEET_NAME: 'PDF-namnbyten logg',
};

// Sätts i filens beskrivning efter ett lyckat namnbyte så att filen inte
// OCR-tolkas och döps om igen vid en senare körning.
const PROCESSED_MARKER = '[OCR-omdöpt]';

// Lämnar marginal under Apps Scripts körtidsgräns (6 minuter för
// konsumentkonton). Om gränsen börjar närma sig avbryts körningen snyggt;
// kör bara samma funktion igen för att fortsätta där den slutade.
const MAX_RUNTIME_MS = 5 * 60 * 1000;

function dryRunRenameAll() {
  processAllFolders(true);
}

function renameAll() {
  processAllFolders(false);
}

function processAllFolders(dryRun) {
  const sheet = getOrCreateLogSheet();
  const state = { startTime: Date.now(), stopped: false };

  CONFIG.FOLDER_IDS.forEach(function (folderId) {
    if (state.stopped || !folderId || folderId.indexOf('KLISTRA_IN') === 0) return;
    try {
      const folder = DriveApp.getFolderById(folderId);
      processFolder(folder, dryRun, sheet, state);
    } catch (e) {
      logRow(sheet, '', '', folderId, 'FEL: kunde inte öppna mapp – ' + e.message, dryRun);
    }
  });

  if (state.stopped) {
    logRow(sheet, '', '', '', 'Tidsgränsen närmade sig – kör funktionen igen för att fortsätta.', dryRun);
  }
  SpreadsheetApp.flush();
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

  if (description.indexOf(PROCESSED_MARKER) !== -1) {
    logRow(sheet, originalName, '(oförändrat)', folder.getName(), 'Hoppar över – redan behandlad', dryRun);
    return;
  }

  let heading;
  try {
    heading = extractHeadingFromPdf(file);
  } catch (e) {
    logRow(sheet, originalName, '', folder.getName(), 'FEL vid OCR: ' + e.message, dryRun);
    return;
  }

  const cleanName = sanitizeFilename(heading);
  if (!cleanName) {
    logRow(sheet, originalName, '', folder.getName(), 'Ingen rubrik hittades – oförändrat', dryRun);
    return;
  }

  const newFullName = ensureUniqueName(folder, cleanName, 'pdf', file.getId());

  if (dryRun) {
    logRow(sheet, originalName, newFullName, folder.getName(), 'FÖRESLAGET (dry run)', dryRun);
    return;
  }

  file.setName(newFullName);
  file.setDescription((description + ' ' + PROCESSED_MARKER + ' ' + new Date().toISOString()).trim());
  logRow(sheet, originalName, newFullName, folder.getName(), 'OMDÖPT', dryRun);
}

/**
 * Skapar en temporär Google Docs-kopia av PDF:en med OCR påslaget, läser ut
 * texten och tar sedan bort den temporära kopian igen.
 */
function extractHeadingFromPdf(file) {
  const tempResource = {
    title: 'TEMP_OCR_' + file.getId(),
    mimeType: MimeType.GOOGLE_DOCS,
  };

  let tempFile;
  try {
    tempFile = Drive.Files.copy(tempResource, file.getId(), {
      ocr: true,
      ocrLanguage: CONFIG.OCR_LANGUAGE,
    });
    const text = DocumentApp.openById(tempFile.id).getBody().getText();
    return pickHeadingLine(text);
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

/**
 * Väljer den första raden som ser ut som en rubrik: inte tom, inte bara
 * siffror/datum/sidnummer.
 */
function pickHeadingLine(text) {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.length < 3) continue;
    if (/^[\d\s./-]+$/.test(line)) continue;
    return line;
  }
  return '';
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
  const existing = DriveApp.getFilesByName(CONFIG.LOG_SHEET_NAME);
  const ss = existing.hasNext()
    ? SpreadsheetApp.open(existing.next())
    : SpreadsheetApp.create(CONFIG.LOG_SHEET_NAME);

  const sheet = ss.getSheets()[0];
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['Tidpunkt', 'Ursprungligt namn', 'Nytt namn', 'Mapp', 'Status', 'Läge']);
  }
  return sheet;
}

function logRow(sheet, originalName, newName, folderName, status, dryRun) {
  sheet.appendRow([new Date(), originalName, newName, folderName, status, dryRun ? 'DRY RUN' : 'LIVE']);
}
