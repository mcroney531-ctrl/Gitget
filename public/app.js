const $ = (id) => document.getElementById(id);
const list = $("list");
const emptyEl = $("empty");
const toastEl = $("toast");

let repos = [];
let toastTimer;

// --- API key handling ---

function getKey() {
  return localStorage.getItem("quickgit_key") || "";
}

function promptKey() {
  $("key-dialog").showModal();
}

$("key-form").addEventListener("submit", () => {
  localStorage.setItem("quickgit_key", $("key-input").value.trim());
  load();
});

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: {
      Authorization: `Bearer ${getKey()}`,
      "Content-Type": "application/json",
      ...opts.headers,
    },
  });
  if (res.status === 401) {
    promptKey();
    throw new Error("unauthorized");
  }
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

// --- rendering ---

function relTime(iso) {
  if (!iso) return "";
  const then = new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
  const mins = Math.round((Date.now() - then.getTime()) / 60000);
  if (!Number.isFinite(mins)) return "";
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return then.toLocaleDateString();
}

function badge(status) {
  const s = (status || "").toLowerCase();
  if (s === "built") return ["built", "built"];
  if (s === "building" || s === "queued") return ["building", s];
  if (s === "errored") return ["errored", "errored"];
  return ["none", "no status"];
}

function timeOf(r) {
  const d = r.last_deploy || r.updated_at || r.added_at;
  if (!d) return 0;
  const t = new Date(d.includes("T") ? d : d.replace(" ", "T") + "Z").getTime();
  return Number.isFinite(t) ? t : 0;
}

function sortRepos(arr) {
  const mode = $("sort").value;
  const out = [...arr];
  if (mode === "az") out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  else if (mode === "za") out.sort((a, b) => b.name.localeCompare(a.name, undefined, { sensitivity: "base" }));
  else if (mode === "oldest") out.sort((a, b) => timeOf(a) - timeOf(b));
  else out.sort((a, b) => timeOf(b) - timeOf(a)); // recent (default)
  return out;
}

function render() {
  const q = $("search").value.trim().toLowerCase();
  const filtered = q
    ? repos.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          (r.owner || "").toLowerCase().includes(q) ||
          (r.live_url || "").toLowerCase().includes(q)
      )
    : repos;
  const shown = sortRepos(filtered);

  list.innerHTML = "";
  emptyEl.classList.toggle("hidden", shown.length > 0);

  for (const r of shown) {
    const card = document.createElement("div");
    card.className = "card";
    card.setAttribute("role", "link");

    const info = document.createElement("div");
    info.className = "info";
    const name = document.createElement("div");
    name.className = "name";
    name.textContent = r.name;
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = [r.owner, r.source].filter(Boolean).join(" · ");
    info.append(name, meta);

    const deploy = relTime(r.last_deploy);
    if (deploy) {
      const dep = document.createElement("div");
      dep.className = "deploy";
      dep.textContent = `deployed ${deploy}`;
      info.append(dep);
    }

    const [cls, label] = badge(r.build_status);
    const b = document.createElement("span");
    b.className = `badge ${cls}`;
    b.textContent = label;

    const del = document.createElement("button");
    del.className = "del";
    del.textContent = "✕";
    del.title = "Remove";
    del.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm(`Remove ${r.name} from GitGet?`)) return;
      try {
        await api(`/repos/${r.id}`, { method: "DELETE" });
        repos = repos.filter((x) => x.id !== r.id);
        render();
      } catch (err) {
        toast(err.message);
      }
    });

    card.append(info, b, del);
    card.addEventListener("click", () => {
      if (r.live_url) window.open(r.live_url, "_blank", "noopener");
      else toast("No live URL saved for this repo");
    });
    list.appendChild(card);
  }
}

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add("hidden"), 3500);
}

// --- actions ---

async function load() {
  if (!getKey()) {
    promptKey();
    return;
  }
  try {
    const data = await api("/repos");
    repos = data.repos;
    render();
  } catch (err) {
    if (err.message !== "unauthorized") toast(err.message);
  }
}

$("search").addEventListener("input", render);

$("sort").value = localStorage.getItem("gitget_sort") || "recent";
$("sort").addEventListener("change", () => {
  localStorage.setItem("gitget_sort", $("sort").value);
  render();
});

$("add-toggle").addEventListener("click", () => {
  $("add-form").classList.toggle("hidden");
  $("add-name").focus();
});

$("add-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await api("/repos", {
      method: "POST",
      body: JSON.stringify({
        name: $("add-name").value.trim(),
        url: $("add-url").value.trim(),
        source: "manual",
      }),
    });
    $("add-form").reset();
    $("add-form").classList.add("hidden");
    toast("Saved");
    load();
  } catch (err) {
    toast(err.message);
  }
});

$("sync-btn").addEventListener("click", async () => {
  const btn = $("sync-btn");
  btn.classList.add("busy");
  btn.textContent = "Syncing…";
  try {
    const result = await api("/sync", { method: "POST" });
    const errs = result.errors.length ? `, ${result.errors.length} errors` : "";
    toast(`Synced ${result.synced.length} of ${result.pages_repos} Pages repos${errs}`);
    load();
  } catch (err) {
    toast(`Sync failed: ${err.message}`);
  } finally {
    btn.classList.remove("busy");
    btn.textContent = "Sync";
  }
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js");
}

load();
