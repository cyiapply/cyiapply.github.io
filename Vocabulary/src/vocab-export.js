(function (root) {
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

function exportRecord(item) {
  return {
    word: item.word,
    phoneticUk: item.phoneticUk || "",
    phoneticUs: item.phoneticUs || "",
    meaning: item.meaning || "",
    example: item.example || "",
    exampleZh: item.exampleZh || ""
  };
}

function start(options) {
  const settings = options || {};
  const button = document.getElementById("exportBtn");
  const status = document.getElementById("funcStatus");
  const getWords = typeof settings.getWords === "function" ? settings.getWords : function () { return []; };
  const getFileName = typeof settings.getFileName === "function" ? settings.getFileName : function () { return "單字卡.json"; };
  let guideReady = false;
  let busy = false;

  function setLocked(locked) {
    if (!button) return;
    button.disabled = locked || busy;
    button.classList.toggle("is-locked", locked);
    if (locked) button.title = "先完成上方的引導";
    else button.removeAttribute("title");
  }

  function setBusy(next) {
    busy = Boolean(next);
    if (!button) return;
    button.disabled = busy || !guideReady;
    button.classList.toggle("is-busy", busy);
  }

  function releaseGuide() {
    if (guideReady) return;
    guideReady = true;
    setLocked(false);
  }

  if (button) {
    button.addEventListener("click", () => {
      if (!guideReady || busy) return;
      const words = getWords() || [];
      const fileName = getFileName() || "單字卡.json";
      const payload = words.map((item) => exportRecord(item));
      downloadText(fileName, `${JSON.stringify(payload, null, 2)}\n`, "application/json");
      if (status) status.textContent = `已匯出 ${payload.length} 筆到 ${fileName}。`;
    });
  }

  setLocked(true);
  return { releaseGuide, setBusy };
}

root.VocabExport = { start };
})(window);
