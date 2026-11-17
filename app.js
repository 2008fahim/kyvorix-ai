// ============================================================================
// Kyvorix Ai — frontend app
// Supabase JS v2 (CDN) + config.js. No build step.
// Views: auth (login/register) -> chat -> admin panel (role = admin only).
// All AI calls go through the `chat` Edge Function; provider keys never
// reach the browser.
// ============================================================================

// NOTE: everything below is wrapped in an IIFE. The Supabase UMD build
// declares a global `var supabase`; a top-level `let supabase` here would
// collide with it (SyntaxError: Identifier 'supabase' has already been
// declared) and kill the WHOLE script before any button works — that is
// exactly why the Register tab did nothing on 2026-11-17.
(function () {
const cfg = window.KYVORIX_CONFIG;
// Guard: if the Supabase CDN fails to load (offline), keep the auth view
// visible with a clear message instead of a blank page.
let supabase = null;
if (window.supabase && typeof window.supabase.createClient === "function") {
  supabase = window.supabase.createClient(
    cfg.SUPABASE_URL,
    cfg.SUPABASE_ANON_KEY,
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const el = (sel) => document.querySelector(sel);
const els = (sel) => Array.from(document.querySelectorAll(sel));

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

let toastTimer = null;
function toast(msg, ms = 3500) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), ms);
}

function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("bn-BD", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function todayStartISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

// Markdown-lite: code blocks, inline code, bold, line breaks.
function renderMarkdown(text) {
  const esc = escapeHtml(text);
  const parts = esc.split(/```/);
  let html = "";
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) {
      const m = parts[i].replace(/^\n/, "").match(/^(\w+)\n?([\s\S]*)$/);
      const code = (m ? m[2] : parts[i]).replace(/\n$/, "");
      html += "<pre><code>" + code + "</code></pre>";
    } else {
      html += parts[i]
        .replace(/`([^`]+)`/g, "<code>$1</code>")
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/\n/g, "<br>");
    }
  }
  return html;
}

function copyText(text, btn) {
  const done = () => {
    if (btn) {
      btn.textContent = "✓ কপি হয়েছে";
      setTimeout(() => (btn.textContent = "📋 কপি"), 1500);
    }
  };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => toast("কপি করা যায়নি।"));
  } else {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      done();
    } catch {
      toast("কপি করা যায়নি।");
    }
    ta.remove();
  }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let currentUser = null; // auth user
let currentProfile = null; // profiles row
let currentChatId = null;
let chatMessages = []; // messages of the open chat
let sending = false;

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
let authMode = "login";

function setAuthMode(mode) {
  authMode = mode;
  $("tab-login").classList.toggle("active", mode === "login");
  $("tab-register").classList.toggle("active", mode === "register");
  $("name-field").classList.toggle("hidden", mode === "login");
  $("auth-submit").textContent = mode === "login" ? "লগইন করুন" : "অ্যাকাউন্ট তৈরি করুন";
  $("auth-error").classList.add("hidden");
  $("auth-success").classList.add("hidden");
}

function showAuthError(msg) {
  const e = $("auth-error");
  e.textContent = msg;
  e.classList.remove("hidden");
  $("auth-success").classList.add("hidden");
}

function showAuthSuccess(msg) {
  const s = $("auth-success");
  s.textContent = msg;
  s.classList.remove("hidden");
  $("auth-error").classList.add("hidden");
}

function friendlyAuthError(err) {
  const m = (err?.message || "").toLowerCase();
  if (m.includes("invalid login credentials")) return "ইমেইল বা পাসওয়ার্ড ভুল।";
  if (m.includes("email not confirmed")) return "ইমেইল এখনো নিশ্চিত হয়নি — ইনবক্স চেক করুন।";
  if (m.includes("user already registered")) return "এই ইমেইলে অ্যাকাউন্ট আছে — লগইন করুন।";
  if (m.includes("password")) return "পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।";
  if (m.includes("rate limit") || m.includes("too many")) return "অনেকবার চেষ্টা হয়েছে — একটু পরে আবার করুন।";
  return err?.message || "একটি সমস্যা হয়েছে। আবার চেষ্টা করুন।";
}

async function handleAuth(e) {
  e.preventDefault();
  const email = $("auth-email").value.trim();
  const password = $("auth-password").value;
  const btn = $("auth-submit");
  btn.disabled = true;
  btn.textContent = "অপেক্ষা করুন…";
  try {
    if (authMode === "register") {
      const name = $("auth-name").value.trim();
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { display_name: name || email.split("@")[0] } },
      });
      if (error) throw error;
      showAuthSuccess(
        "অ্যাকাউন্ট তৈরি হয়েছে! ইমেইলে পাঠানো লিংকে ক্লিক করে নিশ্চিত করুন, তারপর লগইন করুন।",
      );
      setAuthMode("login");
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      // onAuthStateChange will switch the view.
    }
  } catch (err) {
    showAuthError(friendlyAuthError(err));
  } finally {
    btn.disabled = false;
    btn.textContent = authMode === "login" ? "লগইন করুন" : "অ্যাকাউন্ট তৈরি করুন";
  }
}

async function loadProfile(userId, retries = 2) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, display_name, role, is_banned")
    .eq("id", userId)
    .single();
  if (error || !data) {
    if (retries > 0) {
      await new Promise((r) => setTimeout(r, 1200));
      return loadProfile(userId, retries - 1);
    }
    return null;
  }
  return data;
}

function showView(name) {
  $("auth-view").classList.toggle("hidden", name !== "auth");
  $("app-view").classList.toggle("hidden", name !== "app");
}

async function enterApp(user) {
  currentUser = user;
  currentProfile = await loadProfile(user.id);
  if (!currentProfile) {
    toast("প্রোফাইল পাওয়া যায়নি। আবার লগইন করুন।");
    await supabase.auth.signOut();
    return;
  }
  if (currentProfile.is_banned) {
    toast("আপনার অ্যাকাউন্টটি বন্ধ করা হয়েছে।");
    await supabase.auth.signOut();
    return;
  }
  $("user-name").textContent = currentProfile.display_name || currentProfile.email.split("@")[0];
  $("user-email").textContent = currentProfile.email;
  $("user-avatar").textContent = (currentProfile.display_name || currentProfile.email || "ক").charAt(0);
  $("admin-open-btn").classList.toggle("hidden", currentProfile.role !== "admin");
  showView("app");
  showChatView();
  await loadChats();
  newChat();
}

async function logout() {
  await supabase.auth.signOut();
  currentUser = null;
  currentProfile = null;
  currentChatId = null;
  chatMessages = [];
  $("chat-list").innerHTML = "";
  $("messages").innerHTML = "";
  showView("auth");
}

// ---------------------------------------------------------------------------
// Chat list (sidebar)
// ---------------------------------------------------------------------------
async function loadChats() {
  const { data, error } = await supabase
    .from("chats")
    .select("id, title, updated_at")
    .eq("user_id", currentUser.id)
    .order("updated_at", { ascending: false })
    .limit(50);
  if (error) {
    toast("চ্যাট তালিকা লোড করা যায়নি।");
    return;
  }
  renderChatList(data || []);
}

function renderChatList(chats) {
  const list = $("chat-list");
  list.innerHTML = "";
  if (!chats.length) {
    list.innerHTML = '<div class="chat-list-empty">এখনো কোনো চ্যাট নেই।</div>';
    return;
  }
  chats.forEach((c) => {
    const item = document.createElement("div");
    item.className = "chat-item" + (c.id === currentChatId ? " active" : "");
    item.innerHTML =
      '<span class="chat-item-title">' + escapeHtml(c.title) + "</span>" +
      '<span class="chat-item-actions">' +
      '<button class="mini-btn" data-act="rename" title="নাম বদলান">✎</button>' +
      '<button class="mini-btn" data-act="delete" title="মুছুন">🗑</button>' +
      "</span>";
    item.querySelector(".chat-item-title").addEventListener("click", () => openChat(c.id));
    item.querySelector('[data-act="rename"]').addEventListener("click", (ev) => {
      ev.stopPropagation();
      renameChat(c.id, c.title);
    });
    item.querySelector('[data-act="delete"]').addEventListener("click", (ev) => {
      ev.stopPropagation();
      deleteChat(c.id);
    });
    list.appendChild(item);
  });
}

async function renameChat(chatId, oldTitle) {
  const title = window.prompt("চ্যাটের নতুন নাম লিখুন:", oldTitle);
  if (!title || title.trim() === oldTitle) return;
  const { error } = await supabase
    .from("chats")
    .update({ title: title.trim().slice(0, 80) })
    .eq("id", chatId);
  if (error) toast("নাম বদলানো যায়নি।");
  else loadChats();
}

async function deleteChat(chatId) {
  if (!window.confirm("এই চ্যাটটি মুছে ফেলবেন?")) return;
  const { error } = await supabase.from("chats").delete().eq("id", chatId);
  if (error) {
    toast("চ্যাট মোছা যায়নি।");
    return;
  }
  if (chatId === currentChatId) newChat();
  loadChats();
}

function newChat() {
  currentChatId = null;
  chatMessages = [];
  $("messages").innerHTML = "";
  $("empty-state").classList.remove("hidden");
  closeSidebarMobile();
  els(".chat-item").forEach((n) => n.classList.remove("active"));
}

async function openChat(chatId) {
  currentChatId = chatId;
  const { data, error } = await supabase
    .from("messages")
    .select("id, role, content, provider_used, created_at")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: true });
  if (error) {
    toast("মেসেজ লোড করা যায়নি।");
    return;
  }
  chatMessages = data || [];
  renderMessages();
  $("empty-state").classList.add("hidden");
  closeSidebarMobile();
  els(".chat-item").forEach((n) => n.classList.toggle("active", false));
  loadChats(); // refresh active highlight
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------
function scrollToBottom() {
  const m = $("messages");
  m.scrollTop = m.scrollHeight;
}

function renderMessages() {
  const box = $("messages");
  box.innerHTML = "";
  $("empty-state").classList.toggle("hidden", chatMessages.length > 0);
  chatMessages.forEach((msg) => {
    box.appendChild(messageNode(msg));
  });
  scrollToBottom();
}

function messageNode(msg) {
  const wrap = document.createElement("div");
  wrap.className = "msg " + (msg.role === "user" ? "msg-user" : "msg-ai");
  const avatar = document.createElement("div");
  avatar.className = "msg-avatar";
  avatar.textContent = msg.role === "user" ? "আপনি" : "K";
  const body = document.createElement("div");
  body.className = "msg-body";
  const content = document.createElement("div");
  content.className = "msg-content";
  content.innerHTML = renderMarkdown(msg.content);
  body.appendChild(content);
  if (msg.role === "assistant") {
    const actions = document.createElement("div");
    actions.className = "msg-actions";
    const copyBtn = document.createElement("button");
    copyBtn.className = "copy-btn";
    copyBtn.type = "button";
    copyBtn.textContent = "📋 কপি";
    copyBtn.addEventListener("click", () => copyText(msg.content, copyBtn));
    actions.appendChild(copyBtn);
    if (msg.provider_used) {
      const tag = document.createElement("span");
      tag.className = "provider-tag";
      tag.textContent = msg.provider_used;
      actions.appendChild(tag);
    }
    body.appendChild(actions);
  }
  wrap.appendChild(avatar);
  wrap.appendChild(body);
  return wrap;
}

function showTyping() {
  const box = $("messages");
  const t = document.createElement("div");
  t.className = "msg msg-ai typing";
  t.id = "typing-indicator";
  t.innerHTML =
    '<div class="msg-avatar">K</div>' +
    '<div class="msg-body"><div class="msg-content"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div></div>';
  box.appendChild(t);
  scrollToBottom();
}

function hideTyping() {
  $("typing-indicator")?.remove();
}

async function sendMessage(e) {
  e.preventDefault();
  const input = $("message-input");
  const text = input.value.trim();
  if (!text || sending) return;
  sending = true;
  $("send-btn").disabled = true;
  input.value = "";
  autoGrow(input);

  // Optimistic user bubble
  chatMessages.push({ role: "user", content: text });
  renderMessages();
  showTyping();

  try {
    const { data, error } = await supabase.functions.invoke("chat", {
      body: { message: text, chat_id: currentChatId || undefined },
    });
    hideTyping();
    if (error) {
      const serverMsg = data?.error || error.message || "";
      chatMessages.push({
        role: "assistant",
        content: "দুঃখিত, " + (serverMsg || "একটি সমস্যা হয়েছে। আবার চেষ্টা করুন।"),
      });
      renderMessages();
      return;
    }
    if (data?.chat_id && data.chat_id !== currentChatId) {
      currentChatId = data.chat_id;
      loadChats();
    }
    chatMessages.push({
      role: "assistant",
      content: data.reply || "কোনো উত্তর পাওয়া যায়নি।",
      provider_used: data.provider || null,
    });
    renderMessages();
  } catch (err) {
    hideTyping();
    chatMessages.push({
      role: "assistant",
      content: "দুঃখিত, নেটওয়ার্ক সমস্যা হয়েছে। আবার চেষ্টা করুন।",
    });
    renderMessages();
  } finally {
    sending = false;
    $("send-btn").disabled = false;
    input.focus();
  }
}

function autoGrow(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = Math.min(textarea.scrollHeight, 160) + "px";
}
// ---------------------------------------------------------------------------
// Admin panel
// ---------------------------------------------------------------------------
function showAdminView() {
  $("chat-view").classList.add("hidden");
  $("admin-view").classList.remove("hidden");
  closeSidebarMobile();
  loadDashboard();
}

function showChatView() {
  $("admin-view").classList.add("hidden");
  $("chat-view").classList.remove("hidden");
}

function switchAdminTab(name) {
  els(".admin-tab").forEach((b) =>
    b.classList.toggle("active", b.dataset.tab === name),
  );
  ["dashboard", "users", "apis", "logs"].forEach((t) =>
    $("admin-tab-" + t).classList.toggle("hidden", t !== name),
  );
  if (name === "dashboard") loadDashboard();
  if (name === "users") loadUsers();
  if (name === "apis") loadProviders();
  if (name === "logs") loadLogs();
}

async function countRows(table, filter) {
  let q = supabase.from(table).select("*", { count: "exact", head: true });
  if (filter) q = filter(q);
  const { count, error } = await q;
  return error ? "—" : count ?? 0;
}

async function loadDashboard() {
  const today = todayStartISO();
  const [users, chats, msgsToday, providers, failedToday] = await Promise.all([
    countRows("profiles"),
    countRows("chats"),
    countRows("messages", (q) => q.gte("created_at", today)),
    countRows("api_providers", (q) => q.eq("is_active", true)),
    countRows("usage_logs", (q) => q.eq("status", "failed").gte("created_at", today)),
  ]);
  $("stat-users").textContent = users;
  $("stat-chats").textContent = chats;
  $("stat-messages-today").textContent = msgsToday;
  $("stat-providers").textContent = providers;
  $("stat-failed-today").textContent = failedToday;

  const { data, error } = await supabase
    .from("usage_logs")
    .select("created_at, model, status, profiles(email)")
    .order("created_at", { ascending: false })
    .limit(10);
  const body = $("recent-usage-body");
  if (error || !data?.length) {
    body.innerHTML = '<tr><td colspan="4">কোনো রেকর্ড নেই।</td></tr>';
    return;
  }
  body.innerHTML = data
    .map(
      (r) =>
        "<tr><td>" + fmtDate(r.created_at) + "</td><td>" +
        escapeHtml(r.profiles?.email || "—") + "</td><td>" +
        escapeHtml(r.model || "—") + "</td><td>" +
        (r.status === "ok"
          ? '<span class="pill ok">সফল</span>'
          : '<span class="pill fail">ব্যর্থ</span>') +
        "</td></tr>",
    )
    .join("");
}

// ---- Users ----
let allUsers = [];
async function loadUsers() {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, display_name, role, is_banned, created_at")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) {
    $("users-body").innerHTML = '<tr><td colspan="5">লোড করা যায়নি।</td></tr>';
    return;
  }
  allUsers = data || [];
  renderUsers();
}

function renderUsers() {
  const q = ($("user-search").value || "").toLowerCase();
  const rows = allUsers.filter(
    (u) =>
      !q ||
      u.email.toLowerCase().includes(q) ||
      (u.display_name || "").toLowerCase().includes(q),
  );
  const body = $("users-body");
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="5">কোনো ইউজার পাওয়া যায়নি।</td></tr>';
    return;
  }
  body.innerHTML = "";
  rows.forEach((u) => {
    const isSelf = u.id === currentUser.id;
    const tr = document.createElement("tr");
    tr.innerHTML =
      "<td><b>" + escapeHtml(u.display_name || "—") + "</b><br><small>" +
      escapeHtml(u.email) + "</small></td>" +
      "<td>" + (u.role === "admin" ? '<span class="pill admin">অ্যাডমিন</span>' : "ইউজার") + "</td>" +
      "<td>" + fmtDate(u.created_at) + "</td>" +
      "<td>" + (u.is_banned ? '<span class="pill fail">ব্যানড</span>' : '<span class="pill ok">সক্রিয়</span>') + "</td>" +
      "<td></td>";
    const actions = tr.lastElementChild;
    const banBtn = document.createElement("button");
    banBtn.className = "btn-small" + (u.is_banned ? " success" : " danger");
    banBtn.textContent = u.is_banned ? "আনব্যান" : "ব্যান";
    banBtn.disabled = isSelf;
    banBtn.addEventListener("click", () => toggleBan(u));
    const roleBtn = document.createElement("button");
    roleBtn.className = "btn-small";
    roleBtn.textContent = u.role === "admin" ? "অ্যাডমিন সরান" : "অ্যাডমিন করুন";
    roleBtn.disabled = isSelf;
    roleBtn.addEventListener("click", () => toggleRole(u));
    actions.appendChild(banBtn);
    actions.appendChild(roleBtn);
    body.appendChild(tr);
  });
}

async function toggleBan(u) {
  const { error } = await supabase
    .from("profiles")
    .update({ is_banned: !u.is_banned })
    .eq("id", u.id);
  if (error) toast("আপডেট করা যায়নি।");
  else {
    toast(u.is_banned ? "ইউজার আনব্যান করা হয়েছে।" : "ইউজার ব্যান করা হয়েছে।");
    loadUsers();
  }
}

async function toggleRole(u) {
  const newRole = u.role === "admin" ? "user" : "admin";
  const { error } = await supabase
    .from("profiles")
    .update({ role: newRole })
    .eq("id", u.id);
  if (error) toast("আপডেট করা যায়নি।");
  else {
    toast(newRole === "admin" ? "অ্যাডমিন করা হয়েছে।" : "অ্যাডমিন সরানো হয়েছে।");
    loadUsers();
  }
}

// ---- Providers ----
async function loadProviders() {
  const { data, error } = await supabase
    .from("api_providers")
    .select("id, name, provider_type, base_url, model, priority, is_active, created_at")
    .order("priority", { ascending: true });
  const list = $("provider-list");
  if (error) {
    list.innerHTML = '<p class="hint">লোড করা যায়নি।</p>';
    return;
  }
  if (!data?.length) {
    list.innerHTML =
      '<p class="hint">এখনো কোনো API যোগ করা হয়নি। উপরের বোতাম দিয়ে প্রথম API যোগ করুন — তারপর চ্যাট চালু হবে।</p>';
    return;
  }
  list.innerHTML = "";
  data.forEach((p) => {
    const card = document.createElement("div");
    card.className = "provider-card";
    card.innerHTML =
      '<div class="provider-head"><b>' + escapeHtml(p.name) + "</b>" +
      '<span class="pill ' + (p.is_active ? "ok" : "fail") + '">' +
      (p.is_active ? "চালু" : "বন্ধ") + "</span></div>" +
      '<div class="provider-meta">ধরন: ' + escapeHtml(p.provider_type) +
      " &middot; মডেল: <code>" + escapeHtml(p.model) + "</code>" +
      " &middot; Priority: <b>" + p.priority + "</b></div>" +
      '<div class="provider-meta"><small>' + escapeHtml(p.base_url || "(ডিফল্ট URL)") + "</small></div>" +
      '<div class="provider-actions"></div>';
    const actions = card.querySelector(".provider-actions");

    const testBtn = document.createElement("button");
    testBtn.className = "btn-small";
    testBtn.textContent = "🔍 টেস্ট";
    testBtn.addEventListener("click", () => testProvider(p, testBtn));
    actions.appendChild(testBtn);

    const toggleBtn = document.createElement("button");
    toggleBtn.className = "btn-small";
    toggleBtn.textContent = p.is_active ? "বন্ধ করুন" : "চালু করুন";
    toggleBtn.addEventListener("click", () => toggleProvider(p));
    actions.appendChild(toggleBtn);

    const editBtn = document.createElement("button");
    editBtn.className = "btn-small";
    editBtn.textContent = "✎ এডিট";
    editBtn.addEventListener("click", () => openProviderForm(p));
    actions.appendChild(editBtn);

    const delBtn = document.createElement("button");
    delBtn.className = "btn-small danger";
    delBtn.textContent = "🗑 মুছুন";
    delBtn.addEventListener("click", () => deleteProvider(p));
    actions.appendChild(delBtn);

    list.appendChild(card);
  });
}

async function testProvider(p, btn) {
  btn.disabled = true;
  btn.textContent = "টেস্ট হচ্ছে…";
  try {
    const { data, error } = await supabase.functions.invoke("chat", {
      body: { message: "হ্যালো, তুমি কে? এক লাইনে বলো।", provider_id: p.id, test: true },
    });
    if (error || !data?.reply) {
      toast("❌ " + p.name + " ব্যর্থ: " + (data?.error || error?.message || "উত্তর আসেনি"));
    } else {
      toast("✅ " + p.name + " কাজ করছে — উত্তর: " + data.reply.slice(0, 80));
    }
  } catch {
    toast("❌ " + p.name + " টেস্ট করা যায়নি।");
  } finally {
    btn.disabled = false;
    btn.textContent = "🔍 টেস্ট";
  }
}

async function toggleProvider(p) {
  const { error } = await supabase
    .from("api_providers")
    .update({ is_active: !p.is_active })
    .eq("id", p.id);
  if (error) toast("আপডেট করা যায়নি।");
  else loadProviders();
}

async function deleteProvider(p) {
  if (!window.confirm("“" + p.name + "” মুছে ফেলবেন?")) return;
  const { error } = await supabase.from("api_providers").delete().eq("id", p.id);
  if (error) toast("মোছা যায়নি।");
  else {
    toast("API মুছে ফেলা হয়েছে।");
    loadProviders();
  }
}

function openProviderForm(p) {
  $("provider-form").classList.remove("hidden");
  $("provider-form-title").textContent = p ? "API এডিট করুন" : "নতুন API";
  $("pf-id").value = p?.id || "";
  $("pf-name").value = p?.name || "";
  $("pf-type").value = p?.provider_type || "gemini";
  $("pf-model").value = p?.model || "";
  $("pf-priority").value = p?.priority ?? 10;
  $("pf-base-url").value = p?.base_url || "";
  // Never prefill the existing key (we never read api_key to the client).
  $("pf-api-key").value = "";
  $("pf-api-key").placeholder = p
    ? "খালি রাখলে আগের চাবি থাকবে"
    : "API চাবি লিখুন";
  $("pf-api-key").required = !p;
  $("provider-form-error").classList.add("hidden");
  $("provider-form").scrollIntoView({ behavior: "smooth", block: "center" });
}

function closeProviderForm() {
  $("provider-form").classList.add("hidden");
  $("pf-api-key").required = false;
}

async function saveProvider(e) {
  e.preventDefault();
  const id = $("pf-id").value;
  const payload = {
    name: $("pf-name").value.trim(),
    provider_type: $("pf-type").value,
    model: $("pf-model").value.trim(),
    priority: parseInt($("pf-priority").value, 10) || 10,
    base_url: $("pf-base-url").value.trim() || null,
  };
  const key = $("pf-api-key").value.trim();
  if (!id && !key) {
    const err = $("provider-form-error");
    err.textContent = "API চাবি লিখুন।";
    err.classList.remove("hidden");
    return;
  }
  if (payload.provider_type === "other" && !payload.base_url) {
    const err = $("provider-form-error");
    err.textContent = "‘অন্যান্য’ ধরনের জন্য Base URL লিখতে হবে।";
    err.classList.remove("hidden");
    return;
  }
  if (key) payload.api_key = key;
  // New providers start active; editing must NOT re-activate a disabled one.
  if (!id) payload.is_active = true;

  let res;
  if (id) res = await supabase.from("api_providers").update(payload).eq("id", id);
  else res = await supabase.from("api_providers").insert(payload);
  if (res.error) {
    const err = $("provider-form-error");
    err.textContent = "সংরক্ষণ করা যায়নি: " + res.error.message;
    err.classList.remove("hidden");
    return;
  }
  toast("API সংরক্ষণ করা হয়েছে।");
  closeProviderForm();
  loadProviders();
}

// ---- Logs ----
async function loadLogs() {
  const filter = $("log-filter").value;
  let q = supabase
    .from("usage_logs")
    .select("created_at, model, status, error, profiles(email)")
    .order("created_at", { ascending: false })
    .limit(100);
  if (filter !== "all") q = q.eq("status", filter);
  const { data, error } = await q;
  const body = $("logs-body");
  if (error || !data?.length) {
    body.innerHTML = '<tr><td colspan="5">কোনো রেকর্ড নেই।</td></tr>';
    return;
  }
  body.innerHTML = data
    .map(
      (r) =>
        "<tr><td>" + fmtDate(r.created_at) + "</td><td>" +
        escapeHtml(r.profiles?.email || "—") + "</td><td>" +
        escapeHtml(r.model || "—") + "</td><td>" +
        (r.status === "ok"
          ? '<span class="pill ok">সফল</span>'
          : '<span class="pill fail">ব্যর্থ</span>') +
        "</td><td><small>" + escapeHtml(r.error || "—") + "</small></td></tr>",
    )
    .join("");
}

// ---------------------------------------------------------------------------
// Sidebar (mobile)
// ---------------------------------------------------------------------------
function openSidebarMobile() {
  $("sidebar").classList.add("open");
  $("sidebar-overlay").classList.remove("hidden");
}
function closeSidebarMobile() {
  $("sidebar").classList.remove("open");
  $("sidebar-overlay").classList.add("hidden");
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
function init() {
  showView("auth");
  if (!supabase) {
    showAuthError(
      "সার্ভারের সাথে সংযোগ হচ্ছে না — ইন্টারনেট চেক করে পেজটি রিফ্রেশ করুন।",
    );
    return;
  }
  $("tab-login").addEventListener("click", () => setAuthMode("login"));
  $("tab-register").addEventListener("click", () => setAuthMode("register"));
  $("auth-form").addEventListener("submit", handleAuth);
  $("logout-btn").addEventListener("click", logout);
  $("new-chat-btn").addEventListener("click", newChat);
  $("composer").addEventListener("submit", sendMessage);
  $("message-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      $("composer").requestSubmit();
    }
  });
  $("message-input").addEventListener("input", (e) => autoGrow(e.target));
  els(".suggestion").forEach((b) =>
    b.addEventListener("click", () => {
      $("message-input").value = b.textContent;
      $("composer").requestSubmit();
    }),
  );
  $("sidebar-open").addEventListener("click", openSidebarMobile);
  $("sidebar-close").addEventListener("click", closeSidebarMobile);
  $("sidebar-overlay").addEventListener("click", closeSidebarMobile);

  $("admin-open-btn").addEventListener("click", showAdminView);
  $("admin-close-btn").addEventListener("click", showChatView);
  els(".admin-tab").forEach((b) =>
    b.addEventListener("click", () => switchAdminTab(b.dataset.tab)),
  );
  $("users-refresh").addEventListener("click", loadUsers);
  $("user-search").addEventListener("input", renderUsers);
  $("provider-add-btn").addEventListener("click", () => openProviderForm(null));
  $("providers-refresh").addEventListener("click", loadProviders);
  $("provider-form").addEventListener("submit", saveProvider);
  $("provider-form-cancel").addEventListener("click", closeProviderForm);
  $("logs-refresh").addEventListener("click", loadLogs);
  $("log-filter").addEventListener("change", loadLogs);

  supabase.auth.onAuthStateChange((_event, session) => {
    if (session?.user) enterApp(session.user);
    else showView("auth");
  });

  // Initial session check
  supabase.auth.getSession().then(({ data }) => {
    if (data?.session?.user) enterApp(data.session.user);
    else showView("auth");
  });
}

document.addEventListener("DOMContentLoaded", init);


})();
