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
  appStatus: $("#app-status"),
  characterCount: $("#character-count"),
  composerForm: $("#composer-form"),
  conversationList: $("#conversation-list"),
  historyEmpty: $("#history-empty"),
  historyDelete: $("#history-delete"),
  messageInput: $("#message-input"),
  messageList: $("#message-list"),
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

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elements.toast.classList.remove("visible"), 3600);
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers);
  if (options.body) headers.set("Content-Type", "application/json");
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && path !== "/api/session") {
      await restoreGuestSession();
    }
    throw new Error(data.error || `O pedido não foi concluído (${response.status}).`);
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
    image.src = "/nur-mark.svg";
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
      image.src = "/nur-mark.svg";
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

async function sendMessage(value) {
  const content = value.trim();
  if (!content || isSending) return;

  isSending = true;
  elements.sendButton.disabled = true;
  elements.messageInput.disabled = true;
  elements.composerForm.setAttribute("aria-busy", "true");
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
    const userMessage = addMessage({ role: "user", content, createdAt: new Date().toISOString() });
    const typing = addMessage({ role: "assistant", typing: true });
    elements.messageInput.value = "";
    updateComposer();

    try {
      const data = await api(
        `/api/conversations/${encodeURIComponent(activeConversationId)}/messages`,
        { method: "POST", body: JSON.stringify({ content }) },
      );
      typing.remove();
      userMessage.remove();
      for (const message of data.messages) addMessage(message);
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
      addMessage({ role: "assistant", content: error.message, isError: true });
      await refreshConversations().catch((refreshError) => showToast(refreshError.message));
      showToast(error.message);
    }
  } catch (error) {
    showToast(error.message);
  } finally {
    isSending = false;
    elements.messageInput.disabled = false;
    elements.composerForm.removeAttribute("aria-busy");
    updateComposer();
    elements.messageInput.focus();
  }
}

function updateComposer() {
  const length = elements.messageInput.value.length;
  elements.characterCount.textContent = `${length.toLocaleString("pt-MZ")} / 4000`;
  elements.sendButton.disabled = isSending || length === 0 || !elements.messageInput.value.trim();
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
    showToast(`Não foi possível ligar à aplicação. ${error.message}`);
    elements.appStatus.textContent = "Não foi possível iniciar uma sessão.";
  }
}

elements.composerForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const content = elements.messageInput.value;
  sendMessage(content);
});

elements.messageInput.addEventListener("input", updateComposer);
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
