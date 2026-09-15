const CHAT_KEY = "sleep-hub-v3-chat";
const CHAT_WELCOME =
  "第三版把编译做成对话。把 jsonl、日志、说明丢进来，或直接说怎么采集、怎么叫醒。说「编译进中控」会写入当前方案。";

let chatMessages = loadChat();
let pendingFiles = [];
let chatBusy = false;

function loadChat() {
  try {
    const raw = JSON.parse(localStorage.getItem(CHAT_KEY) || "null");
    if (Array.isArray(raw)) return raw.slice(-40);
  } catch {
    /* ignore */
  }
  return [];
}

function saveChat() {
  try {
    localStorage.setItem(CHAT_KEY, JSON.stringify(chatMessages.slice(-40)));
  } catch {
    /* ignore */
  }
}

function ntfyTopicSafe() {
  return typeof ntfyTopic === "function" ? ntfyTopic() : "sleep-hub";
}

function fileKind(file) {
  const name = String(file.name || "").toLowerCase();
  const mime = String(file.type || "").toLowerCase();
  if (mime.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp)$/.test(name)) return "image";
  if (mime === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  return "text";
}

function looksBinary(text) {
  const n = Math.min(text.length, 4000);
  for (let i = 0; i < n; i++) if (text.charCodeAt(i) === 0) return true;
  if (text.slice(0, 8).indexOf("%PDF") === 0) return true;
  return (text.match(/\uFFFD/g) || []).length > 20;
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || ""));
    fr.onerror = () => reject(new Error("读图失败"));
    fr.readAsDataURL(file);
  });
}

async function packLocalFile(file) {
  const name = String(file.name || "file").slice(0, 80);
  const kind = fileKind(file);
  if (file.size > 400000) return { name, error: "超过 400KB" };
  if (kind === "pdf") return { name, error: "PDF 请先另存为文本" };
  if (kind === "image") {
    const image = await readAsDataUrl(file);
    if (image.length > 400000) return { name, error: "图片太大" };
    return { name, image, mime: file.type || "image/*" };
  }
  const text = await file.text();
  if (looksBinary(text)) return { name, error: "不像可读文本" };
  return { name, text: text.slice(0, 80000), mime: file.type || "text/plain" };
}

function renderChatFiles() {
  const box = $("chatFiles");
  if (!box) return;
  box.innerHTML = "";
  if (!pendingFiles.length) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  pendingFiles.forEach((f, i) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chat-chip" + (f.error ? " bad" : "");
    chip.textContent = (f.error ? "!" : "") + f.name + (f.error ? " · " + f.error : "");
    chip.title = f.error || "点掉这个附件";
    chip.onclick = () => {
      pendingFiles.splice(i, 1);
      renderChatFiles();
    };
    box.append(chip);
  });
}

function renderChatLog() {
  const box = $("chatLog");
  if (!box) return;
  box.innerHTML = "";
  const rows = chatMessages.length
    ? chatMessages
    : [{ role: "assistant", content: CHAT_WELCOME }];
  rows.forEach((m, idx) => {
    const el = document.createElement("div");
    el.className = "chat-msg " + (m.role === "user" ? "user" : "bot");
    const body = document.createElement("div");
    body.className = "chat-bubble";
    body.textContent = m.content || "";
    el.append(body);
    if (m.files && m.files.length) {
      const attach = document.createElement("div");
      attach.className = "chat-attach";
      attach.textContent = "附件 " + m.files.join("、");
      el.append(attach);
    }
    if (m.recipe && m.recipe.ok) {
      const card = document.createElement("div");
      card.className = "chat-recipe";
      const title = document.createElement("b");
      title.textContent = m.recipe.name || "已编译方案";
      const p = document.createElement("p");
      p.textContent = m.recipe.report || "可写入中控";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "写入中控";
      btn.onclick = () => writeChatRecipe(m.recipe, m.userText || "");
      card.append(title, p, btn);
      el.append(card);
    }
    box.append(el);
    if (idx === rows.length - 1 && m.pending) {
      el.classList.add("pending");
    }
  });
  box.scrollTop = box.scrollHeight;
}

function writeChatRecipe(out, userText) {
  if (typeof applyCompiled !== "function") {
    logLine("写入失败：中控未就绪");
    return;
  }
  if (recipe && recipe.handEdited && recipe.compiledSteps) {
    if (!window.confirm("方案已手改。用对话里的方案覆盖当前步骤？")) return;
  }
  applyCompiled(out, userText, "");
  if (typeof setCol === "function") setCol("apply");
  logLine("对话方案已写入中控");
}

function shouldAutoWrite(text, recipeOut) {
  if (!recipeOut || !recipeOut.ok) return false;
  return /编译|写入|就按这个|可以了|就这样|按这个/.test(String(text || ""));
}

async function addFiles(fileList) {
  const incoming = Array.from(fileList || []);
  for (const file of incoming) {
    if (pendingFiles.length >= 6) break;
    try {
      pendingFiles.push(await packLocalFile(file));
    } catch {
      pendingFiles.push({ name: file.name || "file", error: "读失败" });
    }
  }
  renderChatFiles();
}

async function sendChat(ev) {
  if (ev) ev.preventDefault();
  if (chatBusy) return;
  const input = $("chatInput");
  const text = (input && input.value.trim()) || "";
  const usable = pendingFiles.filter((f) => !f.error && (f.text || f.image));
  const skipped = pendingFiles.filter((f) => f.error);
  if (!text && !usable.length) return;
  const userMsg = {
    role: "user",
    content: text || "请阅读附件。",
    files: pendingFiles.map((f) => f.name),
  };
  chatMessages.push(userMsg);
  if (skipped.length) {
    chatMessages.push({
      role: "assistant",
      content: "没读成：" + skipped.map((f) => f.name + "（" + f.error + "）").join("、"),
    });
  }
  const filesForApi = usable.map((f) => ({
    name: f.name,
    text: f.text || "",
    image: f.image || "",
  }));
  pendingFiles = [];
  renderChatFiles();
  if (input) input.value = "";
  chatBusy = true;
  $("chatSend").disabled = true;
  chatMessages.push({ role: "assistant", content: "正在读…", pending: true });
  renderChatLog();
  saveChat();
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: chatMessages
          .filter((m) => !m.pending)
          .map((m) => ({ role: m.role, content: m.content })),
        files: filesForApi,
        origin: location.origin,
        topic: ntfyTopicSafe(),
      }),
    });
    const data = await res.json();
    chatMessages = chatMessages.filter((m) => !m.pending);
    if (!data.ok) {
      if (typeof compileNl === "function" && text) {
        const fallback = compileNl(text, "");
        chatMessages.push({
          role: "assistant",
          content: "DeepSeek 不可用，改用关键词编译。",
          recipe: fallback.ok ? fallback : null,
          userText: text,
        });
        if (fallback.ok) writeChatRecipe(fallback, text);
      } else {
        chatMessages.push({
          role: "assistant",
          content: data.error || "对话失败",
        });
      }
      renderChatLog();
      saveChat();
      return;
    }
    const rec = data.recipe && data.recipe.ok ? data.recipe : null;
    chatMessages.push({
      role: "assistant",
      content: data.reply || "我看过了。",
      recipe: rec,
      userText: text,
    });
    if (rec && shouldAutoWrite(text, rec)) writeChatRecipe(rec, text);
    renderChatLog();
    saveChat();
  } catch (e) {
    chatMessages = chatMessages.filter((m) => !m.pending);
    if (typeof compileNl === "function" && text) {
      const fallback = compileNl(text, "");
      chatMessages.push({
        role: "assistant",
        content: "请求失败，改用关键词编译：" + (e.message || e),
        recipe: fallback.ok ? fallback : null,
        userText: text,
      });
      if (fallback.ok) writeChatRecipe(fallback, text);
    } else {
      chatMessages.push({
        role: "assistant",
        content: "请求失败：" + (e.message || e),
      });
    }
    renderChatLog();
    saveChat();
  } finally {
    chatBusy = false;
    if ($("chatSend")) $("chatSend").disabled = false;
  }
}

function initChat() {
  if (!$("chatDock")) return;
  renderChatLog();
  renderChatFiles();
  $("chatForm").onsubmit = sendChat;
  $("chatAttach").onclick = () => $("chatFile").click();
  $("chatFile").onchange = () => {
    addFiles($("chatFile").files);
    $("chatFile").value = "";
  };
  $("chatClear").onclick = () => {
    chatMessages = [];
    pendingFiles = [];
    saveChat();
    renderChatLog();
    renderChatFiles();
  };
  $("chatInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendChat();
    }
  });
  const dock = $("chatDock");
  ["dragenter", "dragover"].forEach((ev) => {
    dock.addEventListener(ev, (e) => {
      e.preventDefault();
      dock.classList.add("drop");
    });
  });
  ["dragleave", "drop"].forEach((ev) => {
    dock.addEventListener(ev, (e) => {
      e.preventDefault();
      dock.classList.remove("drop");
    });
  });
  dock.addEventListener("drop", (e) => {
    if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files);
  });
}

initChat();
