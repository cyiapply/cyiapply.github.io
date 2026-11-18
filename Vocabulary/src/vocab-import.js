(function (root) {
function wrapPhonetic(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("/") && trimmed.endsWith("/") && trimmed.length > 2) return trimmed;
  return `/${trimmed.replace(/^\/+|\/+$/g, "")}/`;
}

function parseVocabLine(line) {
  const trimmed = line.replace(/^\uFEFF/, "").trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  const phonetics = [];
  const rest = trimmed
    .replace(/\/[^/\n]+?\//g, (match) => {
      phonetics.push(match.trim());
      return " ";
    })
    .replace(/\s+/g, " ")
    .trim();

  if (!rest) return { error: trimmed };

  const cjkAt = rest.search(/[\u3400-\u9FFF\uF900-\uFAFF]/);
  let word = "";
  let meaning = "";
  if (cjkAt === 0) return { error: trimmed };
  if (cjkAt === -1) {
    word = rest;
  } else {
    word = rest.slice(0, cjkAt).trim();
    meaning = rest.slice(cjkAt).trim();
  }

  word = word.replace(/[\s.。,，;；:：!！?？|｜]+$/g, "").trim();
  meaning = meaning.replace(/^[\s.。,，;；:：!！?？|｜]+/g, "").trim();
  if (!word || !/[A-Za-z]/.test(word)) return { error: trimmed };

  const phoneticUk = phonetics[0] || "";
  return {
    word,
    phoneticUk,
    phoneticUs: phonetics[1] || phoneticUk,
    meaning
  };
}

function parseVocabText(text) {
  const records = [];
  const skipped = [];
  text.split(/\r?\n/).forEach((line, index) => {
    const parsed = parseVocabLine(line);
    if (!parsed) return;
    if (parsed.error) {
      skipped.push(index + 1);
      return;
    }
    records.push({
      word: parsed.word,
      phoneticUk: parsed.phoneticUk,
      phoneticUs: parsed.phoneticUs,
      meaning: parsed.meaning,
      example: "",
      exampleZh: ""
    });
  });
  return { records, skipped };
}

const entryCache = new Map();

function cleanIpa(text) {
  const matched = String(text || "").trim().match(/\/[^/\s]+\//);
  const body = (matched ? matched[0] : String(text || ""))
    .replace(/^\/|\/$/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\./g, "")
    .replace(/\s+/g, "");
  return wrapPhonetic(body);
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

function emptyEntry() {
  return { phoneticUk: "", phoneticUs: "", example: "", definition: "" };
}

function copyMissing(target, source) {
  if (!source) return;
  if (!target.phoneticUk && source.phoneticUk) target.phoneticUk = source.phoneticUk;
  if (!target.phoneticUs && source.phoneticUs) target.phoneticUs = source.phoneticUs;
  if (!target.example && source.example) target.example = source.example;
  if (!target.definition && source.definition) target.definition = source.definition;
  if (target.phoneticUk && !target.phoneticUs) target.phoneticUs = target.phoneticUk;
  if (target.phoneticUs && !target.phoneticUk) target.phoneticUk = target.phoneticUs;
}

function joinPhonetics(parts) {
  const read = (item, accent) => String(accent === "us"
    ? (item.phoneticUs || item.phoneticUk)
    : (item.phoneticUk || item.phoneticUs)).replace(/^\/|\/$/g, "").replace(/[ˈˌ]/g, "");
  const uk = parts.map((item) => read(item, "uk")).filter(Boolean);
  const us = parts.map((item) => read(item, "us")).filter(Boolean);
  if (uk.length !== parts.length || us.length !== parts.length) return null;
  return {
    phoneticUk: wrapPhonetic(`ˈ${uk.join("")}`),
    phoneticUs: wrapPhonetic(`ˈ${us.join("")}`)
  };
}

function spellIpa(raw, accent) {
  const uk = accent === "uk";
  let input = String(raw || "").toLowerCase().replace(/[^a-z]/g, "");
  if (!input) return "";
  input = input
    .replace(/are\b/g, uk ? "ɛə" : "ɛr")
    .replace(/ire\b/g, uk ? "aɪə" : "aɪr")
    .replace(/ore\b/g, uk ? "ɔː" : "ɔr")
    .replace(/ure\b/g, uk ? "jʊə" : "jʊr")
    .replace(/([aeiou])([^aeiou])e\b/g, (_, vowel, consonant) => {
      const long = { a: "eɪ", e: "iː", i: "aɪ", o: uk ? "əʊ" : "oʊ", u: "juː" };
      return `${long[vowel] || vowel}${consonant}`;
    });
  const rules = [
    ["tion", "ʃən"], ["sion", "ʒən"], ["cious", "ʃəs"], ["eigh", "eɪ"],
    ["ough", uk ? "əʊ" : "oʊ"], ["igh", "aɪ"], ["ee", "iː"], ["ea", "iː"],
    ["oo", "uː"], ["ai", "eɪ"], ["ay", "eɪ"], ["oi", "ɔɪ"], ["oy", "ɔɪ"],
    ["ou", "aʊ"], ["ow", "aʊ"], ["oa", uk ? "əʊ" : "oʊ"], ["au", "ɔː"],
    ["aw", "ɔː"], ["ph", "f"], ["ch", "tʃ"], ["sh", "ʃ"], ["th", "θ"],
    ["wh", "w"], ["qu", "kw"], ["ck", "k"], ["ng", "ŋ"],
    ["ar", uk ? "ɑː" : "ɑr"], ["or", uk ? "ɔː" : "ɔr"],
    ["er", uk ? "ə" : "ər"], ["ir", uk ? "ɜː" : "ɜr"], ["ur", uk ? "ɜː" : "ɜr"]
  ];
  const singles = {
    a: "æ", e: "e", i: "ɪ", o: uk ? "ɒ" : "ɑ", u: "ʌ",
    b: "b", c: "k", d: "d", f: "f", g: "ɡ", h: "h", j: "dʒ",
    k: "k", l: "l", m: "m", n: "n", p: "p", q: "k", r: "r",
    s: "s", t: "t", v: "v", w: "w", x: "ks", y: "j", z: "z"
  };
  let out = "";
  let index = 0;
  while (index < input.length) {
    if (!/[a-z]/.test(input.charAt(index))) {
      let end = index;
      while (end < input.length && !/[a-z]/.test(input.charAt(end))) end += 1;
      out += input.slice(index, end);
      index = end;
      continue;
    }
    const rule = rules.find(([pattern]) => input.startsWith(pattern, index));
    if (rule) {
      out += rule[1];
      index += rule[0].length;
      continue;
    }
    out += singles[input.charAt(index)] || "";
    index += 1;
  }
  return `ˈ${out}`;
}

function guessPhonetics(word) {
  return {
    phoneticUk: wrapPhonetic(spellIpa(word, "uk")),
    phoneticUs: wrapPhonetic(spellIpa(word, "us"))
  };
}

function fallbackExample(word, definition) {
  const gloss = String(definition || "").replace(/\s+/g, " ").trim();
  if (gloss) {
    const short = gloss.length > 90 ? `${gloss.slice(0, 87).replace(/\s+\S*$/, "")}…` : gloss;
    return `A common meaning of "${word}" is "${short}".`;
  }
  return `They talked about ${word} in class.`;
}

async function fetchDictionary(word) {
  try {
    const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
    if (!response.ok) return null;
    const data = await response.json();
    const entry = Array.isArray(data) ? data[0] : null;
    if (!entry) return null;
    let phoneticUk = "";
    let phoneticUs = "";
    const untagged = [];
    (entry.phonetics || []).forEach((item) => {
      const text = cleanIpa(item.text);
      if (!text) return;
      const audio = String(item.audio || "").toLowerCase();
      if (!phoneticUk && /[-_]uk\b/.test(audio)) phoneticUk = text;
      else if (!phoneticUs && /[-_]us\b/.test(audio)) phoneticUs = text;
      else untagged.push(text);
    });
    if (!phoneticUk) phoneticUk = cleanIpa(entry.phonetic) || untagged[0] || "";
    if (!phoneticUs) phoneticUs = untagged.find((item) => item !== phoneticUk) || phoneticUk;
    let example = "";
    let definition = "";
    (entry.meanings || []).some((meaning) => (meaning.definitions || []).some((item) => {
      if (!definition && item.definition) definition = stripHtml(item.definition);
      if (!example && item.example) example = stripHtml(item.example);
      return Boolean(example && definition);
    }));
    return { phoneticUk, phoneticUs, example, definition };
  } catch (error) {
    return null;
  }
}

function parseWiktionaryIpa(wikitext) {
  let phoneticUk = "";
  let phoneticUs = "";
  const pattern = /\{\{IPA\|en\|([\s\S]*?)\}\}/g;
  let match = pattern.exec(wikitext);
  while (match) {
    const ipas = [];
    let accent = "";
    match[1].split("|").forEach((part) => {
      const piece = part.trim();
      if (piece.charAt(0) === "/") ipas.push(cleanIpa(piece));
      else if (piece.startsWith("a=") || piece.startsWith("aa=")) accent = piece.slice(piece.indexOf("=") + 1).toLowerCase();
    });
    const ipa = ipas.filter(Boolean)[0] || "";
    if (ipa) {
      const isUk = /(^|[,\s])(rp|uk|gb|britain)\b/.test(accent);
      const isUs = /(^|[,\s])(ga|genam|us|american)\b/.test(accent);
      if (isUk && !phoneticUk) phoneticUk = ipa;
      if (isUs && !phoneticUs) phoneticUs = ipa;
      if (!accent && !phoneticUk) phoneticUk = ipa;
    }
    match = pattern.exec(wikitext);
  }
  if (!phoneticUk) phoneticUk = phoneticUs;
  if (!phoneticUs) phoneticUs = phoneticUk;
  return { phoneticUk, phoneticUs };
}

async function fetchWiktionaryTitle(title) {
  try {
    const encoded = encodeURIComponent(title);
    const [textResponse, definitionResponse] = await Promise.all([
      fetch(`https://en.wiktionary.org/w/api.php?action=parse&page=${encoded}&prop=wikitext&format=json&redirects=1&origin=*`),
      fetch(`https://en.wiktionary.org/api/rest_v1/page/definition/${encoded}`)
    ]);
    const found = emptyEntry();
    if (textResponse.ok) {
      const data = await textResponse.json();
      const wikitext = data && data.parse && data.parse.wikitext && data.parse.wikitext["*"];
      if (wikitext) copyMissing(found, parseWiktionaryIpa(wikitext));
    }
    if (definitionResponse.ok) {
      const data = await definitionResponse.json();
      const blocks = data && data.en ? data.en : [];
      blocks.some((block) => (block.definitions || []).some((item) => {
        if (!found.definition && item.definition) found.definition = stripHtml(item.definition);
        const sample = (item.examples && item.examples[0]) || "";
        if (!found.example && sample) found.example = stripHtml(sample);
        return Boolean(found.example && found.definition);
      }));
    }
    if (!found.phoneticUk && !found.example && !found.definition) return null;
    return found;
  } catch (error) {
    return null;
  }
}

async function fetchWiktionary(word) {
  const found = await fetchWiktionaryTitle(word);
  if (found) return found;
  const lower = String(word || "").toLowerCase();
  if (lower && lower !== word) return fetchWiktionaryTitle(lower);
  return null;
}

async function lookupKnown(word) {
  const key = `known:${wordKey(word)}`;
  if (entryCache.has(key)) return entryCache.get(key);
  const pending = (async () => {
    const found = emptyEntry();
    copyMissing(found, await fetchDictionary(word));
    if (!found.phoneticUk || !found.example) copyMissing(found, await fetchWiktionary(word));
    return found;
  })();
  entryCache.set(key, pending);
  return pending;
}

async function lookupCompound(word) {
  const text = String(word || "").toLowerCase().replace(/[^a-z]/g, "");
  if (text.length < 6) return null;
  const splits = [];
  for (let index = 3; index <= text.length - 3; index += 1) {
    splits.push([text.slice(0, index), text.slice(index)]);
  }
  splits.sort((left, right) => Math.abs(left[0].length - left[1].length) - Math.abs(right[0].length - right[1].length));
  for (const [left, right] of splits.slice(0, 4)) {
    const [leftEntry, rightEntry] = await Promise.all([lookupKnown(left), lookupKnown(right)]);
    if (leftEntry.phoneticUk && rightEntry.phoneticUk) return joinPhonetics([leftEntry, rightEntry]);
  }
  return null;
}

async function lookupEntry(word) {
  const key = `entry:${wordKey(word)}`;
  if (entryCache.has(key)) return entryCache.get(key);
  const pending = (async () => {
    const found = emptyEntry();
    copyMissing(found, await fetchDictionary(word));
    if (!found.phoneticUk || !found.example || !found.definition) copyMissing(found, await fetchWiktionary(word));
    if (!found.phoneticUk) copyMissing(found, await lookupCompound(word));
    if (!found.phoneticUk) copyMissing(found, guessPhonetics(word));
    if (!found.example) found.example = fallbackExample(word, found.definition);
    return found;
  })();
  entryCache.set(key, pending);
  return pending;
}

async function lookupMeaning(word) {
  const response = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(word)}&langpair=en|zh-TW`);
  if (!response.ok) return "";
  const data = await response.json();
  if (data.responseStatus && data.responseStatus !== 200) return "";
  const text = String(data.responseData?.translatedText || "").trim();
  if (!text || /MYMEMORY WARNING/i.test(text)) return "";
  if (text.toLowerCase() === word.toLowerCase()) return "";
  return text;
}

function isIncomplete(item) {
  return !item.phoneticUk || !item.phoneticUs || !item.meaning || !item.example || !item.exampleZh;
}

async function completeRecord(record) {
  const result = {
    phoneticFilled: false,
    meaningFilled: false,
    exampleFilled: false,
    phoneticMissed: false,
    meaningMissed: false,
    exampleMissed: false
  };
  const needsPhonetic = !record.phoneticUk || !record.phoneticUs;
  const needsMeaning = !record.meaning;
  const needsExample = !record.example;
  const needsExampleZh = !record.exampleZh;
  if (!needsPhonetic && !needsMeaning && !needsExample && !needsExampleZh) return result;

  try {
    const found = await lookupEntry(record.word);
    if (needsPhonetic) {
      if (!record.phoneticUk) record.phoneticUk = found.phoneticUk || found.phoneticUs || "";
      if (!record.phoneticUs) record.phoneticUs = found.phoneticUs || found.phoneticUk || "";
      if (record.phoneticUk || record.phoneticUs) result.phoneticFilled = true;
      else result.phoneticMissed = true;
    }
    if (needsMeaning) {
      let meaning = await lookupMeaning(record.word);
      if (!meaning && found.definition) meaning = await lookupMeaning(found.definition);
      if (meaning) {
        record.meaning = meaning;
        result.meaningFilled = true;
      } else {
        result.meaningMissed = true;
      }
    }
    if (needsExample && found.example) {
      record.example = found.example;
      result.exampleFilled = true;
    } else if (needsExample) {
      result.exampleMissed = true;
    }
    if (!record.exampleZh && record.example) {
      const translated = await lookupMeaning(record.example);
      if (translated) {
        record.exampleZh = translated;
        result.exampleFilled = true;
      }
    }
  } catch (error) {
    if (needsPhonetic && !record.phoneticUk) result.phoneticMissed = true;
    if (needsMeaning && !record.meaning) result.meaningMissed = true;
    if (needsExample && !record.example) result.exampleMissed = true;
  }
  return result;
}

function downloadText(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function wordsToTxt(words) {
  return `${words.map((item) => {
    const uk = item.phoneticUk || "";
    const us = item.phoneticUs || "";
    const parts = [item.word];
    if (uk && us && uk !== us) parts.push(uk, us);
    else if (uk || us) parts.push(uk || us);
    if (item.meaning) parts.push(item.meaning);
    return parts.join(" ");
  }).join("\n")}\n`;
}

function wordKey(word) {
  return String(word || "").trim().toLowerCase();
}


const STORAGE_KEY = "owen-vocab-import";
const SHEET_ID_KEY = "owen-vocab-sheet-id";
const GOOGLE_CLIENT_ID = "50764895625-tia82ub3ggkufij8cs7pbmlti51b3uav.apps.googleusercontent.com";
const SHEET_SCOPE = "https://www.googleapis.com/auth/drive.file";
const SHEET_HEADERS = ["單字", "英式音標", "美式音標", "中文", "例句", "例句翻譯", "更新時間"];

let accessToken = "";
let tokenExpiresAt = 0;
let tokenClient = null;
let tokenWait = null;

function googleReady() {
  return Boolean(window.google && google.accounts && google.accounts.oauth2);
}

function readSheetId() {
  try {
    return String(localStorage.getItem(SHEET_ID_KEY) || "").trim();
  } catch (error) {
    return "";
  }
}

function writeSheetId(id) {
  localStorage.setItem(SHEET_ID_KEY, id);
}

function sheetRecord(item) {
  return {
    word: item.word,
    phoneticUk: item.phoneticUk || "",
    phoneticUs: item.phoneticUs || "",
    meaning: item.meaning || "",
    example: item.example || "",
    exampleZh: item.exampleZh || ""
  };
}

function sheetStamp() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function mergeSheetRows(existingRows, records, now) {
  const rows = existingRows && existingRows.length
    ? existingRows.map((row) => row.slice())
    : [SHEET_HEADERS.slice()];
  const first = String((rows[0] && rows[0][0]) || "").trim().toLowerCase();
  if (first !== "單字" && first !== "word") rows.unshift(SHEET_HEADERS.slice());
  else rows[0] = SHEET_HEADERS.slice();
  const index = new Map();
  rows.forEach((row, position) => {
    if (position === 0) return;
    const key = wordKey(row[0]);
    if (key) index.set(key, position);
  });
  records.forEach((item) => {
    const record = sheetRecord(item);
    const key = wordKey(record.word);
    if (!key) return;
    const current = index.has(key) ? rows[index.get(key)] : null;
    const next = [
      record.word,
      record.phoneticUk || (current && current[1]) || "",
      record.phoneticUs || (current && current[2]) || "",
      record.meaning || (current && current[3]) || "",
      record.example || (current && current[4]) || "",
      record.exampleZh || (current && current[5]) || "",
      now
    ];
    if (current) rows[index.get(key)] = next;
    else {
      index.set(key, rows.length);
      rows.push(next);
    }
  });
  return rows;
}

function rowsToRecords(rows) {
  return (rows || []).filter((row, index) => {
    const word = String((row && row[0]) || "").trim();
    if (!word) return false;
    if (index === 0 && /^(單字|word)$/i.test(word)) return false;
    return true;
  }).map((row) => ({
    word: String(row[0]).trim(),
    phoneticUk: String(row[1] || ""),
    phoneticUs: String(row[2] || ""),
    meaning: String(row[3] || ""),
    example: String(row[4] || ""),
    exampleZh: String(row[5] || "")
  }));
}

function sheetFailure(error) {
  const code = String((error && error.message) || "");
  if (code === "missing-client" || code === "google-script") {
    return "單字已補全。這個頁面還沒有 Google 登入設定，所以還沒寫進試算表。";
  }
  if (/access_denied|popup_closed|popup_failed|interaction_required/.test(code)) {
    return "沒有完成 Google 登入，這次先存在這個瀏覽器。";
  }
  return "寫入 Google 試算表失敗，這次先存在這個瀏覽器。";
}

function requestToken(prompt) {
  if (accessToken && Date.now() < tokenExpiresAt) return Promise.resolve(accessToken);
  if (!GOOGLE_CLIENT_ID) return Promise.reject(new Error("missing-client"));
  if (!googleReady()) return Promise.reject(new Error("google-script"));
  return new Promise((resolve, reject) => {
    tokenWait = { resolve, reject };
    if (!tokenClient) {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: SHEET_SCOPE,
        callback: (response) => {
          const wait = tokenWait;
          tokenWait = null;
          if (!wait) return;
          if (!response || response.error) {
            accessToken = "";
            tokenExpiresAt = 0;
            wait.reject(new Error((response && response.error) || "access_denied"));
            return;
          }
          accessToken = response.access_token;
          tokenExpiresAt = Date.now() + (Number(response.expires_in) || 3600) * 1000 - 60000;
          wait.resolve(accessToken);
        }
      });
    }
    tokenClient.requestAccessToken({ prompt: prompt || "" });
  });
}

async function sheetApi(path, options) {
  const settings = options || {};
  const response = await fetch(`https://sheets.googleapis.com/v4${path}`, {
    method: settings.method || "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: settings.body
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (error) { data = null; }
  if (!response.ok) {
    const message = data && data.error && data.error.message ? data.error.message : (text || `Google 試算表回應 ${response.status}`);
    const failure = new Error(message);
    failure.status = response.status;
    throw failure;
  }
  return data || {};
}

async function ensureSpreadsheet() {
  const saved = readSheetId();
  if (saved) {
    try {
      await sheetApi(`/spreadsheets/${encodeURIComponent(saved)}?fields=spreadsheetId`);
      return saved;
    } catch (error) {
      if (error.status !== 404) throw error;
    }
  }
  const created = await sheetApi("/spreadsheets", {
    method: "POST",
    body: JSON.stringify({
      properties: { title: "單字卡" },
      sheets: [{ properties: { title: "單字" } }]
    })
  });
  writeSheetId(created.spreadsheetId);
  return created.spreadsheetId;
}

async function readSheetRows(spreadsheetId) {
  const data = await sheetApi(`/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent("單字!A:G")}`);
  return data.values || [];
}

async function ensureVocabSheet(spreadsheetId) {
  try {
    return await readSheetRows(spreadsheetId);
  } catch (error) {
    if (error.status !== 400) throw error;
    await sheetApi(`/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: "單字" } } }] })
    });
    return [];
  }
}

async function saveRecordsToSheet(records) {
  if (!records || !records.length) return null;
  if (!(accessToken && Date.now() < tokenExpiresAt)) await requestToken("");
  const spreadsheetId = await ensureSpreadsheet();
  const rows = await ensureVocabSheet(spreadsheetId);
  const merged = mergeSheetRows(rows, records, sheetStamp());
  const range = `單字!A1:G${merged.length}`;
  await sheetApi(`/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent("單字!A:G")}:clear`, {
    method: "POST",
    body: "{}"
  });
  await sheetApi(`/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
    method: "PUT",
    body: JSON.stringify({ range, majorDimension: "ROWS", values: merged })
  });
  return {
    count: records.length,
    url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`
  };
}

function readImportedWords() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(saved) ? saved.filter((item) => item && item.word) : [];
  } catch (error) {
    return [];
  }
}

function saveImportedWords(importedWords) {
  localStorage.setItem(STORAGE_KEY, `${JSON.stringify(importedWords, null, 2)}\n`);
}

function mergeRecords(deckWords, records) {
  const existing = new Map(deckWords.map((item) => [wordKey(item.word), item]));
  const added = [];
  records.forEach((record) => {
    const key = wordKey(record.word);
    if (!key) return;
    const current = existing.get(key);
    if (current) {
      if (!current.phoneticUk && record.phoneticUk) current.phoneticUk = record.phoneticUk;
      if (!current.phoneticUs && record.phoneticUs) current.phoneticUs = record.phoneticUs;
      if (!current.meaning && record.meaning) current.meaning = record.meaning;
      if (!current.example && record.example) current.example = record.example;
      if (!current.exampleZh && record.exampleZh) current.exampleZh = record.exampleZh;
      return;
    }
    const item = {
      word: record.word,
      phoneticUk: record.phoneticUk || "",
      phoneticUs: record.phoneticUs || record.phoneticUk || "",
      meaning: record.meaning || "",
      example: record.example || "",
      exampleZh: record.exampleZh || ""
    };
    deckWords.push(item);
    existing.set(key, item);
    added.push(item);
  });
  return added;
}

function start(options) {
  const settings = options || {};
  const baseWords = Array.isArray(settings.baseWords) ? settings.baseWords : [];
  const deckWords = baseWords.map((item) => ({ ...item }));
  let importedWords = mergeRecords(deckWords, readImportedWords());
  let enrichToken = 0;
  const notify = typeof settings.onChange === "function" ? settings.onChange : function () {};
  const importButton = document.getElementById("importBtn");
  const exportButton = document.getElementById("exportBtn");
  const fileInput = document.getElementById("importFile");
  const status = document.getElementById("funcStatus");
  let sheetLink = "";

  function setStatus(text) {
    if (!status) return;
    status.textContent = text;
    if (!sheetLink) return;
    status.append(" ");
    const link = document.createElement("a");
    link.href = sheetLink;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = "開啟試算表";
    status.append(link);
  }

  function setBusy(busy) {
    if (importButton) importButton.disabled = busy;
    if (exportButton) exportButton.disabled = busy;
  }

  function rememberImported() {
    const baseKeys = new Set(baseWords.map((item) => wordKey(item.word)));
    importedWords = deckWords.filter((item) => !baseKeys.has(wordKey(item.word)));
    saveImportedWords(importedWords);
  }

  async function loadSheet() {
    const spreadsheetId = readSheetId();
    if (!spreadsheetId || !(accessToken && Date.now() < tokenExpiresAt)) return 0;
    const records = rowsToRecords(await readSheetRows(spreadsheetId));
    const added = mergeRecords(deckWords, records);
    try { rememberImported(); } catch (error) { /* 試算表仍是主要儲存。 */ }
    notify({ added, refresh: added.length === 0 });
    return records.length;
  }

  if (importButton && fileInput) {
    importButton.addEventListener("click", () => {
      fileInput.value = "";
      const openFile = () => fileInput.click();
      if (!GOOGLE_CLIENT_ID || !googleReady() || (accessToken && Date.now() < tokenExpiresAt)) {
        openFile();
        return;
      }
      requestToken("").then(openFile).catch(openFile);
    });

    fileInput.addEventListener("change", async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      if (!file.name.toLowerCase().endsWith(".txt")) {
        setStatus("只接受 .txt 檔。每一行一個單字，格式是：單字 /音標/ 翻譯。");
        return;
      }

      setBusy(true);
      enrichToken += 1;
      setStatus("正在讀取，並補上缺少的音標、翻譯和例句…");
      try {
        const text = await file.text();
        const parsed = parseVocabText(text);
        const records = parsed.records;
        const skipped = parsed.skipped;
        if (!records.length) {
          setStatus(skipped.length
            ? "沒有讀到單字。請確認每一行是「單字 /音標/ 翻譯」，音標前後都要有 /。"
            : "這個 txt 是空的。");
          return;
        }

        const totals = {
          phoneticFilled: 0,
          meaningFilled: 0,
          exampleFilled: 0,
          phoneticMissed: 0,
          meaningMissed: 0,
          exampleMissed: 0
        };
        let finished = 0;
        const limit = 3;
        let next = 0;
        async function run() {
          while (next < records.length) {
            const index = next;
            next += 1;
            const result = await completeRecord(records[index]);
            totals.phoneticFilled += result.phoneticFilled ? 1 : 0;
            totals.meaningFilled += result.meaningFilled ? 1 : 0;
            totals.exampleFilled += result.exampleFilled ? 1 : 0;
            totals.phoneticMissed += result.phoneticMissed ? 1 : 0;
            totals.meaningMissed += result.meaningMissed ? 1 : 0;
            totals.exampleMissed += result.exampleMissed ? 1 : 0;
            finished += 1;
            setStatus(`正在補全 ${finished}/${records.length}…`);
          }
        }
        await Promise.all(Array.from({ length: Math.min(limit, records.length) }, () => run()));

        const added = mergeRecords(deckWords, records);
        const json = `${JSON.stringify(records, null, 2)}\n`;
        const jsonName = `${file.name.replace(/\.txt$/i, "") || "vocabulary"}.json`;
        let stored = true;
        try {
          rememberImported();
        } catch (error) {
          stored = false;
        }
        downloadText(jsonName, json, "application/json");
        notify({ added, refresh: added.length === 0 });

        const kept = records.length - added.length;
        const notes = added.length
          ? [`已加入 ${added.length} 張，原本的 ${baseWords.length} 張都還在。現在共 ${deckWords.length} 張。`]
          : ["這些單字本來就在卡組裡，原本的卡片維持不變。"];
        if (kept) notes.push(`有 ${kept} 張跟現有單字重複，所以沒有再新增。`);
        notes.push(`並下載 ${jsonName}。`);
        setStatus("正在把補完的單字存進 Google 試算表…");
        try {
          const saved = await saveRecordsToSheet(records);
          if (saved && saved.url) sheetLink = saved.url;
          notes.push(`已把補完的 ${records.length} 筆存進 Google 試算表「單字卡」。`);
          try { await loadSheet(); } catch (error) { /* 這次寫入的單字已經在卡組裡。 */ }
        } catch (error) {
          notes.push(sheetFailure(error));
        }
        notes.push(stored ? "新加的單字也暫存在這個瀏覽器。" : "瀏覽器無法暫存，重新整理後要再匯入一次。");
        if (totals.phoneticFilled || totals.meaningFilled || totals.exampleFilled) {
          notes.push(`補上音標 ${totals.phoneticFilled} 筆、翻譯 ${totals.meaningFilled} 筆、例句 ${totals.exampleFilled} 筆。`);
        }
        if (totals.phoneticMissed || totals.meaningMissed || totals.exampleMissed) {
          notes.push(`還有音標 ${totals.phoneticMissed} 筆、翻譯 ${totals.meaningMissed} 筆、例句 ${totals.exampleMissed} 筆沒查到。`);
        }
        if (skipped.length) notes.push(`略過第 ${skipped.join("、")} 行。`);
        setStatus(notes.join(""));
      } catch (error) {
        setStatus("匯入失敗，請再選一次 txt。");
      } finally {
        setBusy(false);
      }
    });
  }

  if (exportButton) {
    exportButton.addEventListener("click", () => {
      downloadText("單字卡.txt", wordsToTxt(deckWords), "text/plain;charset=utf-8");
      setStatus(`已匯出 ${deckWords.length} 筆到 單字卡.txt。`);
    });
  }

  setTimeout(async () => {
    if (GOOGLE_CLIENT_ID && googleReady() && readSheetId()) {
      try {
        await requestToken("none");
        const count = await loadSheet();
        if (count) setStatus(`已從 Google 試算表讀入 ${count} 筆。`);
      } catch (error) {
        /* 沒有現成的 Google 登入時，先用瀏覽器裡的單字。 */
      }
    }
    repairDeck();
  }, 0);
  return { words: deckWords };

  async function repairDeck() {
    const pending = deckWords.filter(isIncomplete);
    if (!pending.length) return;
    const token = ++enrichToken;
    setStatus("正在補上缺少的音標與例句…");
    const totals = { phoneticFilled: 0, meaningFilled: 0, exampleFilled: 0 };
    for (let index = 0; index < pending.length; index += 1) {
      if (token !== enrichToken) return;
      const result = await completeRecord(pending[index]);
      totals.phoneticFilled += result.phoneticFilled ? 1 : 0;
      totals.meaningFilled += result.meaningFilled ? 1 : 0;
      totals.exampleFilled += result.exampleFilled ? 1 : 0;
      notify({ added: [], refresh: true, word: pending[index].word });
    }
    if (token !== enrichToken) return;
    try {
      rememberImported();
    } catch (error) {
      setStatus("音標和例句已補上，但瀏覽器無法暫存。");
      notify({ added: [], refresh: true });
      return;
    }
    if (accessToken && Date.now() < tokenExpiresAt && importedWords.length && (totals.phoneticFilled || totals.meaningFilled || totals.exampleFilled)) {
      try {
        const saved = await saveRecordsToSheet(importedWords);
        if (saved && saved.url) sheetLink = saved.url;
      } catch (error) { /* 本機已存，下次匯入會再寫入試算表。 */ }
    }
    const notes = [];
    if (totals.phoneticFilled) notes.push(`音標 ${totals.phoneticFilled} 筆`);
    if (totals.meaningFilled) notes.push(`翻譯 ${totals.meaningFilled} 筆`);
    if (totals.exampleFilled) notes.push(`例句 ${totals.exampleFilled} 筆`);
    setStatus(notes.length ? `已補上${notes.join("、")}。` : "");
    notify({ added: [], refresh: true });
  }
}

root.VocabImport = { start, wordKey };
})(window);
