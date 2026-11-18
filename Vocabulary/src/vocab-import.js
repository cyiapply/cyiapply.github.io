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

  function setStatus(text) {
    if (status) status.textContent = text;
  }

  function setBusy(busy) {
    if (importButton) importButton.disabled = busy;
    if (exportButton) exportButton.disabled = busy;
  }

  if (importButton && fileInput) {
    importButton.addEventListener("click", () => {
      fileInput.value = "";
      fileInput.click();
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
        importedWords.push(...added);
        const json = `${JSON.stringify(records, null, 2)}\n`;
        const jsonName = `${file.name.replace(/\.txt$/i, "") || "vocabulary"}.json`;
        let stored = true;
        try {
          saveImportedWords(importedWords);
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

  setTimeout(repairDeck, 0);
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
      saveImportedWords(importedWords);
    } catch (error) {
      setStatus("音標和例句已補上，但瀏覽器無法暫存。");
      notify({ added: [], refresh: true });
      return;
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
