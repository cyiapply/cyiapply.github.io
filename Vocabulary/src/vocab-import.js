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

function recordFromFields(source) {
  if (typeof source === "string") {
    const word = source.trim();
    if (!word || !/[A-Za-z]/.test(word)) return null;
    return {
      word,
      phoneticUk: "",
      phoneticUs: "",
      meaning: "",
      example: "",
      exampleZh: ""
    };
  }
  if (!source || typeof source !== "object") return null;
  const word = String(source.word || source.單字 || "").trim();
  if (!word || !/[A-Za-z]/.test(word)) return null;
  const phoneticUk = wrapPhonetic(source.phoneticUk || source.phonetic || source.ipa || source.音標 || source.英式音標 || "");
  const phoneticUs = wrapPhonetic(source.phoneticUs || source.美式音標 || source.phoneticUk || source.phonetic || source.ipa || source.音標 || "");
  return {
    word,
    phoneticUk,
    phoneticUs: phoneticUs || phoneticUk,
    meaning: String(source.meaning || source.中文 || source.中文說明 || source.翻譯 || source.translation || "").trim(),
    example: String(source.example || source.例句 || "").trim(),
    exampleZh: String(source.exampleZh || source.例句翻譯 || "").trim()
  };
}

function parseVocabJson(text) {
  let data;
  try {
    data = JSON.parse(String(text || "").replace(/^\uFEFF/, ""));
  } catch (error) {
    return { error: "這個 json 無法讀取。", records: [], skipped: [] };
  }
  let list = data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    if (data.word || data.單字) list = [data];
    else list = data.words || data.records || data.items || data.vocabulary || null;
  }
  if (!Array.isArray(list)) {
    return { error: "json 需要是單字陣列。", records: [], skipped: [] };
  }
  const records = [];
  const skipped = [];
  list.forEach((item, index) => {
    const record = recordFromFields(item);
    if (!record) {
      skipped.push(index + 1);
      return;
    }
    records.push(record);
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

function wordKey(word) {
  return String(word || "").trim().toLowerCase();
}


const WORD_STORAGE_PREFIX = "owen-vocab-import";
const SHEET_MAP_KEY = "owen-vocab-sheet-ids";
const LEGACY_WORD_KEY = "owen-vocab-import";
const LEGACY_SHEET_ID_KEY = "owen-vocab-sheet-id";
const GOOGLE_CLIENT_ID = "50764895625-tia82ub3ggkufij8cs7pbmlti51b3uav.apps.googleusercontent.com";
const SHEET_SCOPE = "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email";
const SHEET_HEADERS = ["單字", "英式音標", "美式音標", "中文", "例句", "例句翻譯", "更新時間"];

let accessToken = "";
let tokenExpiresAt = 0;
let tokenClient = null;
let tokenWait = null;
let accountEmail = "";

function googleReady() {
  return Boolean(window.google && google.accounts && google.accounts.oauth2);
}

function sheetTitle(email) {
  return `單字卡 ${email}`;
}

function exportFileName() {
  return `${accountEmail ? sheetTitle(accountEmail) : "單字卡"}.json`;
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const saved = JSON.parse(raw);
    return saved == null ? fallback : saved;
  } catch (error) {
    return fallback;
  }
}

function readSheetMap() {
  const saved = readJson(SHEET_MAP_KEY, {});
  return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
}

function readSheetId(email) {
  if (!email) return "";
  return String(readSheetMap()[email] || "").trim();
}

function writeSheetId(email, id) {
  const map = readSheetMap();
  map[email] = id;
  localStorage.setItem(SHEET_MAP_KEY, JSON.stringify(map));
}

function readLegacySheetId() {
  try {
    return String(localStorage.getItem(LEGACY_SHEET_ID_KEY) || "").trim();
  } catch (error) {
    return "";
  }
}

function wordStorageKey(email) {
  return `${WORD_STORAGE_PREFIX}:${email}`;
}

function readWordList(key) {
  const saved = readJson(key, []);
  return Array.isArray(saved) ? saved.filter((item) => item && item.word) : [];
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
  if (code === "missing-account") {
    return "沒有讀到 Google 帳號，所以還沒寫進試算表。";
  }
  if (code === "sheet-denied") {
    return "無法開啟這個帳號的單字卡，所以這次沒寫進試算表。";
  }
  if (/access_denied|popup_closed|popup_failed|interaction_required/.test(code)) {
    return "沒有完成 Google 登入，這次先存在這個瀏覽器。";
  }
  return "寫入 Google 試算表失敗，這次先存在這個瀏覽器。";
}

let tokenQueue = Promise.resolve();

function requestToken(prompt) {
  const run = tokenQueue.then(() => requestTokenNow(prompt), () => requestTokenNow(prompt));
  tokenQueue = run.then(() => {}, () => {});
  return run;
}

function requestTokenNow(prompt) {
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

function driveQueryLiteral(value) {
  return `'${String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

async function driveApi(path, options) {
  const settings = options || {};
  const response = await fetch(`https://www.googleapis.com/drive/v3${path}`, {
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
    const message = data && data.error && data.error.message ? data.error.message : (text || `Google 雲端硬碟回應 ${response.status}`);
    const failure = new Error(message);
    failure.status = response.status;
    throw failure;
  }
  return data || {};
}

async function fetchAccountEmail() {
  const response = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (error) { data = null; }
  if (!response.ok || !data || !data.email) throw new Error("missing-account");
  return String(data.email).trim().toLowerCase();
}

async function ensureAccount() {
  if (!(accessToken && Date.now() < tokenExpiresAt)) await requestToken("");
  if (!accountEmail) accountEmail = await fetchAccountEmail();
  return accountEmail;
}

async function canOpenSpreadsheet(id) {
  try {
    await sheetApi(`/spreadsheets/${encodeURIComponent(id)}?fields=spreadsheetId`);
    return "ok";
  } catch (error) {
    if (error.status === 404) return "missing";
    if (error.status === 403) return "denied";
    throw error;
  }
}

async function renameSpreadsheet(spreadsheetId, title) {
  const meta = await sheetApi(`/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=properties.title`);
  if (meta.properties && meta.properties.title === title) return;
  await sheetApi(`/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({
      requests: [{
        updateSpreadsheetProperties: {
          properties: { title },
          fields: "title"
        }
      }]
    })
  });
}

async function findSheetByTitle(title) {
  const query = [
    `name = ${driveQueryLiteral(title)}`,
    "mimeType = 'application/vnd.google-apps.spreadsheet'",
    "trashed = false"
  ].join(" and ");
  const data = await driveApi(`/files?q=${encodeURIComponent(query)}&fields=files(id,name)&pageSize=10&spaces=drive`);
  const match = (data.files || []).find((file) => file && file.id && file.name === title);
  return match ? match.id : "";
}

async function ensureSpreadsheet(create) {
  const email = await ensureAccount();
  const title = sheetTitle(email);
  const saved = readSheetId(email);
  if (saved) {
    const state = await canOpenSpreadsheet(saved);
    if (state === "ok") {
      await renameSpreadsheet(saved, title);
      return { id: saved, title, adoptedLegacy: false };
    }
    if (state === "denied") throw new Error("sheet-denied");
  }
  let driveError = null;
  try {
    const found = await findSheetByTitle(title);
    if (found) {
      writeSheetId(email, found);
      return { id: found, title, adoptedLegacy: false };
    }
  } catch (error) {
    driveError = error;
  }
  const legacy = readLegacySheetId();
  if (legacy && legacy !== saved) {
    const state = await canOpenSpreadsheet(legacy);
    if (state === "ok") {
      await renameSpreadsheet(legacy, title);
      writeSheetId(email, legacy);
      try { localStorage.removeItem(LEGACY_SHEET_ID_KEY); } catch (error) { /* 帳號對應的 id 已經記下。 */ }
      return { id: legacy, title, adoptedLegacy: true };
    }
  }
  if (driveError && !create) throw driveError;
  if (!create) return { id: "", title, adoptedLegacy: false };
  const created = await sheetApi("/spreadsheets", {
    method: "POST",
    body: JSON.stringify({
      properties: { title },
      sheets: [{ properties: { title: "單字" } }]
    })
  });
  writeSheetId(email, created.spreadsheetId);
  return { id: created.spreadsheetId, title, adoptedLegacy: false };
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
  const sheet = await ensureSpreadsheet(true);
  const rows = await ensureVocabSheet(sheet.id);
  const merged = mergeSheetRows(rows, records, sheetStamp());
  const range = `單字!A1:G${merged.length}`;
  await sheetApi(`/spreadsheets/${encodeURIComponent(sheet.id)}/values/${encodeURIComponent("單字!A:G")}:clear`, {
    method: "POST",
    body: "{}"
  });
  await sheetApi(`/spreadsheets/${encodeURIComponent(sheet.id)}/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
    method: "PUT",
    body: JSON.stringify({ range, majorDimension: "ROWS", values: merged })
  });
  return {
    count: records.length,
    url: `https://docs.google.com/spreadsheets/d/${sheet.id}`,
    title: sheet.title
  };
}

function readImportedWords(email) {
  if (!email) return [];
  return readWordList(wordStorageKey(email));
}

function readLegacyWords() {
  return readWordList(LEGACY_WORD_KEY);
}

function saveImportedWords(email, importedWords) {
  localStorage.setItem(wordStorageKey(email), `${JSON.stringify(importedWords, null, 2)}\n`);
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
  let importedWords = [];
  let enrichToken = 0;
  const notify = typeof settings.onChange === "function" ? settings.onChange : function () {};
  const onBusy = typeof settings.onBusy === "function" ? settings.onBusy : function () {};
  const importButton = document.getElementById("importBtn");
  const fileInput = document.getElementById("importFile");
  const status = document.getElementById("funcStatus");
  let sheetLink = "";
  let guideReady = false;

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

  function setGuideLock(locked) {
    if (!importButton) return;
    importButton.disabled = locked;
    importButton.classList.toggle("is-locked", locked);
    if (locked) importButton.title = "先完成上方的引導";
    else importButton.removeAttribute("title");
  }

  function setBusy(busy) {
    if (importButton) {
      importButton.disabled = busy || !guideReady;
      importButton.classList.toggle("is-busy", busy);
    }
    onBusy(busy);
  }

  function rememberImported() {
    const baseKeys = new Set(baseWords.map((item) => wordKey(item.word)));
    importedWords = deckWords.filter((item) => !baseKeys.has(wordKey(item.word)));
    if (!accountEmail) return false;
    saveImportedWords(accountEmail, importedWords);
    return true;
  }

  async function loadAccountDeck() {
    const email = await ensureAccount();
    const title = sheetTitle(email);
    const incoming = readImportedWords(email);
    let adoptedLegacyWords = false;
    const sheet = await ensureSpreadsheet(false);
    if (!incoming.length && (sheet.adoptedLegacy || !readLegacySheetId())) {
      const legacyWords = readLegacyWords();
      if (legacyWords.length) {
        incoming.push(...legacyWords);
        adoptedLegacyWords = true;
      }
    }
    const added = mergeRecords(deckWords, incoming);
    let remoteCount = 0;
    if (sheet.id) {
      const records = rowsToRecords(await readSheetRows(sheet.id));
      remoteCount = records.length;
      added.push(...mergeRecords(deckWords, records));
      sheetLink = `https://docs.google.com/spreadsheets/d/${sheet.id}`;
    }
    let stored = false;
    try { stored = rememberImported(); } catch (error) { stored = false; }
    if (adoptedLegacyWords && stored) {
      try { localStorage.removeItem(LEGACY_WORD_KEY); } catch (error) { /* 帳號自己的單字已經記下。 */ }
    }
    return { added, remoteCount, title, sheetId: sheet.id, localCount: incoming.length };
  }

  let accountDeckPromise = null;

  function loadAccountDeckOnce() {
    if (!accountDeckPromise) {
      accountDeckPromise = loadAccountDeck().then((result) => {
        if (result.added.length) notify({ added: result.added, refresh: false });
        else if (result.remoteCount || result.localCount) notify({ added: [], refresh: true });
        if (result.remoteCount) setStatus(`已從「${result.title}」讀入 ${result.remoteCount} 筆。`);
        else if (!result.sheetId && !result.localCount) setStatus(`這個帳號還沒有單字卡。匯入後會建立「${result.title}」。`);
        return result;
      }).catch((error) => {
        accountDeckPromise = null;
        throw error;
      });
    }
    return accountDeckPromise;
  }

  async function loadSheet() {
    if (!(accessToken && Date.now() < tokenExpiresAt)) return 0;
    const sheet = await ensureSpreadsheet(false);
    if (!sheet.id) return 0;
    const records = rowsToRecords(await readSheetRows(sheet.id));
    const added = mergeRecords(deckWords, records);
    try { rememberImported(); } catch (error) { /* 試算表仍是主要儲存。 */ }
    sheetLink = `https://docs.google.com/spreadsheets/d/${sheet.id}`;
    notify({ added, refresh: added.length === 0 });
    return records.length;
  }

  if (importButton && fileInput) {
    importButton.addEventListener("click", () => {
      if (!guideReady) return;
      fileInput.value = "";
      const openFile = () => fileInput.click();
      const openAccount = () => {
        loadAccountDeckOnce().catch(() => {});
      };
      if (!GOOGLE_CLIENT_ID || !googleReady()) {
        openFile();
        return;
      }
      if (accessToken && Date.now() < tokenExpiresAt) {
        openAccount();
        openFile();
        return;
      }
      requestToken("").then(() => {
        openAccount();
        openFile();
      }).catch(openFile);
    });

    fileInput.addEventListener("change", async () => {
      if (!guideReady) return;
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      const lowerName = file.name.toLowerCase();
      const isTxt = lowerName.endsWith(".txt");
      const isJson = lowerName.endsWith(".json");
      if (!isTxt && !isJson) {
        setStatus("只接受 .txt 或 .json。txt 每一行是：單字 /音標/ 中文說明。");
        return;
      }

      setBusy(true);
      enrichToken += 1;
      setStatus("正在讀取這個帳號的單字卡…");
      if (accessToken && Date.now() < tokenExpiresAt) {
        try { await loadAccountDeckOnce(); } catch (error) { /* 讀不到時仍處理這次選的檔案。 */ }
      }
      setStatus("正在讀取，並補上缺少的音標、中文和例句…");
      try {
        const text = await file.text();
        const parsed = isJson ? parseVocabJson(text) : parseVocabText(text);
        if (parsed.error) {
          setStatus(parsed.error);
          return;
        }
        const records = parsed.records;
        const skipped = parsed.skipped;
        if (!records.length) {
          setStatus(skipped.length
            ? (isJson
              ? "沒有讀到單字。json 裡每一筆都要有英文單字。"
              : "沒有讀到單字。請確認每一行是「單字 /音標/ 中文說明」，音標前後都要有 /。")
            : (isJson ? "這個 json 沒有單字。" : "這個 txt 是空的。"));
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
        let stored = false;
        try {
          stored = rememberImported();
        } catch (error) {
          stored = false;
        }
        notify({ added, refresh: added.length === 0 });

        const kept = records.length - added.length;
        const notes = added.length
          ? [`已加入 ${added.length} 張，原本的 ${baseWords.length} 張都還在。現在共 ${deckWords.length} 張。`]
          : ["這些單字本來就在卡組裡，原本的卡片維持不變。"];
        if (kept) notes.push(`有 ${kept} 張跟現有單字重複，所以沒有再新增。`);
        setStatus("正在把補完的單字存進 Google 試算表…");
        try {
          const saved = await saveRecordsToSheet(records);
          if (saved && saved.url) sheetLink = saved.url;
          notes.push(`已把補完的 ${records.length} 筆存進「${saved.title}」。`);
          try { await loadSheet(); } catch (error) { /* 這次寫入的單字已經在卡組裡。 */ }
        } catch (error) {
          notes.push(sheetFailure(error));
        }
        try {
          stored = rememberImported();
        } catch (error) {
          stored = false;
        }
        if (accountEmail) {
          notes.push(stored ? "新加的單字也暫存在這個帳號。" : "瀏覽器無法暫存，重新整理後會再從這個帳號的單字卡讀取。");
        } else {
          notes.push("還沒登入 Google，重新整理後要再匯入一次。");
        }
        if (totals.phoneticFilled || totals.meaningFilled || totals.exampleFilled) {
          notes.push(`補上音標 ${totals.phoneticFilled} 筆、中文 ${totals.meaningFilled} 筆、例句 ${totals.exampleFilled} 筆。`);
        }
        if (totals.phoneticMissed || totals.meaningMissed || totals.exampleMissed) {
          notes.push(`還有音標 ${totals.phoneticMissed} 筆、中文 ${totals.meaningMissed} 筆、例句 ${totals.exampleMissed} 筆沒查到。`);
        }
        if (skipped.length) {
          notes.push(isJson
            ? `略過第 ${skipped.join("、")} 筆。`
            : `略過第 ${skipped.join("、")} 行。`);
        }
        setStatus(notes.join(""));
      } catch (error) {
        setStatus("匯入失敗，請再選一次檔案。");
      } finally {
        setBusy(false);
      }
    });
  }

  setGuideLock(true);

  function releaseGuide() {
    if (guideReady) return;
    guideReady = true;
    setGuideLock(false);
    setTimeout(async () => {
      if (GOOGLE_CLIENT_ID && googleReady()) {
        try {
          await requestToken("none");
          await loadAccountDeckOnce();
        } catch (error) {
          /* 沒有現成的 Google 登入時，先用內建單字。匯入時會再登入並讀取這個帳號的單字卡。 */
        }
      }
      repairDeck();
    }, 0);
  }

  return { words: deckWords, releaseGuide };

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
    if (totals.meaningFilled) notes.push(`中文 ${totals.meaningFilled} 筆`);
    if (totals.exampleFilled) notes.push(`例句 ${totals.exampleFilled} 筆`);
    setStatus(notes.length ? `已補上${notes.join("、")}。` : "");
    notify({ added: [], refresh: true });
  }
}

root.VocabImport = { start, wordKey, exportFileName };
})(window);
