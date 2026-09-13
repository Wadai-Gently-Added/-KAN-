"use strict";

/* ============================================
   換-KAN- app.js
   v1.0.0 — Chromium系デスクトップ向け（File System Access API）
   ============================================ */

const state = {
  folders: [],   // { id, name, handle, enabled, includeSubfolders, depth }
  rules: [],     // { id, from, to }
  preview: [],   // 直近のプレビュー結果
  history: [],   // 実行済みバッチのスタック（Undo用）
  redoStack: [], // Undoしたバッチのスタック（Redo用）
};

let idCounter = 1;
const nextId = () => String(idCounter++);

// フォルダごとに割り当てる色相（登録順に巡回。削除しても色がずれないよう専用カウンタを使う）
const FOLDER_HUES = [205, 20, 150, 280, 45, 335, 190, 100];
let folderHueCounter = 0;
function nextFolderHue() {
  const hue = FOLDER_HUES[folderHueCounter % FOLDER_HUES.length];
  folderHueCounter += 1;
  return hue;
}

/* ---------- DOM参照 ---------- */
const el = {
  unsupportedBanner: document.getElementById("unsupported-banner"),
  folderList: document.getElementById("folder-list"),
  folderEmpty: document.getElementById("folder-empty"),
  addFolderBtn: document.getElementById("add-folder-btn"),
  ruleList: document.getElementById("rule-list"),
  ruleEmpty: document.getElementById("rule-empty"),
  addRuleBtn: document.getElementById("add-rule-btn"),
  selectAllCheckbox: document.getElementById("select-all-checkbox"),
  previewBody: document.getElementById("preview-body"),
  previewEmpty: document.getElementById("preview-empty"),
  previewSummary: document.getElementById("preview-summary"),
  refreshPreviewBtn: document.getElementById("refresh-preview-btn"),
  executeBtn: document.getElementById("execute-btn"),
  undoBtn: document.getElementById("undo-btn"),
  redoBtn: document.getElementById("redo-btn"),
  logList: document.getElementById("log-list"),
};

/* ---------- 起動チェック ---------- */
function checkSupport() {
  const supported = typeof window.showDirectoryPicker === "function";
  el.unsupportedBanner.hidden = supported;
  el.addFolderBtn.disabled = !supported;
  return supported;
}

/* ---------- ログ ---------- */
function log(message, kind = "info") {
  const li = document.createElement("li");
  const time = new Date().toLocaleTimeString("ja-JP", { hour12: false });
  li.textContent = `[${time}] ${message}`;
  if (kind === "error") li.classList.add("log-error");
  if (kind === "success") li.classList.add("log-success");
  el.logList.appendChild(li);
}

/* ---------- 拡張子ユーティリティ ---------- */
function normalizeExt(raw) {
  return raw.trim().replace(/^\./, "").toLowerCase();
}

function splitExt(filename) {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0) return null; // 拡張子なし、またはドットファイル
  return { base: filename.slice(0, dot), ext: filename.slice(dot + 1).toLowerCase() };
}

/* ============================================
   フォルダ管理
   ============================================ */
async function addFolder() {
  try {
    const handle = await window.showDirectoryPicker({ mode: "readwrite" });
    state.folders.push({
      id: nextId(),
      name: handle.name,
      handle,
      enabled: true,
      includeSubfolders: false,
      depth: 0,
      invalid: false,
      hue: nextFolderHue(),
    });
    log(`フォルダを追加: ${handle.name}`);
    renderFolders();
  } catch (e) {
    if (e.name !== "AbortError") log(`フォルダ追加に失敗: ${e.message}`, "error");
  }
}

function removeFolder(id) {
  state.folders = state.folders.filter((f) => f.id !== id);
  // フォルダを削除したら、そのフォルダに紐づくプレビュー行も一緒に消す
  // （プレビューは「更新」時点のスナップショットなので、放置すると古い行が残り続ける）
  state.preview = state.preview.filter((item) => item.folderId !== id);
  renderFolders();
  renderPreview();
}

function renderFolders() {
  el.folderList.innerHTML = "";
  el.folderEmpty.hidden = state.folders.length > 0;

  for (const folder of state.folders) {
    const li = document.createElement("li");
    li.className = "item-row";

    const enabledLabel = document.createElement("label");
    const enabledCheckbox = document.createElement("input");
    enabledCheckbox.type = "checkbox";
    enabledCheckbox.checked = folder.enabled;
    enabledCheckbox.addEventListener("change", () => {
      folder.enabled = enabledCheckbox.checked;
    });
    enabledLabel.append(enabledCheckbox, " 対象");

    const nameSpan = document.createElement("span");
    nameSpan.className = "name";

    const swatch = document.createElement("span");
    swatch.className = "folder-swatch";
    swatch.style.setProperty("--folder-hue", folder.hue);
    nameSpan.appendChild(swatch);
    nameSpan.appendChild(document.createTextNode(folder.name));

    if (folder.invalid) {
      const badge = document.createElement("span");
      badge.textContent = "⚠ 再登録が必要";
      badge.style.color = "var(--clay-500)";
      badge.style.fontSize = "12px";
      nameSpan.appendChild(document.createElement("br"));
      nameSpan.appendChild(badge);
    }

    const subLabel = document.createElement("label");
    const subCheckbox = document.createElement("input");
    subCheckbox.type = "checkbox";
    subCheckbox.checked = folder.includeSubfolders;
    subCheckbox.addEventListener("change", () => {
      folder.includeSubfolders = subCheckbox.checked;
      depthSelect.disabled = !subCheckbox.checked;
    });
    subLabel.append(subCheckbox, " サブフォルダ");

    const depthSelect = document.createElement("select");
    depthSelect.disabled = !folder.includeSubfolders;
    [
      ["0", "0階層"],
      ["1", "1階層"],
      ["2", "2階層"],
      ["3", "3階層"],
      ["unlimited", "無制限"],
    ].forEach(([value, text]) => {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = text;
      depthSelect.appendChild(opt);
    });
    depthSelect.value = folder.depth === null ? "unlimited" : String(folder.depth);
    depthSelect.addEventListener("change", () => {
      folder.depth = depthSelect.value === "unlimited" ? null : Number(depthSelect.value);
    });

    const removeBtn = document.createElement("button");
    removeBtn.className = "btn--danger-text";
    removeBtn.type = "button";
    removeBtn.textContent = "削除";
    removeBtn.addEventListener("click", () => removeFolder(folder.id));

    li.append(enabledLabel, nameSpan, subLabel, depthSelect, removeBtn);
    el.folderList.appendChild(li);
  }
}

/* ============================================
   ルール管理
   ============================================ */
function addRule() {
  state.rules.push({ id: nextId(), from: "", to: "" });
  renderRules();
}

function removeRule(id) {
  state.rules = state.rules.filter((r) => r.id !== id);
  renderRules();
}

function ruleValidationMessage(rule) {
  const from = normalizeExt(rule.from);
  const to = normalizeExt(rule.to);
  if (!from || !to) return "拡張子を入力してください";
  if (from === to) return "変換元と変換先が同じです";
  const dup = state.rules.some((r) => r.id !== rule.id && normalizeExt(r.from) === from);
  if (dup) return "同じ変換元のルールが既にあります";
  return "";
}

function renderRules() {
  el.ruleList.innerHTML = "";
  el.ruleEmpty.hidden = state.rules.length > 0;

  for (const rule of state.rules) {
    const li = document.createElement("li");
    li.className = "item-row";

    const fromInput = document.createElement("input");
    fromInput.type = "text";
    fromInput.placeholder = "ts";
    fromInput.value = rule.from;
    fromInput.addEventListener("input", () => {
      rule.from = fromInput.value;
    });

    const arrow = document.createElement("span");
    arrow.className = "rule-arrow";
    arrow.textContent = "→";

    const toInput = document.createElement("input");
    toInput.type = "text";
    toInput.placeholder = "txt";
    toInput.value = rule.to;
    toInput.addEventListener("input", () => {
      rule.to = toInput.value;
    });

    const warning = document.createElement("span");
    warning.style.fontSize = "12px";
    warning.style.color = "var(--clay-500)";
    const msg = ruleValidationMessage(rule);
    warning.textContent = rule.from || rule.to ? msg : "";

    const removeBtn = document.createElement("button");
    removeBtn.className = "btn--danger-text";
    removeBtn.type = "button";
    removeBtn.textContent = "削除";
    removeBtn.addEventListener("click", () => removeRule(rule.id));

    li.append(fromInput, arrow, toInput, warning, removeBtn);
    el.ruleList.appendChild(li);
  }
}

function activeValidRules() {
  return state.rules.filter((r) => !ruleValidationMessage(r));
}

/* ============================================
   探索
   ============================================ */
async function scanDirectory(dirHandle, currentDepth, maxDepth, pathPrefix) {
  const results = [];
  for await (const [name, handle] of dirHandle.entries()) {
    if (handle.kind === "file") {
      results.push({
        name,
        handle,
        dirHandle,
        path: pathPrefix ? `${pathPrefix}/${name}` : name,
      });
    } else if (handle.kind === "directory") {
      const canDescend = maxDepth === null || currentDepth < maxDepth;
      if (canDescend) {
        const childPath = pathPrefix ? `${pathPrefix}/${name}` : name;
        const sub = await scanDirectory(handle, currentDepth + 1, maxDepth, childPath);
        results.push(...sub);
      }
    }
  }
  return results;
}

async function fileExists(dirHandle, name) {
  try {
    await dirHandle.getFileHandle(name, { create: false });
    return true;
  } catch (e) {
    return false;
  }
}

async function ensureReadWritePermission(handle) {
  const opts = { mode: "readwrite" };
  try {
    if ((await handle.queryPermission(opts)) === "granted") return true;
    if ((await handle.requestPermission(opts)) === "granted") return true;
  } catch (e) {
    // queryPermission/requestPermission 自体が未対応の場合はここに来る
  }
  return false;
}

/* ============================================
   プレビュー
   ============================================ */
async function buildPreview() {
  const rules = activeValidRules();
  state.preview = [];

  const enabledFolders = state.folders.filter((f) => f.enabled);
  if (enabledFolders.length === 0 || rules.length === 0) {
    renderPreview();
    return;
  }

  el.refreshPreviewBtn.disabled = true;
  el.refreshPreviewBtn.textContent = "探索中…";

  try {
    for (const folder of enabledFolders) {
      const maxDepth = folder.includeSubfolders ? folder.depth : 0;
      let files;
      try {
        files = await scanDirectory(folder.handle, 0, maxDepth, "");
        folder.invalid = false;
      } catch (e) {
        if (e.name === "NotFoundError") {
          folder.invalid = true;
          log(
            `フォルダが見つかりません: ${folder.name} — フォルダが削除・再作成された可能性があります（例：圧縮ファイルの再展開）。一覧から削除して「＋フォルダ追加」から選び直してください。`,
            "error"
          );
        } else {
          log(`探索に失敗: ${folder.name} (${e.message})`, "error");
        }
        continue;
      }

      for (const file of files) {
        const parts = splitExt(file.name);
        if (!parts) continue;
        const rule = rules.find((r) => normalizeExt(r.from) === parts.ext);
        if (!rule) continue;

        const newName = `${parts.base}.${normalizeExt(rule.to)}`;
        const collides = await fileExists(file.dirHandle, newName);

        state.preview.push({
          folderId: folder.id,
          folderName: folder.name,
          folderHue: folder.hue,
          relPath: file.path,
          oldName: file.name,
          newName,
          dirHandle: file.dirHandle,
          fileHandle: file.handle,
          status: collides ? "collision" : "pending",
          selected: !collides, // 変更予定は初期状態で選択済みにしておく
        });
      }
    }
  } finally {
    el.refreshPreviewBtn.disabled = false;
    el.refreshPreviewBtn.textContent = "プレビュー更新";
  }

  renderFolders();
  renderPreview();
}

function statusLabel(status) {
  switch (status) {
    case "pending": return "変更予定";
    case "collision": return "既存あり";
    case "done": return "変更済み";
    case "error": return "失敗";
    default: return status;
  }
}

function renderPreview() {
  el.previewBody.innerHTML = "";
  el.previewEmpty.hidden = state.preview.length > 0;

  const counts = { pending: 0, collision: 0, done: 0, error: 0 };
  let selectedCount = 0;
  let pendingCount = 0;

  // フォルダ登録順にグルーピングして表示する（同じフォルダの行をまとめて見やすくする）
  const groups = state.folders
    .map((folder) => ({
      folder,
      items: state.preview.filter((item) => item.folderId === folder.id),
    }))
    .filter((g) => g.items.length > 0);

  for (const group of groups) {
    const hue = group.folder.hue;

    const headerTr = document.createElement("tr");
    headerTr.className = "preview-group-header";
    const headerTd = document.createElement("td");
    headerTd.colSpan = 5;
    headerTd.style.setProperty("--folder-hue", hue);
    const swatch = document.createElement("span");
    swatch.className = "folder-swatch";
    swatch.style.setProperty("--folder-hue", hue);
    headerTd.appendChild(swatch);
    headerTd.appendChild(document.createTextNode(group.folder.name));
    headerTr.appendChild(headerTd);
    el.previewBody.appendChild(headerTr);

    for (const item of group.items) {
      counts[item.status] = (counts[item.status] || 0) + 1;
      if (item.status === "pending") {
        pendingCount += 1;
        if (item.selected) selectedCount += 1;
      }

      // 同じフォルダ内でも、階層が深いファイルほど少し明るい色合いにして階層感を出す
      const depth = (item.relPath.match(/\//g) || []).length;
      const rowLightness = Math.min(34, 16 + depth * 6);

      const tr = document.createElement("tr");
      tr.className = "preview-row";
      tr.style.setProperty("--folder-hue", hue);
      tr.style.setProperty("--row-lightness", `${rowLightness}%`);
      if (item.status === "collision" || item.status === "error") tr.classList.add("status-collision");
      if (item.status === "done") tr.classList.add("status-done");

      const tdCheck = document.createElement("td");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = Boolean(item.selected);
      checkbox.disabled = item.status !== "pending";
      checkbox.setAttribute("aria-label", `${item.oldName} を実行対象に含める`);
      checkbox.addEventListener("change", () => {
        item.selected = checkbox.checked;
        updateSelectAllCheckboxState();
        updateExecuteButtonState();
      });
      tdCheck.appendChild(checkbox);

      const tdOld = document.createElement("td");
      tdOld.textContent = item.relPath;

      const tdArrow = document.createElement("td");
      tdArrow.textContent = "→";

      const tdNew = document.createElement("td");
      tdNew.textContent = item.newName;

      const tdStatus = document.createElement("td");
      const badge = document.createElement("span");
      badge.className = "status-badge";
      badge.textContent = statusLabel(item.status);
      tdStatus.appendChild(badge);

      tr.append(tdCheck, tdOld, tdArrow, tdNew, tdStatus);
      el.previewBody.appendChild(tr);
    }
  }

  const total = state.preview.length;
  el.previewSummary.textContent = total === 0
    ? "対象なし"
    : `対象 ${total}件 / 変更可能 ${counts.pending}件（選択中 ${selectedCount}件）/ 既存あり ${counts.collision}件`;

  updateSelectAllCheckboxState(pendingCount, selectedCount);
  updateExecuteButtonState();
}

function updateSelectAllCheckboxState(pendingCount, selectedCount) {
  if (pendingCount === undefined) {
    pendingCount = state.preview.filter((i) => i.status === "pending").length;
    selectedCount = state.preview.filter((i) => i.status === "pending" && i.selected).length;
  }
  el.selectAllCheckbox.disabled = pendingCount === 0;
  el.selectAllCheckbox.checked = pendingCount > 0 && selectedCount === pendingCount;
  el.selectAllCheckbox.indeterminate = selectedCount > 0 && selectedCount < pendingCount;
}

function updateExecuteButtonState() {
  const hasSelectedPending = state.preview.some((i) => i.status === "pending" && i.selected);
  el.executeBtn.disabled = !hasSelectedPending;
}

/* ============================================
   実行（疑似リネーム：作成→書込→検証→削除）
   ============================================ */
async function renameOne(dirHandle, oldName, newName) {
  const file = await (await dirHandle.getFileHandle(oldName)).getFile();
  const buffer = await file.arrayBuffer();

  const newHandle = await dirHandle.getFileHandle(newName, { create: true });
  const writable = await newHandle.createWritable();
  await writable.write(buffer);
  await writable.close();

  const written = await newHandle.getFile();
  if (written.size !== buffer.byteLength) {
    throw new Error("書き込み後のサイズが一致しません");
  }

  await dirHandle.removeEntry(oldName);
}

async function executeAll() {
  const targets = state.preview.filter((i) => i.status === "pending" && i.selected);
  if (targets.length === 0) return;

  el.executeBtn.disabled = true;

  // 書き込み権限は実行の一番最初にまとめて確認する。
  // 複数フォルダを順番に処理する途中で確認すると、ユーザー操作の有効時間が切れて失敗しやすいため。
  const uniqueDirHandles = [];
  for (const item of targets) {
    if (!uniqueDirHandles.includes(item.dirHandle)) uniqueDirHandles.push(item.dirHandle);
  }
  for (const dirHandle of uniqueDirHandles) {
    const granted = await ensureReadWritePermission(dirHandle);
    if (!granted) {
      log("書き込み権限が確認できませんでした。「実行」をもう一度押してください。", "error");
      el.executeBtn.disabled = false;
      return;
    }
  }

  const batchItems = [];

  for (const item of targets) {
    try {
      await renameOne(item.dirHandle, item.oldName, item.newName);
      item.status = "done";
      batchItems.push({
        dirHandle: item.dirHandle,
        oldName: item.oldName,
        newName: item.newName,
        folderName: item.folderName,
        relPath: item.relPath,
      });
      log(`成功: ${item.relPath} → ${item.newName}`, "success");
    } catch (e) {
      item.status = "error";
      log(`失敗: ${item.relPath} (${e.message})`, "error");
    }
  }

  if (batchItems.length > 0) {
    state.history.push({ items: batchItems, timestamp: new Date() });
    state.redoStack = [];
  }

  log(`一括変更完了：成功 ${batchItems.length}件 / 失敗 ${targets.length - batchItems.length}件`);
  renderPreview();
  updateUndoRedoButtons();
}

/* ============================================
   Undo / Redo
   ============================================ */
async function undoBatch(batch) {
  const uniqueDirHandles = [];
  for (const item of batch.items) {
    if (!uniqueDirHandles.includes(item.dirHandle)) uniqueDirHandles.push(item.dirHandle);
  }
  for (const dirHandle of uniqueDirHandles) {
    const granted = await ensureReadWritePermission(dirHandle);
    if (!granted) {
      log("書き込み権限が確認できませんでした。「Undo」をもう一度押してください。", "error");
      return [];
    }
  }

  const reversed = [];
  for (const item of batch.items) {
    const collides = await fileExists(item.dirHandle, item.oldName);
    if (collides) {
      log(`Undo不可（既存あり）: ${item.newName} は元の名前に戻せません`, "error");
      continue;
    }
    try {
      await renameOne(item.dirHandle, item.newName, item.oldName);
      reversed.push(item);
      log(`Undo: ${item.newName} → ${item.oldName}`, "success");
    } catch (e) {
      log(`Undo失敗: ${item.newName} (${e.message})`, "error");
    }
  }
  return reversed;
}

async function undoLast() {
  const batch = state.history.pop();
  if (!batch) return;
  const reversed = await undoBatch(batch);
  if (reversed.length > 0) {
    state.redoStack.push({ items: reversed, timestamp: new Date() });
  }
  await buildPreview();
  updateUndoRedoButtons();
}

async function redoLast() {
  const batch = state.redoStack.pop();
  if (!batch) return;

  const uniqueDirHandles = [];
  for (const item of batch.items) {
    if (!uniqueDirHandles.includes(item.dirHandle)) uniqueDirHandles.push(item.dirHandle);
  }
  for (const dirHandle of uniqueDirHandles) {
    const granted = await ensureReadWritePermission(dirHandle);
    if (!granted) {
      log("書き込み権限が確認できませんでした。「Redo」をもう一度押してください。", "error");
      state.redoStack.push(batch);
      return;
    }
  }

  const reapplied = [];
  for (const item of batch.items) {
    const collides = await fileExists(item.dirHandle, item.newName);
    if (collides) {
      log(`Redo不可（既存あり）: ${item.oldName} は変更後の名前に進められません`, "error");
      continue;
    }
    try {
      await renameOne(item.dirHandle, item.oldName, item.newName);
      reapplied.push(item);
      log(`Redo: ${item.oldName} → ${item.newName}`, "success");
    } catch (e) {
      log(`Redo失敗: ${item.oldName} (${e.message})`, "error");
    }
  }
  if (reapplied.length > 0) {
    state.history.push({ items: reapplied, timestamp: new Date() });
  }
  await buildPreview();
  updateUndoRedoButtons();
}

function updateUndoRedoButtons() {
  el.undoBtn.disabled = state.history.length === 0;
  el.redoBtn.disabled = state.redoStack.length === 0;
}

/* ============================================
   イベント登録・初期化
   ============================================ */
el.selectAllCheckbox.addEventListener("change", () => {
  const checked = el.selectAllCheckbox.checked;
  for (const item of state.preview) {
    if (item.status === "pending") item.selected = checked;
  }
  renderPreview();
});
el.addFolderBtn.addEventListener("click", addFolder);
el.addRuleBtn.addEventListener("click", addRule);
el.refreshPreviewBtn.addEventListener("click", buildPreview);
el.executeBtn.addEventListener("click", executeAll);
el.undoBtn.addEventListener("click", undoLast);
el.redoBtn.addEventListener("click", redoLast);

checkSupport();
renderFolders();
renderRules();
renderPreview();
updateUndoRedoButtons();
log("換-KAN- を起動しました。フォルダとルールを登録してください。");

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {
      /* PWA登録に失敗しても本体機能には影響しない */
    });
  });
}
