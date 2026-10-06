const $ = (selector) => document.querySelector(selector);

const elements = {
  authDialog: $("#auth-dialog"),
  authEmail: $("#auth-email"),
  authError: $("#auth-error"),
  authForm: $("#auth-form"),
  authLogout: $("#auth-logout"),
  authName: $("#auth-name"),
  authNameField: $("#auth-name-field"),
  authPassword: $("#auth-password"),
  authSubmit: $("#auth-submit"),
  authSwitchButton: $("#auth-switch-button"),
  authSwitchPrompt: $("#auth-switch-prompt"),
  apiBaseForm: $("#api-base-form"),
  apiBaseInput: $("#api-base-input"),
  appStatus: $("#app-status"),
  attachmentButton: $("#attachment-button"),
  attachmentInput: $("#attachment-input"),
  attachmentMenu: $("#attachment-menu"),
  attachmentPreview: $("#attachment-preview"),
  characterCount: $("#character-count"),
  composerForm: $("#composer-form"),
  conversationList: $("#conversation-list"),
  historyEmpty: $("#history-empty"),
  historyDelete: $("#history-delete"),
  messageInput: $("#message-input"),
  messageList: $("#message-list"),
  microphoneButton: $("#microphone-button"),
  memoryEnabled: $("#memory-enabled"),
  memoryError: $("#memory-error"),
  memoryForm: $("#memory-form"),
  memorySave: $("#memory-save"),
  memoryAccountNote: $("#memory-account-note"),
  memoryDelete: $("#memory-delete"),
  messagesScroll: $("#messages-scroll"),
  profileEmail: $("#profile-email"),
  profileForm: $("#profile-form"),
  profileNameInput: $("#profile-name-input"),
  profileAvatar: $("#profile-avatar"),
  profileButton: $("#profile-button"),
  profileLabel: $("#profile-label"),
  profileName: $("#profile-name"),
  sendButton: $("#send-button"),
  settingsDialog: $("#settings-dialog"),
  sidebar: $("#sidebar"),
  sidebarScrim: $("#sidebar-scrim"),
  themeDescription: $("#theme-description"),
  themeToggle: $("#theme-toggle"),
  toast: $("#toast"),
  recordingStatus: $("#recording-status"),
  uploadProgress: $("#upload-progress"),
  uploadProgressBar: $("#upload-progress-bar"),
  uploadProgressLabel: $("#upload-progress-label"),
  cancelUploadButton: $("#cancel-upload-button"),
  topbarAvatar: $("#topbar-avatar"),
  welcomeView: $("#welcome-view"),
  workspaceTitle: $("#workspace-title"),
};

let currentUser = null;
let activeConversationId = null;
let isSending = false;
let authMode = "login";
let toastTimer;
let knownConversations = [];
let selectedFiles = [];
let mediaRecorder = null;
let recordingChunks = [];
let recordingStartedAt = 0;
let recordingTimer = null;
let activeMessageRequest = null;

const MAX_FILES = 3;
const MAX_TOTAL_FILE_BYTES = 12 * 1024 * 1024;
const MAX_VIDEO_SECONDS = 120;
const MAX_AUDIO_SECONDS = 60;
const ATTACHMENT_TYPES = {
  jpg: { mimeType: "image/jpeg", category: "image", maxBytes: 5 * 1024 * 1024 },
  jpeg: { mimeType: "image/jpeg", category: "image", maxBytes: 5 * 1024 * 1024 },
  png: { mimeType: "image/png", category: "image", maxBytes: 5 * 1024 * 1024 },
  webp: { mimeType: "image/webp", category: "image", maxBytes: 5 * 1024 * 1024 },
  mp4: { mimeType: "video/mp4", category: "video", maxBytes: 12 * 1024 * 1024 },
  webm: { mimeType: "video/webm", category: "video", maxBytes: 12 * 1024 * 1024 },
  mp3: { mimeType: "audio/mp3", category: "audio", maxBytes: 5 * 1024 * 1024 },
  wav: { mimeType: "audio/wav", category: "audio", maxBytes: 5 * 1024 * 1024 },
  ogg: { mimeType: "audio/ogg", category: "audio", maxBytes: 5 * 1024 * 1024 },
  aac: { mimeType: "audio/aac", category: "audio", maxBytes: 5 * 1024 * 1024 },
  flac: { mimeType: "audio/flac", category: "audio", maxBytes: 5 * 1024 * 1024 },
  pdf: { mimeType: "application/pdf", category: "document", maxBytes: 8 * 1024 * 1024 },
  txt: { mimeType: "text/plain", category: "text", maxBytes: 1024 * 1024 },
  csv: { mimeType: "text/csv", category: "text", maxBytes: 1024 * 1024 },
};

function formatBytes(value) {
  return value < 1024 * 1024
    ? `${Math.max(1, Math.round(value / 1024))} KB`
    : `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function renderSelectedFiles() {
  elements.attachmentPreview.replaceChildren();
  elements.attachmentPreview.hidden = selectedFiles.length === 0;
  for (const [index, item] of selectedFiles.entries()) {
    const row = document.createElement("div");
    row.className = "attachment-item";
    const preview = document.createElement("div");
    preview.className = "attachment-thumbnail";
    if (item.type.category === "image") {
      const image = document.createElement("img");
      image.src = item.url;
      image.alt = `Pré-visualização de ${item.file.name}`;
      preview.append(image);
    } else if (item.type.category === "video" || item.type.category === "audio") {
      const media = document.createElement(item.type.category);
      media.src = item.url;
      media.preload = "metadata";
      media.controls = true;
      media.setAttribute("aria-label", `Pré-visualização de ${item.file.name}`);
      preview.append(media);
    } else {
      preview.textContent = item.type.category === "video"
        ? "🎥"
        : item.type.category === "audio"
          ? "🎤"
          : item.type.category === "document" || item.type.category === "text"
            ? "📄"
            : "📁";
    }
    const details = document.createElement("span");
    details.className = "attachment-details";
    const name = document.createElement("strong");
    name.textContent = item.file.name;
    const info = document.createElement("small");
    info.textContent = `${formatBytes(item.file.size)}${item.duration ? ` · ${Math.round(item.duration)} s` : ""}`;
    details.append(name, info);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "attachment-remove";
    remove.setAttribute("aria-label", `Remover ${item.file.name}`);
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      URL.revokeObjectURL(item.url);
      selectedFiles.splice(index, 1);
      renderSelectedFiles();
      updateComposer();
    });
    row.append(preview, details, remove);
    elements.attachmentPreview.append(row);
  }
}

function expectedFileType(file) {
  const extension = file.name.split(".").at(-1)?.toLowerCase();
  let type = ATTACHMENT_TYPES[extension];
  if (!type) throw new Error("Este formato não é suportado. Usa imagem, áudio, MP4/WEBM, PDF, TXT ou CSV.");
  if (extension === "webm" && file.type === "audio/webm") {
    type = { mimeType: "audio/webm", category: "audio", maxBytes: 5 * 1024 * 1024 };
  }
  const browserMimeAlias = extension === "mp3" && file.type === "audio/mpeg";
  if (file.type && file.type !== "application/octet-stream"
    && file.type !== type.mimeType && !browserMimeAlias) {
    throw new Error("O formato declarado não corresponde à extensão do ficheiro.");
  }
  if (file.size === 0) throw new Error("O ficheiro está vazio.");
  if (file.size > type.maxBytes) throw new Error(`O ficheiro excede o limite de ${formatBytes(type.maxBytes)}.`);
  return type;
}

async function getVideoDuration(file) {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.onloadedmetadata = () => resolve(video.duration);
      video.onerror = () => reject(new Error("Não foi possível ler a duração deste vídeo."));
      video.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function addFiles(files) {
  for (const file of files) {
    try {
      if (selectedFiles.length >= MAX_FILES) {
        throw new Error(`Podes anexar no máximo ${MAX_FILES} ficheiros por mensagem.`);
      }
      const type = expectedFileType(file);
      const currentSize = selectedFiles.reduce((total, item) => total + item.file.size, 0);
      if (currentSize + file.size > MAX_TOTAL_FILE_BYTES) {
        throw new Error("O tamanho total dos anexos não pode ultrapassar 12 MB.");
      }
      let duration;
      if (type.category === "video") {
        duration = await getVideoDuration(file);
        if (!Number.isFinite(duration) || duration <= 0) {
          throw new Error("Não foi possível determinar a duração do vídeo.");
        }
        if (duration > MAX_VIDEO_SECONDS) {
          throw new Error("Os vídeos devem ter até 2 minutos para análise.");
        }
      }
      selectedFiles.push({ file, type, url: URL.createObjectURL(file), duration });
      renderSelectedFiles();
      updateComposer();
    } catch (error) {
      showToast(error.message);
    }
  }
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Não foi possível preparar ${file.name} para envio.`));
    reader.onload = () => {
      const result = String(reader.result || "");
      const separator = result.indexOf(",");
      if (separator < 0) reject(new Error(`Não foi possível ler ${file.name}.`));
      else resolve(result.slice(separator + 1));
    };
    reader.readAsDataURL(file);
  });
}

async function convertRecordingToWav(blob, fileName) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    throw new Error("Este navegador não consegue converter a gravação para um formato de áudio compatível.");
  }
  const context = new AudioContextClass();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    const targetRate = 16_000;
    const sampleCount = Math.floor(decoded.length * targetRate / decoded.sampleRate);
    const mono = new Float32Array(sampleCount);
    const channels = Array.from(
      { length: decoded.numberOfChannels },
      (_, channel) => decoded.getChannelData(channel),
    );
    for (let index = 0; index < sampleCount; index += 1) {
      const start = Math.floor(index * decoded.sampleRate / targetRate);
      const end = Math.max(start + 1, Math.floor((index + 1) * decoded.sampleRate / targetRate));
      let total = 0;
      for (const channel of channels) {
        let channelTotal = 0;
        for (let sourceIndex = start; sourceIndex < Math.min(end, channel.length); sourceIndex += 1) {
          channelTotal += channel[sourceIndex];
        }
        total += channelTotal / Math.max(1, Math.min(end, channel.length) - start);
      }
      mono[index] = total / channels.length;
    }
    const wav = new ArrayBuffer(44 + sampleCount * 2);
    const view = new DataView(wav);
    const writeText = (offset, text) => {
      for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
    };
    writeText(0, "RIFF");
    view.setUint32(4, 36 + sampleCount * 2, true);
    writeText(8, "WAVE");
    writeText(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, targetRate, true);
    view.setUint32(28, targetRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeText(36, "data");
    view.setUint32(40, sampleCount * 2, true);
    for (let index = 0; index < sampleCount; index += 1) {
      const sample = Math.max(-1, Math.min(1, mono[index]));
      view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    }
    return new File([wav], fileName, { type: "audio/wav" });
  } finally {
    await context.close();
  }
}

function formatHttpStatusError(status, serverError) {
  if (serverError) return serverError;
  switch (status) {
    case 400:
      return "O pedido é inválido. Verifica os dados introduzidos.";
    case 401:
      return "Sessão não autorizada ou expirada.";
    case 403:
      return "Acesso negado pelo servidor.";
    case 404:
      return "Endpoint da API não encontrado (404).";
    case 405:
      return "Método HTTP não permitido (405). Se estás no GitHub Pages, configura o URL do servidor backend Node.js nas Definições (ex.: https://bot-nur.onrender.com).";
    case 429:
      return "Muitos pedidos em pouco tempo. Tenta novamente dentro de instantes.";
    case 500:
      return "Erro interno do servidor (500). Tenta novamente mais tarde.";
    case 502:
    case 503:
      return "Servidor backend ou serviço de IA temporariamente indisponível (502/503).";
    default:
      return `O pedido não foi concluído (${status}).`;
  }
}

function sendMessageWithProgress(path, body) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    activeMessageRequest = xhr;
    const apiBase = getApiBase();
    const fullUrl = apiBase && path.startsWith("/") ? `${apiBase}${path}` : path;
    const isCrossOrigin = Boolean(apiBase) && !apiBase.startsWith(window.location.origin);
    xhr.open("POST", fullUrl);
    if (isCrossOrigin) xhr.withCredentials = true;
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) return;
      const percent = Math.round(event.loaded / event.total * 100);
      elements.uploadProgressBar.value = percent;
      elements.uploadProgressLabel.textContent = percent === 100
        ? "Ficheiros enviados; o Nur está a analisar…"
        : `A enviar ficheiros… ${percent}%`;
    });
    xhr.addEventListener("load", async () => {
      activeMessageRequest = null;
      let data = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        reject(new Error("O servidor devolveu uma resposta inválida."));
        return;
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        if (xhr.status === 401 && path !== "/api/auth/guest") await restoreGuestSession();
        reject(new Error(formatHttpStatusError(xhr.status, data.error)));
        return;
      }
      resolve(data);
    });
    xhr.addEventListener("error", () => {
      activeMessageRequest = null;
      reject(new Error(`Falha de rede ao enviar ficheiros. Verifica se o backend está ativo e o URL do servidor (${apiBase || "mesmo domínio"}).`));
    });
    xhr.addEventListener("abort", () => {
      activeMessageRequest = null;
      const error = new Error("Envio cancelado. Os ficheiros continuam anexados.");
      error.name = "AbortError";
      reject(error);
    });
    xhr.send(JSON.stringify(body));
  });
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elements.toast.classList.remove("visible"), 3600);
}

const getApiBase = () => {
  if (typeof window !== "undefined" && window.BOT_NUR_API_BASE) {
    return window.BOT_NUR_API_BASE.replace(/\/+$/, "");
  }
  try {
    const stored = localStorage.getItem("bot_nur_api_base");
    if (stored) return stored.trim().replace(/\/+$/, "");
  } catch {}
  if (typeof window !== "undefined" && window.location.hostname.endsWith(".github.io")) {
    return "https://bot-nur-api.onrender.com";
  }
  return "";
};

async function api(path, options = {}) {
  const headers = new Headers(options.headers);
  if (options.body) headers.set("Content-Type", "application/json");
  const apiBase = getApiBase();
  const fullUrl = apiBase && path.startsWith("/") ? `${apiBase}${path}` : path;
  const isCrossOrigin = Boolean(apiBase) && !apiBase.startsWith(window.location.origin);
  let response;
  try {
    response = await fetch(fullUrl, {
      credentials: isCrossOrigin ? "include" : "same-origin",
      ...options,
      headers,
    });
  } catch (networkError) {
    throw new Error(`Não foi possível ligar ao servidor de API (${apiBase || "mesmo domínio"}). Verifica se o backend está a funcionar ou configura o URL nas Definições.`);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && path !== "/api/session" && path !== "/api/auth/guest") {
      await restoreGuestSession();
    }
    throw new Error(formatHttpStatusError(response.status, data.error));
  }
  return data;
}

function setUser(user) {
  currentUser = user;
  const initial = Array.from(user.name.trim())[0]?.toLocaleUpperCase("pt-MZ") || "N";
  elements.profileName.textContent = user.name;
  elements.profileLabel.textContent = user.email || "A tua conta";
  elements.profileAvatar.textContent = initial;
  elements.topbarAvatar.textContent = initial;
  elements.profileButton.setAttribute("aria-label", `Perfil e conta de ${user.name}`);
}

function formatTime(value) {
  const date = new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("pt-MZ", { hour: "2-digit", minute: "2-digit" }).format(date);
}

function addMessage({ role, content, createdAt, isError = false, typing = false }) {
  const message = document.createElement("article");
  message.className = `message ${role === "user" ? "user-message" : "assistant-message"}`;
  if (typing) {
    message.dataset.typing = "true";
    message.setAttribute("aria-label", "O Nur está a preparar uma resposta");
    const mark = document.createElement("span");
    mark.className = "message-assistant-mark";
    const image = document.createElement("img");
    image.src = "./nur-mark.svg";
    image.alt = "";
    mark.append(image);
    const dots = document.createElement("span");
    dots.className = "typing-indicator";
    dots.setAttribute("aria-hidden", "true");
    for (let index = 0; index < 3; index += 1) dots.append(document.createElement("span"));
    message.append(mark, dots);
  } else {
    if (role === "assistant") {
      const mark = document.createElement("span");
      mark.className = "message-assistant-mark";
      const image = document.createElement("img");
      image.src = "./nur-mark.svg";
      image.alt = "";
      mark.append(image);
      message.append(mark);
    }
    const body = document.createElement("div");
    body.className = "message-content";
    const text = document.createElement("p");
    text.className = `message-text${isError ? " error-text" : ""}`;
    text.textContent = content;
    body.append(text);
    if (!isError) {
      const time = document.createElement("time");
      time.className = "message-time";
      time.textContent = formatTime(createdAt || new Date().toISOString());
      body.append(time);
      if (role === "assistant" && "speechSynthesis" in window) {
        const voiceControls = document.createElement("div");
        voiceControls.className = "voice-controls";
        const speak = document.createElement("button");
        speak.type = "button";
        speak.textContent = "🔊 Ouvir";
        speak.setAttribute("aria-label", "Ouvir resposta do Nur");
        speak.addEventListener("click", () => {
          window.speechSynthesis.cancel();
          const utterance = new SpeechSynthesisUtterance(content);
          utterance.lang = "pt-MZ";
          window.speechSynthesis.speak(utterance);
        });
        const pause = document.createElement("button");
        pause.type = "button";
        pause.textContent = "⏸ Pausar";
        pause.addEventListener("click", () => window.speechSynthesis.pause());
        pause.setAttribute("aria-label", "Pausar leitura");
        const stop = document.createElement("button");
        stop.type = "button";
        stop.textContent = "⏹ Parar";
        stop.addEventListener("click", () => window.speechSynthesis.cancel());
        stop.setAttribute("aria-label", "Parar leitura");
        voiceControls.append(speak, pause, stop);
        body.append(voiceControls);
      }
    }
    message.append(body);
  }
  elements.welcomeView.hidden = true;
  elements.messageList.append(message);
  elements.messagesScroll.scrollTop = elements.messagesScroll.scrollHeight;
  return message;
}

function showEmptyState() {
  elements.messageList.replaceChildren();
  elements.welcomeView.hidden = false;
}

function updateTitle(title) {
  elements.workspaceTitle.textContent = title || "Nova conversa";
}

function renderConversations(conversations) {
  knownConversations = conversations;
  elements.conversationList.replaceChildren();
  elements.historyEmpty.hidden = conversations.length > 0;
  for (const conversation of conversations) {
    const item = document.createElement("div");
    item.className = `conversation-row${conversation.id === activeConversationId ? " active" : ""}`;
    const open = document.createElement("button");
    open.className = "conversation-item";
    open.type = "button";
    open.setAttribute("aria-label", `Abrir conversa: ${conversation.title}`);
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.classList.add("conversation-item-icon");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z");
    icon.append(path);
    const title = document.createElement("span");
    title.className = "conversation-title";
    title.textContent = conversation.title;
    open.append(icon, title);
    open.addEventListener("click", () => openConversation(conversation.id, conversation.title));
    const remove = document.createElement("button");
    remove.className = "conversation-delete";
    remove.type = "button";
    remove.setAttribute("aria-label", `Apagar conversa: ${conversation.title}`);
    remove.title = "Apagar conversa";
    const trash = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    trash.setAttribute("viewBox", "0 0 24 24");
    trash.setAttribute("aria-hidden", "true");
    const trashPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    trashPath.setAttribute("d", "M3 6h18m-2 0-.9 14H5.9L5 6m4 0V4h6v2m-5 4v6m4-6v6");
    trash.append(trashPath);
    remove.append(trash);
    remove.addEventListener("click", () => deleteConversation(conversation.id, conversation.title));
    item.append(open, remove);
    elements.conversationList.append(item);
  }
}

function rememberConversation(conversation) {
  knownConversations = [
    conversation,
    ...knownConversations.filter((existing) => existing.id !== conversation.id),
  ].sort((first, second) => second.updatedAt.localeCompare(first.updatedAt));
  renderConversations(knownConversations);
}

async function refreshConversations() {
  const data = await api("/api/conversations");
  renderConversations(data.conversations);
  return data.conversations;
}

async function openConversation(id, title) {
  if (isSending) return;
  closeMobileMenu();
  try {
    let selected = knownConversations.find((conversation) => conversation.id === id);
    if (!selected) {
      selected = (await refreshConversations()).find((conversation) => conversation.id === id);
    }
    if (!selected) throw new Error("Esta conversa já não está disponível.");
    activeConversationId = id;
    updateTitle(selected.title || title);
    elements.messageList.replaceChildren();
    const data = await api(`/api/conversations/${encodeURIComponent(id)}/messages`);
    for (const message of data.messages) addMessage(message);
    if (data.messages.length === 0) showEmptyState();
  } catch (error) {
    showToast(error.message);
  }
}

async function createConversation() {
  if (isSending) return;
  try {
    const data = await api("/api/conversations", { method: "POST", body: "{}" });
    activeConversationId = data.conversation.id;
    updateTitle("Nova conversa");
    showEmptyState();
    rememberConversation(data.conversation);
    closeMobileMenu();
    elements.messageInput.focus();
  } catch (error) {
    showToast(error.message);
  }
}

async function deleteConversation(id, title) {
  if (isSending) return;
  if (!window.confirm(`Apagar a conversa "${title}"? Esta ação não pode ser desfeita.`)) return;
  try {
    await api(`/api/conversations/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (activeConversationId === id) {
      activeConversationId = null;
      updateTitle("Nova conversa");
      showEmptyState();
    }
    const conversations = await refreshConversations();
    if (!activeConversationId && conversations.length > 0) {
      await openConversation(conversations[0].id, conversations[0].title);
    }
    showToast("Conversa apagada.");
  } catch (error) {
    showToast(error.message);
  }
}

async function sendMessage(value, files = selectedFiles) {
  const plainContent = value.trim();
  const content = plainContent || (files.length ? "Analisa o conteúdo do(s) ficheiro(s) anexado(s)." : "");
  if ((!content && !files.length) || isSending) return;

  if (!getApiBase() && typeof window !== "undefined" && window.location.hostname.endsWith(".github.io")) {
    showToast("Configura o URL do servidor backend nas Definições para conversar no GitHub Pages.");
    addMessage({
      role: "assistant",
      content: "O site está a ser executado no GitHub Pages (servidor estático). Para o chat funcionar em produção, abre as Definições (ícone ⚙️ no menu) e insere o URL do teu servidor backend Node.js (ex.: https://bot-nur.onrender.com).",
      isError: true,
    });
    return;
  }

  isSending = true;
  elements.sendButton.disabled = true;
  elements.messageInput.disabled = true;
  elements.attachmentButton.disabled = true;
  elements.microphoneButton.disabled = true;
  elements.composerForm.setAttribute("aria-busy", "true");
  elements.uploadProgress.hidden = files.length === 0;
  elements.uploadProgressBar.value = 0;
  if (files.length) elements.uploadProgressLabel.textContent = "A preparar anexos…";
  try {
    let createdConversation = false;
    if (!activeConversationId) {
      const data = await api("/api/conversations", { method: "POST", body: "{}" });
      activeConversationId = data.conversation.id;
      rememberConversation(data.conversation);
      updateTitle("Nova conversa");
      createdConversation = true;
    }

    const previousConversation = knownConversations.find(
      (conversation) => conversation.id === activeConversationId,
    );
    const isFirstMessage = createdConversation || previousConversation?.title === "Nova conversa";
    const visibleContent = files.length
      ? `${content}\n\n[Anexos: ${files.map(({ file }) => file.name).join(", ")}]`
      : content;
    const userMessage = addMessage({ role: "user", content: visibleContent, createdAt: new Date().toISOString() });
    const typing = addMessage({ role: "assistant", typing: true });
    elements.messageInput.value = "";
    updateComposer();

    try {
      const path = `/api/conversations/${encodeURIComponent(activeConversationId)}/messages`;
      const data = files.length
        ? await sendMessageWithProgress(path, {
          content,
          attachments: await Promise.all(files.map(async ({ file, type }) => ({
            name: file.name,
            mimeType: type.mimeType,
            data: await readFileAsBase64(file),
          }))),
        })
        : await api(path, { method: "POST", body: JSON.stringify({ content }) });
      typing.remove();
      userMessage.remove();
      for (const message of data.messages) addMessage(message);
      selectedFiles.forEach(({ url }) => URL.revokeObjectURL(url));
      selectedFiles = [];
      renderSelectedFiles();
      elements.recordingStatus.hidden = true;
      const title = isFirstMessage ? content.slice(0, 64) : previousConversation.title;
      rememberConversation({
        ...previousConversation,
        id: activeConversationId,
        title,
        updatedAt: new Date().toISOString().replace("T", " ").slice(0, 19),
      });
      updateTitle(title);
      elements.appStatus.textContent = "Resposta recebida do Nur.";
    } catch (error) {
      typing.remove();
      elements.messageInput.value = content;
      updateComposer();
      addMessage({ role: "assistant", content: error.message, isError: true });
      await refreshConversations().catch((refreshError) => showToast(refreshError.message));
      showToast(error.message);
    }
  } catch (error) {
    showToast(error.message);
  } finally {
    activeMessageRequest = null;
    elements.uploadProgress.hidden = true;
    isSending = false;
    elements.messageInput.disabled = false;
    elements.attachmentButton.disabled = false;
    elements.microphoneButton.disabled = false;
    elements.composerForm.removeAttribute("aria-busy");
    updateComposer();
    elements.messageInput.focus();
  }
}

function updateComposer() {
  const length = elements.messageInput.value.length;
  elements.characterCount.textContent = `${length.toLocaleString("pt-MZ")} / 4000`;
  elements.sendButton.disabled = isSending || (!elements.messageInput.value.trim() && selectedFiles.length === 0);
  elements.messageInput.style.height = "auto";
  elements.messageInput.style.height = `${Math.min(elements.messageInput.scrollHeight, 172)}px`;
}

function setAuthMode(mode) {
  authMode = mode;
  const isRegistering = mode === "register";
  elements.authNameField.classList.toggle("hidden", !isRegistering);
  elements.authName.required = isRegistering;
  elements.authPassword.autocomplete = isRegistering ? "new-password" : "current-password";
  $("#auth-title").textContent = isRegistering ? "Uma conta para ti." : "Bom ter-te de volta.";
  elements.authSwitchPrompt.textContent = isRegistering ? "Já tens uma conta?" : "Ainda não tens conta?";
  elements.authSwitchButton.textContent = isRegistering ? "Entrar" : "Criar conta";
  elements.authSubmit.textContent = isRegistering ? "Criar a minha conta" : "Entrar";
  elements.authError.hidden = true;
  elements.authLogout.classList.toggle("hidden", !currentUser?.email);
}

function openAuthDialog() {
  setAuthMode("login");
  elements.authForm.reset();
  elements.authError.hidden = true;
  if (!elements.authDialog.open) elements.authDialog.showModal();
}

async function restoreGuestSession() {
  const data = await api("/api/auth/guest", { method: "POST", body: "{}" });
  setUser(data.user);
}

function updateTheme(isDark) {
  document.documentElement.dataset.theme = isDark ? "dark" : "light";
  elements.themeToggle.setAttribute("aria-checked", String(isDark));
  elements.themeToggle.setAttribute("aria-label", isDark ? "Ativar modo claro" : "Ativar modo escuro");
  elements.themeDescription.textContent = isDark ? "Modo escuro" : "Modo claro";
  localStorage.setItem("nur-theme", isDark ? "dark" : "light");
}

function memoryFields() {
  return [...document.querySelectorAll("[data-memory-category]")];
}

function renderMemory(items) {
  const byCategory = new Map(items.map((item) => [item.category, item.content]));
  for (const field of memoryFields()) {
    field.value = byCategory.get(field.dataset.memoryCategory) || "";
  }
}

async function openSettings() {
  elements.profileNameInput.value = currentUser?.name || "";
  elements.profileEmail.textContent = currentUser?.email || "Modo visitante";
  elements.apiBaseInput.value = getApiBase();
  const hasAccount = Boolean(currentUser?.email);
  elements.memoryAccountNote.classList.toggle("hidden", hasAccount);
  elements.memoryForm.querySelectorAll("textarea, button").forEach((field) => {
    field.disabled = !hasAccount;
  });
  elements.memoryEnabled.disabled = !hasAccount;
  elements.memoryDelete.disabled = !hasAccount;
  elements.memoryError.hidden = true;
  if (hasAccount) {
    try {
      const [profile, memory] = await Promise.all([
        api("/api/profile"),
        api("/api/memory"),
      ]);
      elements.profileNameInput.value = profile.profile.name;
      elements.profileEmail.textContent = profile.profile.email;
      elements.memoryEnabled.checked = profile.settings.useMemory;
      renderMemory(memory.items);
    } catch (error) {
      showToast(error.message);
    }
  } else {
    elements.memoryEnabled.checked = false;
    renderMemory([]);
  }
  if (!elements.settingsDialog.open) elements.settingsDialog.showModal();
}

function closeMobileMenu() {
  elements.sidebar.classList.remove("open");
  elements.sidebarScrim.classList.remove("visible");
  elements.sidebarScrim.hidden = true;
}

async function initialize() {
  const savedTheme = localStorage.getItem("nur-theme");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  updateTheme(savedTheme ? savedTheme === "dark" : prefersDark);
  try {
    const session = await api("/api/session");
    if (session.user) setUser(session.user);
    else await restoreGuestSession();
    const conversations = await refreshConversations();
    if (conversations.length > 0) {
      await openConversation(conversations[0].id, conversations[0].title);
    }
  } catch (error) {
    showToast(`Servidor backend inacessível. Podes configurar o URL do servidor nas Definições.`);
    elements.appStatus.textContent = "Não foi possível iniciar uma sessão.";
  }
}

elements.composerForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const content = elements.messageInput.value;
  sendMessage(content);
});

elements.messageInput.addEventListener("input", updateComposer);
elements.attachmentButton.addEventListener("click", () => {
  const willOpen = elements.attachmentMenu.hidden;
  elements.attachmentMenu.hidden = !willOpen;
  elements.attachmentButton.setAttribute("aria-expanded", String(willOpen));
});
elements.attachmentMenu.querySelectorAll("[data-file-kind]").forEach((button) => {
  button.addEventListener("click", () => {
    const filters = {
      image: ".jpg,.jpeg,.png,.webp",
      video: ".mp4,.webm",
      document: ".pdf,.txt,.csv",
      all: `.${Object.keys(ATTACHMENT_TYPES).join(",.")}`,
    };
    elements.attachmentInput.accept = filters[button.dataset.fileKind];
    elements.attachmentMenu.hidden = true;
    elements.attachmentButton.setAttribute("aria-expanded", "false");
    elements.attachmentInput.click();
  });
});
elements.attachmentInput.addEventListener("change", async () => {
  await addFiles(Array.from(elements.attachmentInput.files || []));
  elements.attachmentInput.value = "";
});
elements.cancelUploadButton.addEventListener("click", () => activeMessageRequest?.abort());
elements.microphoneButton.addEventListener("click", async () => {
  if (mediaRecorder?.state === "recording") {
    mediaRecorder.stop();
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    showToast("A gravação de áudio não está disponível neste navegador. Podes anexar um ficheiro de áudio compatível.");
    return;
  }
  if (selectedFiles.length >= MAX_FILES) {
    showToast(`Podes anexar no máximo ${MAX_FILES} ficheiros por mensagem.`);
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus"]
      .find((type) => MediaRecorder.isTypeSupported(type));
    if (!mimeType) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error("Este navegador não oferece um formato de gravação compatível.");
    }
    mediaRecorder = new MediaRecorder(stream, { mimeType });
    recordingChunks = [];
    mediaRecorder.addEventListener("dataavailable", (event) => {
      if (event.data.size) recordingChunks.push(event.data);
    });
    mediaRecorder.addEventListener("stop", async () => {
      clearInterval(recordingTimer);
      stream.getTracks().forEach((track) => track.stop());
      const duration = (Date.now() - recordingStartedAt) / 1000;
      mediaRecorder = null;
      elements.microphoneButton.textContent = "🎤";
      elements.microphoneButton.setAttribute("aria-label", "Gravar mensagem de áudio");
      elements.recordingStatus.textContent = "A preparar o áudio gravado…";
      if (duration > MAX_AUDIO_SECONDS) {
        showToast("O áudio deve ter até 60 segundos.");
        return;
      }
      try {
        const source = new Blob(recordingChunks, { type: mimeType.split(";")[0] });
        const file = await convertRecordingToWav(source, `gravacao-${Date.now()}.wav`);
        elements.recordingStatus.textContent = `Áudio pronto (${Math.round(duration)} s). Podes enviar ou removê-lo.`;
        await addFiles([file]);
      } catch (error) {
        elements.recordingStatus.textContent = "";
        elements.recordingStatus.hidden = true;
        showToast(error.message);
      }
    });
    recordingStartedAt = Date.now();
    mediaRecorder.start();
    elements.recordingStatus.hidden = false;
    elements.recordingStatus.textContent = "🔴 A gravar… 0 s (máximo 60 s)";
    elements.microphoneButton.textContent = "⏹";
    elements.microphoneButton.setAttribute("aria-label", "Parar gravação");
    recordingTimer = setInterval(() => {
      const seconds = Math.floor((Date.now() - recordingStartedAt) / 1000);
      elements.recordingStatus.textContent = `🔴 A gravar… ${seconds} s (máximo 60 s)`;
      if (seconds >= MAX_AUDIO_SECONDS && mediaRecorder?.state === "recording") mediaRecorder.stop();
    }, 500);
  } catch (error) {
    showToast(error.name === "NotAllowedError"
      ? "O acesso ao microfone foi recusado. Permite o microfone nas definições do navegador."
      : error.message);
  }
});
elements.messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    if (!elements.sendButton.disabled) elements.composerForm.requestSubmit();
  }
});

document.querySelectorAll("[data-prompt]").forEach((button) => {
  button.addEventListener("click", () => sendMessage(button.dataset.prompt));
});

$("#new-chat").addEventListener("click", createConversation);
elements.profileButton.addEventListener("click", openAuthDialog);
$("#topbar-profile").addEventListener("click", openAuthDialog);
$("#settings-button").addEventListener("click", openSettings);
elements.authSwitchButton.addEventListener("click", () => {
  setAuthMode(authMode === "login" ? "register" : "login");
});
elements.themeToggle.addEventListener("click", () => {
  updateTheme(document.documentElement.dataset.theme !== "dark");
});

elements.profileForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const data = await api("/api/profile", {
      method: "PATCH",
      body: JSON.stringify({ name: elements.profileNameInput.value.trim() }),
    });
    setUser({ ...currentUser, ...data.profile });
    showToast("Perfil atualizado.");
  } catch (error) {
    showToast(error.message);
  }
});

elements.apiBaseForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  const value = elements.apiBaseInput.value.trim().replace(/\/+$/, "");
  if (value) {
    try {
      new URL(value);
      localStorage.setItem("bot_nur_api_base", value);
      showToast("URL do servidor backend guardado.");
    } catch {
      showToast("Insere um URL válido (ex.: https://bot-nur.onrender.com).");
      return;
    }
  } else {
    localStorage.removeItem("bot_nur_api_base");
    showToast("URL do servidor reposto para o mesmo domínio.");
  }
  initialize();
});

elements.memoryEnabled.addEventListener("change", async () => {
  if (!currentUser?.email) {
    elements.memoryEnabled.checked = false;
    showToast("Cria uma conta para configurar a memória contextual.");
    return;
  }
  const enabled = elements.memoryEnabled.checked;
  elements.memoryEnabled.disabled = true;
  try {
    await api("/api/settings", {
      method: "PATCH",
      body: JSON.stringify({ useMemory: enabled }),
    });
    showToast(enabled ? "O Nur pode usar memória relevante." : "O uso da memória foi desativado.");
  } catch (error) {
    elements.memoryEnabled.checked = !enabled;
    showToast(error.message);
  } finally {
    elements.memoryEnabled.disabled = false;
  }
});

elements.memoryForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const items = memoryFields()
    .map((field) => ({
      category: field.dataset.memoryCategory,
      content: field.value.trim(),
    }))
    .filter((item) => item.content);
  elements.memorySave.disabled = true;
  elements.memoryError.hidden = true;
  try {
    const data = await api("/api/memory", {
      method: "PUT",
      body: JSON.stringify({ items }),
    });
    renderMemory(data.items);
    showToast("A tua memória foi guardada.");
  } catch (error) {
    elements.memoryError.textContent = error.message;
    elements.memoryError.hidden = false;
  } finally {
    elements.memorySave.disabled = false;
  }
});

elements.memoryDelete.addEventListener("click", async () => {
  if (!currentUser?.email) return;
  if (!window.confirm("Apagar toda a memória contextual? Esta ação não pode ser desfeita.")) return;
  try {
    await api("/api/memory", { method: "DELETE" });
    renderMemory([]);
    showToast("Toda a memória contextual foi apagada.");
  } catch (error) {
    showToast(error.message);
  }
});

elements.historyDelete.addEventListener("click", async () => {
  if (!window.confirm("Apagar todas as conversas e mensagens do histórico? Esta ação não pode ser desfeita.")) return;
  try {
    await api("/api/conversations", { method: "DELETE" });
    activeConversationId = null;
    updateTitle("Nova conversa");
    showEmptyState();
    await refreshConversations();
    elements.settingsDialog.close();
    showToast("Todo o histórico foi apagado.");
  } catch (error) {
    showToast(error.message);
  }
});

elements.authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const body = {
    email: elements.authEmail.value.trim(),
    password: elements.authPassword.value,
  };
  if (authMode === "register") body.name = elements.authName.value.trim();
  elements.authSubmit.disabled = true;
  elements.authSubmit.textContent = authMode === "register" ? "A criar a conta..." : "A entrar...";
  elements.authError.hidden = true;
  try {
    const data = await api(`/api/auth/${authMode}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    setUser(data.user);
    elements.authForm.reset();
    elements.authDialog.close();
    activeConversationId = null;
    updateTitle("Nova conversa");
    showEmptyState();
    await refreshConversations();
    showToast(authMode === "register" ? "A tua conta foi criada. Bem-vindo ao Nur!" : "Sessão iniciada. Olá outra vez!");
  } catch (error) {
    elements.authError.textContent = error.message;
    elements.authError.hidden = false;
  } finally {
    elements.authSubmit.disabled = false;
    elements.authSubmit.textContent = authMode === "register" ? "Criar a minha conta" : "Entrar";
  }
});

elements.authLogout.addEventListener("click", async () => {
  try {
    await api("/api/auth/logout", { method: "POST", body: "{}" });
    await restoreGuestSession();
    elements.authForm.reset();
    elements.authDialog.close();
    activeConversationId = null;
    updateTitle("Nova conversa");
    showEmptyState();
    await refreshConversations();
    showToast("Sessão terminada. Continuas com o Nur em modo visitante.");
  } catch (error) {
    elements.authError.textContent = error.message;
    elements.authError.hidden = false;
  }
});

$("#menu-button").addEventListener("click", () => {
  elements.sidebarScrim.hidden = false;
  requestAnimationFrame(() => {
    elements.sidebarScrim.classList.add("visible");
    elements.sidebar.classList.add("open");
  });
});
$("#sidebar-dismiss").addEventListener("click", closeMobileMenu);
elements.sidebarScrim.addEventListener("click", closeMobileMenu);

document.querySelectorAll("[data-close-dialog]").forEach((button) => {
  button.addEventListener("click", () => button.closest("dialog").close());
});
document.querySelectorAll(".dialog").forEach((dialog) => {
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
});
document.addEventListener("keydown", (event) => {
  if (event.altKey && event.key.toLowerCase() === "n") {
    event.preventDefault();
    createConversation();
  }
});

initialize();
