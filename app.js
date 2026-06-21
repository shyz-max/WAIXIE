window.appLoaded = false;
const appVersion = "0.5.0";
const storageKey = "outsourcing-management-data";
const columnPreferencesKey = `${storageKey}:column-preferences:v2`;
const serverStorage = location.protocol === "http:" || location.protocol === "https:";
const apiBase = serverStorage ? "" : "http://127.0.0.1:8765";

const titles = {
  dashboard: ["概览", "查看外协业务的关键状态和风险。"],
  tasks: ["\u5916\u534f\u8ba1\u5212\u6c47\u603b", "\u6279\u91cf\u67e5\u770b\u5916\u534f\u8ba1\u5212\u4ef7\u683c\u72b6\u6001\uff0c\u5e76\u5feb\u901f\u751f\u6210\u5408\u540c\u548c\u6302\u8d26\u3002"],
  procedures: ["\u5de5\u827a\u89c4\u7a0b\u5e93", "\u7edf\u4e00\u7ba1\u7406\u5916\u534f\u8ba1\u5212\u4e0a\u4f20\u7684 PDF \u5de5\u827a\u89c4\u7a0b\u9644\u4ef6\u3002"],
  prices: ["价格库", "维护供应商价格、单位、税率和生效日期。"],
  progress: ["外协进度", "跟踪每个计划的状态、完成率和异常说明。"],
  contracts: ["外协合同", "登记合同编号、金额、期限、状态和负责人。"],
  negotiations: ["谈判纪要", "记录外协谈判过程、结论和后续跟进事项。"],
  pricingProcesses: ["定价流程", "记录外协定价过程、工序、单价和后续跟进事项。"],
  accounts: ["挂账管理", "记录外协应付、到期日和付款状态。"],
  vendors: ["供应商", "管理外协供应商信息。"],
};

let state = createDefaultState();
let selectedTaskIds = new Set();
let selectedContractItems = {};
let editingContractId = null;
let editingNegotiationId = null;
let editingPricingProcessId = null;
let editingAccountId = null;
let priceIndexCache = null;
let pricePlansCache = {};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function apiUrl(path) {
  return apiBase + path;
}

function invalidateCaches() {
  priceIndexCache = null;
  pricePlansCache = {};
  accountedTaskNoCache = null;
  planContractCache = null;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function createDefaultState() {
  return {
    plans: [],
    prices: [],
    contracts: [],
    negotiations: [],
    pricingProcesses: [],
    progress: [],
    accounts: [],
    procedures: [],
    vendors: [],
  };
}

function createSampleState() {
  const now = today();
  return {
    ...createDefaultState(),
    plans: [
      {
        id: crypto.randomUUID(),
        taskNo: "TASK-0001",
        drawingNo: "S-001",
        name: "样件喷涂",
        project: "S-001 样件喷涂",
        vendor: "华东表面处理",
        process: "喷涂",
        quantity: 120,
        dueDate: now,
        priority: "加急",
        note: "按最新图纸版本执行",
      },
    ],
    prices: [
      {
        id: crypto.randomUUID(),
        vendor: "华东表面处理",
        item: "喷涂",
        unit: "件",
        price: 8.5,
        effectiveDate: now,
        taxRate: 13,
      },
    ],
  };
}

function loadLocalState() {
  const saved = localStorage.getItem(storageKey);
  if (saved) {
    try {
      return normalizeState(JSON.parse(saved));
    } catch {
      localStorage.removeItem(storageKey);
    }
  }

  return createSampleState();
}

async function loadServerState() {
  const response = await fetch(apiUrl("/api/data"), { cache: "no-store" });
  if (!response.ok) throw new Error("读取本地数据文件失败");
  return normalizeState(await response.json());
}

function normalizeState(data) {
  const source = data && data.data && typeof data.data === "object" ? data.data : data;
  const plans = Array.isArray(source && source.plans) ? source.plans.map((plan, index) => normalizePlan(plan, index)) : [];
  return {
    plans,
    prices: Array.isArray(source && source.prices) ? source.prices : [],
    progress: Array.isArray(source && source.progress) ? source.progress : [],
    contracts: Array.isArray(source && source.contracts) ? source.contracts : [],
    negotiations: Array.isArray(source && source.negotiations) ? source.negotiations : [],
    pricingProcesses: Array.isArray(source && source.pricingProcesses) ? source.pricingProcesses : [],
    accounts: Array.isArray(source && source.accounts) ? source.accounts : [],
    vendors: Array.isArray(source && source.vendors) ? source.vendors : [],
    procedures: buildProcedureLibrary(Array.isArray(source && source.procedures) ? source.procedures : [], plans),
  };
}

function splitLegacyProject(project) {
  const text = String(project || "").trim();
  if (!text) return { drawingNo: "", name: "" };
  const parts = text.split(/\s+/);
  if (parts.length === 1) return { drawingNo: "", name: text };
  return { drawingNo: parts[0], name: parts.slice(1).join(" ") };
}

function planLabelFromParts(drawingNo, name) {
  return [drawingNo, name].map((value) => String(value || "").trim()).filter(Boolean).join(" ");
}

function fallbackTaskNo(plan, index = 0) {
  const idText = String(plan.id || "");
  const match = idText.match(/(\d+)$/);
  const number = match ? Number(match[1]) : index + 1;
  return `TASK-${String(number).padStart(4, "0")}`;
}

function normalizePlan(plan, index = 0) {
  const legacy = splitLegacyProject(plan.project);
  const taskNo = String(plan.taskNo || fallbackTaskNo(plan, index)).trim();
  const drawingNo = String(plan.drawingNo || legacy.drawingNo || "").trim();
  const name = String(plan.name || legacy.name || plan.project || "").trim();
  return {
    ...plan,
    taskNo,
    drawingNo,
    name,
    procedureFiles: Array.isArray(plan.procedureFiles) ? plan.procedureFiles : [],
    project: planLabelFromParts(drawingNo, name),
  };
}

function planTaskNo(plan) {
  return normalizePlan(plan).taskNo;
}

function planDrawingNo(plan) {
  return normalizePlan(plan).drawingNo;
}

function planName(plan) {
  return normalizePlan(plan).name;
}

function planLabel(plan) {
  return normalizePlan(plan).project;
}


function procedureRecordFromFile(plan, file) {
  return {
    id: file.id || `${plan.id || planTaskNo(plan)}-${file.path || file.url || file.name || Date.now()}`,
    planId: plan.id || "",
    taskNo: planTaskNo(plan),
    drawingNo: planDrawingNo(plan),
    name: planName(plan),
    vendor: plan.vendor || "",
    process: plan.process || "",
    fileName: file.fileName || file.name || "procedure.pdf",
    url: file.url || file.path || "",
    path: file.path || file.url || "",
    size: Number(file.size || 0),
    uploadedAt: file.uploadedAt || "",
  };
}

function buildProcedureLibrary(records = [], plans = []) {
  const byKey = {};
  const addRecord = (record) => {
    const key = record.drawingNo + "||" + record.process;
    if (!key || key === "||") return;
    const existing = byKey[key];
    if (!existing || (record.uploadedAt || "") > (existing.uploadedAt || "")) {
      byKey[key] = { ...record };
    }
  };
  records.forEach(addRecord);
  plans.forEach((plan) => {
    (Array.isArray(plan.procedureFiles) ? plan.procedureFiles : []).forEach((file) => {
      addRecord(procedureRecordFromFile(plan, file));
    });
  });
  return Object.values(byKey).sort((a, b) => String(b.uploadedAt || "").localeCompare(String(a.uploadedAt || "")));
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || "").split(",")[1] || "");
    reader.onerror = () => reject(reader.error || new Error("\u6587\u4ef6\u8bfb\u53d6\u5931\u8d25"));
    reader.readAsDataURL(file);
  });
}

async function uploadProcedureFiles(planId, files) {
  const plan = state.plans.find((item) => item.id === planId);
  if (!plan || files.length === 0) return;
  const uploaded = [];
  for (const file of files) {
    uploaded.push(await uploadProcedureAttachment(plan, file));
  }
  if (uploaded.length === 0) return;
  const nextFiles = [...(Array.isArray(plan.procedureFiles) ? plan.procedureFiles : []), ...uploaded];
  state.plans = state.plans.map((item) => (item.id === planId ? normalizePlan({ ...item, procedureFiles: nextFiles }) : item));
  state.procedures = buildProcedureLibrary(state.procedures || [], state.plans);
  saveState();
  renderTasks();
  if (activeView() === "procedures") renderProcedures();
}

async function uploadProcedureAttachment(plan, file) {
  if (file.type !== "application/pdf" && !String(file.name || "").toLowerCase().endsWith(".pdf")) {
    throw new Error("\u53ea\u80fd\u4e0a\u4f20 PDF \u5de5\u827a\u89c4\u7a0b\u6587\u4ef6\u3002");
  }
  const data = await fileToBase64(file);
  let response;
  try {
    response = await fetch(apiUrl("/api/attachments/procedure"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskNo: planTaskNo(plan),
        fileName: file.name,
        size: file.size,
        data,
      }),
    });
  } catch {
    throw new Error("\u672c\u5730\u670d\u52a1\u672a\u8fde\u63a5\uff0c\u8bf7\u5148\u8fd0\u884c start-server.bat \u540e\u91cd\u8bd5\u3002");
  }
  if (!response.ok) throw new Error("\u670d\u52a1\u7aef\u4fdd\u5b58\u5931\u8d25");
  return response.json();
}

function procedureFilesCell(plan) {
  const files = Array.isArray(plan.procedureFiles) ? plan.procedureFiles : [];
  const links = files.length
    ? '<div class="attachment-list">' +
      files
        .map((file) => {
          const fileId = file.id || file.path || file.url || "";
          return '<span class="attachment-item"><a class="attachment-link" href="' + escapeHtml(file.url || file.path || "#") + '" target="_blank">' + escapeHtml(file.fileName || file.name || "PDF") + '</a>' +
            '<button class="attachment-delete-btn" data-delete-procedure-file="' + escapeHtml(plan.id) + '" data-file-key="' + escapeHtml(fileId) + '" type="button" title="\u5220\u9664">\u00d7</button></span>';
        })
        .join("") +
      '</div>'
    : '<span class="muted-text">\u672a\u4e0a\u4f20</span>';
  return '<div class="attachment-cell">' + links + '<label class="ghost-button compact-button">\u4e0a\u4f20<input class="procedure-file-input" data-plan-id="' + escapeHtml(plan.id) + '" type="file" accept="application/pdf,.pdf" multiple hidden /></label></div>';
}

function procedureFileNames(plan) {
  return (Array.isArray(plan.procedureFiles) ? plan.procedureFiles : []).map((file) => file.fileName || file.name || "PDF").join(" ");
}

function nextTaskNo() {
  const maxNumber = state.plans.reduce((max, plan) => {
    const match = planTaskNo(plan).match(/^TASK-(\d+)$/);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `TASK-${String(maxNumber + 1).padStart(4, "0")}`;
}

function nextNegotiationNo() {
  const prefix = `JY-${today().replaceAll("-", "")}`;
  const maxNumber = state.negotiations.reduce((max, item) => {
    const no = String(item.negotiationNo || "");
    if (no.startsWith(prefix)) {
      const num = parseInt(no.slice(prefix.length + 1), 10);
      return isNaN(num) ? max : Math.max(max, num);
    }
    return max;
  }, 0);
  return `${prefix}-${String(maxNumber + 1).padStart(3, "0")}`;
}

function nextPricingProcessNo() {
  const prefix = `PJ-${today().replaceAll("-", "")}`;
  const maxNumber = state.pricingProcesses.reduce((max, item) => {
    const no = String(item.pricingNo || "");
    if (no.startsWith(prefix)) {
      const num = parseInt(no.slice(prefix.length + 1), 10);
      return isNaN(num) ? max : Math.max(max, num);
    }
    return max;
  }, 0);
  return `${prefix}-${String(maxNumber + 1).padStart(3, "0")}`;
}

function dataEnvelope(extraMeta = {}) {
  return {
    meta: {
      appName: "外协管理工具",
      appVersion,
      schemaVersion: 1,
      storageKey,
      savedAt: new Date().toISOString(),
      ...extraMeta,
    },
    data: state,
  };
}

function saveState() {
  invalidateCaches();
  const envelope = dataEnvelope();
  fetch(apiUrl("/api/data"), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(envelope),
  }).catch(() => {
    if (!serverStorage) {
      try { localStorage.setItem(storageKey, JSON.stringify(envelope)); } catch {}
    }
  });
}

const moneyFormatter = new Intl.NumberFormat("zh-CN", {
  style: "currency",
  currency: "CNY",
  maximumFractionDigits: 2,
});

function money(value) {
  return moneyFormatter.format(Number(value || 0));
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function isOverdue(date, done = false) {
  if (!date || done) return false;
  const due = new Date(`${date}T23:59:59`);
  return due < new Date();
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function openEditModal({ title, fields, onSave }) {
  const overlay = document.createElement("div");
  overlay.className = "modal-backdrop";
  const renderField = (field) => {
    const value = field.value == null ? "" : field.value;
    const spanClass = field.span === 2 || field.type === "textarea" ? " span-2" : "";
    const attrs =
      `name="${escapeHtml(field.name)}"` +
      ` ${field.required ? "required" : ""}` +
      ` ${field.readonly ? "readonly" : ""}` +
      ` ${field.min != null ? `min="${escapeHtml(field.min)}"` : ""}` +
      ` ${field.max != null ? `max="${escapeHtml(field.max)}"` : ""}` +
      ` ${field.step != null ? `step="${escapeHtml(field.step)}"` : ""}`;
    if (field.type === "textarea") {
      return `<label class="edit-field${spanClass}"><span>${escapeHtml(field.label)}</span><textarea ${attrs} rows="${field.rows || 3}">${escapeHtml(value)}</textarea></label>`;
    }
    if (field.type === "select") {
      const options = (field.options || [])
        .map((option) => {
          const optionValue = typeof option === "object" ? option.value : option;
          const optionLabel = typeof option === "object" ? option.label : option;
          const selected = String(optionValue) === String(value) ? " selected" : "";
          return `<option value="${escapeHtml(optionValue)}"${selected}>${escapeHtml(optionLabel)}</option>`;
        })
        .join("");
      return `<label class="edit-field${spanClass}"><span>${escapeHtml(field.label)}</span><select ${attrs}>${options}</select></label>`;
    }
    return `<label class="edit-field${spanClass}"><span>${escapeHtml(field.label)}</span><input ${attrs} type="${escapeHtml(field.type || "text")}" value="${escapeHtml(value)}" /></label>`;
  };
  overlay.innerHTML =
    '<section class="modal-panel edit-modal-panel" role="dialog" aria-modal="true">' +
    '<div class="modal-header"><h2>' + escapeHtml(title) + '</h2><button class="ghost-button compact-button" data-close-edit-modal type="button">&#20851;&#38381;</button></div>' +
    '<form class="edit-modal-form">' +
    fields.map(renderField).join("") +
    '<div class="modal-actions span-2"><button class="ghost-button" data-close-edit-modal type="button">&#21462;&#28040;</button><button class="primary-button" type="submit">&#20445;&#23384;</button></div>' +
    '</form>' +
    '</section>';
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay || event.target.closest("[data-close-edit-modal]")) close();
  });
  overlay.querySelector("form").addEventListener("submit", (event) => {
    event.preventDefault();
    onSave(formData(event.currentTarget));
    close();
  });
  const firstInput = overlay.querySelector("input:not([readonly]), select, textarea");
  if (firstInput) firstInput.focus();
}

function openDashboardModal(title, rows, headers) {
  const overlay = document.createElement("div");
  overlay.className = "modal-backdrop";
  const tableId = "dash-modal-" + Date.now();
  const headerCells = headers.map((h, i) => `<th data-column-key="dash-col-${i}" data-column-label="${escapeHtml(h)}">${escapeHtml(h)}</th>`).join("");
  const bodyRows = rows.length
    ? rows.map((row) => `<tr>${row.map((cell, i) => `<td data-column-key="dash-col-${i}">${cell}</td>`).join("")}</tr>`).join("")
    : `<tr><td colspan="${headers.length}" class="empty">暂无数据</td></tr>`;
  overlay.innerHTML =
    '<section class="modal-panel dashboard-modal-panel" role="dialog" aria-modal="true">' +
    '<div class="modal-header"><h2>' + escapeHtml(title) + '</h2><div class="panel-tools"><button class="ghost-button compact-button column-settings-button" data-column-settings="' + tableId + '" type="button">\u5217\u8bbe\u7f6e</button><button class="ghost-button compact-button" data-close-edit-modal type="button">\u5173\u95ed</button></div></div>' +
    '<div class="table-wrap" style="max-height:60vh;overflow:auto"><table data-column-table-key="' + tableId + '" id="' + tableId + '"><colgroup>' + headers.map((_, i) => '<col data-column-key="dash-col-' + i + '" />').join("") + '</colgroup><thead><tr>' + headerCells + '</tr></thead><tbody>' + bodyRows + '</tbody></table></div>' +
    '</section>';
  document.body.appendChild(overlay);
  applyColumnPreferences(overlay.querySelector("table"));
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay || event.target.closest("[data-close-edit-modal]")) overlay.remove();
  });
}

function openGanttModal() {
  const overlay = document.createElement("div");
  overlay.className = "modal-backdrop";
  const vendors = ["", ...new Set(state.plans.map((p) => p.vendor).filter(Boolean))].sort();
  const vendorOptions = vendors.map((v) => '<option value="' + escapeHtml(v) + '">' + (v || "\u5168\u90e8\u5382\u5bb6") + '</option>').join("");
  overlay.innerHTML =
    '<section class="modal-panel dashboard-modal-panel" role="dialog" aria-modal="true">' +
    '<div class="modal-header"><h2>\u7518\u7279\u56fe</h2><div class="panel-tools"><select id="gantt-modal-select" class="gantt-vendor-select">' + vendorOptions + '</select><button class="ghost-button compact-button" data-close-edit-modal type="button">\u5173\u95ed</button></div></div>' +
    '<div class="table-wrap" style="max-height:65vh;overflow:auto"><div class="gantt-chart" id="gantt-modal-chart"></div></div>' +
    '</section>';
  document.body.appendChild(overlay);
  const renderGanttInModal = () => {
    const select = overlay.querySelector("#gantt-modal-select");
    const vendorFilter = select ? select.value : "";
    ganttEl = overlay.querySelector("#gantt-modal-chart");
    if (!ganttEl) return;
    const plans = [...state.plans].filter((p) => p.dueDate && (!vendorFilter || p.vendor === vendorFilter));
    if (plans.length === 0) {
      ganttEl.innerHTML = '<div class="empty" style="padding:16px">暂无任务数据</div>';
      return;
    }
    const minDate = new Date(Math.min(...plans.map((p) => new Date(p.dueDate).getTime())) - 7 * 86400000);
    const maxDate = new Date(Math.max(...plans.map((p) => new Date(p.dueDate).getTime())) + 7 * 86400000);
    const range = maxDate - minDate || 1;
    const months = [];
    const d = new Date(minDate);
    while (d <= maxDate) {
      months.push(d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"));
      d.setMonth(d.getMonth() + 1);
    }
    const grouped = {};
    plans.forEach((p) => {
      const v = p.vendor || "\u672a\u6307\u5b9a";
      if (!grouped[v]) grouped[v] = [];
      grouped[v].push(p);
    });
    const sorted = Object.entries(grouped).sort((a, b) => b[1].length - a[1].length);
    ganttEl.innerHTML =
      '<div class="gantt-header">' + months.map((m) => '<span>' + escapeHtml(m) + '</span>').join("") + '</div>' +
      sorted.map(([vendor, tasks]) =>
        '<div class="gantt-vendor-group">' +
        '<div class="gantt-vendor-label">' + escapeHtml(vendor) + ' (' + tasks.length + ')</div>' +
        tasks.sort((a, b) => a.dueDate.localeCompare(b.dueDate)).map((t) => {
          const start = new Date(t.dueDate).getTime() - 14 * 86400000;
          const end = new Date(t.dueDate).getTime();
          const left = Math.max(0, ((start - minDate) / range) * 100);
          const width = Math.max(2, ((end - start) / range) * 100);
          return '<div class="gantt-row">' +
            '<span class="gantt-row-label">' + escapeHtml(planDrawingNo(t) + ' ' + planName(t)) + '</span>' +
            '<div class="gantt-row-track"><div class="gantt-bar" style="left:' + left + '%;width:' + width + '%"></div></div>' +
          '</div>';
        }).join("") +
        '</div>'
      ).join("");
  };
  renderGanttInModal();
  const select = overlay.querySelector("#gantt-modal-select");
  if (select) select.addEventListener("change", renderGanttInModal);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay || event.target.closest("[data-close-edit-modal]")) overlay.remove();
  });
}

function openVendorModal(item) {
  const isEdit = Boolean(item);
  const title = isEdit ? "\u4fee\u6539\u4f9b\u5e94\u5546" : "\u65b0\u589e\u4f9b\u5e94\u5546";
  const v = item || {};
  const overlay = document.createElement("div");
  overlay.className = "modal-backdrop";
  overlay.innerHTML =
    '<section class="modal-panel edit-modal-panel" role="dialog" aria-modal="true">' +
    '<div class="modal-header"><h2>' + title + '</h2><button class="ghost-button compact-button" data-close-edit-modal type="button">\u5173\u95ed</button></div>' +
    '<form class="form-grid" style="padding:18px">' +
      '<label>\u4f9b\u5e94\u5546\u540d\u79f0<input name="name" required value="' + escapeHtml(v.name || "") + '" /></label>' +
      '<label>\u8054\u7cfb\u4eba<input name="contact" value="' + escapeHtml(v.contact || "") + '" /></label>' +
      '<label>\u7535\u8bdd<input name="phone" value="' + escapeHtml(v.phone || "") + '" /></label>' +
      '<label class="span-2">\u5730\u5740<input name="address" value="' + escapeHtml(v.address || "") + '" /></label>' +
      '<label>\u5ec9\u6d01\u5408\u4f5c\u534f\u8bae (PDF)<input name="integrityFile" type="file" accept="application/pdf,.pdf" />' +
        (v.integrityFileName ? '<span class="muted-text">\u5df2\u4e0a\u4f20: ' + escapeHtml(v.integrityFileName) + '</span>' : '') +
      '</label>' +
      '<label>\u5b89\u5168\u534f\u8bae\u4e66 (PDF)<input name="safetyFile" type="file" accept="application/pdf,.pdf" />' +
        (v.safetyFileName ? '<span class="muted-text">\u5df2\u4e0a\u4f20: ' + escapeHtml(v.safetyFileName) + '</span>' : '') +
      '</label>' +
      '<label class="span-2">\u5907\u6ce8<input name="note" value="' + escapeHtml(v.note || "") + '" /></label>' +
      '<div class="span-2" style="display:flex;gap:8px"><button class="primary-button" type="submit">\u4fdd\u5b58</button><button class="ghost-button" data-close-edit-modal type="button">\u53d6\u6d88</button></div>' +
    '</form>' +
    '</section>';
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay || event.target.closest("[data-close-edit-modal]")) overlay.remove();
  });
  overlay.querySelector("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = formData(form);
    const saveBtn = form.querySelector("button[type=submit]");
    saveBtn.disabled = true;
    saveBtn.textContent = "\u4fdd\u5b58\u4e2d...";
    try {
      delete data.integrityFile;
      delete data.safetyFile;
      delete data.integrityFileName;
      delete data.safetyFileName;
      const integrityFile = form.elements.integrityFile.files[0];
      const safetyFile = form.elements.safetyFile.files[0];
      if (integrityFile) {
        const result = await uploadVendorFile(integrityFile, "integrity");
        data.integrityFile = result;
        data.integrityFileName = integrityFile.name;
      } else if (isEdit) {
        data.integrityFile = v.integrityFile || null;
        data.integrityFileName = v.integrityFileName || "";
      }
      if (safetyFile) {
        const result = await uploadVendorFile(safetyFile, "safety");
        data.safetyFile = result;
        data.safetyFileName = safetyFile.name;
      } else if (isEdit) {
        data.safetyFile = v.safetyFile || null;
        data.safetyFileName = v.safetyFileName || "";
      }
      if (isEdit) {
        updateRecord("vendors", v.id, data);
      } else {
        addRecord("vendors", data);
      }
      overlay.remove();
    } catch (err) {
      alert("\u4fdd\u5b58\u5931\u8d25\uff1a" + err.message);
      saveBtn.disabled = false;
      saveBtn.textContent = "\u4fdd\u5b58";
    }
  });
}

async function uploadVendorFile(file, type) {
  const data = await fileToBase64(file);
  let response;
  try {
    response = await fetch(apiUrl("/api/attachments/vendor"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: file.name, type, data, size: file.size }),
    });
  } catch {
    throw new Error("\u672c\u5730\u670d\u52a1\u672a\u8fde\u63a5\uff0c\u8bf7\u5148\u8fd0\u884c start-server.bat \u540e\u91cd\u8bd5\u3002");
  }
  if (!response.ok) throw new Error("\u6587\u4ef6\u4e0a\u4f20\u5931\u8d25");
  return response.json();
}

function openProcedureModal(item) {
  const isEdit = Boolean(item);
  const title = isEdit ? "\u4fee\u6539\u5de5\u827a\u89c4\u7a0b" : "\u65b0\u589e\u5de5\u827a\u89c4\u7a0b";
  const v = item || {};
  const overlay = document.createElement("div");
  overlay.className = "modal-backdrop";
  overlay.innerHTML =
    '<section class="modal-panel edit-modal-panel" role="dialog" aria-modal="true">' +
    '<div class="modal-header"><h2>' + title + '</h2><button class="ghost-button compact-button" data-close-edit-modal type="button">\u5173\u95ed</button></div>' +
    '<form class="form-grid" style="padding:18px">' +
      '<label>\u56fe\u53f7<input name="drawingNo" required value="' + escapeHtml(v.drawingNo || "") + '" /></label>' +
      '<label>\u540d\u79f0<input name="name" required value="' + escapeHtml(v.name || "") + '" /></label>' +
      '<label>\u5de5\u5e8f<input name="process" required value="' + escapeHtml(v.process || "") + '" /></label>' +
      '<label>\u5916\u534f\u65b9<input name="vendor" value="' + escapeHtml(v.vendor || "") + '" /></label>' +
      '<label class="span-2">PDF\u5de5\u827a\u89c4\u7a0b<input name="procedureFile" type="file" accept="application/pdf,.pdf" />' +
        (v.fileName ? '<span class="muted-text">\u5df2\u4e0a\u4f20: ' + escapeHtml(v.fileName) + '</span>' : '') +
      '</label>' +
      '<div class="span-2" style="display:flex;gap:8px"><button class="primary-button" type="submit">\u4fdd\u5b58</button><button class="ghost-button" data-close-edit-modal type="button">\u53d6\u6d88</button></div>' +
    '</form>' +
    '</section>';
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay || event.target.closest("[data-close-edit-modal]")) overlay.remove();
  });
  overlay.querySelector("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = formData(form);
    delete data.procedureFile;
    const saveBtn = form.querySelector("button[type=submit]");
    saveBtn.disabled = true;
    saveBtn.textContent = "\u4fdd\u5b58\u4e2d...";
    try {
      const file = form.elements.procedureFile.files[0];
      if (file) {
        const plan = state.plans.find((p) => planDrawingNo(p) === data.drawingNo && p.process === data.process) ||
          state.plans.find((p) => planDrawingNo(p) === data.drawingNo) ||
          { id: "", taskNo: "", vendor: data.vendor || "", process: data.process || "", drawingNo: data.drawingNo, name: data.name };
        const result = await uploadProcedureAttachment(plan, file);
        data.fileName = result.fileName || result.name || file.name;
        data.url = result.url || result.path || "";
        data.path = result.path || result.url || "";
        data.size = result.size || file.size;
        data.uploadedAt = result.uploadedAt || new Date().toISOString();
      } else if (isEdit) {
        data.fileName = v.fileName || "";
        data.url = v.url || "";
        data.path = v.path || "";
      }
      data.id = isEdit ? v.id : Date.now().toString(36) + Math.random().toString(36).slice(2);
      data.planId = "";
      data.taskNo = "";
      if (isEdit) {
        state.procedures = (state.procedures || []).map((p) => p.id === v.id ? { ...p, ...data } : p);
      } else {
        state.procedures = [...(state.procedures || []), data];
      }
      state.procedures = buildProcedureLibrary(state.procedures, state.plans);
      saveState();
      renderProcedures();
      overlay.remove();
    } catch (err) {
      alert("\u4fdd\u5b58\u5931\u8d25\uff1a" + err.message);
      saveBtn.disabled = false;
      saveBtn.textContent = "\u4fdd\u5b58";
    }
  });
}

function openNegotiationModal(item) {
  const isEdit = Boolean(item);
  const title = isEdit ? "\u4fee\u6539\u8c08\u5224\u7eaa\u8981" : "\u65b0\u589e\u8c08\u5224\u7eaa\u8981";
  const v = item || {};
  const overlay = document.createElement("div");
  overlay.className = "modal-backdrop";
  overlay.innerHTML =
    '<section class="modal-panel edit-modal-panel" role="dialog" aria-modal="true">' +
    '<div class="modal-header"><h2>' + title + '</h2><button class="ghost-button compact-button" data-close-edit-modal type="button">\u5173\u95ed</button></div>' +
    '<form class="form-grid" style="padding:18px">' +
      '<label>\u8c08\u5224\u65e5\u671f<input name="meetingDate" type="date" required value="' + escapeHtml(v.meetingDate || today()) + '" /></label>' +
      '<label>\u7eaa\u8981\u7f16\u53f7<input name="negotiationNo" value="' + escapeHtml(v.negotiationNo || "") + '" /></label>' +
      '<label>\u5916\u534f\u65b9<input name="vendor" required value="' + escapeHtml(v.vendor || "") + '" /></label>' +
      '<label class="span-2 form-field-group"><span>\u5173\u8054\u56fe\u53f7/\u540d\u79f0</span>' +
        '<textarea name="negotiationItemsText" required rows="3">' + escapeHtml(isEdit ? negotiationItemsText(v) : "") + '</textarea>' +
        '<div class="form-field-tools">' +
          '<label class="ghost-button compact-button" for="nego-excel-import">\u5bfc\u5165Excel</label>' +
          '<input id="nego-excel-import" type="file" accept=".xlsx,.xls" hidden />' +
        '</div>' +
      '</label>' +
      '<label>\u4e0b\u6b21\u8ddf\u8fdb\u65e5\u671f<input name="followUpDate" type="date" value="' + escapeHtml(v.followUpDate || "") + '" /></label>' +
      '<div class="span-2" style="display:flex;gap:8px"><button class="primary-button" type="submit">\u4fdd\u5b58</button><button class="ghost-button" data-close-edit-modal type="button">\u53d6\u6d88</button></div>' +
    '</form>' +
    '</section>';
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay || event.target.closest("[data-close-edit-modal]")) overlay.remove();
  });
  const excelInput = overlay.querySelector("#nego-excel-import");
  if (excelInput) {
    excelInput.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const ta = overlay.querySelector("[name='negotiationItemsText']");
        await importContractItemsExcel(file, "[name='negotiationItemsText']");
        if (ta) ta.value = overlay.querySelector("[name='negotiationItemsText']")?.value || ta.value;
      } catch (err) { alert("\u5bfc\u5165\u5931\u8d25\uff1a" + err.message); }
      e.target.value = "";
    });
  }
  overlay.querySelector("form").addEventListener("submit", (e) => {
    e.preventDefault();
    const data = formData(e.currentTarget);
    if (isEdit) {
      updateRecord("negotiations", v.id, negotiationPayload(data));
    } else {
      addRecord("negotiations", negotiationPayload(data));
    }
    overlay.remove();
  });
}

function excelDateToIso(value) {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number") {
    const epoch = Date.UTC(1899, 11, 30);
    return new Date(epoch + value * 86400000).toISOString().slice(0, 10);
  }
  const text = String(value).trim().replaceAll("/", "-").replaceAll(".", "-");
  const date = new Date(`${text}T00:00:00`);
  if (!Number.isNaN(date.valueOf())) return date.toISOString().slice(0, 10);
  return text;
}

function normalizeHeader(value) {
  return String(value || "")
    .replaceAll("*", "")
    .replaceAll(" ", "")
    .trim();
}

function resetForm(form) {
  form.reset();
  $$('input[type="date"]:not([data-optional-date])').forEach((input) => {
    if (!input.value) input.value = today();
  });
}

function statusBadge(status, dueDate) {
  const label = escapeHtml(status);
  if (
    status === "已完成" ||
    status === "已付款" ||
    status === "已签订" ||
    status === "已归档" ||
    status === "已签合同" ||
    status === "已交付" ||
    status === "已导入价格库" ||
    status === "已挂账" ||
    status === "已全部挂账" ||
    status === "有效"
  ) {
    return `<span class="badge ok">${label}</span>`;
  }
  if (status === "异常" || status === "逾期" || status === "已过期" || isOverdue(dueDate, false)) return `<span class="badge danger">${label}</span>`;
  if (
    status === "加急" ||
    status === "部分付款" ||
    status === "草拟中" ||
    status === "待跟进" ||
    status === "未签合同" ||
    status === "未签订" ||
    status === "进行中" ||
    status === "已发出" ||
    status === "加工中" ||
    status === "待检验" ||
    status === "待发出" ||
    status === "未挂账" ||
    status === "部分挂账"
  ) {
    return `<span class="badge warning">${label}</span>`;
  }
  return `<span class="badge">${label}</span>`;
}

function planById(id) {
  return state.plans.find((plan) => plan.id === id);
}

function latestProgress(planId) {
  return state.progress
    .filter((item) => item.planId === planId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}

function uniqueValues(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "zh-CN"),
  );
}

let columnFilters = {};

function columnFilterKey(module, column) {
  return `${module}||${column}`;
}

function getColumnFilter(module, column) {
  const raw = columnFilters[columnFilterKey(module, column)];
  if (!raw) return [];
  return raw.map((v) => String(v || "").trim().toLowerCase()).filter(Boolean);
}

function columnFilterMatch(module, column, cellText) {
  const filterValues = getColumnFilter(module, column);
  if (filterValues.length === 0) return true;
  const text = String(cellText || "").toLowerCase();
  return filterValues.some((v) => text.includes(v));
}

function readColumnFilters(module) {
  if (filterDropdownsInitialized[module]) return;
  const filters = {};
  document.querySelectorAll(`.filter-row[data-module="${module}"] .th-filter`).forEach((input) => {
    const raw = String(input.value || "").trim();
    if (!raw) return;
    const values = raw.split(/[,，、\s]+/).map((v) => v.trim()).filter(Boolean);
    if (values.length) filters[columnFilterKey(module, input.dataset.column)] = values;
  });
  columnFilters = { ...columnFilters, ...filters };
  Object.keys(columnFilters).forEach((key) => {
    if (key.startsWith(`${module}||`) && !(key in filters)) delete columnFilters[key];
  });
}

function clearAllColumnFilters(module) {
  const filterRow = document.querySelector(`.filter-row[data-module="${module}"]`);
  if (filterRow) {
    filterRow.querySelectorAll(".filter-toggle").forEach((button) => {
      button.textContent = "\u5168\u90e8";
      button.classList.remove("filter-active");
    });
    filterRow.querySelectorAll(".filter-checkbox").forEach((cb) => { cb.checked = false; });
  }
  Object.keys(columnFilters).forEach((key) => {
    if (key.startsWith(`${module}||`)) delete columnFilters[key];
  });
}

let filterDropdownsInitialized = {};

function getColumnOptions(module, column) {
  const statusOptions = {
    tasks_progress: ["待发出", "已发出", "进行中", "加工中", "待检验", "已交付", "已完成", "异常"],
    progress_status: ["待发出", "已发出", "进行中", "加工中", "待检验", "已交付", "已完成", "异常"],
    contracts_status: ["草拟中", "已签订", "履行中", "已完成", "已归档", "异常"],
    accounts_status: ["未付款", "部分付款", "已付款"],
  };
  const statusKey = `${module}_${column}`;
  if (statusOptions[statusKey]) return statusOptions[statusKey];

  if (module === "tasks") {
    const taskOptions = {
      "\u4efb\u52a1\u7f16\u53f7": () => uniqueValues(state.plans.map((p) => planTaskNo(p))),
      "\u6279\u6b21": () => uniqueValues(state.plans.map((p) => p.batch).filter(Boolean)),
      "\u56fe\u53f7": () => uniqueValues(state.plans.map((p) => planDrawingNo(p))),
      "\u540d\u79f0": () => uniqueValues(state.plans.map((p) => planName(p))),
      "\u8ba1\u5212\u5916\u534f\u65b9": () => uniqueValues(state.plans.map((p) => p.vendor)),
      "\u5de5\u5e8f": () => uniqueValues(state.plans.map((p) => p.process)),
      "\u8981\u6c42\u5b8c\u6210\u65f6\u95f4": () => uniqueValues(state.plans.map((p) => p.dueDate)),
      "\u4efb\u52a1\u8fdb\u5ea6": () => ["\u5f85\u53d1\u51fa", "\u5df2\u53d1\u51fa", "\u8fdb\u884c\u4e2d", "\u52a0\u5de5\u4e2d", "\u5f85\u68c0\u9a8c", "\u5df2\u4ea4\u4ed8", "\u5df2\u5b8c\u6210", "\u5f02\u5e38"],
      "\u4ef7\u683c\u72b6\u6001": () => [{ value: "priced", label: "\u5df2\u6709\u4ef7\u683c" }, { value: "missing", label: "\u7f3a\u5c11\u4ef7\u683c" }],
      "\u5408\u540c\u72b6\u6001": () => [{ value: "signed", label: "\u5df2\u7b7e\u5408\u540c" }, { value: "unsigned", label: "\u672a\u7b7e\u5408\u540c" }],
      "\u5408\u540c\u7f16\u53f7": () => uniqueValues(state.plans.map((p) => p.contractNo).filter(Boolean)),
    };
    if (taskOptions[column]) return taskOptions[column]();
  }
  if (module === "procedures") {
    const procedureOptions = {
      "\u4efb\u52a1\u7f16\u53f7": () => uniqueValues((state.procedures || []).map((i) => i.taskNo)),
      "\u56fe\u53f7": () => uniqueValues((state.procedures || []).map((i) => i.drawingNo)),
      "\u540d\u79f0": () => uniqueValues((state.procedures || []).map((i) => i.name)),
      "\u5916\u534f\u65b9": () => uniqueValues((state.procedures || []).map((i) => i.vendor)),
      "\u5de5\u5e8f": () => uniqueValues((state.procedures || []).map((i) => i.process)),
    };
    if (procedureOptions[column]) return procedureOptions[column]();
  }


  const directOptions = {
    prices: {
      "\u5916\u534f\u65b9": () => uniqueValues(state.prices.map((i) => i.vendor)),
      "\u56fe\u53f7": () => uniqueValues(state.prices.map((i) => i.drawingNo).filter(Boolean)),
      "\u540d\u79f0": () => uniqueValues(state.prices.map((i) => i.name).filter(Boolean)),
      "\u5de5\u5e8f/\u7269\u6599": () => uniqueValues(state.prices.map((i) => i.item)),
      "\u8ba1\u5212\u4e2d\u7684\u5de5\u5e8f": () => uniqueValues(state.prices.flatMap(pricePlannedProcesses)),
      "\u5355\u4f4d": () => uniqueValues(state.prices.map((i) => i.unit)),
      "\u751f\u6548\u65e5\u671f": () => uniqueValues(state.prices.map((i) => i.effectiveDate)),
      "\u8c08\u5224\u7eaa\u8981\u7f16\u53f7": () => uniqueValues(state.prices.map((i) => i.negotiationNo).filter(Boolean)),
      "\u4ef7\u683c\u5355\u53f7": () => uniqueValues(state.prices.map((i) => i.priceSheetNo || i.pricingNo).filter(Boolean)),
      "\u5907\u6ce8": () => uniqueValues(state.prices.map((i) => i.note).filter(Boolean)),
    },
    progress: {
      "\u56fe\u53f7": () => uniqueValues(state.progress.map((i) => { const p = planById(i.planId); return p ? planDrawingNo(p) : ""; })),
      "\u540d\u79f0": () => uniqueValues(state.progress.map((i) => { const p = planById(i.planId); return p ? planName(p) : ""; })),
      "\u5916\u534f\u65b9": () => uniqueValues(state.progress.map((i) => { const p = planById(i.planId); return p ? p.vendor : ""; })),
      "\u72b6\u6001": () => ["\u5f85\u53d1\u51fa", "\u5df2\u53d1\u51fa", "\u8fdb\u884c\u4e2d", "\u52a0\u5de5\u4e2d", "\u5f85\u68c0\u9a8c", "\u5df2\u4ea4\u4ed8", "\u5df2\u5b8c\u6210", "\u5f02\u5e38"],
      "\u66f4\u65b0\u65f6\u95f4": () => uniqueValues(state.progress.map((i) => i.updatedAt)),
      "\u8bf4\u660e": () => uniqueValues(state.progress.map((i) => i.remark).filter(Boolean)),
    },
    contracts: {
      "\u5408\u540c\u7f16\u53f7": () => uniqueValues(state.contracts.map((i) => i.contractNo)),
      "\u5916\u534f\u65b9": () => uniqueValues(state.contracts.map((i) => i.vendor)),
      "\u56fe\u53f7/\u540d\u79f0": () => uniqueValues(state.contracts.map((i) => contractItemsSummary(i))),
      "\u7b7e\u8ba2\u65e5\u671f": () => uniqueValues(state.contracts.map((i) => i.signDate)),
      "\u72b6\u6001": () => ["\u8349\u62df\u4e2d", "\u5df2\u7b7e\u8ba2", "\u5c65\u884c\u4e2d", "\u5df2\u5b8c\u6210", "\u5df2\u5f52\u6863", "\u5f02\u5e38"],
    },
    negotiations: {
      "\u7f16\u53f7": () => uniqueValues(state.negotiations.map((i) => i.negotiationNo)),
      "\u65e5\u671f": () => uniqueValues(state.negotiations.map((i) => i.meetingDate)),
      "\u5916\u534f\u65b9": () => uniqueValues(state.negotiations.map((i) => i.vendor)),
      "\u8ddf\u8fdb\u65e5\u671f": () => uniqueValues(state.negotiations.map((i) => i.followUpDate).filter(Boolean)),
    },
    pricingProcesses: {
      "\u4ef7\u683c\u5355\u53f7": () => uniqueValues(state.pricingProcesses.map((i) => i.pricingNo)),
      "\u65e5\u671f": () => uniqueValues(state.pricingProcesses.map((i) => i.pricingDate)),
      "\u5916\u534f\u65b9": () => uniqueValues(state.pricingProcesses.map((i) => i.vendor)),
      "\u8ddf\u8fdb\u65e5\u671f": () => uniqueValues(state.pricingProcesses.map((i) => i.followUpDate).filter(Boolean)),
      "\u4ef7\u683c\u5e93\u72b6\u6001": () => uniqueValues(state.pricingProcesses.map((i) => i.priceImportStatus || "\u672a\u5bfc\u5165")),
    },
    accounts: {
      "\u5916\u534f\u65b9": () => uniqueValues(state.accounts.map((i) => i.vendor)),
      "\u6302\u8d26\u65e5\u671f": () => uniqueValues(state.accounts.map((i) => i.accountDate)),
      "\u5230\u671f\u65e5": () => uniqueValues(state.accounts.map((i) => i.dueDate)),
      "\u72b6\u6001": () => uniqueValues(state.accounts.map((i) => i.payStatus)),
    },
  };
  if (directOptions[module] && directOptions[module][column]) return directOptions[module][column]();

  const dataMap = {
    tasks: {
      "任务编号": () => uniqueValues(state.plans.map((p) => planTaskNo(p))),
      "图号": () => uniqueValues(state.plans.map((p) => planDrawingNo(p))),
      "名称": () => uniqueValues(state.plans.map((p) => planName(p))),
      "任务类别": () => uniqueValues(state.plans.map((p) => p.taskCategory).filter(Boolean)),
      "外协类别": () => uniqueValues(state.plans.map((p) => p.outsourceCategory).filter(Boolean)),
      "外协产品类别": () => uniqueValues(state.plans.map((p) => p.productCategory).filter(Boolean)),
      "ABC类别": () => uniqueValues(state.plans.map((p) => p.abcCategory).filter(Boolean)),
      "领用用途": () => uniqueValues(state.plans.map((p) => p.usage).filter(Boolean)),
      "计划外协方": () => uniqueValues(state.plans.map((p) => p.vendor)),
      "工序": () => uniqueValues(state.plans.map((p) => p.process)),
      "要求完成时间": () => uniqueValues(state.plans.map((p) => p.dueDate)),
      "任务进度": () => statusOptions.tasks_progress,
      "价格状态": () => [{ value: "priced", label: "已有价格" }, { value: "missing", label: "缺少价格" }],
      "合同状态": () => [{ value: "signed", label: "已签合同" }, { value: "unsigned", label: "未签合同" }],
      "挂账状态": () => [{ value: "accounted", label: "已挂账" }, { value: "unaccounted", label: "未挂账" }],
      "合同编号": () => uniqueValues(state.plans.map((p) => p.contractNo).filter(Boolean)),
    },
    procedures: {
      "任务编号": () => uniqueValues((state.procedures || []).map((i) => i.taskNo)),
      "图号": () => uniqueValues((state.procedures || []).map((i) => i.drawingNo)),
      "名称": () => uniqueValues((state.procedures || []).map((i) => i.name)),
      "外协方": () => uniqueValues((state.procedures || []).map((i) => i.vendor)),
      "工序": () => uniqueValues((state.procedures || []).map((i) => i.process)),
    },
    prices: {
      "外协方": () => uniqueValues(state.prices.map((i) => i.vendor)),
      "图号": () => uniqueValues(state.prices.map((i) => i.drawingNo).filter(Boolean)),
      "名称": () => uniqueValues(state.prices.map((i) => i.name).filter(Boolean)),
      "工序/物料": () => uniqueValues(state.prices.map((i) => i.item)),
      "单位": () => uniqueValues(state.prices.map((i) => i.unit)),
      "生效日期": () => uniqueValues(state.prices.map((i) => i.effectiveDate)),
      "谈判纪要编号": () => uniqueValues(state.prices.map((i) => i.negotiationNo).filter(Boolean)),
      "价格单号": () => uniqueValues(state.prices.map((i) => i.priceSheetNo || i.pricingNo).filter(Boolean)),
      "备注": () => uniqueValues(state.prices.map((i) => i.note).filter(Boolean)),
    },
    progress: {
      "图号": () => uniqueValues(state.progress.map((i) => { const p = planById(i.planId); return p ? planDrawingNo(p) : ""; })),
      "名称": () => uniqueValues(state.progress.map((i) => { const p = planById(i.planId); return p ? planName(p) : ""; })),
      "外协方": () => uniqueValues(state.progress.map((i) => { const p = planById(i.planId); return p ? p.vendor : ""; })),
      "状态": () => statusOptions.progress_status,
      "更新时间": () => uniqueValues(state.progress.map((i) => i.updatedAt)),
      "说明": () => uniqueValues(state.progress.map((i) => i.remark).filter(Boolean)),
    },
    contracts: {
      "合同编号": () => uniqueValues(state.contracts.map((i) => i.contractNo)),
      "外协方": () => uniqueValues(state.contracts.map((i) => i.vendor)),
      "图号/名称": () => uniqueValues(state.contracts.map((i) => contractItemsSummary(i))),
      "状态": () => statusOptions.contracts_status,
      "签订日期": () => uniqueValues(state.contracts.map((i) => i.signDate)),
    },
    negotiations: {
      "编号": () => uniqueValues(state.negotiations.map((i) => i.negotiationNo)),
      "日期": () => uniqueValues(state.negotiations.map((i) => i.meetingDate)),
      "外协方": () => uniqueValues(state.negotiations.map((i) => i.vendor)),
      "跟进日期": () => uniqueValues(state.negotiations.map((i) => i.followUpDate).filter(Boolean)),
    },
    pricingProcesses: {
      "价格单号": () => uniqueValues(state.pricingProcesses.map((i) => i.pricingNo)),
      "日期": () => uniqueValues(state.pricingProcesses.map((i) => i.pricingDate)),
      "外协方": () => uniqueValues(state.pricingProcesses.map((i) => i.vendor)),
      "跟进日期": () => uniqueValues(state.pricingProcesses.map((i) => i.followUpDate).filter(Boolean)),
    },
    accounts: {
      "外协方": () => uniqueValues(state.accounts.map((i) => i.vendor)),
      "状态": () => statusOptions.accounts_status,
      "挂账日期": () => uniqueValues(state.accounts.map((i) => i.accountDate)),
      "到期日": () => uniqueValues(state.accounts.map((i) => i.dueDate)),
    },
  };

  const moduleMap = dataMap[module];
  if (moduleMap && moduleMap[column]) {
    try { return moduleMap[column](); } catch (e) { return []; }
  }
  return [];
}

function populateFilterDatalists(module) {
  setupFilterDropdowns(module);
}

function setupFilterDropdowns(module) {
  if (filterDropdownsInitialized[module]) {
    syncFilterDropdowns(module);
    return;
  }
  filterDropdownsInitialized[module] = true;
  const filterRow = document.querySelector(`.filter-row[data-module="${module}"]`);
  if (!filterRow) return;
  filterRow.querySelectorAll(".th-filter").forEach((input) => {
    const column = input.dataset.column;
    const options = getColumnOptions(module, column);
    const vals = options.map((opt) => (typeof opt === "object" ? opt.value : String(opt)));
    const labels = options.map((opt) => (typeof opt === "object" ? opt.label : String(opt)));
    const valueToLabel = {};
    vals.forEach((v, i) => { valueToLabel[v] = labels[i]; });
    const key = columnFilterKey(module, column);

    const wrapper = document.createElement("div");
    wrapper.className = "filter-dropdown";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "filter-toggle";
    button.textContent = "\u5168\u90e8";
    button.dataset.filterKey = key;

    const panel = document.createElement("div");
    panel.className = "filter-dropdown-panel";
    panel.hidden = true;
    panel._valueToLabel = valueToLabel;
    panel.innerHTML = `<input class="filter-search-input" placeholder="\u641c\u7d22\u6216\u8f93\u5165..." />` +
      vals
      .map((val, i) => `<label class="filter-checkbox-label"><input type="checkbox" class="filter-checkbox" data-filter-key="${escapeHtml(key)}" value="${escapeHtml(val)}" />${escapeHtml(labels[i])}</label>`)
      .join("") +
      `<div class="filter-dropdown-actions"><button class="filter-clear-btn" type="button">\u6e05\u9664</button></div>`;

    wrapper.appendChild(button);
    wrapper.appendChild(panel);
    input.replaceWith(wrapper);

    button.addEventListener("click", (e) => {
      e.stopPropagation();
      document.querySelectorAll(".filter-dropdown-panel").forEach((p) => { if (p !== panel) p.hidden = true; });
      panel.hidden = !panel.hidden;
    });

    panel.addEventListener("change", (e) => {
      const cb = e.target.closest(".filter-checkbox");
      if (!cb) return;
      const selected = [...panel.querySelectorAll(".filter-checkbox:checked")].map((c) => valueToLabel[c.value] || c.value);
      if (selected.length) {
        columnFilters[key] = selected;
        button.textContent = selected.length === vals.length ? "\u5168\u90e8" : `${selected.length}`;
        button.classList.add("filter-active");
      } else {
        delete columnFilters[key];
        button.textContent = "\u5168\u90e8";
        button.classList.remove("filter-active");
      }
      refreshFromFirstPage(module);
    });

    panel.querySelector(".filter-clear-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      panel.querySelectorAll(".filter-checkbox").forEach((c) => { c.checked = false; });
      delete columnFilters[key];
      button.textContent = "\u5168\u90e8";
      button.classList.remove("filter-active");
      const searchInput = panel.querySelector(".filter-search-input");
      if (searchInput) searchInput.value = "";
      refreshFromFirstPage(module);
    });

    const searchInput = panel.querySelector(".filter-search-input");
    if (searchInput) {
      searchInput.addEventListener("input", () => {
        const query = searchInput.value.toLowerCase();
        panel.querySelectorAll(".filter-checkbox-label").forEach((label) => {
          label.hidden = query && !label.textContent.toLowerCase().includes(query);
        });
      });
      searchInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          const text = searchInput.value.trim();
          if (text) {
            const found = panel.querySelector(`.filter-checkbox-label`);
            if (found && found.textContent.trim().toLowerCase().includes(text.toLowerCase())) {
              const cb = found.querySelector(".filter-checkbox");
              if (cb) { cb.checked = true; cb.dispatchEvent(new Event("change", { bubbles: true })); }
            } else {
              columnFilters[key] = [text];
              button.textContent = "1";
              button.classList.add("filter-active");
              refreshFromFirstPage(module);
            }
            searchInput.value = "";
          }
        }
      });
    }
  });
}

function syncFilterDropdowns(module) {
  const filterRow = document.querySelector(`.filter-row[data-module="${module}"]`);
  if (!filterRow) return;
  filterRow.querySelectorAll(".filter-toggle").forEach((button) => {
    const key = button.dataset.filterKey;
    const values = columnFilters[key];
    const panel = button.parentElement.querySelector(".filter-dropdown-panel");
    if (!panel) return;
    if (values && values.length) {
      button.textContent = `${values.length}`;
      button.classList.add("filter-active");
    } else {
      button.textContent = "\u5168\u90e8";
      button.classList.remove("filter-active");
    }
    panel.querySelectorAll(".filter-checkbox").forEach((cb) => {
      const label = (panel._valueToLabel && panel._valueToLabel[cb.value]) || cb.value;
      cb.checked = values ? values.includes(label) : false;
    });
  });
}
function selectedTaskVendor() {
  const select = $("#task-vendor-select");
  return select ? select.value : "";
}

function sameText(left, right) {
  return String(left || "").trim() === String(right || "").trim();
}

function pricePlannedProcess(price) {
  return pricePlannedProcesses(price).join("\u3001");
}

function pricePlannedProcesses(price) {
  const source = Array.isArray(price.plannedProcesses) && price.plannedProcesses.length > 0
    ? price.plannedProcesses
    : String(price.plannedProcessesText || price.plannedProcess || price.planProcess || price.item || "")
        .split(/[;\uFF1B\u3001,\n\r]+/);
  return uniqueValues(source.map((value) => String(value || "").trim()).filter(Boolean));
}

function pricePlannedProcessesText(price) {
  return pricePlannedProcesses(price).join("\n");
}

function addPricePlannedProcess(id, process) {
  const value = String(process || "").trim();
  if (!value) {
    alert("\u8bf7\u586b\u5199\u8ba1\u5212\u4e2d\u7684\u5de5\u5e8f\u3002");
    return;
  }
  let changed = false;
  state.prices = state.prices.map((price) => {
    if (price.id !== id) return price;
    const plannedProcesses = pricePlannedProcesses(price);
    if (plannedProcesses.some((item) => sameText(item, value))) {
      alert("\u8be5\u8ba1\u5212\u5de5\u5e8f\u5df2\u5b58\u5728\u3002");
      return price;
    }
    const nextProcesses = [...plannedProcesses, value];
    changed = true;
    return {
      ...price,
      plannedProcesses: nextProcesses,
      plannedProcess: nextProcesses[0] || "",
      plannedProcessesText: nextProcesses.join("\n"),
    };
  });
  if (!changed) return;
  saveState();
  renderPrices();
  openPriceSubRow(id);
  renderDashboard();
}

function updatePricePlannedProcess(id, index, process) {
  const value = String(process || "").trim();
  if (!value) {
    alert("\u8bf7\u586b\u5199\u8ba1\u5212\u4e2d\u7684\u5de5\u5e8f\u3002");
    return;
  }
  let changed = false;
  state.prices = state.prices.map((price) => {
    if (price.id !== id) return price;
    const plannedProcesses = pricePlannedProcesses(price);
    if (!plannedProcesses[index]) return price;
    if (plannedProcesses.some((item, itemIndex) => itemIndex !== index && sameText(item, value))) {
      alert("\u8be5\u8ba1\u5212\u5de5\u5e8f\u5df2\u5b58\u5728\u3002");
      return price;
    }
    const nextProcesses = plannedProcesses.map((item, itemIndex) => (itemIndex === index ? value : item));
    changed = true;
    return {
      ...price,
      plannedProcesses: nextProcesses,
      plannedProcess: nextProcesses[0] || "",
      plannedProcessesText: nextProcesses.join("\n"),
    };
  });
  if (!changed) return;
  saveState();
  renderPrices();
  openPriceSubRow(id);
  renderDashboard();
}

function deletePricePlannedProcess(id, index) {
  let changed = false;
  state.prices = state.prices.map((price) => {
    if (price.id !== id) return price;
    const plannedProcesses = pricePlannedProcesses(price);
    if (!plannedProcesses[index]) return price;
    const nextProcesses = plannedProcesses.filter((_, itemIndex) => itemIndex !== index);
    changed = true;
    return {
      ...price,
      plannedProcesses: nextProcesses,
      plannedProcess: nextProcesses[0] || "",
      plannedProcessesText: nextProcesses.join("\n"),
    };
  });
  if (!changed) return;
  saveState();
  renderPrices();
  openPriceSubRow(id);
  renderDashboard();
}

function openPriceSubRow(id) {
  const subRow = document.getElementById("price-sub-" + id);
  const toggle = document.querySelector(`[data-toggle-price="${id}"]`);
  if (subRow) subRow.hidden = false;
  if (toggle) {
    toggle.textContent = "\u25bc";
    toggle.classList.add("expanded");
  }
}

function priceGroupKey(vendor, item) {
  return [vendor, item].map((value) => String(value || "").trim()).join("||");
}

function planPriceKey(drawingNo, process) {
  return [drawingNo, process].map((value) => String(value || "").trim()).join("||");
}

function priceSpecificity(price) {
  return (price.drawingNo ? 1 : 0) + (price.name ? 1 : 0);
}

function priceMatchesTarget(price, drawingNo, name) {
  if (drawingNo && price.drawingNo && price.drawingNo !== drawingNo) return false;
  if (name && price.name && price.name !== name) return false;
  return true;
}

function priceIndex() {
  if (priceIndexCache) return priceIndexCache;
  const groups = { byVendorProcess: {}, byDrawingProcess: {} };
  state.prices.forEach((price) => {
    pricePlannedProcesses(price).forEach((process) => {
      const vendorProcessKey = priceGroupKey(price.vendor, process);
      if (!groups.byVendorProcess[vendorProcessKey]) groups.byVendorProcess[vendorProcessKey] = [];
      groups.byVendorProcess[vendorProcessKey].push(price);
      const drawingProcessKey = planPriceKey(price.drawingNo, process);
      if (!groups.byDrawingProcess[drawingProcessKey]) groups.byDrawingProcess[drawingProcessKey] = [];
      groups.byDrawingProcess[drawingProcessKey].push(price);
    });
  });
  Object.values(groups).forEach((group) => {
    Object.keys(group).forEach((key) => {
      group[key].sort((a, b) => {
      const dateCompare = String(b.effectiveDate || "").localeCompare(String(a.effectiveDate || ""));
      if (dateCompare) return dateCompare;
      return priceSpecificity(b) - priceSpecificity(a);
      });
    });
  });
  priceIndexCache = groups;
  return priceIndexCache;
}

function findPlanProcessPrice(plan) {
  const candidates = priceIndex().byDrawingProcess[planPriceKey(planDrawingNo(plan), plan.process)] || [];
  return candidates[0] || null;
}

function findTaskPrice(plan, vendor = selectedTaskVendor()) {
  const targetVendor = vendor || plan.vendor;
  const candidates = priceIndex().byVendorProcess[priceGroupKey(targetVendor, plan.process)] || [];
  const vendorMatch = candidates.find((item) => priceMatchesTarget(item, planDrawingNo(plan), planName(plan)));
  if (vendorMatch) return vendorMatch;
  return findPlanProcessPrice(plan);
}

function findPlanPrice(plan) {
  return findTaskPrice(plan, plan.vendor);
}

function taskAmount(plan, vendor = selectedTaskVendor()) {
  const price = findTaskPrice(plan, vendor) || findPlanProcessPrice(plan);
  if (!price) return null;
  return Number(plan.quantity || 0) * Number(price.price || 0);
}

function findPriceForContractItem(parts, vendor) {
  if (!parts.process) return null;
  const candidates = priceIndex().byVendorProcess[priceGroupKey(vendor, parts.process)] || [];
  return candidates.find((price) => sameText(price.drawingNo, parts.drawingNo) && sameText(price.name, parts.name));
}

function contractItemPriceInfo(parts, vendor, options = {}) {
  const price = findPriceForContractItem(parts, vendor) || findPlanProcessPriceByParts(parts);
  const storedUnitPrice = Number(parts.unitPrice);
  const hasStoredPrice = storedUnitPrice > 0;
  const unitPrice = options.preferPriceLibrary && price ? String(price.price) : (hasStoredPrice ? String(parts.unitPrice) : (price ? String(price.price) : ""));
  const quantityMatch = String(parts.quantityUnit || "").match(/[\d.]+/);
  const quantity = Number(quantityMatch ? quantityMatch[0] : 0);
  const amount = options.preferPriceLibrary
    ? unitPrice && quantity
      ? String(Number(unitPrice) * quantity)
      : parts.amount || ""
    : (Number(parts.amount) > 0 ? parts.amount : (unitPrice && quantity ? String(Number(unitPrice) * quantity) : ""));
  return { unitPrice, amount, price };
}

function findPlanProcessPriceByParts(parts) {
  if (!parts.drawingNo || !parts.process) return null;
  const candidates = priceIndex().byDrawingProcess[planPriceKey(parts.drawingNo, parts.process)] || [];
  return candidates[0] || null;
}

let planContractCache = null;

function planContractMap() {
  if (planContractCache) return planContractCache;
  const map = {};
  state.contracts.forEach((c) => {
    if (c.status === "草拟中" || c.status === "异常") return;
    (Array.isArray(c.contractItems) ? c.contractItems : []).forEach((item) => {
      if (item.taskNo) map[item.taskNo] = c;
    });
  });
  planContractCache = map;
  return map;
}

function findPlanContract(plan) {
  return planContractMap()[planTaskNo(plan)] || null;
}

let accountedTaskNoCache = null;

function accountedTaskNos() {
  if (accountedTaskNoCache) return accountedTaskNoCache;
  const nos = new Set();
  const validContractIds = new Set(
    state.contracts
      .filter((c) => c.status !== "草拟中" && c.status !== "异常")
      .map((c) => c.id)
  );
  state.accounts.forEach((a) => {
    if (!validContractIds.has(a.contractId)) return;
    (Array.isArray(a.accountItems) ? a.accountItems : []).forEach((item) => {
      if (item.taskNo) nos.add(item.taskNo);
    });
  });
  accountedTaskNoCache = nos;
  return nos;
}

function isPlanAccounted(plan) {
  return accountedTaskNos().has(planTaskNo(plan));
}

function planEstimateAmount(plan) {
  const price = findPlanPrice(plan);
  if (!price) return null;
  return Number(plan.quantity || 0) * Number(price.price || 0);
}

function selectedTasks() {
  return state.plans.filter((plan) => selectedTaskIds.has(plan.id));
}

function renderEmpty(colspan, text) {
  return `<tr><td class="empty" colspan="${colspan}">${text}</td></tr>`;
}

function renderDashboard() {
  const running = state.plans.filter((plan) => {
    const progress = latestProgress(plan.id);
    return !progress || progress.status !== "已完成";
  }).length;
  const unpaid = state.accounts
    .filter((item) => item.payStatus !== "已付款")
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const overdue = state.plans.filter((plan) => {
    const progress = latestProgress(plan.id);
    return isOverdue(plan.dueDate, progress && progress.status === "已完成");
  }).length;
  const activeContracts = state.contracts.filter((item) => !["已归档", "异常"].includes(item.status)).length;
  const pendingNegotiations = state.negotiations.length;
  const currentMonth = today().slice(0, 7);
  const monthlyEstimates = buildMonthlyEstimates();
  const currentMonthEstimate = monthlyEstimates.find((item) => item.month === currentMonth);

  $("#metric-plans").textContent = state.plans.length;
  $("#metric-running").textContent = running;
  $("#metric-unpaid").textContent = money(unpaid);
  $("#metric-overdue").textContent = overdue;
  $("#metric-contracts").textContent = activeContracts;
  $("#metric-negotiations").textContent = pendingNegotiations;
  $("#metric-month-estimate").textContent = money(currentMonthEstimate ? currentMonthEstimate.amount : 0);

  $("#monthly-estimate-table").innerHTML =
    monthlyEstimates.length === 0
      ? renderEmpty(4, "暂无暂估")
      : monthlyEstimates
          .map(
            (item) => `<tr>
              <td>${escapeHtml(item.month)}</td>
              <td>${item.count}</td>
              <td>${money(item.amount)}</td>
              <td>${item.missingPriceCount === 0 ? statusBadge("完整") : statusBadge(`${item.missingPriceCount} 个缺价格`, today())}</td>
            </tr>`,
          )
          .join("");

  const upcoming = [...state.plans]
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 6);
  $("#upcoming-table").innerHTML =
    upcoming.length === 0
      ? renderEmpty(5, "暂无近期交付")
      : upcoming
          .map((plan) => {
            const progress = latestProgress(plan.id);
            const status = progress ? progress.status : "待发出";
            return `<tr>
              <td>${escapeHtml(planDrawingNo(plan))}</td>
              <td>${escapeHtml(planName(plan))}</td>
              <td>${escapeHtml(plan.vendor)}</td>
              <td>${escapeHtml(plan.dueDate)}</td>
              <td>${statusBadge(status, plan.dueDate)}</td>
            </tr>`;
          })
          .join("");

  const alerts = state.accounts
    .filter((item) => item.payStatus !== "已付款")
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 6);
  $("#account-alerts-table").innerHTML =
    alerts.length === 0
      ? renderEmpty(4, "暂无挂账提醒")
      : alerts
          .map(
            (item) => `<tr>
              <td>${escapeHtml(item.vendor)}</td>
              <td>${money(item.amount)}</td>
              <td>${escapeHtml(item.dueDate)}</td>
              <td>${statusBadge(item.payStatus, item.dueDate)}</td>
            </tr>`,
          )
          .join("");

  const contracts = state.contracts
    .filter((item) => item.status !== "已归档")
    .sort((a, b) => String(b.signDate || "").localeCompare(String(a.signDate || "")))
    .slice(0, 6);
  $("#contract-alerts-table").innerHTML =
    contracts.length === 0
      ? renderEmpty(4, "暂无合同提醒")
      : contracts
          .map(
            (item) => `<tr>
              <td>${escapeHtml(item.contractNo)}</td>
              <td>${escapeHtml(item.vendor)}</td>
              <td>${escapeHtml(item.signDate)}</td>
              <td>${statusBadge(contractAutoStatus(item))}</td>
            </tr>`,
          )
          .join("");

  const vendorCounts = {};
  state.plans.forEach((plan) => {
    const v = plan.vendor || "未指定";
    vendorCounts[v] = (vendorCounts[v] || 0) + 1;
  });
  const vendorChart = $("#vendor-bar-chart");
  if (vendorChart) {
    const maxCount = Math.max(1, ...Object.values(vendorCounts));
    vendorChart.innerHTML = Object.entries(vendorCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([vendor, count]) => `<div class="bar-chart-row">
        <span class="bar-chart-label">${escapeHtml(vendor)}</span>
        <div class="bar-chart-track"><div class="bar-chart-fill" style="width:${Math.round((count / maxCount) * 100)}%"></div></div>
        <span class="bar-chart-count">${count}</span>
      </div>`)
      .join("");
  }

  const ganttEl = $("#gantt-chart");
  if (ganttEl) {
    renderGanttChart("");
  }

  const setPanelCount = (panelId, count) => {
    const h2 = document.querySelector(`[data-toggle-panel="${panelId}"] h2`);
    if (h2) h2.textContent = h2.textContent.replace(/\s*\(\d+\)$/, "") + ` (${count})`;
  };
  setPanelCount("monthly", monthlyEstimates.length);
  setPanelCount("upcoming", state.plans.length);
  setPanelCount("account", state.accounts.filter((i) => i.payStatus !== "\u5df2\u4ed8\u6b3e").length);
  setPanelCount("contract", state.contracts.filter((i) => i.status !== "\u5df2\u5f52\u6863").length);
  const vendorCount = new Set(state.plans.map((p) => p.vendor).filter(Boolean)).size;
  setPanelCount("vendor-chart", vendorCount);
  const ganttCount = state.plans.filter((p) => p.dueDate).length;
  setPanelCount("gantt", ganttCount);
}

function renderGanttChart(vendorFilter) {
  const ganttEl = $("#gantt-chart");
  if (!ganttEl) return;
  const plans = [...state.plans].filter((p) => p.dueDate && (!vendorFilter || p.vendor === vendorFilter));
  if (plans.length === 0) {
    ganttEl.innerHTML = '<div class="empty" style="padding:16px">暂无任务数据</div>';
    return;
  }
  const minDate = new Date(Math.min(...plans.map((p) => new Date(p.dueDate).getTime())) - 7 * 86400000);
  const maxDate = new Date(Math.max(...plans.map((p) => new Date(p.dueDate).getTime())) + 7 * 86400000);
  const range = maxDate - minDate || 1;
  const months = [];
  const d = new Date(minDate);
  while (d <= maxDate) {
    months.push(d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"));
    d.setMonth(d.getMonth() + 1);
  }
  const grouped = {};
  plans.forEach((p) => {
    const v = p.vendor || "\u672a\u6307\u5b9a";
    if (!grouped[v]) grouped[v] = [];
    grouped[v].push(p);
  });
  const sorted = Object.entries(grouped).sort((a, b) => b[1].length - a[1].length);
  ganttEl.innerHTML =
    '<div class="gantt-header">' + months.map((m) => '<span>' + escapeHtml(m) + '</span>').join("") + '</div>' +
    sorted.map(([vendor, tasks]) =>
      '<div class="gantt-vendor-group">' +
      '<div class="gantt-vendor-label">' + escapeHtml(vendor) + ' (' + tasks.length + ')</div>' +
      tasks.sort((a, b) => a.dueDate.localeCompare(b.dueDate)).map((t) => {
        const start = new Date(t.dueDate).getTime() - 14 * 86400000;
        const end = new Date(t.dueDate).getTime();
        const left = Math.max(0, ((start - minDate) / range) * 100);
        const width = Math.max(2, ((end - start) / range) * 100);
        return '<div class="gantt-row">' +
          '<span class="gantt-row-label">' + escapeHtml(planDrawingNo(t) + ' ' + planName(t)) + '</span>' +
          '<div class="gantt-row-track"><div class="gantt-bar" style="left:' + left + '%;width:' + width + '%"></div></div>' +
        '</div>';
      }).join("") +
      '</div>'
    ).join("");
}

function buildMonthlyEstimates() {
  const grouped = {};
  state.plans.forEach((plan) => {
    const month = String(plan.dueDate || "").slice(0, 7) || "未定月份";
    if (!grouped[month]) {
      grouped[month] = { month, count: 0, amount: 0, missingPriceCount: 0 };
    }
    const amount = planEstimateAmount(plan);
    grouped[month].count += 1;
    if (amount === null) {
      grouped[month].missingPriceCount += 1;
    } else {
      grouped[month].amount += amount;
    }
  });

  return Object.values(grouped).sort((a, b) => a.month.localeCompare(b.month, "zh-CN"));
}

function renderTaskVendorOptions() {
  const select = $("#task-vendor-select");
  if (!select) return;
  const current = select.value;
  const vendors = uniqueValues([...state.prices.map((item) => item.vendor), ...state.plans.map((plan) => plan.vendor)]);
  select.innerHTML =
    vendors.length === 0
      ? `<option value="">请先维护厂家或价格</option>`
      : vendors.map((vendor) => `<option value="${escapeHtml(vendor)}">${escapeHtml(vendor)}</option>`).join("");
  if (vendors.includes(current)) select.value = current;
}

function setSelectOptions(select, values, allLabel) {
  if (!select) return;
  const current = select.value;
  select.innerHTML = [`<option value="">${allLabel}</option>`]
    .concat(values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`))
    .join("");
  if (values.includes(current)) select.value = current;
}


function taskProgressStatus(plan) {
  const progress = latestProgress(plan.id);
  return progress ? progress.status : "待发出";
}

function taskMatchesFilters(plan, selectedVendor) {
  const keyword = $("#task-search").value.trim().toLowerCase();
  const taskPrice = findTaskPrice(plan, selectedVendor);
  const hasPrice = Boolean(findPlanProcessPrice(plan));
  const contract = findPlanContract(plan);
  const hasContract = Boolean(contract);
  const accounted = isPlanAccounted(plan);
  const progressStatus = taskProgressStatus(plan);

  if (
    keyword &&
    ![planTaskNo(plan), plan.batch, planDrawingNo(plan), planName(plan), planLabel(plan), plan.vendor, plan.process].some((value) =>
      String(value || "").toLowerCase().includes(keyword),
    )
  ) {
    return false;
  }

  if (!columnFilterMatch("tasks", "\u4efb\u52a1\u7f16\u53f7", planTaskNo(plan))) return false;
  if (!columnFilterMatch("tasks", "\u6279\u6b21", plan.batch)) return false;
  if (!columnFilterMatch("tasks", "\u56fe\u53f7", planDrawingNo(plan))) return false;
  if (!columnFilterMatch("tasks", "\u540d\u79f0", planName(plan))) return false;
  if (!columnFilterMatch("tasks", "\u4efb\u52a1\u7c7b\u522b", plan.taskCategory)) return false;
  if (!columnFilterMatch("tasks", "\u5916\u534f\u7c7b\u522b", plan.outsourceCategory)) return false;
  if (!columnFilterMatch("tasks", "\u5916\u534f\u4ea7\u54c1\u7c7b\u522b", plan.productCategory)) return false;
  if (!columnFilterMatch("tasks", "ABC\u7c7b\u522b", plan.abcCategory)) return false;
  if (!columnFilterMatch("tasks", "\u9886\u7528\u7528\u9014", plan.usage)) return false;
  if (!columnFilterMatch("tasks", "\u8ba1\u5212\u5916\u534f\u65b9", plan.vendor)) return false;
  if (!columnFilterMatch("tasks", "\u5de5\u5e8f", plan.process)) return false;
  if (!columnFilterMatch("tasks", "quantity", plan.quantity)) return false;
  if (!columnFilterMatch("tasks", "\u8981\u6c42\u5b8c\u6210\u65f6\u95f4", plan.dueDate)) return false;
  if (!columnFilterMatch("tasks", "\u4efb\u52a1\u8fdb\u5ea6", progressStatus)) return false;
  if (!columnFilterMatch("tasks", "\u4ef7\u683c\u72b6\u6001", hasPrice ? "\u5df2\u6709\u4ef7\u683c" : "\u7f3a\u5c11\u4ef7\u683c")) return false;
  if (!columnFilterMatch("tasks", "\u5408\u540c\u72b6\u6001", hasContract ? "\u5df2\u7b7e\u5408\u540c" : "\u672a\u7b7e\u5408\u540c")) return false;
  if (!columnFilterMatch("tasks", "\u6302\u8d26\u72b6\u6001", accounted ? "\u5df2\u6302\u8d26" : "\u672a\u6302\u8d26")) return false;

  if (!columnFilterMatch("tasks", "\u5408\u540c\u7f16\u53f7", contract ? contract.contractNo : "")) return false;
  const taskAmountValue = taskPrice ? Number(plan.quantity || 0) * Number(taskPrice.price || 0) : "";
  if (!columnFilterMatch("tasks", "unitPrice", taskPrice ? taskPrice.price : "")) return false;
  if (!columnFilterMatch("tasks", "amount", taskAmountValue)) return false;

  return true;
}

function filteredTaskRows() {
  const vendor = selectedTaskVendor();
  return state.plans.filter((plan) => taskMatchesFilters(plan, vendor));
}

function plansForPrice(price) {
  const cacheKey = price.id || [price.vendor, price.item, price.drawingNo, price.name].join("||");
  if (pricePlansCache[cacheKey]) return pricePlansCache[cacheKey];
  pricePlansCache[cacheKey] = state.plans.filter((plan) => {
    if (plan.vendor !== price.vendor || plan.process !== price.item) return false;
    if (price.drawingNo && price.drawingNo !== planDrawingNo(plan)) return false;
    if (price.name && price.name !== planName(plan)) return false;
    return true;
  });
  return pricePlansCache[cacheKey];
}

function priceMatchesFilters(item) {
  const keyword = $("#price-search").value.trim().toLowerCase();
  const relatedPlans = plansForPrice(item);
  const drawingNos = item.drawingNo || relatedPlans.map(planDrawingNo).join("、");
  const names = item.name || relatedPlans.map(planName).join("、");

  if (
    keyword &&
    ![
      item.vendor,
      item.item,
      pricePlannedProcess(item),
      item.unit,
      item.price,
      item.effectiveDate,
      item.taxRate,
      item.negotiationNo,
      item.priceSheetNo,
      item.pricingNo,
      item.note,
      drawingNos,
      names,
    ].some((value) => String(value || "").toLowerCase().includes(keyword))
  ) {
    return false;
  }
  if (!columnFilterMatch("prices", "\u5916\u534f\u65b9", item.vendor)) return false;
  if (!columnFilterMatch("prices", "\u56fe\u53f7", drawingNos)) return false;
  if (!columnFilterMatch("prices", "\u540d\u79f0", names)) return false;
  if (!columnFilterMatch("prices", "\u5de5\u5e8f/\u7269\u6599", item.item)) return false;
  if (!columnFilterMatch("prices", "\u8ba1\u5212\u4e2d\u7684\u5de5\u5e8f", pricePlannedProcess(item))) return false;
  if (!columnFilterMatch("prices", "\u5355\u4f4d", item.unit)) return false;
  if (!columnFilterMatch("prices", "\u5355\u4ef7", money(item.price))) return false;
  if (!columnFilterMatch("prices", "\u751f\u6548\u65e5\u671f", item.effectiveDate)) return false;
  if (!columnFilterMatch("prices", "\u7a0e\u7387", (item.taxRate || 0) + "%")) return false;
  if (!columnFilterMatch("prices", "\u8c08\u5224\u7eaa\u8981\u7f16\u53f7", item.negotiationNo)) return false;
  if (!columnFilterMatch("prices", "\u4ef7\u683c\u5355\u53f7", item.priceSheetNo || item.pricingNo)) return false;
  if (!columnFilterMatch("prices", "\u5907\u6ce8", item.note)) return false;
  return true;
}

function pricePayload(data) {
  const plannedProcesses = pricePlannedProcesses({
    plannedProcesses: data.plannedProcesses,
    plannedProcessesText: data.plannedProcessesText,
    plannedProcess: data.plannedProcess,
    planProcess: data.planProcess,
    item: data.item,
  });
  return {
    ...data,
    drawingNo: String(data.drawingNo || "").trim(),
    name: String(data.name || "").trim(),
    plannedProcesses,
    plannedProcess: plannedProcesses[0] || "",
    plannedProcessesText: plannedProcesses.join("\n"),
    pricingNo: String(data.pricingNo || data.priceSheetNo || "").trim(),
    note: String(data.note || "").trim(),
    price: Number(data.price),
    taxRate: Number(data.taxRate || 0),
  };
}

function resetPriceEdit() {
}

function startPriceEdit(id) {
  const item = state.prices.find((price) => price.id === id);
  if (!item) return;
  const createPanel = $("#price-create-panel");
  if (createPanel) createPanel.hidden = true;
  switchView("prices");
  openEditModal({
    title: "\u4fee\u6539\u4ef7\u683c",
    fields: [
      { name: "drawingNo", label: "\u56fe\u53f7", value: item.drawingNo || "", required: true },
      { name: "name", label: "\u540d\u79f0", value: item.name || "", required: true },
      { name: "vendor", label: "\u5916\u534f\u65b9", value: item.vendor || "", required: true },
      { name: "item", label: "\u5de5\u5e8f/\u7269\u6599", value: item.item || "", readonly: true },
      { name: "unit", label: "\u5355\u4f4d", value: item.unit || "", required: true },
      { name: "price", label: "\u5355\u4ef7", value: item.price || 0, type: "number", min: 0, step: "0.01", required: true },
      { name: "effectiveDate", label: "\u751f\u6548\u65e5\u671f", value: item.effectiveDate || today(), type: "date", required: true },
      { name: "taxRate", label: "\u7a0e\u7387", value: item.taxRate || 0, type: "number", min: 0, step: "0.01" },
      { name: "negotiationNo", label: "\u8c08\u5224\u7eaa\u8981\u7f16\u53f7", value: item.negotiationNo || "" },
      { name: "priceSheetNo", label: "\u4ef7\u683c\u5355\u53f7", value: item.priceSheetNo || item.pricingNo || "" },
      { name: "note", label: "\u5907\u6ce8", value: item.note || "", type: "textarea", span: 2 },
    ],
    onSave: (data) => {
      updateRecord("prices", id, pricePayload({ ...data, item: item.item || "", plannedProcesses: pricePlannedProcesses(item) }));
      resetPriceEdit();
    },
  });
}

function contractPayload(data) {
  const contractItems = parseContractItems(data.contractItemsText || data.project, data.vendor, { enrichContractPrice: true });
  const project = contractItems.map((item) => item.label).join("\u3001");
  const { contractItemsText, ...rest } = data;
  const autoAmount = contractItems.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  return {
    ...rest,
    project,
    contractItems,
    amount: autoAmount || Number(data.amount),
  };
}

function parseContractItems(text, vendor = "", options = {}) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((label) => (options.enrichContractPrice ? enrichContractItem({ label }, vendor) : { label }));
}

function formatContractItemLabel(parts) {
  return [parts.seq, parts.drawingNo, parts.name, parts.quantityUnit, parts.process, parts.unitPrice, parts.amount, parts.note]
    .filter((value) => String(value || "").trim())
    .join(" / ");
}

function enrichContractItem(item, vendor = "") {
  const parts = parseContractItemParts(item.label || "");
  const priceInfo = contractItemPriceInfo(parts, vendor, { preferPriceLibrary: true });
  const next = {
    ...item,
    taskNo: parts.seq || item.taskNo || "",
    drawingNo: parts.drawingNo || item.drawingNo || "",
    name: parts.name || item.name || "",
    process: parts.process || item.process || "",
    quantityUnit: parts.quantityUnit || item.quantityUnit || "",
    unitPrice: priceInfo.unitPrice || item.unitPrice || "",
    amount: priceInfo.amount || item.amount || "",
    priceId: priceInfo.price ? priceInfo.price.id || "" : item.priceId || "",
    note: parts.note || item.note || "",
  };
  next.label = formatContractItemLabel({
    seq: next.taskNo,
    drawingNo: next.drawingNo,
    name: next.name,
    quantityUnit: next.quantityUnit,
    process: next.process,
    unitPrice: next.unitPrice,
    amount: next.amount,
    note: next.note,
  });
  return next;
}

function contractItemsSummary(contract) {
  if (Array.isArray(contract.contractItems) && contract.contractItems.length > 0) {
    const items = contract.contractItems;
    if (items.length <= 2) {
      return items.map((item) => {
        const parts = parseContractItemParts(item.label);
        return parts.drawingNo && parts.name ? `${parts.drawingNo} ${parts.name}` : (item.label || "");
      }).filter(Boolean).join("、");
    }
    const first = items[0];
    const parts = parseContractItemParts(first.label);
    const firstLabel = parts.drawingNo && parts.name ? `${parts.drawingNo} ${parts.name}` : (first.label || "");
    return `${firstLabel} 等 ${items.length} 项`;
  }
  return String(contract.project || "");
}

function contractedAccountedLabels(contractId) {
  const labels = new Set();
  if (!contractId) return labels;
  state.accounts
    .filter((a) => a.contractId === contractId)
    .forEach((a) => {
      (Array.isArray(a.accountItems) ? a.accountItems : []).forEach((item) => {
        const drawingNo = item.drawingNo || "";
        const name = item.name || "";
        if (!drawingNo && !name) {
          const parts = parseContractItemParts(item.label);
          if (parts.drawingNo || parts.name) {
            labels.add(`${parts.drawingNo}||${parts.name}`);
          }
        } else {
          labels.add(`${drawingNo}||${name}`);
        }
      });
    });
  return labels;
}

function contractItemsText(contract) {
  if (Array.isArray(contract.contractItems) && contract.contractItems.length > 0) {
    return contract.contractItems.map((item) => item.label || "").filter(Boolean).join("\n");
  }
  return String(contract.project || "");
}

function negotiationPayload(data) {
  const negotiationItems = parseContractItems(data.negotiationItemsText || data.project);
  const project = negotiationItems.map((item) => item.label).join("、");
  const { negotiationItemsText, ...rest } = data;
  const negotiationNo = String(data.negotiationNo || "").trim() || nextNegotiationNo();
  return {
    ...rest,
    negotiationNo,
    project,
    negotiationItems,
  };
}

function negotiationItemsSummary(negotiation) {
  if (Array.isArray(negotiation.negotiationItems) && negotiation.negotiationItems.length > 0) {
    return negotiation.negotiationItems.map((item) => item.label || "").filter(Boolean).join("、");
  }
  return String(negotiation.project || "");
}

function negotiationItemsText(negotiation) {
  if (Array.isArray(negotiation.negotiationItems) && negotiation.negotiationItems.length > 0) {
    return negotiation.negotiationItems.map((item) => item.label || "").filter(Boolean).join("\n");
  }
  return String(negotiation.project || "");
}

function pricingProcessPayload(data) {
  const pricingItems = parseContractItems(data.pricingItemsText || data.project);
  const project = pricingItems.map((item) => item.label).join("、");
  const { pricingItemsText, ...rest } = data;
  const pricingNo = String(data.pricingNo || "").trim() || nextPricingProcessNo();
  return {
    ...rest,
    pricingNo,
    project,
    pricingItems,
  };
}

function pricingProcessItemsSummary(pricingProcess) {
  if (Array.isArray(pricingProcess.pricingItems) && pricingProcess.pricingItems.length > 0) {
    return pricingProcess.pricingItems.map((item) => item.label || "").filter(Boolean).join("、");
  }
  return String(pricingProcess.project || "");
}

function pricingProcessItemsText(pricingProcess) {
  if (Array.isArray(pricingProcess.pricingItems) && pricingProcess.pricingItems.length > 0) {
    return pricingProcess.pricingItems.map((item) => item.label || "").filter(Boolean).join("\n");
  }
  return String(pricingProcess.project || "");
}

function firstNumber(value) {
  const match = String(value || "").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function unitFromQuantityUnit(value) {
  const text = String(value || "").trim();
  return text.replace(/[\d.\s]/g, "") || text;
}

function priceKey(price) {
  return [price.vendor, price.drawingNo, price.name, price.item, pricePlannedProcess(price)].map((value) => String(value || "").trim()).join("||");
}

function pricingProcessPriceRows(pricingProcess) {
  const items =
    Array.isArray(pricingProcess.pricingItems) && pricingProcess.pricingItems.length > 0
      ? pricingProcess.pricingItems
      : parseContractItems(pricingProcess.project);
  return items
    .map((item) => {
      const parts = parseContractItemParts(item.label);
      return pricePayload({
        drawingNo: parts.drawingNo,
        name: parts.name,
        vendor: pricingProcess.vendor,
        item: parts.process,
        plannedProcess: parts.process,
        unit: unitFromQuantityUnit(parts.quantityUnit),
        price: firstNumber(parts.unitPrice),
        effectiveDate: pricingProcess.pricingDate || today(),
        taxRate: 0,
        negotiationNo: "",
        priceSheetNo: pricingProcess.pricingNo || "",
        pricingNo: pricingProcess.pricingNo || "",
        pricingProcessId: pricingProcess.id || "",
        note: parts.note || "",
      });
    })
    .filter((item) => item.drawingNo && item.name && item.vendor && item.item && item.unit && item.price > 0 && item.effectiveDate);
}

function syncPricingProcessToPrices(id, previousPricingNo = "", removeWhenEmpty = false) {
  const pricingProcess = state.pricingProcesses.find((item) => item.id === id);
  if (!pricingProcess) return null;
  const priceRows = pricingProcessPriceRows(pricingProcess);
  const sourceMatches = (price) =>
    price.pricingProcessId === id ||
    (pricingProcess.pricingNo && (price.pricingNo === pricingProcess.pricingNo || price.priceSheetNo === pricingProcess.pricingNo)) ||
    (previousPricingNo && (price.pricingNo === previousPricingNo || price.priceSheetNo === previousPricingNo));
  const previousSourceKeys = new Set(state.prices.filter(sourceMatches).map(priceKey));
  const nextPrices = state.prices.filter((price) => !sourceMatches(price));
  if (priceRows.length === 0) {
    if (removeWhenEmpty && previousSourceKeys.size > 0) {
      state.prices = nextPrices;
      state.pricingProcesses = state.pricingProcesses.map((item) =>
        item.id === id
          ? {
              ...item,
              priceImportStatus: "未导入",
              priceImportedAt: "",
              priceImportedCount: 0,
            }
          : item,
      );
      return { added: 0, updated: 0, removed: previousSourceKeys.size, count: 0 };
    }
    return null;
  }
  let added = 0;
  let updated = 0;

  priceRows.forEach((row) => {
    const key = priceKey(row);
    const index = nextPrices.findIndex((price) => priceKey(price) === key);
    if (index >= 0) {
      nextPrices[index] = { ...nextPrices[index], ...row };
      updated += 1;
    } else {
      nextPrices.push({ id: crypto.randomUUID(), ...row });
      if (previousSourceKeys.has(key)) updated += 1;
      else added += 1;
    }
  });

  state.prices = nextPrices;
  state.pricingProcesses = state.pricingProcesses.map((item) =>
    item.id === id
      ? {
          ...item,
          priceImportStatus: "已导入价格库",
          priceImportedAt: new Date().toISOString(),
          priceImportedCount: priceRows.length,
        }
      : item,
  );
  return { added, updated, count: priceRows.length };
}

function importPricingProcessToPrices(id) {
  const result = syncPricingProcessToPrices(id);
  if (!result) {
    alert("没有可导入价格库的明细，请确认定价流程明细中已填写图号、名称、工序、单位和单价。");
    return;
  }
  saveState();
  refreshFromFirstPage("pricingProcesses"); refreshFromFirstPage("prices"); renderDashboard();
  switchView("pricingProcesses");
  alert(`已导入价格库：新增 ${result.added} 条，更新 ${result.updated} 条。`);
}

function accountPayload(data) {
  const accountItems = parseContractItems(data.accountItemsText || data.project);
  const project = accountItems.map((item) => item.label).join("、");
  const { accountItemsText, ...rest } = data;
  return {
    ...rest,
    project,
    accountItems,
    amount: Number(data.amount),
  };
}

function accountItemsSummary(account) {
  if (Array.isArray(account.accountItems) && account.accountItems.length > 0) {
    return account.accountItems.map((item) => item.label || "").filter(Boolean).join("、");
  }
  return String(account.project || "");
}

function accountItemsText(account) {
  if (Array.isArray(account.accountItems) && account.accountItems.length > 0) {
    return account.accountItems.map((item) => item.label || "").filter(Boolean).join("\n");
  }
  return String(account.project || "");
}

function accountItemKeys(contractId) {
  const keys = new Set();
  state.accounts.forEach((account) => {
    if (contractId && account.contractId !== contractId) return;
    const items =
      Array.isArray(account.accountItems) && account.accountItems.length > 0 ? account.accountItems : parseContractItems(account.project);
    items.forEach((item) => {
      const parts = parseContractItemParts(item.label);
      const drawingNo = parts.drawingNo || item.drawingNo || "";
      const name = parts.name || item.name || "";
      if (drawingNo || name) keys.add(`${drawingNo}||${name}`);
    });
  });
  return keys;
}

function contractItemKey(item) {
  const parts = parseContractItemParts(item.label);
  const drawingNo = parts.drawingNo || item.drawingNo || "";
  const name = parts.name || item.name || "";
  return `${drawingNo}||${name}`;
}

function contractAutoStatus(contract) {
  if (contract.status === "异常" || contract.status === "草拟中" || contract.status === "已完成" || contract.status === "已归档") return contract.status;
  const items = Array.isArray(contract.contractItems) && contract.contractItems.length > 0 ? contract.contractItems : parseContractItems(contract.project);
  if (items.length === 0) return contract.status || "履行中";
  const accountKeys = accountItemKeys(contract.id);
  const accountedCount = items.filter((item) => accountKeys.has(contractItemKey(item))).length;
  if (accountedCount === items.length) return "已完成";
  if (accountedCount > 0 && contract.status === "已签订") return "履行中";
  return contract.status || "履行中";
}

function parseContractItemParts(label) {
  const parts = String(label || "").split(/\s*\/\s*/).map((s) => s.trim()).filter(Boolean);
  const hasTaskNo = /^TASK-\d+$/i.test(parts[0] || "");
  const offset = hasTaskNo ? 1 : 0;
  const thirdLooksLikeQuantity = /^[\d.]+/.test(parts[offset + 2] || "");
  return {
    seq: hasTaskNo ? parts[0] : "",
    drawingNo: parts[offset] || "",
    name: parts[offset + 1] || "",
    process: thirdLooksLikeQuantity ? parts[offset + 3] || "" : parts[offset + 2] || "",
    quantityUnit: thirdLooksLikeQuantity ? parts[offset + 2] || "" : parts[offset + 3] || "",
    unitPrice: parts[offset + 4] || "",
    amount: parts[offset + 5] || "",
    note: parts.slice(offset + 6).join(" / ") || "",
  };
}

function resetContractEdit() {
  editingContractId = null;
}

function startContractEdit(id) {
  const item = state.contracts.find((contract) => contract.id === id);
  if (!item) return;
  openEditModal({
    title: "\u4fee\u6539\u5916\u534f\u5408\u540c",
    fields: [
      { name: "contractNo", label: "\u5408\u540c\u7f16\u53f7", value: item.contractNo || "", required: true },
      { name: "vendor", label: "\u5916\u534f\u65b9", value: item.vendor || "", required: true },
      { name: "contractItemsText", label: "\u5408\u540c\u6807\u7684\u7269", value: contractItemsText(item), type: "textarea", span: 2, required: true },
      { name: "amount", label: "\u5408\u540c\u91d1\u989d", value: item.amount || 0, type: "number", min: 0, step: "0.01" },
      { name: "signDate", label: "\u7b7e\u8ba2\u65e5\u671f", value: item.signDate || today(), type: "date", required: true },
      { name: "status", label: "\u5408\u540c\u72b6\u6001", value: item.status || "\u8349\u62df\u4e2d", type: "select", options: ["\u8349\u62df\u4e2d", "\u5df2\u7b7e\u8ba2", "\u5c65\u884c\u4e2d", "\u5df2\u5b8c\u6210", "\u5df2\u5f52\u6863", "\u5f02\u5e38"] },
      { name: "note", label: "\u5907\u6ce8", value: item.note || "", span: 2 },
    ],
    onSave: (data) => {
      updateRecord("contracts", id, contractPayload(data));
    },
  });
}

function resetNegotiationEdit() {
  editingNegotiationId = null;
}

function startNegotiationEdit(id) {
  const item = state.negotiations.find((n) => n.id === id);
  if (item) openNegotiationModal(item);
}

function resetPricingProcessEdit() {
  editingPricingProcessId = null;
  $("#pricing-process-edit-panel").hidden = true;
  resetForm($("#pricing-process-edit-form"));
}

function startPricingProcessEdit(id) {
  const item = state.pricingProcesses.find((pricingProcess) => pricingProcess.id === id);
  if (!item) return;
  $("#pricing-process-create-panel").hidden = true;
  editingPricingProcessId = id;
  const form = $("#pricing-process-edit-form");
  form.elements.pricingDate.value = item.pricingDate || today();
  form.elements.pricingNo.value = item.pricingNo || "";
  form.elements.vendor.value = item.vendor || "";
  form.elements.pricingItemsText.value = pricingProcessItemsText(item);
  form.elements.followUpDate.value = item.followUpDate || "";
  $("#pricing-process-edit-panel").hidden = false;
  switchView("pricingProcesses");
  form.elements.pricingDate.focus();
}

function resetAccountEdit() {
  editingAccountId = null;
}

function startAccountEdit(id) {
  const item = state.accounts.find((account) => account.id === id);
  if (!item) return;
  openEditModal({
    title: "\u4fee\u6539\u6302\u8d26",
    fields: [
      { name: "vendor", label: "\u5916\u534f\u65b9", value: item.vendor || "", required: true },
      { name: "accountItemsText", label: "\u5173\u8054\u56fe\u53f7/\u540d\u79f0", value: accountItemsText(item), type: "textarea", span: 2, required: true },
      { name: "amount", label: "\u91d1\u989d", value: item.amount || 0, type: "number", min: 0, step: "0.01", required: true },
      { name: "accountDate", label: "\u6302\u8d26\u65e5\u671f", value: item.accountDate || today(), type: "date", required: true },
      { name: "dueDate", label: "\u5230\u671f\u65e5", value: item.dueDate || today(), type: "date", required: true },
      { name: "payStatus", label: "\u4ed8\u6b3e\u72b6\u6001", value: item.payStatus || "\u672a\u4ed8\u6b3e", type: "select", options: ["\u672a\u4ed8\u6b3e", "\u90e8\u5206\u4ed8\u6b3e", "\u5df2\u4ed8\u6b3e"] },
      { name: "voucher", label: "\u53d1\u7968/\u51ed\u8bc1", value: item.voucher || "" },
      { name: "reportNo", label: "\u7f51\u62a5\u5355\u7f16\u53f7", value: item.reportNo || "" },
    ],
    onSave: (data) => {
      const accountItems = parseContractItems(data.accountItemsText || data.vendor);
      const project = accountItems.map((i) => i.label).join("\u3001");
      updateRecord("accounts", id, {
        vendor: data.vendor,
        project,
        accountItems: accountItems.map((i) => ({ label: i.label, drawingNo: i.drawingNo, name: i.name })),
        amount: Number(data.amount || 0),
        accountDate: data.accountDate || today(),
        dueDate: data.dueDate || today(),
        payStatus: data.payStatus || "\u672a\u4ed8\u6b3e",
        voucher: data.voucher || "",
        reportNo: data.reportNo || "",
      });
    },
  });
}

function startPlanEdit(id) {
  const item = state.plans.find((plan) => plan.id === id);
  if (!item) return;
  const plan = normalizePlan(item);
  openEditModal({
    title: "\u4fee\u6539\u5916\u534f\u4efb\u52a1",
    fields: [
      { name: "taskNo", label: "\u4efb\u52a1\u7f16\u53f7", value: planTaskNo(plan), readonly: true },
      { name: "drawingNo", label: "\u56fe\u53f7", value: planDrawingNo(plan), required: true },
      { name: "name", label: "\u540d\u79f0", value: planName(plan), required: true },
      { name: "vendor", label: "\u5916\u534f\u65b9", value: plan.vendor || "", required: true },
      { name: "process", label: "\u5de5\u5e8f", value: plan.process || "", required: true },
      { name: "quantity", label: "\u6570\u91cf", value: plan.quantity || 0, type: "number", min: 0, step: "0.01" },
      { name: "dueDate", label: "\u8981\u6c42\u5b8c\u6210\u65f6\u95f4", value: plan.dueDate || today(), type: "date" },
      { name: "contractNo", label: "\u5408\u540c\u53f7", value: plan.contractNo || "" },
      { name: "batch", label: "\u6279\u6b21", value: plan.batch || "" },
      { name: "taskCategory", label: "\u4efb\u52a1\u7c7b\u522b", value: plan.taskCategory || "" },
      { name: "outsourceCategory", label: "\u5916\u534f\u7c7b\u522b", value: plan.outsourceCategory || "" },
      { name: "productCategory", label: "\u5916\u534f\u4ea7\u54c1\u7c7b\u522b", value: plan.productCategory || "" },
      { name: "abcCategory", label: "ABC\u7c7b\u522b", value: plan.abcCategory || "" },
      { name: "usage", label: "\u9886\u7528\u7528\u9014", value: plan.usage || "" },
      { name: "note", label: "\u5907\u6ce8", value: plan.note || "", type: "textarea", span: 2 },
    ],
    onSave: (data) => {
      state.plans = state.plans.map((current, index) =>
        current.id === id
          ? normalizePlan(
              {
                ...current,
                ...data,
                taskNo: planTaskNo(current),
                quantity: Number(data.quantity || 0),
              },
              index,
            )
          : current,
      );
      const updatedPlan = state.plans.find((planItem) => planItem.id === id);
      if (updatedPlan) {
        const procedureKeys = new Set(
          (Array.isArray(updatedPlan.procedureFiles) ? updatedPlan.procedureFiles : [])
            .map((file) => file.id || file.path || file.url)
            .filter(Boolean),
        );
        state.procedures = (state.procedures || []).map((procedure) =>
          procedure.planId === id || procedureKeys.has(procedure.id) || procedureKeys.has(procedure.path) || procedureKeys.has(procedure.url)
            ? {
                ...procedure,
                taskNo: planTaskNo(updatedPlan),
                drawingNo: planDrawingNo(updatedPlan),
                name: planName(updatedPlan),
                vendor: updatedPlan.vendor || "",
                process: updatedPlan.process || "",
              }
            : procedure,
        );
      }
      state.procedures = buildProcedureLibrary(state.procedures || [], state.plans);
      saveState();
      refreshFromFirstPage("tasks");
      if (activeView() === "procedures") renderProcedures();
      renderDashboard();
    },
  });
}

function startProgressEdit(id) {
  const item = state.progress.find((progress) => progress.id === id);
  if (!item) return;
  openEditModal({
    title: "\u4fee\u6539\u5916\u534f\u8fdb\u5ea6",
    fields: [
      {
        name: "status",
        label: "\u72b6\u6001",
        value: item.status || "\u5f85\u53d1\u51fa",
        type: "select",
        options: ["\u5f85\u53d1\u51fa", "\u5df2\u53d1\u51fa", "\u8fdb\u884c\u4e2d", "\u52a0\u5de5\u4e2d", "\u5f85\u68c0\u9a8c", "\u5df2\u4ea4\u4ed8", "\u5df2\u5b8c\u6210", "\u5f02\u5e38"],
      },
      { name: "percent", label: "\u5b8c\u6210\u7387", value: item.percent || 0, type: "number", min: 0, max: 100, step: 1 },
      { name: "updatedAt", label: "\u66f4\u65b0\u65f6\u95f4", value: item.updatedAt || today(), type: "date" },
      { name: "remark", label: "\u8bf4\u660e", value: item.remark || "", type: "textarea", span: 2 },
    ],
    onSave: (data) => {
      updateRecord("progress", id, {
        status: data.status,
        percent: Number(data.percent || 0),
        updatedAt: data.updatedAt || today(),
        remark: data.remark || "",
      });
      if (activeView() === "tasks") renderTasks();
    },
  });
}

function startProcedureEdit(id) {
  const item = (state.procedures || []).find((procedure) => procedure.id === id);
  if (!item) return;
  openEditModal({
    title: "\u4fee\u6539\u5de5\u827a\u89c4\u7a0b",
    fields: [
      { name: "fileName", label: "PDF\u6587\u4ef6\u540d", value: item.fileName || item.name || "PDF", required: true, span: 2 },
    ],
    onSave: (data) => {
      const fileName = String(data.fileName || "").trim() || item.fileName || item.name || "PDF";
      const keys = new Set([item.id, item.path, item.url].filter(Boolean));
      const nextProcedures = (state.procedures || []).map((procedure) =>
        procedure.id === id ? { ...procedure, fileName } : procedure,
      );
      state.plans = state.plans.map((plan) => {
        const files = Array.isArray(plan.procedureFiles) ? plan.procedureFiles : [];
        const procedureFiles = files.map((file) => {
          const fileKey = file.id || file.path || file.url;
          return keys.has(fileKey) ? { ...file, fileName, name: fileName } : file;
        });
        return procedureFiles === files ? plan : { ...plan, procedureFiles };
      });
      state.procedures = buildProcedureLibrary(nextProcedures, state.plans);
      saveState();
      renderProcedures();
      if (activeView() === "tasks") renderTasks();
    },
  });
}

function procedureKeys(item) {
  return new Set([item && item.id, item && item.path, item && item.url].filter(Boolean));
}

function removeProcedure(id) {
  const item = (state.procedures || []).find((procedure) => procedure.id === id);
  if (!item) return;
  if (!confirm("\u786e\u5b9a\u5220\u9664\u8fd9\u4efd\u5de5\u827a\u89c4\u7a0b\u5417\uff1f")) return;
  const keys = procedureKeys(item);
  state.procedures = (state.procedures || []).filter((procedure) => procedure.id !== id && !keys.has(procedure.path) && !keys.has(procedure.url));
  state.plans = state.plans.map((plan) => ({
    ...plan,
    procedureFiles: (Array.isArray(plan.procedureFiles) ? plan.procedureFiles : []).filter((file) => {
      const fileKey = file.id || file.path || file.url;
      return !keys.has(fileKey);
    }),
  }));
  state.procedures = buildProcedureLibrary(state.procedures || [], state.plans);
  saveState();
  renderProcedures();
  if (activeView() === "tasks") renderTasks();
}

function removeProcedureFile(planId, fileKey) {
  const plan = state.plans.find((p) => p.id === planId);
  if (!plan) return;
  if (!confirm("\u786e\u5b9a\u5220\u9664\u8be5\u5de5\u827a\u89c4\u7a0b\u6587\u4ef6\u5417\uff1f")) return;
  state.plans = state.plans.map((p) => {
    if (p.id !== planId) return p;
    return {
      ...p,
      procedureFiles: (Array.isArray(p.procedureFiles) ? p.procedureFiles : []).filter((f) => {
        const k = f.id || f.path || f.url || "";
        return k !== fileKey;
      }),
    };
  });
  state.procedures = buildProcedureLibrary(state.procedures || [], state.plans);
  saveState();
  renderTasks();
}

async function replaceProcedure(id, file) {
  const item = (state.procedures || []).find((procedure) => procedure.id === id);
  if (!item || !file) return;
  const plan = state.plans.find((planItem) => planItem.id === item.planId) || {
    id: item.planId || "",
    taskNo: item.taskNo || "",
    drawingNo: item.drawingNo || "",
    name: item.name || "",
    vendor: item.vendor || "",
    process: item.process || "",
  };
  const uploaded = await uploadProcedureAttachment(plan, file);
  const keys = procedureKeys(item);
  const replacement = {
    ...item,
    ...uploaded,
    id: item.id,
    planId: item.planId || plan.id || "",
    taskNo: item.taskNo || planTaskNo(plan),
    drawingNo: item.drawingNo || planDrawingNo(plan),
    name: item.name || planName(plan),
    vendor: item.vendor || plan.vendor || "",
    process: item.process || plan.process || "",
    fileName: uploaded.fileName || uploaded.name || file.name,
  };
  state.procedures = (state.procedures || []).map((procedure) => (procedure.id === id ? replacement : procedure));
  state.plans = state.plans.map((planItem) => {
    const files = Array.isArray(planItem.procedureFiles) ? planItem.procedureFiles : [];
    const procedureFiles = files.map((oldFile) => {
      const fileKey = oldFile.id || oldFile.path || oldFile.url;
      return keys.has(fileKey) ? { ...oldFile, ...uploaded, id: item.id, fileName: replacement.fileName, name: replacement.fileName } : oldFile;
    });
    return procedureFiles === files ? planItem : { ...planItem, procedureFiles };
  });
  state.procedures = buildProcedureLibrary(state.procedures || [], state.plans);
  saveState();
  renderProcedures();
  if (activeView() === "tasks") renderTasks();
}

function procedureMatchesFilters(item) {
  const keyword = $("#procedure-search").value.trim().toLowerCase();
  if (keyword && ![item.drawingNo, item.name, item.process, item.fileName].some((value) => String(value || "").toLowerCase().includes(keyword))) return false;
  if (!columnFilterMatch("procedures", "\u56fe\u53f7", item.drawingNo)) return false;
  if (!columnFilterMatch("procedures", "\u540d\u79f0", item.name)) return false;
  if (!columnFilterMatch("procedures", "\u5de5\u5e8f", item.process)) return false;
  if (!columnFilterMatch("procedures", "fileName", item.fileName || item.name)) return false;
  if (!columnFilterMatch("procedures", "uploadedAt", (item.uploadedAt || "").slice(0, 19).replace("T", " "))) return false;
  return true;
}

function renderProcedures() {
  readColumnFilters("procedures");
  populateFilterDatalists("procedures");
  const rows = (state.procedures || []).filter(procedureMatchesFilters);
  const pageInfo = paginateRows("procedures", rows);
  $("#procedures-table").innerHTML =
    rows.length === 0
      ? renderEmpty(6, "\u6682\u65e0\u5de5\u827a\u89c4\u7a0b")
      : pageInfo.pageRows
          .map((item) => {
            const url = item.url || item.path || "#";
            return '<tr>' +
              '<td>' + escapeHtml(item.drawingNo || "-") + '</td>' +
              '<td>' + escapeHtml(item.name || "-") + '</td>' +
              '<td>' + escapeHtml(item.process || "-") + '</td>' +
              '<td><a class="attachment-link" href="' + escapeHtml(url) + '" target="_blank">' + escapeHtml(item.fileName || item.name || "PDF") + '</a></td>' +
              '<td>' + escapeHtml((item.uploadedAt || "").slice(0, 19).replace("T", " ") || "-") + '</td>' +
              '<td><a class="ghost-button compact-button" href="' + escapeHtml(url) + '" target="_blank">\u6253\u5f00</a><label class="ghost-button compact-button">\u66ff\u6362<input class="procedure-replace-input" data-procedure-id="' + escapeHtml(item.id) + '" type="file" accept="application/pdf,.pdf" hidden /></label><button class="ghost-button compact-button" data-edit-procedure="' + escapeHtml(item.id) + '" type="button">\u4fee\u6539</button><button class="danger-button compact-button" data-delete-procedure="' + escapeHtml(item.id) + '" type="button">\u5220\u9664</button></td>' +
            '</tr>';
          })
          .join("");
  renderPagination("procedures", "#procedures-table", pageInfo);
}

function renderTasks() {
  readColumnFilters("tasks");
  populateFilterDatalists("tasks");
  const rows = filteredTaskRows();
  const pageInfo = paginateRows("tasks", rows);
  selectedTaskIds = new Set([...selectedTaskIds].filter((id) => state.plans.some((plan) => plan.id === id)));

  const checkAll = $("#task-check-all");
  if (checkAll) {
    checkAll.checked = rows.length > 0 && rows.every((plan) => selectedTaskIds.has(plan.id));
    checkAll.indeterminate = rows.some((plan) => selectedTaskIds.has(plan.id)) && !checkAll.checked;
  }

  $("#tasks-table").innerHTML =
    rows.length === 0
      ? renderEmpty(22, "\u6682\u65e0\u4efb\u52a1")
      : pageInfo.pageRows
          .map((plan) => {
            const price = findPlanProcessPrice(plan);
            const amount = price ? Number(plan.quantity || 0) * Number(price.price || 0) : null;
            const contract = findPlanContract(plan);
            const accounted = isPlanAccounted(plan);
            const progressStatus = taskProgressStatus(plan);
            const overdueBadge = isOverdue(plan.dueDate, progressStatus === "已完成" || progressStatus === "已交付")
              ? ` ${statusBadge("逾期")}`
              : "";
            return `<tr>
              <td><input class="task-check" data-task-id="${plan.id}" type="checkbox" ${
                selectedTaskIds.has(plan.id) ? "checked" : ""
              } /></td>
              <td>${escapeHtml(planTaskNo(plan))}</td>
              <td>${escapeHtml(plan.batch || "-")}</td>
              <td>${escapeHtml(planDrawingNo(plan))}</td>
              <td>${escapeHtml(planName(plan))}</td>
              <td>${escapeHtml(plan.taskCategory || "-")}</td>
              <td>${escapeHtml(plan.outsourceCategory || "-")}</td>
              <td>${escapeHtml(plan.productCategory || "-")}</td>
              <td>${escapeHtml(plan.abcCategory || "-")}</td>
              <td>${escapeHtml(plan.usage || "-")}</td>
              <td>${escapeHtml(plan.vendor)}</td>
              <td>${escapeHtml(plan.process)}</td>
              <td>${plan.quantity}</td>
              <td>${escapeHtml(plan.dueDate)}</td>
              <td>${statusBadge(progressStatus)}${overdueBadge}</td>
              <td>${price ? statusBadge("\u5df2\u6709\u4ef7\u683c") : statusBadge("\u7f3a\u5c11\u4ef7\u683c", today())}</td>
              <td>${contract ? statusBadge("已签合同") : statusBadge("未签合同")}</td>
              <td>${contract ? escapeHtml(contract.contractNo) : "-"}</td>
              <td>${accounted ? statusBadge("\u5df2\u6302\u8d26") : statusBadge("\u672a\u6302\u8d26")}</td>
              <td>${price ? money(price.price) : "-"}</td>
              <td>${amount === null ? "-" : money(amount)}</td>
              <td>
                <button class="ghost-button compact-button" data-edit-plan="${plan.id}" type="button">\u4fee\u6539</button>
                <button class="danger-button compact-button" data-delete="plans" data-id="${plan.id}" type="button">\u5220\u9664</button>
              </td>
            </tr>`;
          })
          .join("");
  renderPagination("tasks", "#tasks-table", pageInfo);
}

function renderPrices() {
  readColumnFilters("prices");
  populateFilterDatalists("prices");
  const rows = state.prices.filter(priceMatchesFilters);
  const pageInfo = paginateRows("prices", rows);
  $("#prices-table").innerHTML =
    rows.length === 0
      ? renderEmpty(13, "\u6682\u65e0\u4ef7\u683c")
      : pageInfo.pageRows
          .map((item) => {
            const relatedPlans = plansForPrice(item);
            const drawingNos = item.drawingNo || uniqueValues(relatedPlans.map(planDrawingNo)).join("\u3001") || "-";
            const names = item.name || uniqueValues(relatedPlans.map(planName)).join("\u3001") || "-";
            const plannedProcesses = pricePlannedProcesses(item);
            const subRows = plannedProcesses.length
              ? plannedProcesses.map((process, index) => `<tr>
                  <td>${index + 1}</td>
                  <td><input class="inline-edit-input" data-price-process-value="${item.id}" data-price-process-index="${index}" value="${escapeHtml(process)}" /></td>
                  <td class="inline-edit-actions"><button class="primary-button compact-button" data-save-price-process="${item.id}" data-price-process-index="${index}" type="button">\u4fdd\u5b58</button><button class="danger-button compact-button" data-delete-price-process="${item.id}" data-price-process-index="${index}" type="button">\u5220\u9664</button></td>
                </tr>`).join("")
              : `<tr><td colspan="3" class="empty">\u6682\u65e0\u8ba1\u5212\u4e2d\u7684\u5de5\u5e8f</td></tr>`;
            const addRow = `<tr><td>+</td><td colspan="2"><div class="subtable-add-row"><input class="inline-edit-input" data-new-price-process="${item.id}" placeholder="\u65b0\u589e\u8ba1\u5212\u5de5\u5e8f" /><button class="primary-button compact-button" data-add-price-process="${item.id}" type="button">\u6dfb\u52a0</button></div></td></tr>`;
            return `<tr>
              <td><button class="contract-expand-toggle" data-toggle-price="${item.id}" type="button">\u25b6</button></td>
              <td>${escapeHtml(item.vendor)}</td>
              <td>${escapeHtml(drawingNos)}</td>
              <td>${escapeHtml(names)}</td>
              <td>${escapeHtml(item.item)}</td>
              <td>${escapeHtml(item.unit)}</td>
              <td>${money(item.price)}</td>
              <td>${escapeHtml(item.effectiveDate)}</td>
              <td>${item.taxRate || 0}%</td>
              <td>${escapeHtml(item.negotiationNo || "-")}</td>
              <td>${escapeHtml(item.priceSheetNo || item.pricingNo || "-")}</td>
              <td>${escapeHtml(item.note || "-")}</td>
              <td>
                <button class="ghost-button" data-edit-price="${item.id}" type="button">\u4fee\u6539</button>
                <button class="danger-button" data-delete="prices" data-id="${item.id}" type="button">\u5220\u9664</button>
              </td>
            </tr>
            <tr class="contract-sub-row" id="price-sub-${item.id}" hidden>
              <td colspan="13">
                <table class="contract-sub-table">
                  <thead><tr><th>\u5e8f\u53f7</th><th>\u8ba1\u5212\u4e2d\u7684\u5de5\u5e8f</th><th>\u64cd\u4f5c</th></tr></thead>
                  <tbody>${subRows}${addRow}</tbody>
                </table>
              </td>
            </tr>`;
          })
          .join("");
  renderPagination("prices", "#prices-table", pageInfo);
}

function exportPricesExcel() {
  if (!window.XLSX) {
    alert("Excel 导出组件未加载，请刷新页面后重试。");
    return;
  }
  const rows = state.prices.filter(priceMatchesFilters);
  if (rows.length === 0) {
    alert("没有可导出的价格数据。");
    return;
  }
  const header = ["外协方", "图号", "名称", "工序/物料", "计划中的工序", "单位", "单价", "生效日期", "税率", "谈判纪要编号", "价格单号", "备注"];
  const data = rows.map((item) => {
    const relatedPlans = plansForPrice(item);
    const drawingNos = item.drawingNo || uniqueValues(relatedPlans.map(planDrawingNo)).join("、") || "";
    const names = item.name || uniqueValues(relatedPlans.map(planName)).join("、") || "";
    return [
      item.vendor || "",
      drawingNos,
      names,
      item.item || "",
      pricePlannedProcess(item) || "",
      item.unit || "",
      Number(item.price || 0),
      item.effectiveDate || "",
      (item.taxRate || 0) + "%",
      item.negotiationNo || "",
      item.priceSheetNo || item.pricingNo || "",
      item.note || "",
    ];
  });
  const sheet = XLSX.utils.aoa_to_sheet([header, ...data]);
  sheet["!cols"] = header.map(() => ({ wch: 20 }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "价格库");
  XLSX.writeFile(workbook, `价格库_${today().replaceAll("-", "")}.xlsx`);
}

function exportContractExcel(contractId) {
  if (!window.XLSX) {
    alert("\u0045\u0078\u0063\u0065\u006c \u5bfc\u51fa\u7ec4\u4ef6\u672a\u52a0\u8f7d\uff0c\u8bf7\u5237\u65b0\u9875\u9762\u540e\u91cd\u8bd5\u3002");
    return;
  }
  const contract = state.contracts.find((c) => c.id === contractId);
  if (!contract) {
    alert("\u672a\u627e\u5230\u8be5\u5408\u540c\u3002");
    return;
  }
  const items = Array.isArray(contract.contractItems) && contract.contractItems.length > 0 ? contract.contractItems : parseContractItems(contract.project);
  if (items.length === 0) {
    alert("\u6ca1\u6709\u53ef\u5bfc\u51fa\u7684\u5408\u540c\u6807\u7684\u660e\u7ec6\u3002");
    return;
  }
  const header = [
    "\u5408\u540c\u7f16\u53f7",
    "\u5916\u534f\u65b9",
    "\u7b7e\u8ba2\u65e5\u671f",
    "\u5408\u540c\u72b6\u6001",
    "\u5e8f\u53f7",
    "\u4efb\u52a1\u7f16\u53f7",
    "\u56fe\u53f7",
    "\u540d\u79f0",
    "\u5de5\u5e8f/\u89c4\u683c",
    "\u6570\u91cf/\u5355\u4f4d",
    "\u5355\u4ef7",
    "\u91d1\u989d",
    "\u5355\u4ef7\u6765\u6e90",
    "\u5907\u6ce8",
  ];
  const rows = items.map((sub, index) => {
    const parsedParts = parseContractItemParts(sub.label);
    const parts = {
      ...parsedParts,
      unitPrice: sub.unitPrice == null ? parsedParts.unitPrice : String(sub.unitPrice),
      amount: sub.amount == null ? parsedParts.amount : String(sub.amount),
    };
    const priceInfo = contractItemPriceInfo(parts, contract.vendor, { preferPriceLibrary: true });
    return [
      contract.contractNo || "",
      contract.vendor || "",
      contract.signDate || "",
      contractAutoStatus(contract),
      index + 1,
      parts.seq || sub.taskNo || "",
      parts.drawingNo || "",
      parts.name || "",
      parts.process || "",
      parts.quantityUnit || "",
      priceInfo.unitPrice ? Number(priceInfo.unitPrice) : "",
      priceInfo.amount ? Number(priceInfo.amount) : "",
      priceInfo.price ? "\u4ef7\u683c\u5e93" : "\u5408\u540c\u660e\u7ec6",
      parts.note || contract.note || "",
    ];
  });
  const sheet = XLSX.utils.aoa_to_sheet([header, ...rows]);
  sheet["!cols"] = [
    { wch: 18 }, { wch: 16 }, { wch: 14 }, { wch: 12 }, { wch: 8 },
    { wch: 16 }, { wch: 18 }, { wch: 20 }, { wch: 18 }, { wch: 14 },
    { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 24 },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "\u5408\u540c\u6807\u7684\u7269");
  const contractNo = String(contract.contractNo || contract.id).replace(/[\\/:*?"<>|]/g, "_");
  XLSX.writeFile(workbook, `${contractNo}.xlsx`);
}

function exportContractsExcel() {
  if (!window.XLSX) {
    alert("Excel 导出组件未加载，请刷新页面后重试。");
    return;
  }
  const keyword = $("#contract-search").value.trim().toLowerCase();
  const contracts = state.contracts.filter((item) =>
    [item.contractNo, item.vendor, contractItemsSummary(item)].some((value) => String(value || "").toLowerCase().includes(keyword)) && contractMatchesFilters(item),
  );
  if (contracts.length === 0) {
    alert("没有可导出的合同数据。");
    return;
  }
  const header = ["合同编号", "外协方", "签订日期", "合同状态", "序号", "任务编号", "图号", "名称", "工序/规格", "数量/单位", "单价", "金额", "单价来源", "备注"];
  const rows = [];
  contracts.forEach((contract) => {
    const items = Array.isArray(contract.contractItems) && contract.contractItems.length > 0 ? contract.contractItems : parseContractItems(contract.project);
    if (items.length === 0) return;
    items.forEach((sub, index) => {
      const parsedParts = parseContractItemParts(sub.label);
      const parts = {
        ...parsedParts,
        unitPrice: sub.unitPrice == null ? parsedParts.unitPrice : String(sub.unitPrice),
        amount: sub.amount == null ? parsedParts.amount : String(sub.amount),
      };
      const priceInfo = contractItemPriceInfo(parts, contract.vendor, { preferPriceLibrary: true });
      rows.push([
        contract.contractNo || "", contract.vendor || "", contract.signDate || "", contractAutoStatus(contract),
        index + 1, parts.seq || sub.taskNo || "", parts.drawingNo || "", parts.name || "",
        parts.process || "", parts.quantityUnit || "",
        priceInfo.unitPrice ? Number(priceInfo.unitPrice) : "",
        priceInfo.amount ? Number(priceInfo.amount) : "",
        priceInfo.price ? "价格库" : "合同明细", parts.note || contract.note || "",
      ]);
    });
  });
  const sheet = XLSX.utils.aoa_to_sheet([header, ...rows]);
  sheet["!cols"] = [
    { wch: 18 }, { wch: 16 }, { wch: 14 }, { wch: 12 }, { wch: 8 },
    { wch: 16 }, { wch: 18 }, { wch: 20 }, { wch: 18 }, { wch: 14 },
    { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 24 },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "合同标的物");
  XLSX.writeFile(workbook, `合同标的物_${today().replaceAll("-", "")}.xlsx`);
}

function exportTasksExcel() {
  if (!window.XLSX) {
    alert("Excel 导出组件未加载，请刷新页面后重试。");
    return;
  }
  const rows = filteredTaskRows();
  if (rows.length === 0) {
    alert("没有可导出的外协计划数据。");
    return;
  }
  const header = ["任务编号", "批次", "图号", "名称", "任务类别", "外协类别", "外协产品类别", "ABC类别", "领用用途", "外协方", "工序", "数量", "要求完成时间", "任务进度", "单价", "预估金额", "合同编号", "备注"];
  const data = rows.map((plan) => {
    const price = findPlanProcessPrice(plan);
    const amount = price ? Number(plan.quantity || 0) * Number(price.price || 0) : "";
    const contract = findPlanContract(plan);
    return [
      planTaskNo(plan), plan.batch || "", planDrawingNo(plan), planName(plan),
      plan.taskCategory || "", plan.outsourceCategory || "", plan.productCategory || "", plan.abcCategory || "", plan.usage || "",
      plan.vendor || "", plan.process || "",
      plan.quantity, plan.dueDate || "", taskProgressStatus(plan),
      price ? price.price : "", amount,
      contract ? contract.contractNo : "", plan.note || "",
    ];
  });
  const sheet = XLSX.utils.aoa_to_sheet([header, ...data]);
  sheet["!cols"] = [
    { wch: 14 }, { wch: 12 }, { wch: 18 }, { wch: 20 }, { wch: 16 },
    { wch: 16 }, { wch: 10 }, { wch: 14 }, { wch: 12 }, { wch: 14 },
    { wch: 14 }, { wch: 18 }, { wch: 24 },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "外协计划汇总");
  XLSX.writeFile(workbook, `外协计划汇总_${today().replaceAll("-", "")}.xlsx`);
}

function renderProgressSelect() {
  const select = $("#progress-plan-select");
  select.innerHTML =
    state.plans.length === 0
      ? `<option value="">请先新增外协计划</option>`
      : state.plans
          .map((plan) => `<option value="${plan.id}">${escapeHtml(planTaskNo(plan))} / ${escapeHtml(planLabel(plan))} / ${escapeHtml(plan.vendor)}</option>`)
          .join("");
}


function progressMatchesFilters(item) {
  const plan = planById(item.planId) || { drawingNo: "", name: "", project: "", vendor: "" };
  if (!columnFilterMatch("progress", "\u56fe\u53f7", planDrawingNo(plan))) return false;
  if (!columnFilterMatch("progress", "\u540d\u79f0", planName(plan))) return false;
  if (!columnFilterMatch("progress", "\u5916\u534f\u65b9", plan.vendor)) return false;
  if (!columnFilterMatch("progress", "\u72b6\u6001", item.status)) return false;
  if (!columnFilterMatch("progress", "\u5b8c\u6210\u7387", item.percent + "%")) return false;
  if (!columnFilterMatch("progress", "\u66f4\u65b0\u65f6\u95f4", item.updatedAt)) return false;
  if (!columnFilterMatch("progress", "\u8bf4\u660e", item.remark)) return false;
  return true;
}

function contractMatchesFilters(item) {
  if (!columnFilterMatch("contracts", "\u5408\u540c\u7f16\u53f7", item.contractNo)) return false;
  if (!columnFilterMatch("contracts", "\u5916\u534f\u65b9", item.vendor)) return false;
  if (!columnFilterMatch("contracts", "\u56fe\u53f7/\u540d\u79f0", contractItemsSummary(item))) return false;
  if (!columnFilterMatch("contracts", "\u91d1\u989d", money(item.amount))) return false;
  if (!columnFilterMatch("contracts", "\u7b7e\u8ba2\u65e5\u671f", item.signDate)) return false;
  if (!columnFilterMatch("contracts", "\u72b6\u6001", contractAutoStatus(item))) return false;
  return true;
}

function negotiationMatchesFilters(item) {
  if (!columnFilterMatch("negotiations", "\u7f16\u53f7", item.negotiationNo)) return false;
  if (!columnFilterMatch("negotiations", "\u65e5\u671f", item.meetingDate)) return false;
  if (!columnFilterMatch("negotiations", "\u5916\u534f\u65b9", item.vendor)) return false;
  if (!columnFilterMatch("negotiations", "\u8ddf\u8fdb\u65e5\u671f", item.followUpDate)) return false;
  return true;
}

function pricingProcessMatchesFilters(item) {
  if (!columnFilterMatch("pricingProcesses", "\u4ef7\u683c\u5355\u53f7", item.pricingNo)) return false;
  if (!columnFilterMatch("pricingProcesses", "\u65e5\u671f", item.pricingDate)) return false;
  if (!columnFilterMatch("pricingProcesses", "\u5916\u534f\u65b9", item.vendor)) return false;
  if (!columnFilterMatch("pricingProcesses", "\u8ddf\u8fdb\u65e5\u671f", item.followUpDate)) return false;
  if (!columnFilterMatch("pricingProcesses", "\u4ef7\u683c\u5e93\u72b6\u6001", item.priceImportStatus || "\u672a\u5bfc\u5165")) return false;
  return true;
}

function accountMatchesFilters(item) {
  if (!columnFilterMatch("accounts", "\u5916\u534f\u65b9", item.vendor)) return false;
  if (!columnFilterMatch("accounts", "\u91d1\u989d", money(item.amount))) return false;
  if (!columnFilterMatch("accounts", "\u6302\u8d26\u65e5\u671f", item.accountDate)) return false;
  if (!columnFilterMatch("accounts", "\u5230\u671f\u65e5", item.dueDate)) return false;
  if (!columnFilterMatch("accounts", "\u7f51\u62a5\u5355\u7f16\u53f7", item.reportNo)) return false;
  if (!columnFilterMatch("accounts", "\u72b6\u6001", item.payStatus)) return false;
  return true;
}

function renderProgress() {
  renderProgressSelect();
  readColumnFilters("progress");
  populateFilterDatalists("progress");
  const rows = state.progress.filter(progressMatchesFilters);
  $("#progress-table").innerHTML =
    rows.length === 0
      ? renderEmpty(8, "暂无进度")
      : [...rows]
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .map((item) => {
            const plan = planById(item.planId) || { drawingNo: "", name: "计划已删除", project: "计划已删除", vendor: "-" };
            return `<tr>
              <td>${escapeHtml(planDrawingNo(plan))}</td>
              <td>${escapeHtml(planName(plan))}</td>
              <td>${escapeHtml(plan.vendor)}</td>
              <td>${statusBadge(item.status)}</td>
              <td>${item.percent}%</td>
              <td>${escapeHtml(item.updatedAt)}</td>
              <td>${escapeHtml(item.remark || "-")}</td>
              <td><button class="ghost-button compact-button" data-edit-progress="${item.id}" type="button">\u4fee\u6539</button><button class="danger-button" data-delete="progress" data-id="${item.id}" type="button">删除</button></td>
            </tr>`;
          })
          .join("");
}

function renderContracts() {
  readColumnFilters("contracts");
  populateFilterDatalists("contracts");
  const keyword = $("#contract-search").value.trim().toLowerCase();
  const rows = state.contracts.filter((item) =>
    [item.contractNo, item.vendor, contractItemsSummary(item)].some((value) => String(value || "").toLowerCase().includes(keyword)) && contractMatchesFilters(item),
  );
  $("#contracts-table").innerHTML =
    rows.length === 0
      ? renderEmpty(8, "暂无合同")
      : rows
          .map((item) => {
            const items = Array.isArray(item.contractItems) && item.contractItems.length > 0 ? item.contractItems : [];
            const hasItems = items.length > 0;
            const contractSel = selectedContractItems[item.id];
            const selSize = contractSel ? contractSel.size : 0;
            const accountedLabels = contractedAccountedLabels(item.id);
            const subRows = hasItems
              ? items
                  .map((sub, idx) => {
                    const parsedParts = parseContractItemParts(sub.label);
                    const parts = {
                      ...parsedParts,
                      unitPrice: sub.unitPrice == null ? parsedParts.unitPrice : String(sub.unitPrice),
                      amount: sub.amount == null ? parsedParts.amount : String(sub.amount),
                    };
                    const priceInfo = contractItemPriceInfo(parts, item.vendor);
                    const checked = contractSel && contractSel.has(idx) ? "checked" : "";
                    const itemKey = (sub.drawingNo || parts.drawingNo || "") + "||" + (sub.name || parts.name || "");
                    const accounted = accountedLabels.has(itemKey);
                    return `<tr>
                      <td><input class="contract-item-check" data-contract-id="${item.id}" data-item-index="${idx}" type="checkbox" ${checked} /></td>
                      <td>${idx + 1}</td>
                      <td>${escapeHtml(parts.drawingNo)}</td>
                      <td>${escapeHtml(parts.name)}</td>
                      <td>${escapeHtml(parts.process)}</td>
                      <td>${escapeHtml(parts.quantityUnit)}</td>
                      <td>${priceInfo.unitPrice != null && priceInfo.unitPrice !== "" ? money(priceInfo.unitPrice) : "-"}</td>
                      <td>${priceInfo.amount != null && priceInfo.amount !== "" ? money(priceInfo.amount) : "-"}</td>
                      <td>${escapeHtml(parts.note || "-")}</td>
                      <td>${accounted ? statusBadge("\u5df2\u6302\u8d26") : statusBadge("\u672a\u6302\u8d26")}</td>
                    </tr>`;
                  })
                  .join("")
              : `<tr><td colspan="10" class="empty">暂无标的物明细</td></tr>`;

            const accountedCount = accountedLabels.size;
            const totalCount = items.length;
            const accountStatus = totalCount > 0 && accountedCount === totalCount ? "已全部挂账"
              : accountedCount > 0 ? "部分挂账"
              : "";
            return `<tr class="contract-main-row" data-contract-id="${item.id}">
              <td>${
                hasItems
                  ? `<button class="contract-expand-toggle" data-toggle-contract="${item.id}" type="button">▶</button>`
                  : ""
              }</td>
              <td>${escapeHtml(item.contractNo)}</td>
              <td>${escapeHtml(item.vendor)}</td>
              <td>${escapeHtml(contractItemsSummary(item))}</td>
              <td>${money(item.amount)}</td>
              <td>${escapeHtml(item.signDate)}</td>
              <td>${statusBadge(contractAutoStatus(item))}${accountStatus ? " " + statusBadge(accountStatus) : ""}</td>
              <td>
                <button class="ghost-button" data-edit-contract="${item.id}" type="button">修改</button>
                <button class="ghost-button compact-button" onclick="exportContractExcel('${item.id}')" type="button">导出</button>
                <button class="danger-button" data-delete="contracts" data-id="${item.id}" type="button">删除</button>
              </td>
            </tr>
            <tr class="contract-sub-row" id="contract-sub-${item.id}" hidden>
              <td colspan="8">
                <table class="contract-sub-table">
                  <thead>
                    <tr>
                      <th><input class="contract-item-check-all" data-contract-id="${item.id}" type="checkbox" ${selSize > 0 && selSize === items.length ? "checked" : ""} /></th>
                      <th>序号</th>
                      <th>图号</th>
                      <th>名称</th>
                      <th>工序/规格</th>
                      <th>数量/单位</th>
                      <th>单价</th>
                      <th>金额</th>
                      <th>备注</th>
                      <th>挂账状态</th>
                    </tr>
                  </thead>
                  <tbody>${subRows}</tbody>
                  <tfoot>
                    <tr><td colspan="10"><button class="primary-button compact-button" data-account-from-contract="${item.id}" type="button" onclick="createAccountFromContract('${item.id}')">一键挂账</button></td></tr>
                  </tfoot>
                </table>
              </td>
            </tr>`;
          })
          .join("");
}

function renderNegotiations() {
  readColumnFilters("negotiations");
  populateFilterDatalists("negotiations");
  const keyword = $("#negotiation-search").value.trim().toLowerCase();
  const rows = state.negotiations.filter((item) =>
    [item.negotiationNo, item.vendor, negotiationItemsSummary(item)].some((value) =>
      String(value || "").toLowerCase().includes(keyword),
    ) && negotiationMatchesFilters(item),
  );
  $("#negotiations-table").innerHTML =
    rows.length === 0
      ? renderEmpty(6, "暂无谈判纪要")
      : [...rows]
          .sort((a, b) => String(b.meetingDate || "").localeCompare(String(a.meetingDate || "")))
          .map((item) => {
            const items =
              Array.isArray(item.negotiationItems) && item.negotiationItems.length > 0
                ? item.negotiationItems
                : parseContractItems(item.project);
            const hasItems = items.length > 0;
            const subRows = hasItems
              ? items
                  .map((sub, idx) => {
                    const parts = parseContractItemParts(sub.label);
                    return `<tr>
                      <td>${idx + 1}</td>
                      <td>${escapeHtml(parts.drawingNo)}</td>
                      <td>${escapeHtml(parts.name)}</td>
                      <td>${escapeHtml(parts.process || "-")}</td>
                      <td>${escapeHtml(parts.quantityUnit || "-")}</td>
                      <td>${parts.unitPrice ? escapeHtml(parts.unitPrice) : "-"}</td>
                      <td>${parts.amount ? escapeHtml(parts.amount) : "-"}</td>
                    </tr>`;
                  })
                  .join("")
              : `<tr><td colspan="7" class="empty">暂无图号名称明细</td></tr>`;

            return `<tr class="negotiation-main-row" data-negotiation-id="${item.id}">
              <td>${
                hasItems
                  ? `<button class="contract-expand-toggle" data-toggle-negotiation="${item.id}" type="button">▶</button>`
                  : ""
              }</td>
              <td>${escapeHtml(item.negotiationNo || "-")}</td>
              <td>${escapeHtml(item.meetingDate)}</td>
              <td>${escapeHtml(item.vendor)}</td>
              <td>${escapeHtml(item.followUpDate || "-")}</td>
              <td>
                <button class="ghost-button" data-edit-negotiation="${item.id}" type="button">修改</button>
                <button class="danger-button" data-delete="negotiations" data-id="${item.id}" type="button">删除</button>
              </td>
            </tr>
            <tr class="contract-sub-row" id="negotiation-sub-${item.id}" hidden>
              <td colspan="6">
                <table class="contract-sub-table">
                  <thead>
                    <tr>
                      <th>序号</th>
                      <th>图号</th>
                      <th>名称</th>
                    </tr>
                  </thead>
                  <tbody>${subRows}</tbody>
                </table>
              </td>
            </tr>`;
          })
          .join("");
}

function renderPricingProcesses() {
  readColumnFilters("pricingProcesses");
  populateFilterDatalists("pricingProcesses");
  const keyword = $("#pricing-process-search").value.trim().toLowerCase();
  const rows = state.pricingProcesses.filter((item) =>
    [item.pricingNo, item.vendor, pricingProcessItemsSummary(item)].some((value) =>
      String(value || "").toLowerCase().includes(keyword),
    ) && pricingProcessMatchesFilters(item),
  );
  $("#pricing-processes-table").innerHTML =
    rows.length === 0
      ? renderEmpty(7, "暂无定价流程")
      : [...rows]
          .sort((a, b) => String(b.pricingDate || "").localeCompare(String(a.pricingDate || "")))
          .map((item) => {
            const items =
              Array.isArray(item.pricingItems) && item.pricingItems.length > 0 ? item.pricingItems : parseContractItems(item.project);
            const hasItems = items.length > 0;
            const subRows = hasItems
              ? items
                  .map((sub, idx) => {
                    const parts = parseContractItemParts(sub.label);
                    return `<tr>
                      <td>${idx + 1}</td>
                      <td>${escapeHtml(parts.drawingNo)}</td>
                      <td>${escapeHtml(parts.name)}</td>
                      <td>${escapeHtml(parts.process || "-")}</td>
                      <td>${escapeHtml(parts.quantityUnit || "-")}</td>
                      <td>${escapeHtml(parts.unitPrice || "-")}</td>
                      <td>${escapeHtml(parts.amount || "-")}</td>
                    </tr>`;
                  })
                  .join("")
              : `<tr><td colspan="7" class="empty">暂无定价明细</td></tr>`;

            return `<tr class="pricing-process-main-row" data-pricing-process-id="${item.id}">
              <td>${
                hasItems
                  ? `<button class="contract-expand-toggle" data-toggle-pricing-process="${item.id}" type="button">▶</button>`
                  : ""
              }</td>
              <td>${escapeHtml(item.pricingNo || "-")}</td>
              <td>${escapeHtml(item.pricingDate)}</td>
              <td>${escapeHtml(item.vendor)}</td>
              <td>${escapeHtml(item.followUpDate || "-")}</td>
              <td>${statusBadge(item.priceImportStatus || "未导入")}</td>
              <td>
                <button class="ghost-button" data-import-pricing-process="${item.id}" type="button">${
                  item.priceImportStatus === "已导入价格库" ? "重新导入价格库" : "导入价格库"
                }</button>
                <button class="ghost-button" data-edit-pricing-process="${item.id}" type="button">修改</button>
                <button class="danger-button" data-delete="pricingProcesses" data-id="${item.id}" type="button">删除</button>
              </td>
            </tr>
            <tr class="contract-sub-row" id="pricing-process-sub-${item.id}" hidden>
              <td colspan="7">
                <table class="contract-sub-table">
                  <thead>
                    <tr>
                      <th>序号</th>
                      <th>图号</th>
                      <th>名称</th>
                      <th>工序</th>
                      <th>数量/单位</th>
                      <th>单价</th>
                      <th>金额</th>
                    </tr>
                  </thead>
                  <tbody>${subRows}</tbody>
                </table>
              </td>
            </tr>`;
          })
          .join("");
}

function renderAccounts() {
  readColumnFilters("accounts");
  populateFilterDatalists("accounts");
  const keyword = $("#account-search").value.trim().toLowerCase();
  const rows = state.accounts.filter((item) =>
    [item.vendor, accountItemsSummary(item), item.voucher, item.reportNo].some((value) => String(value || "").toLowerCase().includes(keyword)) && accountMatchesFilters(item),
  );
  $("#accounts-table").innerHTML =
    rows.length === 0
      ? renderEmpty(8, "暂无挂账")
      : rows
          .map((item) => {
            const items =
              Array.isArray(item.accountItems) && item.accountItems.length > 0 ? item.accountItems : parseContractItems(item.project);
            const hasItems = items.length > 0;
            const subRows = hasItems
              ? items
                  .map((sub, idx) => {
                    const parts = parseContractItemParts(sub.label);
                    return `<tr>
                      <td>${idx + 1}</td>
                      <td>${escapeHtml(parts.drawingNo)}</td>
                      <td>${escapeHtml(parts.name)}</td>
                    </tr>`;
                  })
                  .join("")
              : `<tr><td colspan="3" class="empty">暂无图号名称明细</td></tr>`;

            return `<tr class="account-main-row" data-account-id="${item.id}">
              <td>${
                hasItems ? `<button class="contract-expand-toggle" data-toggle-account="${item.id}" type="button">▶</button>` : ""
              }</td>
              <td>${escapeHtml(item.vendor)}</td>
              <td>${money(item.amount)}</td>
              <td>${escapeHtml(item.accountDate)}</td>
              <td>${escapeHtml(item.dueDate)}</td>
              <td>${escapeHtml(item.reportNo || "-")}</td>
              <td>${statusBadge(item.payStatus, item.dueDate)}</td>
              <td>
                <button class="ghost-button" data-edit-account="${item.id}" type="button">修改</button>
                <button class="danger-button" data-delete="accounts" data-id="${item.id}" type="button">删除</button>
              </td>
            </tr>
            <tr class="contract-sub-row" id="account-sub-${item.id}" hidden>
              <td colspan="8">
                <table class="contract-sub-table">
                  <thead>
                    <tr>
                      <th>序号</th>
                      <th>图号</th>
                      <th>名称</th>
                    </tr>
                  </thead>
                  <tbody>${subRows}</tbody>
                </table>
              </td>
            </tr>`;
          })
          .join("");
}

function renderVendors() {
  const keyword = $("#vendor-search").value.trim().toLowerCase();
  const rows = state.vendors.filter((v) =>
    !keyword || [v.name, v.contact, v.phone].some((val) => String(val || "").toLowerCase().includes(keyword)),
  );
  const fileLink = (file, fileName) => {
    if (!file) return statusBadge("\u672a\u4e0a\u4f20");
    const url = file.url || file.path || "#";
    return '<a class="attachment-link" href="' + escapeHtml(url) + '" target="_blank">' + escapeHtml(fileName || "PDF") + '</a>';
  };
  $("#vendors-table").innerHTML =
    rows.length === 0
      ? renderEmpty(8, "暂无供应商")
      : rows
          .map((v) => `<tr>
            <td>${escapeHtml(v.name)}</td>
            <td>${escapeHtml(v.contact || "-")}</td>
            <td>${escapeHtml(v.phone || "-")}</td>
            <td>${fileLink(v.integrityFile, v.integrityFileName)}</td>
            <td>${fileLink(v.safetyFile, v.safetyFileName)}</td>
            <td>${escapeHtml(v.address || "-")}</td>
            <td>${escapeHtml(v.note || "-")}</td>
            <td>
              <button class="ghost-button compact-button" data-edit-vendor="${v.id}" type="button">修改</button>
              <button class="danger-button compact-button" data-delete="vendors" data-id="${v.id}" type="button">删除</button>
            </td>
          </tr>`)
          .join("");
}

const paginationState = {};
const defaultPageSize = 50;
const pageSizeOptions = [20, 50, 100, 200, 500, 99999];

function resetPage(key) {
  if (!paginationState[key]) paginationState[key] = { page: 1, pageSize: defaultPageSize };
  else paginationState[key].page = 1;
}

function paginationFor(key) {
  if (!paginationState[key]) paginationState[key] = { page: 1, pageSize: defaultPageSize };
  return paginationState[key];
}

function paginateRows(key, rows) {
  const pagination = paginationFor(key);
  const pageSize = Number(pagination.pageSize || defaultPageSize);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  pagination.page = Math.min(Math.max(1, Number(pagination.page || 1)), totalPages);
  const start = (pagination.page - 1) * pageSize;
  return {
    pageRows: rows.slice(start, start + pageSize),
    page: pagination.page,
    pageSize,
    totalPages,
    totalRows: rows.length,
    start,
  };
}

function renderPagination(key, tableSelector, pageInfo) {
  const tableBody = $(tableSelector);
  if (!tableBody) return;
  const wrapper = tableBody.closest(".table-wrap");
  if (!wrapper) return;
  const existing = wrapper.nextElementSibling;
  if (existing && existing.dataset.paginationFor === key) existing.remove();
  const from = pageInfo.totalRows === 0 ? 0 : pageInfo.start + 1;
  const to = Math.min(pageInfo.start + pageInfo.pageSize, pageInfo.totalRows);
  const bar = document.createElement("div");
  bar.className = "pagination-bar";
  bar.dataset.paginationFor = key;
  bar.innerHTML =
    '<div class="pagination-info">&#20849; ' + pageInfo.totalRows + ' &#26465;&#65292;&#26174;&#31034; ' + from + '-' + to + ' &#26465;&#65292;&#31532; ' + pageInfo.page + ' / ' + pageInfo.totalPages + ' &#39029;</div>' +
    '<div class="pagination-controls">' +
      '<button class="ghost-button" data-page-action="prev" data-page-key="' + key + '" type="button" ' + (pageInfo.page <= 1 ? 'disabled' : '') + '>&#19978;&#19968;&#39029;</button>' +
      '<button class="ghost-button" data-page-action="next" data-page-key="' + key + '" type="button" ' + (pageInfo.page >= pageInfo.totalPages ? 'disabled' : '') + '>&#19979;&#19968;&#39029;</button>' +
      '<label>&#27599;&#39029; <select data-page-size="' + key + '">' +
        pageSizeOptions.map((size) => '<option value="' + size + '" ' + (size === pageInfo.pageSize ? 'selected' : '') + '>' + (size === 99999 ? "\u5168\u90e8" : size) + '</option>').join('') +
      '</select></label>' +
    '</div>';
  wrapper.insertAdjacentElement("afterend", bar);
  const table = wrapper.querySelector("table");
  if (table) applyColumnPreferences(table);
}

function loadColumnPreferences() {
  try {
    const prefs = JSON.parse(localStorage.getItem(columnPreferencesKey) || "{}");
    return prefs;
  } catch { return {}; }
}

function validateColumnPreferences() {
  try {
    const prefs = JSON.parse(localStorage.getItem(columnPreferencesKey) || "{}");
    let changed = false;
    document.querySelectorAll("table").forEach((table) => {
      const key = tablePreferenceKey(table);
      const defaults = defaultTableColumns(table);
      if (!defaults.length) return;
      const saved = prefs[key];
      if (saved && Array.isArray(saved.order) && saved.order.length !== defaults.length) {
        delete prefs[key];
        changed = true;
      }
    });
    if (changed) localStorage.setItem(columnPreferencesKey, JSON.stringify(prefs));
  } catch {}
}

function saveColumnPreferences(prefs) {
  try { localStorage.setItem(columnPreferencesKey, JSON.stringify(prefs)); } catch {}
}


function tablePreferenceKey(table) {
  if (table.dataset.columnTableKey) return table.dataset.columnTableKey;
  const tbody = table.tBodies && table.tBodies[0];
  const key = tbody && tbody.id ? tbody.id : "column-table-" + (document.querySelectorAll("table[data-column-table-key]").length + 1);
  table.dataset.columnTableKey = key;
  return key;
}

function tableByPreferenceKey(key) {
  return Array.from(document.querySelectorAll("table")).find((table) => tablePreferenceKey(table) === key) || null;
}

function headerRow(table) {
  return table.tHead && table.tHead.rows.length ? table.tHead.rows[0] : null;
}

function getAllTableRows(table) {
  const rows = [];
  if (table.tHead) rows.push(...Array.from(table.tHead.rows));
  if (table.tBodies) Array.from(table.tBodies).forEach((body) => rows.push(...Array.from(body.rows)));
  return rows;
}

function normalizeColumnLabel(text, index) {
  return String(text || "").trim() || "\u5217 " + (index + 1);
}

function ensureTableColumnKeys(table) {
  const head = headerRow(table);
  if (!head) return [];
  const keyPrefix = tablePreferenceKey(table);
  const headers = Array.from(head.cells);
  const keys = headers.map((cell, index) => {
    if (!cell.dataset.columnKey) cell.dataset.columnKey = keyPrefix + "-" + index;
    cell.dataset.columnLabel = normalizeColumnLabel(cell.textContent, index);
    return cell.dataset.columnKey;
  });

  if (!table.dataset.defaultColumns || table.dataset.defaultColumnCount !== String(keys.length)) {
    table.dataset.defaultColumnCount = String(keys.length);
    table.dataset.defaultColumns = JSON.stringify(
      headers.map((cell, index) => ({
        key: keys[index],
        label: cell.dataset.columnLabel,
      })),
    );
  }

  let defaultKeys = keys;
  try {
    const defaults = JSON.parse(table.dataset.defaultColumns || "[]");
    if (Array.isArray(defaults) && defaults.length === keys.length) defaultKeys = defaults.map((item) => item.key);
  } catch {}

  getAllTableRows(table).forEach((row) => {
    if (row.cells.length !== keys.length) return;
    Array.from(row.cells).forEach((cell, index) => {
      if (!cell.dataset.columnKey) cell.dataset.columnKey = defaultKeys[index] || keys[index];
    });
  });

  const cols = table.querySelectorAll("colgroup col");
  if (cols.length === keys.length) cols.forEach((col, index) => {
    if (!col.dataset.columnKey) col.dataset.columnKey = defaultKeys[index] || keys[index];
  });
  return keys;
}

function defaultTableColumns(table) {
  ensureTableColumnKeys(table);
  try {
    const parsed = JSON.parse(table.dataset.defaultColumns || "[]");
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch {}
  const row = headerRow(table);
  return Array.from(row ? row.cells : []).map((cell, index) => ({
    key: cell.dataset.columnKey,
    label: normalizeColumnLabel(cell.dataset.columnLabel || cell.textContent, index),
  }));
}

function tableColumns(table) {
  const defaults = defaultTableColumns(table);
  const prefs = loadColumnPreferences();
  const key = tablePreferenceKey(table);
  let saved = prefs[key] || {};
  if (Array.isArray(saved.order) && saved.order.length && saved.order.length !== defaults.length) {
    delete prefs[key];
    saveColumnPreferences(prefs);
    saved = {};
  }
  const byKey = new Map(defaults.map((item) => [item.key, item]));
  const order = Array.isArray(saved.order) ? saved.order.filter((item) => byKey.has(item)) : [];
  defaults.forEach((item) => { if (!order.includes(item.key)) order.push(item.key); });
  const visible = saved.visible && typeof saved.visible === "object" ? saved.visible : {};
  return order.map((itemKey) => ({ ...byKey.get(itemKey), visible: visible[itemKey] !== false }));
}

function reorderRowCells(row, order) {
  if (row.cells.length !== order.length) return;
  const cells = Array.from(row.cells);
  const byKey = new Map(cells.map((cell) => [cell.dataset.columnKey, cell]));
  order.forEach((key) => {
    const cell = byKey.get(key);
    if (cell) row.appendChild(cell);
  });
}

function setColumnHidden(element, hidden) {
  if (!element) return;
  element.hidden = hidden;
  element.style.display = hidden ? "none" : "";
}

function applyColumnPreferences(table) {
  const columns = tableColumns(table);
  if (!columns.length) return;
  const order = columns.map((item) => item.key);
  const orderKey = order.join(",");
  if (table.dataset.appliedColumnOrder === orderKey) return;
  table.dataset.appliedColumnOrder = orderKey;
  const visibleCount = Math.max(1, columns.filter((item) => item.visible).length);

  getAllTableRows(table).forEach((row) => {
    if (row.cells.length === order.length) {
      reorderRowCells(row, order);
      Array.from(row.cells).forEach((cell) => {
        const column = columns.find((item) => item.key === cell.dataset.columnKey);
        setColumnHidden(cell, column ? !column.visible : false);
      });
    } else if (row.cells.length === 1 && row.cells[0].hasAttribute("colspan")) {
      row.cells[0].colSpan = visibleCount;
    }
  });

  const cols = Array.from(table.querySelectorAll("colgroup col"));
  if (cols.length === order.length) {
    const byKey = new Map(cols.map((col) => [col.dataset.columnKey, col]));
    const group = cols[0].parentElement;
    order.forEach((key) => {
      const col = byKey.get(key);
      if (col) group.appendChild(col);
    });
    Array.from(group.children).forEach((col) => {
      const column = columns.find((item) => item.key === col.dataset.columnKey);
      setColumnHidden(col, column ? !column.visible : false);
    });
  }
}

function resetColumnPreferences(table) {
  const key = tablePreferenceKey(table);
  const prefs = loadColumnPreferences();
  delete prefs[key];
  saveColumnPreferences(prefs);
  const defaults = defaultTableColumns(table).map((item) => ({ ...item, visible: true }));
  const order = defaults.map((item) => item.key);
  getAllTableRows(table).forEach((row) => {
    if (row.cells.length === order.length) {
      reorderRowCells(row, order);
      Array.from(row.cells).forEach((cell) => setColumnHidden(cell, false));
    } else if (row.cells.length === 1 && row.cells[0].hasAttribute("colspan")) {
      row.cells[0].colSpan = defaults.length;
    }
  });
  const cols = Array.from(table.querySelectorAll("colgroup col"));
  if (cols.length === order.length) {
    const byKey = new Map(cols.map((col) => [col.dataset.columnKey, col]));
    const group = cols[0].parentElement;
    order.forEach((itemKey) => {
      const col = byKey.get(itemKey);
      if (col) group.appendChild(col);
    });
    Array.from(group.children).forEach((col) => setColumnHidden(col, false));
  }
}

function applyColumnPreferencesInView(view = activeView()) {
  const root = document.getElementById(view) || document;
  root.querySelectorAll(".table-wrap > table").forEach(applyColumnPreferences);
}

function ensureColumnSettingButtons() {
  document.querySelectorAll(".view .panel").forEach((panel) => {
    if (panel.querySelector("[data-toggle-panel]")) return;
    const table = panel.querySelector(":scope .table-wrap > table");
    const header = panel.querySelector(":scope .panel-header");
    if (!table || !header) return;
    const key = tablePreferenceKey(table);
    if (header.querySelector("[data-column-settings=\"" + key + "\"]")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ghost-button compact-button column-settings-button";
    button.dataset.columnSettings = key;
    button.textContent = "\u5217\u8bbe\u7f6e";
    const tools = header.querySelector(":scope .panel-tools");
    if (tools) tools.appendChild(button);
    else header.appendChild(button);
  });
}

function finishTableLayout(view = activeView()) {
  ensureColumnSettingButtons();
  applyColumnPreferencesInView(view);
  setupFilterDropdowns(view);
}

function openColumnSettings(table) {
  const key = tablePreferenceKey(table);
  let columns = tableColumns(table);
  const overlay = document.createElement("div");
  overlay.className = "modal-backdrop";
  overlay.innerHTML = '<section class="modal-panel column-settings-panel" role="dialog" aria-modal="true">' +
    '<div class="modal-header"><div><h2>&#21015;&#35774;&#32622;</h2><p>&#36873;&#25321;&#26174;&#31034;&#30340;&#21015;&#65292;&#24182;&#35843;&#25972;&#21015;&#39034;&#24207;</p></div><button class="ghost-button compact-button" data-close-column-settings type="button">&#20851;&#38381;</button></div>' +
    '<div class="column-settings-toolbar"><button class="ghost-button compact-button" data-column-check-all type="button">&#20840;&#37096;&#26174;&#31034;</button><button class="ghost-button compact-button" data-column-uncheck-all type="button">&#20840;&#37096;&#38544;&#34255;</button></div>' +
    '<div class="column-settings-list"></div>' +
    '<div class="modal-actions"><button class="ghost-button" data-reset-column-settings type="button">&#24674;&#22797;&#40664;&#35748;</button><button class="primary-button" data-save-column-settings type="button">&#20445;&#23384;</button></div>' +
    '</section>';
  const list = overlay.querySelector(".column-settings-list");
  const draw = () => {
    list.innerHTML = columns.map((column, index) => '<div class="column-setting-row" data-column-key="' + escapeHtml(column.key) + '">' +
      '<span class="column-index">' + (index + 1) + '</span>' +
      '<label class="column-visible-toggle"><input type="checkbox" ' + (column.visible ? 'checked' : '') + ' /> <span class="column-label-text">' + escapeHtml(column.label) + '</span></label>' +
      '<div class="column-move-actions"><button class="ghost-button compact-button" data-column-move="up" type="button" ' + (index === 0 ? 'disabled' : '') + '>&#19978;&#31227;</button><button class="ghost-button compact-button" data-column-move="down" type="button" ' + (index === columns.length - 1 ? 'disabled' : '') + '>&#19979;&#31227;</button></div>' +
      '</div>').join("");
  };
  draw();
  overlay.addEventListener("click", (event) => {
    const close = event.target.closest("[data-close-column-settings]");
    if (close || event.target === overlay) { overlay.remove(); return; }
    if (event.target.closest("[data-column-check-all]")) {
      columns = columns.map((item) => ({ ...item, visible: true }));
      draw();
      return;
    }
    if (event.target.closest("[data-column-uncheck-all]")) {
      columns = columns.map((item) => ({ ...item, visible: false }));
      draw();
      return;
    }
    const move = event.target.closest("[data-column-move]");
    if (move) {
      const row = move.closest(".column-setting-row");
      const index = columns.findIndex((item) => item.key === row.dataset.columnKey);
      const nextIndex = move.dataset.columnMove === "up" ? index - 1 : index + 1;
      if (index >= 0 && nextIndex >= 0 && nextIndex < columns.length) {
        [columns[index], columns[nextIndex]] = [columns[nextIndex], columns[index]];
        draw();
      }
      return;
    }
    if (event.target.closest("[data-reset-column-settings]")) {
      resetColumnPreferences(table);
      columns = tableColumns(table);
      draw();
      return;
    }
    if (event.target.closest("[data-save-column-settings]")) {
      list.querySelectorAll(".column-setting-row").forEach((row) => {
        const column = columns.find((item) => item.key === row.dataset.columnKey);
        if (column) column.visible = Boolean(row.querySelector('input[type="checkbox"]').checked);
      });
      if (!columns.some((item) => item.visible)) {
        alert("\u81f3\u5c11\u9700\u8981\u4fdd\u7559\u4e00\u5217\u663e\u793a\u3002");
        return;
      }
      const prefs = loadColumnPreferences();
      prefs[key] = {
        order: columns.map((item) => item.key),
        visible: Object.fromEntries(columns.map((item) => [item.key, item.visible])),
      };
      saveColumnPreferences(prefs);
      overlay.remove();
      applyColumnPreferences(table);
    }
  });
  document.body.appendChild(overlay);
}
function activeView() {
  const current = document.querySelector(".view.active");
  return current ? current.id : "dashboard";
}

function refreshFromFirstPage(key) {
  accountedTaskNoCache = null;
  planContractCache = null;
  resetPage(key);
  const renderer = viewRenderers[key];
  if (renderer) renderer();
  requestAnimationFrame(() => finishTableLayout(key));
}

function renderAll() {
  renderDashboard();
  renderTasks();
  renderPrices();
  renderProgress();
  renderContracts();
  renderNegotiations();
  renderPricingProcesses();
  renderAccounts();
}

const viewRenderers = {
  dashboard: renderDashboard,
  tasks: renderTasks,
  procedures: renderProcedures,
  negotiations: renderNegotiations,
  pricingProcesses: renderPricingProcesses,
  prices: renderPrices,
  progress: renderProgress,
  contracts: renderContracts,
  accounts: renderAccounts,
  vendors: renderVendors,
};

function switchView(view) {
  $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
  $$(".view").forEach((item) => item.classList.toggle("active", item.id === view));
  const title = titles[view];
  if (title) {
    $("#page-title").textContent = title[0];
    $("#page-subtitle").textContent = title[1];
  }
  const renderer = viewRenderers[view];
  if (renderer) renderer();
  requestAnimationFrame(() => finishTableLayout(view));
}

const collectionToModule = {
  plans: "tasks",
  prices: "prices",
  progress: "progress",
  contracts: "contracts",
  negotiations: "negotiations",
  pricingProcesses: "pricingProcesses",
  accounts: "accounts",
  vendors: "vendors",
};

function addRecord(collection, data) {
  state[collection].push({ id: crypto.randomUUID(), ...data });
  saveState();
  refreshFromFirstPage(collectionToModule[collection] || activeView());
  renderDashboard();
}

function addRecords(collection, records) {
  state[collection].push(...records.map((record) => ({ id: crypto.randomUUID(), ...record })));
  saveState();
  refreshFromFirstPage(collectionToModule[collection] || activeView());
  renderDashboard();
}

function updateRecord(collection, id, data) {
  state[collection] = state[collection].map((item) => (item.id === id ? { ...item, ...data } : item));
  saveState();
  refreshFromFirstPage(collectionToModule[collection] || activeView());
  renderDashboard();
}

function assertSelectedTasksHavePrices(tasks, vendor) {
  const missing = tasks.filter((plan) => !findTaskPrice(plan, vendor) && !findPlanProcessPrice(plan));
  if (missing.length > 0) {
    alert(`有 ${missing.length} 个任务缺少价格，请先维护价格后再操作。`);
    return false;
  }
  return true;
}

function createContractFromSelectedTasks() {
  const allTasks = selectedTasks();
  if (allTasks.length === 0) {
    alert("请先选择任务。");
    return;
  }

  const contractedTaskNos = new Set(
    state.contracts.flatMap((c) =>
      (Array.isArray(c.contractItems) ? c.contractItems : []).map((item) => item.taskNo).filter(Boolean),
    ),
  );

  const alreadyContracted = allTasks.filter((plan) => contractedTaskNos.has(planTaskNo(plan)));
  if (alreadyContracted.length > 0) {
    const names = alreadyContracted.map((p) => planTaskNo(p)).join("、");
    alert(`以下任务已签过合同，不能重复签约：${names}`);
    return;
  }

  const signDate = $("#task-sign-date").value || today();
  const contractNoPrefix = $("#task-contract-no").value.trim();

  const grouped = new Map();
  allTasks.forEach((plan) => {
    const v = (plan.vendor || "").trim();
    if (!v) return;
    if (!grouped.has(v)) grouped.set(v, []);
    grouped.get(v).push(plan);
  });

  if (grouped.size === 0) {
    alert("所选任务均未指定外协方，请先在任务中填写外协方。");
    return;
  }

  const contracts = [];
  let suffix = 0;
  grouped.forEach((tasks, vendor) => {
    if (!assertSelectedTasksHavePrices(tasks, vendor)) return;
    suffix++;
    const contractNo = contractNoPrefix
      ? `${contractNoPrefix}-${String(suffix).padStart(2, "0")}`
      : `WX-${today().replaceAll("-", "")}-${Date.now().toString().slice(-4)}${String(suffix).padStart(2, "0")}`;
    const amount = tasks.reduce((sum, plan) => sum + taskAmount(plan, vendor), 0);
    const project = tasks.map((plan) => planLabel(plan)).join("、");
    const note = tasks.map((plan) => `${planTaskNo(plan)}/${planLabel(plan)}/${plan.process}/${plan.quantity}`).join("；");

    contracts.push({
      contractNo,
      vendor,
      project,
      contractItems: tasks.map((plan) => {
        const price = findTaskPrice(plan, vendor);
        const quantity = Number(plan.quantity || 0);
        const unitPrice = Number(price ? price.price : 0);
        const lineAmount = quantity * unitPrice;
        return {
          label: `${planTaskNo(plan)} / ${planDrawingNo(plan)} / ${planName(plan)} / ${plan.process} / ${quantity} / ${unitPrice} / ${lineAmount}`,
          taskNo: planTaskNo(plan),
          drawingNo: planDrawingNo(plan),
          name: planName(plan),
          process: plan.process,
          quantity,
          unitPrice,
          amount: lineAmount,
        };
      }),
      amount,
      signDate,
      status: "已签订",
      note: `由外协任务汇总生成：${note}`,
    });
  });

  if (contracts.length === 0) return;
  addRecords("contracts", contracts);
  selectedTaskIds.clear();
  switchView("contracts");
}

function createAccountFromContract(contractId) {
  const contract = state.contracts.find((c) => c.id === contractId);
  if (!contract) {
    alert("未找到该合同。");
    return;
  }

  const allItems = Array.isArray(contract.contractItems) && contract.contractItems.length > 0
    ? contract.contractItems
    : [{ label: contract.project, drawingNo: "", name: contract.project, unitPrice: 0, amount: 0 }];
  const sel = selectedContractItems[contractId];
  const selectedItems = (sel && sel.size > 0)
    ? allItems.filter((_, idx) => sel.has(idx))
    : allItems;

  const alreadyAccounted = state.accounts.some((a) => a.contractId === contractId);
  if (alreadyAccounted) {
    if (sel && sel.size > 0) {
      delete selectedContractItems[contractId];
    } else {
      alert("该合同已生成过挂账记录。如需对部分标的物单独挂账，请先展开合同勾选标的物后再操作。");
      return;
    }
  }

  const amount = selectedItems.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 30);

  addRecord("accounts", {
    contractId,
    vendor: contract.vendor,
    project: contract.project,
    accountItems: selectedItems.map((item) => ({
      label: item.label || `${item.drawingNo || ""} / ${item.name || ""}`,
      taskNo: item.taskNo || "",
      drawingNo: item.drawingNo || "",
      name: item.name || "",
    })),
    amount,
    accountDate: today(),
    dueDate: dueDate.toISOString().slice(0, 10),
    payStatus: "未付款",
    voucher: `外协合同一键挂账 - ${contract.contractNo}`,
  });
  delete selectedContractItems[contractId];
  switchView("accounts");
}

function deleteRecord(collection, id) {
  state[collection] = state[collection].filter((item) => item.id !== id);
  if (collection === "plans") {
    selectedTaskIds.delete(id);
    state.progress = state.progress.filter((item) => item.planId !== id);
  }
  saveState();
  refreshFromFirstPage(collectionToModule[collection] || activeView());
  renderDashboard();
}

function setupForms() {
  const planForm = $("#plan-form");
  if (planForm) {
    planForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = formData(event.currentTarget);
      addRecord("plans", normalizePlan({ ...data, taskNo: nextTaskNo(), quantity: Number(data.quantity) }));
      resetForm(event.currentTarget);
    });
  }

  $("#price-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = formData(event.currentTarget);
    addRecord("prices", pricePayload(data));
    resetForm(event.currentTarget);
    $("#price-create-panel").hidden = true;
  });

  $("#progress-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = formData(event.currentTarget);
    if (!data.planId) return;
    addRecord("progress", { ...data, percent: Number(data.percent) });
    resetForm(event.currentTarget);
  });

  $("#pricing-process-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = formData(event.currentTarget);
    addRecord("pricingProcesses", pricingProcessPayload(data));
    resetForm(event.currentTarget);
    $("#pricing-process-create-panel").hidden = true;
  });

  $("#pricing-process-edit-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!editingPricingProcessId) return;
    const currentItem = state.pricingProcesses.find((item) => item.id === editingPricingProcessId);
    const shouldSyncPrices = currentItem && currentItem.priceImportStatus === "已导入价格库";
    const data = formData(event.currentTarget);
    state.pricingProcesses = state.pricingProcesses.map((item) =>
      item.id === editingPricingProcessId ? { ...item, ...pricingProcessPayload(data) } : item,
    );
    if (shouldSyncPrices) {
      syncPricingProcessToPrices(editingPricingProcessId, currentItem.pricingNo || "", true);
    }
    saveState();
    refreshFromFirstPage("pricingProcesses"); renderDashboard();
    resetPricingProcessEdit();
  });

}

async function importContractItemsExcel(file, targetSelector) {
  if (!window.XLSX) {
    alert("Excel 导入组件未加载，请刷新页面后重试。");
    return;
  }

  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  const headerIndex = rows.findIndex((row) =>
    row.some((cell) => ["图号", "名称", "工序", "规格"].includes(normalizeHeader(cell))),
  );
  if (headerIndex < 0) {
    alert("导入失败：未找到“图号/名称/工序”表头，请使用合同标的物导入模板。");
    return;
  }

  const headers = rows[headerIndex].map(normalizeHeader);
  const indexOfExact = (...names) => {
    for (const name of names) {
      const idx = headers.findIndex((h) => h === name);
      if (idx >= 0) return idx;
    }
    return -1;
  };
  const indexOf = (...names) => {
    const exact = indexOfExact(...names);
    if (exact >= 0) return exact;
    return headers.findIndex((header) => names.some((n) => header.includes(n)));
  };
  const columns = {
    drawingNo: indexOf("图号", "项目图号", "零件图号"),
    name: indexOf("名称", "零件名称", "标的名称"),
    process: indexOf("工序", "工序/内容", "规格", "规格/工序"),
    unit: indexOf("单位"),
    quantity: indexOf("数量"),
    price: indexOf("单价"),
    amount: indexOf("金额", "总价"),
    note: indexOf("备注"),
  };

  if (columns.drawingNo < 0 && columns.name < 0 && columns.process < 0) {
    alert("导入失败：模板缺少必填列（图号、名称、工序至少有一列），请重新下载模板后填写。");
    return;
  }

  const lines = rows
    .slice(headerIndex + 1)
    .map((row) => {
      const parts = [];
      if (columns.drawingNo >= 0) parts.push(String(row[columns.drawingNo] || "").trim());
      if (columns.name >= 0) parts.push(String(row[columns.name] || "").trim());
      if (columns.unit >= 0) {
        const unit = String(row[columns.unit] || "").trim();
        const qty = columns.quantity >= 0 ? Number(row[columns.quantity] || 0) : 0;
        if (unit && qty) parts.push(`${qty}${unit}`);
        else if (unit) parts.push(unit);
        else if (qty) parts.push(String(qty));
      } else if (columns.quantity >= 0) {
        const qty = Number(row[columns.quantity] || 0);
        if (qty) parts.push(String(qty));
      }
      if (columns.process >= 0) parts.push(String(row[columns.process] || "").trim());
      if (columns.price >= 0) {
        const price = Number(row[columns.price] || 0);
        if (price) parts.push(`${price}元`);
      }
      if (columns.amount >= 0) {
        const amount = Number(row[columns.amount] || 0);
        if (amount) parts.push(`小计${amount}元`);
      }
      if (columns.note >= 0) {
        const note = String(row[columns.note] || "").trim();
        if (note) parts.push(note);
      }
      return parts.join(" / ");
    })
    .filter((line) => line.trim());

  if (lines.length === 0) {
    alert("没有可导入的标的物，请确认模板中已填写内容。");
    return;
  }

  const target = document.querySelector(targetSelector);
  if (target) {
    target.value = target.value.trim() ? target.value.trim() + "\n" + lines.join("\n") : lines.join("\n");
  }
  alert(`已导入 ${lines.length} 条标的物。`);
}

async function importPlanExcel(file) {
  if (!window.XLSX) {
    alert("Excel 导入组件未加载，请刷新页面后重试。");
    return;
  }

  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  const headerIndex = rows.findIndex((row) =>
    row.some((cell) => ["图号", "名称", "项目名称"].includes(normalizeHeader(cell))),
  );
  if (headerIndex < 0) {
    alert("导入失败：未找到“图号/名称”表头，请使用外协计划导入模板。");
    return;
  }

  const headers = rows[headerIndex].map(normalizeHeader);
  const indexOfExact = (...names) => {
    for (const name of names) {
      const idx = headers.findIndex((h) => h === name);
      if (idx >= 0) return idx;
    }
    return -1;
  };
  const indexOf = (...names) => {
    const exact = indexOfExact(...names);
    if (exact >= 0) return exact;
    return headers.findIndex((header) => names.some((n) => header.includes(n)));
  };
  const columns = {
    drawingNo: indexOf("图号", "项目图号", "零件图号"),
    name: indexOf("名称", "零件名称"),
    project: indexOf("项目名称", "项目"),
    vendor: indexOf("外协方"),
    process: indexOf("工序/内容", "工序", "内容"),
    quantity: indexOf("数量"),
    dueDate: indexOf("计划交期", "要求完成时间", "交期"),
    batch: indexOf("批次"),
    taskCategory: indexOf("任务类别"),
    outsourceCategory: indexOf("外协类别"),
    productCategory: indexOf("外协产品类别"),
    abcCategory: indexOf("ABC类别"),
    usage: indexOf("领用用途"),
    priority: indexOf("优先级"),
    note: indexOf("备注"),
  };

  const missingCore = ["vendor", "process", "quantity", "dueDate"].filter((key) => columns[key] < 0);
  const missingIdentity = columns.project < 0 && (columns.drawingNo < 0 || columns.name < 0);
  if (missingCore.length > 0 || missingIdentity) {
    alert("导入失败：模板缺少必填列，请重新下载模板后填写。");
    return;
  }

  const nextTaskNoNumber = state.plans.reduce((max, plan) => {
    const match = planTaskNo(plan).match(/^TASK-(\d+)$/);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0) + 1;

  const plans = rows
    .slice(headerIndex + 1)
    .map((row) => {
      const legacy = columns.project >= 0 ? splitLegacyProject(row[columns.project]) : { drawingNo: "", name: "" };
      return normalizePlan({
        drawingNo: columns.drawingNo >= 0 ? String(row[columns.drawingNo] || "").trim() : legacy.drawingNo,
        name: columns.name >= 0 ? String(row[columns.name] || "").trim() : legacy.name,
        vendor: String(row[columns.vendor] || "").trim(),
        process: String(row[columns.process] || "").trim(),
        quantity: Number(row[columns.quantity] || 0),
        dueDate: excelDateToIso(row[columns.dueDate]),
        batch: columns.batch >= 0 ? String(row[columns.batch] || "").trim() : "",
        taskCategory: columns.taskCategory >= 0 ? String(row[columns.taskCategory] || "").trim() : "",
        outsourceCategory: columns.outsourceCategory >= 0 ? String(row[columns.outsourceCategory] || "").trim() : "",
        productCategory: columns.productCategory >= 0 ? String(row[columns.productCategory] || "").trim() : "",
        abcCategory: columns.abcCategory >= 0 ? String(row[columns.abcCategory] || "").trim() : "",
        usage: columns.usage >= 0 ? String(row[columns.usage] || "").trim() : "",
        priority: String(row[columns.priority] || "普通").trim() || "普通",
        note: columns.note >= 0 ? String(row[columns.note] || "").trim() : "",
      });
    })
    .filter((item) => item.drawingNo || item.name || item.vendor || item.process || item.quantity || item.dueDate)
    .filter((item) => item.drawingNo && item.name && item.vendor && item.process && item.quantity > 0 && item.dueDate)
    .map((item, index) => normalizePlan({ ...item, taskNo: `TASK-${String(nextTaskNoNumber + index).padStart(4, "0")}` }));

  if (plans.length === 0) {
    alert("没有可导入的计划，请确认模板中已填写必填字段。");
    return;
  }

  addRecords("plans", plans);
  switchView("tasks");
  alert(`已导入 ${plans.length} 条外协计划。`);
}

async function importPriceExcel(file) {
  if (!window.XLSX) {
    alert("Excel 导入组件未加载，请刷新页面后重试。");
    return;
  }

  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  const headerIndex = rows.findIndex((row) => row.some((cell) => normalizeHeader(cell) === "外协方"));
  if (headerIndex < 0) {
    alert("导入失败：未找到“外协方”表头，请使用价格导入模板。");
    return;
  }

  const headers = rows[headerIndex].map(normalizeHeader);
  const indexOf = (...names) => headers.findIndex((header) => names.includes(header));
  const columns = {
    drawingNo: indexOf("图号", "项目图号", "零件图号"),
    name: indexOf("名称", "零件名称"),
    vendor: indexOf("外协方", "厂家", "供应商"),
    item: indexOf("工序/物料", "工序", "物料", "内容"),
    plannedProcess: indexOf("计划中的工序", "计划工序", "外协计划工序"),
    unit: indexOf("单位"),
    price: indexOf("单价", "价格"),
    effectiveDate: indexOf("生效日期", "生效日"),
    taxRate: indexOf("税率"),
    negotiationNo: indexOf("谈判纪要编号", "纪要编号", "谈判编号"),
    priceSheetNo: indexOf("价格单号", "价格编号", "定价单号"),
    note: indexOf("备注", "说明"),
  };

  const missing = ["drawingNo", "name", "vendor", "item", "unit", "price", "effectiveDate"].filter((key) => columns[key] < 0);
  if (missing.length > 0) {
    alert("导入失败：模板缺少必填列，请重新下载模板后填写。");
    return;
  }

  const prices = rows
    .slice(headerIndex + 1)
    .map((row) =>
      pricePayload({
        drawingNo: String(row[columns.drawingNo] || "").trim(),
        name: String(row[columns.name] || "").trim(),
        vendor: String(row[columns.vendor] || "").trim(),
        item: String(row[columns.item] || "").trim(),
        plannedProcess: columns.plannedProcess >= 0 ? String(row[columns.plannedProcess] || "").trim() : String(row[columns.item] || "").trim(),
        unit: String(row[columns.unit] || "").trim(),
        price: Number(row[columns.price] || 0),
        effectiveDate: excelDateToIso(row[columns.effectiveDate]),
        taxRate: columns.taxRate >= 0 ? Number(row[columns.taxRate] || 0) : 0,
        negotiationNo: columns.negotiationNo >= 0 ? String(row[columns.negotiationNo] || "").trim() : "",
        priceSheetNo: columns.priceSheetNo >= 0 ? String(row[columns.priceSheetNo] || "").trim() : "",
        note: columns.note >= 0 ? String(row[columns.note] || "").trim() : "",
      }),
    )
    .filter((item) => item.drawingNo || item.name || item.vendor || item.item || item.unit || item.price || item.effectiveDate)
    .filter((item) => item.drawingNo && item.name && item.vendor && item.item && item.unit && item.price >= 0 && item.effectiveDate);

  if (prices.length === 0) {
    alert("没有可导入的价格，请确认模板中已填写必填字段。");
    return;
  }

  addRecords("prices", prices);
  switchView("prices");
  alert(`已导入 ${prices.length} 条价格。`);
}

function setupEvents() {
  const sidebarToggle = $("#sidebar-toggle");
  if (sidebarToggle) sidebarToggle.addEventListener("click", () => {
    document.querySelector(".sidebar").classList.toggle("collapsed");
    sidebarToggle.textContent = document.querySelector(".sidebar").classList.contains("collapsed") ? "\u25b6" : "\u25c0";
  });

  $$(".nav-item").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });

  [
    ["#task-search", "tasks"],
    ["#procedure-search", "procedures"],
    ["#price-search", "prices"],
    ["#contract-search", "contracts"],
    ["#negotiation-search", "negotiations"],
    ["#pricing-process-search", "pricingProcesses"],
    ["#account-search", "accounts"],
  ].forEach(([selector, key]) => {
    const element = $(selector);
    if (element) element.addEventListener("input", () => refreshFromFirstPage(key));
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".filter-dropdown")) {
      document.querySelectorAll(".filter-dropdown-panel").forEach((p) => { p.hidden = true; });
    }
  });

  $("#price-toggle-button").addEventListener("click", () => {
    resetPriceEdit();
    $("#price-create-panel").hidden = false;
    $("#price-form").elements.drawingNo.focus();
  });
  $("#price-cancel-button").addEventListener("click", () => {
    $("#price-create-panel").hidden = true;
    resetForm($("#price-form"));
  });
  $("#contract-toggle-button").addEventListener("click", () => {
    openEditModal({
      title: "\u65b0\u589e\u5916\u534f\u5408\u540c",
      fields: [
        { name: "contractNo", label: "\u5408\u540c\u7f16\u53f7", value: "", required: true },
        { name: "vendor", label: "\u5916\u534f\u65b9", value: "", required: true },
        { name: "contractItemsText", label: "\u5408\u540c\u6807\u7684\u7269", value: "", type: "textarea", span: 2, required: true },
        { name: "amount", label: "\u5408\u540c\u91d1\u989d", value: "", type: "number", min: 0, step: "0.01" },
        { name: "signDate", label: "\u7b7e\u8ba2\u65e5\u671f", value: today(), type: "date", required: true },
        { name: "status", label: "\u5408\u540c\u72b6\u6001", value: "\u8349\u62df\u4e2d", type: "select", options: ["\u8349\u62df\u4e2d", "\u5df2\u7b7e\u8ba2", "\u5c65\u884c\u4e2d", "\u5df2\u5b8c\u6210", "\u5df2\u5f52\u6863", "\u5f02\u5e38"] },
        { name: "note", label: "\u5907\u6ce8", value: "", span: 2 },
      ],
      onSave: (data) => {
        addRecord("contracts", contractPayload(data));
      },
    });
  });
  $("#negotiation-toggle-button").addEventListener("click", () => openNegotiationModal(null));
  $("#pricing-process-toggle-button").addEventListener("click", () => {
    resetPricingProcessEdit();
    $("#pricing-process-create-panel").hidden = false;
    $("#pricing-process-form").elements.pricingDate.focus();
  });
  $("#pricing-process-cancel-button").addEventListener("click", () => {
    $("#pricing-process-create-panel").hidden = true;
    resetForm($("#pricing-process-form"));
  });
  $("#cancel-pricing-process-edit").addEventListener("click", resetPricingProcessEdit);
  const taskCheckAll = $("#task-check-all");
  if (taskCheckAll) taskCheckAll.addEventListener("change", (event) => {
    filteredTaskRows().forEach((plan) => {
      if (event.target.checked) selectedTaskIds.add(plan.id);
      else selectedTaskIds.delete(plan.id);
    });
    renderTasks();
  });
  const selectAllTasksButton = $("#select-all-tasks");
  if (selectAllTasksButton) selectAllTasksButton.addEventListener("click", () => {
    filteredTaskRows().forEach((plan) => selectedTaskIds.add(plan.id));
    refreshFromFirstPage("tasks");
  });
  const clearTaskSelectionButton = $("#clear-task-selection");
  if (clearTaskSelectionButton) clearTaskSelectionButton.addEventListener("click", () => {
    selectedTaskIds.clear();
    refreshFromFirstPage("tasks");
  });
  const batchDeleteButton = $("#batch-delete-tasks");
  if (batchDeleteButton) batchDeleteButton.addEventListener("click", () => {
    const tasks = selectedTasks();
    if (tasks.length === 0) {
      alert("请先选择要删除的任务。");
      return;
    }
    if (!confirm(`确定要删除选中的 ${tasks.length} 条外协计划吗？此操作不可恢复。`)) return;
    state.plans = state.plans.filter((plan) => !selectedTaskIds.has(plan.id));
    state.progress = state.progress.filter((item) => !selectedTaskIds.has(item.planId));
    selectedTaskIds.clear();
    saveState();
    refreshFromFirstPage("tasks");
    renderDashboard();
  });
  const exportTasksButton = $("#export-tasks-excel");
  if (exportTasksButton) exportTasksButton.addEventListener("click", exportTasksExcel);
  const createContractButton = $("#create-contract-from-tasks");
  if (createContractButton) createContractButton.addEventListener("click", createContractFromSelectedTasks);

  const toggleContractPanelButton = $("#toggle-contract-panel");
  if (toggleContractPanelButton) toggleContractPanelButton.addEventListener("click", () => {
    const panel = $("#task-contract-panel");
    const hidden = panel.hidden;
    panel.hidden = !hidden;
    toggleContractPanelButton.textContent = hidden ? "\u25bc \u4e00\u952e\u7b7e\u5408\u540c" : "\u25b6 \u4e00\u952e\u7b7e\u5408\u540c";
  });

  document.body.addEventListener("click", (event) => {
    const togglePanel = event.target.closest("[data-toggle-panel]");
    if (togglePanel) {
      const panelId = togglePanel.dataset.togglePanel;
      if (panelId === "monthly") openDashboardModal("\u6bcf\u6708\u6682\u4f30", buildMonthlyEstimates().map((item) => [
        escapeHtml(item.month), item.count, money(item.amount),
        item.missingPriceCount === 0 ? statusBadge("\u5b8c\u6574") : statusBadge(`${item.missingPriceCount} \u4e2a\u7f3a\u4ef7\u683c`, today()),
      ]), ["\u6708\u4efd", "\u4efb\u52a1\u6570", "\u6682\u4f30\u91d1\u989d", "\u7f3a\u4ef7\u683c\u4efb\u52a1"]);
      else if (panelId === "upcoming") openDashboardModal("\u8fd1\u671f\u4ea4\u4ed8", [...state.plans].sort((a, b) => a.dueDate.localeCompare(b.dueDate)).map((plan) => {
        const progress = latestProgress(plan.id);
        return [escapeHtml(planDrawingNo(plan)), escapeHtml(planName(plan)), escapeHtml(plan.vendor), escapeHtml(plan.dueDate), statusBadge(progress ? progress.status : "\u5f85\u53d1\u51fa", plan.dueDate)];
      }), ["\u56fe\u53f7", "\u540d\u79f0", "\u5916\u534f\u65b9", "\u8981\u6c42\u5b8c\u6210\u65f6\u95f4", "\u72b6\u6001"]);
      else if (panelId === "account") openDashboardModal("\u6302\u8d26\u63d0\u9192", state.accounts.filter((item) => item.payStatus !== "\u5df2\u4ed8\u6b3e").sort((a, b) => a.dueDate.localeCompare(b.dueDate)).map((item) => [
        escapeHtml(item.vendor), money(item.amount), escapeHtml(item.dueDate), statusBadge(item.payStatus, item.dueDate),
      ]), ["\u5916\u534f\u65b9", "\u91d1\u989d", "\u5230\u671f\u65e5", "\u72b6\u6001"]);
      else if (panelId === "contract") openDashboardModal("\u5408\u540c\u63d0\u9192", state.contracts.filter((item) => item.status !== "\u5df2\u5f52\u6863").sort((a, b) => (a.signDate || "").localeCompare(b.signDate || "")).map((c) => [
        escapeHtml(c.contractNo), escapeHtml(c.vendor), escapeHtml(c.signDate || ""), statusBadge(contractAutoStatus(c)),
      ]), ["\u5408\u540c\u7f16\u53f7", "\u5916\u534f\u65b9", "\u7b7e\u8ba2\u65e5\u671f", "\u72b6\u6001"]);
      else if (panelId === "vendor-chart") {
        const vendorCounts = {};
        state.plans.forEach((plan) => {
          const v = plan.vendor || "\u672a\u6307\u5b9a";
          vendorCounts[v] = (vendorCounts[v] || 0) + 1;
        });
        const entries = Object.entries(vendorCounts).sort((a, b) => b[1] - a[1]);
        const maxCount = Math.max(1, ...Object.values(vendorCounts));
        const rows = entries.map(([vendor, count]) => [
          escapeHtml(vendor), `<div class="bar-chart-track" style="width:200px"><div class="bar-chart-fill" style="width:${Math.round((count/maxCount)*100)}%"></div></div>`, String(count),
        ]);
        openDashboardModal("\u5382\u5bb6\u4efb\u52a1\u5206\u5e03", rows, ["\u5382\u5bb6", "\u5360\u6bd4", "\u4efb\u52a1\u6570"]);
      }
      else if (panelId === "gantt") {
        openGanttModal();
      }
      return;
    }
    const columnSettingsButton = event.target.closest("[data-column-settings]");
    if (columnSettingsButton) {
      const table = tableByPreferenceKey(columnSettingsButton.dataset.columnSettings);
      if (table) openColumnSettings(table);
      return;
    }
    const pageButton = event.target.closest("[data-page-action]");
    if (pageButton) {
      const pagination = paginationFor(pageButton.dataset.pageKey);
      pagination.page += pageButton.dataset.pageAction === "next" ? 1 : -1;
      const renderer = viewRenderers[pageButton.dataset.pageKey];
      if (renderer) renderer();
      return;
    }
    const toggleButton = event.target.closest("[data-toggle-contract]");
    if (toggleButton) {
      const id = toggleButton.dataset.toggleContract;
      const subRow = document.getElementById(`contract-sub-${id}`);
      if (subRow) {
        const isHidden = subRow.hidden;
        subRow.hidden = !isHidden;
        toggleButton.textContent = isHidden ? "▼" : "▶";
        toggleButton.classList.toggle("expanded", isHidden);
      }
      return;
    }
    const negotiationToggleButton = event.target.closest("[data-toggle-negotiation]");
    if (negotiationToggleButton) {
      const id = negotiationToggleButton.dataset.toggleNegotiation;
      const subRow = document.getElementById(`negotiation-sub-${id}`);
      if (subRow) {
        const isHidden = subRow.hidden;
        subRow.hidden = !isHidden;
        negotiationToggleButton.textContent = isHidden ? "▼" : "▶";
        negotiationToggleButton.classList.toggle("expanded", isHidden);
      }
      return;
    }
    const pricingProcessToggleButton = event.target.closest("[data-toggle-pricing-process]");
    if (pricingProcessToggleButton) {
      const id = pricingProcessToggleButton.dataset.togglePricingProcess;
      const subRow = document.getElementById(`pricing-process-sub-${id}`);
      if (subRow) {
        const isHidden = subRow.hidden;
        subRow.hidden = !isHidden;
        pricingProcessToggleButton.textContent = isHidden ? "▼" : "▶";
        pricingProcessToggleButton.classList.toggle("expanded", isHidden);
      }
      return;
    }
    const accountToggleButton = event.target.closest("[data-toggle-account]");
    if (accountToggleButton) {
      const id = accountToggleButton.dataset.toggleAccount;
      const subRow = document.getElementById(`account-sub-${id}`);
      if (subRow) {
        const isHidden = subRow.hidden;
        subRow.hidden = !isHidden;
        accountToggleButton.textContent = isHidden ? "▼" : "▶";
        accountToggleButton.classList.toggle("expanded", isHidden);
      }
      return;
    }
    const priceToggleButton = event.target.closest("[data-toggle-price]");
    if (priceToggleButton) {
      const id = priceToggleButton.dataset.togglePrice;
      const subRow = document.getElementById(`price-sub-${id}`);
      if (subRow) {
        const isHidden = subRow.hidden;
        subRow.hidden = !isHidden;
        priceToggleButton.textContent = isHidden ? "▼" : "▶";
        priceToggleButton.classList.toggle("expanded", isHidden);
      }
      return;
    }
    const addPriceProcessButton = event.target.closest("[data-add-price-process]");
    if (addPriceProcessButton) {
      const id = addPriceProcessButton.dataset.addPriceProcess;
      const input = document.querySelector(`[data-new-price-process="${id}"]`);
      addPricePlannedProcess(id, input ? input.value : "");
      return;
    }
    const savePriceProcessButton = event.target.closest("[data-save-price-process]");
    if (savePriceProcessButton) {
      const id = savePriceProcessButton.dataset.savePriceProcess;
      const index = Number(savePriceProcessButton.dataset.priceProcessIndex || 0);
      const input = document.querySelector(`[data-price-process-value="${id}"][data-price-process-index="${index}"]`);
      updatePricePlannedProcess(id, index, input ? input.value : "");
      return;
    }
    const deletePriceProcessButton = event.target.closest("[data-delete-price-process]");
    if (deletePriceProcessButton) {
      deletePricePlannedProcess(deletePriceProcessButton.dataset.deletePriceProcess, Number(deletePriceProcessButton.dataset.priceProcessIndex || 0));
      return;
    }
    const editPlanButton = event.target.closest("[data-edit-plan]");
    if (editPlanButton) {
      startPlanEdit(editPlanButton.dataset.editPlan);
      return;
    }
    const editProgressButton = event.target.closest("[data-edit-progress]");
    if (editProgressButton) {
      startProgressEdit(editProgressButton.dataset.editProgress);
      return;
    }
    const editProcedureButton = event.target.closest("[data-edit-procedure]");
    if (editProcedureButton) {
      startProcedureEdit(editProcedureButton.dataset.editProcedure);
      return;
    }
    const deleteProcedureButton = event.target.closest("[data-delete-procedure]");
    if (deleteProcedureButton) {
      removeProcedure(deleteProcedureButton.dataset.deleteProcedure);
      return;
    }
    const editPriceButton = event.target.closest("[data-edit-price]");
    if (editPriceButton) {
      startPriceEdit(editPriceButton.dataset.editPrice);
      return;
    }
    const editContractButton = event.target.closest("[data-edit-contract]");
    if (editContractButton) {
      startContractEdit(editContractButton.dataset.editContract);
      return;
    }
    const editNegotiationButton = event.target.closest("[data-edit-negotiation]");
    if (editNegotiationButton) {
      startNegotiationEdit(editNegotiationButton.dataset.editNegotiation);
      return;
    }
    const importPricingProcessButton = event.target.closest("[data-import-pricing-process]");
    if (importPricingProcessButton) {
      importPricingProcessToPrices(importPricingProcessButton.dataset.importPricingProcess);
      return;
    }
    const editPricingProcessButton = event.target.closest("[data-edit-pricing-process]");
    if (editPricingProcessButton) {
      startPricingProcessEdit(editPricingProcessButton.dataset.editPricingProcess);
      return;
    }
    const editAccountButton = event.target.closest("[data-edit-account]");
    if (editAccountButton) {
      startAccountEdit(editAccountButton.dataset.editAccount);
      return;
    }
    const editVendorButton = event.target.closest("[data-edit-vendor]");
    if (editVendorButton) {
      const item = state.vendors.find((v) => v.id === editVendorButton.dataset.editVendor);
      if (item) openVendorModal(item);
      return;
    }
    const button = event.target.closest("[data-delete]");
    if (!button) return;
    if (button.dataset.delete === "contracts" && button.dataset.id === editingContractId) {
      resetContractEdit();
    }
    if (button.dataset.delete === "negotiations" && button.dataset.id === editingNegotiationId) {
      resetNegotiationEdit();
    }
    if (button.dataset.delete === "pricingProcesses" && button.dataset.id === editingPricingProcessId) {
      resetPricingProcessEdit();
    }
    if (button.dataset.delete === "accounts" && button.dataset.id === editingAccountId) {
      resetAccountEdit();
    }
    deleteRecord(button.dataset.delete, button.dataset.id);
  });
  document.body.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    const newPriceProcessInput = event.target.closest("[data-new-price-process]");
    if (newPriceProcessInput) {
      event.preventDefault();
      addPricePlannedProcess(newPriceProcessInput.dataset.newPriceProcess, newPriceProcessInput.value);
      return;
    }
    const priceProcessInput = event.target.closest("[data-price-process-value]");
    if (priceProcessInput) {
      event.preventDefault();
      updatePricePlannedProcess(
        priceProcessInput.dataset.priceProcessValue,
        Number(priceProcessInput.dataset.priceProcessIndex || 0),
        priceProcessInput.value,
      );
    }
  });
  document.body.addEventListener("change", (event) => {
    const pageSizeSelect = event.target.closest("[data-page-size]");
    if (pageSizeSelect) {
      const pagination = paginationFor(pageSizeSelect.dataset.pageSize);
      pagination.pageSize = Number(pageSizeSelect.value || defaultPageSize);
      pagination.page = 1;
      const renderer = viewRenderers[pageSizeSelect.dataset.pageSize];
      if (renderer) renderer();
      return;
    }
    const procedureInput = event.target.closest(".procedure-file-input");
    if (procedureInput) {
      const files = Array.from(procedureInput.files || []);
      uploadProcedureFiles(procedureInput.dataset.planId, files).catch((error) => {
        alert("\u5de5\u827a\u89c4\u7a0b\u4e0a\u4f20\u5931\u8d25\uff1a" + error.message);
      });
      procedureInput.value = "";
      return;
    }
    const procedureReplaceInput = event.target.closest(".procedure-replace-input");
    if (procedureReplaceInput) {
      const file = procedureReplaceInput.files && procedureReplaceInput.files[0];
      if (file) {
        replaceProcedure(procedureReplaceInput.dataset.procedureId, file).catch((error) => {
          alert("\u5de5\u827a\u89c4\u7a0b\u66ff\u6362\u5931\u8d25\uff1a" + error.message);
        });
      }
      procedureReplaceInput.value = "";
      return;
    }
    const deleteProcedureFileBtn = event.target.closest("[data-delete-procedure-file]");
    if (deleteProcedureFileBtn) {
      removeProcedureFile(deleteProcedureFileBtn.dataset.deleteProcedureFile, deleteProcedureFileBtn.dataset.fileKey);
      return;
    }
    const contractItemCheckAll = event.target.closest(".contract-item-check-all");
    if (contractItemCheckAll) {
      const contractId = contractItemCheckAll.dataset.contractId;
      const rows = document.querySelectorAll(`.contract-item-check[data-contract-id="${contractId}"]`);
      if (contractItemCheckAll.checked) {
        const sel = new Set();
        rows.forEach((cb) => sel.add(Number(cb.dataset.itemIndex)));
        selectedContractItems[contractId] = sel;
      } else {
        delete selectedContractItems[contractId];
      }
      rows.forEach((cb) => { cb.checked = contractItemCheckAll.checked; });
      return;
    }
    const contractItemCheck = event.target.closest(".contract-item-check");
    if (contractItemCheck) {
      const contractId = contractItemCheck.dataset.contractId;
      const itemIndex = Number(contractItemCheck.dataset.itemIndex);
      if (contractItemCheck.checked) {
        if (!selectedContractItems[contractId]) selectedContractItems[contractId] = new Set();
        selectedContractItems[contractId].add(itemIndex);
      } else {
        if (selectedContractItems[contractId]) {
          selectedContractItems[contractId].delete(itemIndex);
          if (selectedContractItems[contractId].size === 0) delete selectedContractItems[contractId];
        }
      }
      const checkAll = document.querySelector(`.contract-item-check-all[data-contract-id="${contractId}"]`);
      if (checkAll) {
        const rows = document.querySelectorAll(`.contract-item-check[data-contract-id="${contractId}"]`);
        const allChecked = rows.length > 0 && [...rows].every((cb) => cb.checked);
        checkAll.checked = allChecked;
        checkAll.indeterminate = !allChecked && [...rows].some((cb) => cb.checked);
      }
      return;
    }
    const checkbox = event.target.closest(".task-check");
    if (!checkbox) return;
    if (checkbox.checked) selectedTaskIds.add(checkbox.dataset.taskId);
    else selectedTaskIds.delete(checkbox.dataset.taskId);
    refreshFromFirstPage("tasks");
  });

  $("#plan-excel-import").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      await importPlanExcel(file);
    } catch {
      alert("导入失败，请检查 Excel 文件格式。");
    }
    event.target.value = "";
  });
  $("#price-excel-import").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (file) {
      try {
        await importPriceExcel(file);
      } catch (error) {
        alert(`导入失败：${error.message}`);
      }
    }
    event.target.value = "";
  });
  $("#price-export-excel").addEventListener("click", exportPricesExcel);
  const contractExportButton = $("#contract-export-excel");
  if (contractExportButton) contractExportButton.addEventListener("click", exportContractsExcel);
  $("#pricing-process-excel-import").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (file) {
      try {
        await importContractItemsExcel(file, "#pricing-process-form [name='pricingItemsText']");
      } catch (error) {
        alert(`导入失败：${error.message}`);
      }
    }
    event.target.value = "";
  });
  $("#pricing-process-edit-excel-import").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (file) {
      try {
        await importContractItemsExcel(file, "#pricing-process-edit-form [name='pricingItemsText']");
      } catch (error) {
        alert(`导入失败：${error.message}`);
      }
    }
    event.target.value = "";
  });

  $("#vendor-toggle-button").addEventListener("click", () => openVendorModal(null));
  $("#vendor-search").addEventListener("input", () => renderVendors());

  $("#procedure-toggle-button").addEventListener("click", () => openProcedureModal(null));
}

async function init() {
  try {
    state = await loadServerState();
  } catch {
    try {
      state = loadLocalState();
    } catch {
      state = createSampleState();
    }
  }

  try {
    validateColumnPreferences();
    $$('input[type="date"]:not([data-optional-date])').forEach((input) => {
      input.value = today();
    });
    setupForms();
    setupEvents();
    const renderer = viewRenderers[activeView()] || renderDashboard;
    renderer();
    finishTableLayout(activeView());
  } catch (error) {
    alert("初始化错误: " + error.message);
    console.error("Init error:", error);
  }
}

init();
