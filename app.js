const appVersion = "0.5.0";
const storageKey = "outsourcing-management-data";
const serverStorage = location.protocol === "http:" || location.protocol === "https:";

const titles = {
  dashboard: ["概览", "查看外协业务的关键状态和风险。"],
  plans: ["外协计划", "登记外协任务、交期、数量和优先级。"],
  prices: ["价格管理", "维护供应商价格、单位、税率和生效日期。"],
  progress: ["外协进度", "跟踪每个计划的状态、完成率和异常说明。"],
  contracts: ["外协合同", "登记合同编号、金额、期限、状态和负责人。"],
  negotiations: ["谈判纪要", "记录外协谈判过程、结论和后续跟进事项。"],
  accounts: ["挂账管理", "记录外协应付、到期日和付款状态。"],
};

let state = createDefaultState();

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function today() {
  return new Date().toISOString().slice(0, 10);
}

function createDefaultState() {
  return {
    plans: [],
    prices: [],
    contracts: [],
    negotiations: [],
    progress: [],
    accounts: [],
  };
}

function createSampleState() {
  const now = today();
  return {
    ...createDefaultState(),
    plans: [
      {
        id: crypto.randomUUID(),
        project: "样件喷涂 S-001",
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
  const response = await fetch("/api/data", { cache: "no-store" });
  if (!response.ok) throw new Error("读取本地数据文件失败");
  return normalizeState(await response.json());
}

function normalizeState(data) {
  const source = data?.data && typeof data.data === "object" ? data.data : data;
  return {
    plans: Array.isArray(source?.plans) ? source.plans : [],
    prices: Array.isArray(source?.prices) ? source.prices : [],
    progress: Array.isArray(source?.progress) ? source.progress : [],
    contracts: Array.isArray(source?.contracts) ? source.contracts : [],
    negotiations: Array.isArray(source?.negotiations) ? source.negotiations : [],
    accounts: Array.isArray(source?.accounts) ? source.accounts : [],
  };
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
  localStorage.setItem(storageKey, JSON.stringify(dataEnvelope()));
  if (serverStorage) {
    fetch("/api/data", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dataEnvelope()),
    }).catch(() => {
      alert("数据文件保存失败，请确认本地服务仍在运行。");
    });
  }
}

function money(value) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function escapeHtml(value) {
  return String(value ?? "")
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
  if (status === "已完成" || status === "已付款" || status === "已签订" || status === "已归档") {
    return `<span class="badge ok">${label}</span>`;
  }
  if (status === "异常" || isOverdue(dueDate, false)) return `<span class="badge danger">${label}</span>`;
  if (status === "加急" || status === "部分付款" || status === "草拟中" || status === "待跟进") {
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

function renderEmpty(colspan, text) {
  return `<tr><td class="empty" colspan="${colspan}">${text}</td></tr>`;
}

function renderDashboard() {
  const running = state.plans.filter((plan) => latestProgress(plan.id)?.status !== "已完成").length;
  const unpaid = state.accounts
    .filter((item) => item.payStatus !== "已付款")
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const overdue = state.plans.filter((plan) => {
    const progress = latestProgress(plan.id);
    return isOverdue(plan.dueDate, progress?.status === "已完成");
  }).length;
  const activeContracts = state.contracts.filter((item) => !["已归档", "异常"].includes(item.status)).length;
  const pendingNegotiations = state.negotiations.filter((item) => item.status === "待跟进").length;

  $("#metric-plans").textContent = state.plans.length;
  $("#metric-running").textContent = running;
  $("#metric-unpaid").textContent = money(unpaid);
  $("#metric-overdue").textContent = overdue;
  $("#metric-contracts").textContent = activeContracts;
  $("#metric-negotiations").textContent = pendingNegotiations;

  const upcoming = [...state.plans]
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 6);
  $("#upcoming-table").innerHTML =
    upcoming.length === 0
      ? renderEmpty(4, "暂无近期交付")
      : upcoming
          .map((plan) => {
            const progress = latestProgress(plan.id);
            const status = progress?.status || "待发出";
            return `<tr>
              <td>${escapeHtml(plan.project)}</td>
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
    .sort((a, b) => a.endDate.localeCompare(b.endDate))
    .slice(0, 6);
  $("#contract-alerts-table").innerHTML =
    contracts.length === 0
      ? renderEmpty(4, "暂无合同提醒")
      : contracts
          .map(
            (item) => `<tr>
              <td>${escapeHtml(item.contractNo)}</td>
              <td>${escapeHtml(item.vendor)}</td>
              <td>${escapeHtml(item.endDate)}</td>
              <td>${statusBadge(item.status, item.endDate)}</td>
            </tr>`,
          )
          .join("");

  const negotiations = state.negotiations
    .filter((item) => item.status === "待跟进")
    .sort((a, b) => String(a.followUpDate || "9999-12-31").localeCompare(String(b.followUpDate || "9999-12-31")))
    .slice(0, 6);
  $("#negotiation-alerts-table").innerHTML =
    negotiations.length === 0
      ? renderEmpty(4, "暂无待跟进纪要")
      : negotiations
          .map(
            (item) => `<tr>
              <td>${escapeHtml(item.topic)}</td>
              <td>${escapeHtml(item.vendor)}</td>
              <td>${escapeHtml(item.followUpDate || "-")}</td>
              <td>${statusBadge(item.status, item.followUpDate)}</td>
            </tr>`,
          )
          .join("");
}

function renderPlans() {
  const keyword = $("#plan-search").value.trim().toLowerCase();
  const rows = state.plans.filter((plan) =>
    [plan.project, plan.vendor, plan.process].some((value) => value.toLowerCase().includes(keyword)),
  );
  $("#plans-table").innerHTML =
    rows.length === 0
      ? renderEmpty(7, "暂无计划")
      : rows
          .map(
            (plan) => `<tr>
              <td>${escapeHtml(plan.project)}</td>
              <td>${escapeHtml(plan.vendor)}</td>
              <td>${escapeHtml(plan.process)}</td>
              <td>${plan.quantity}</td>
              <td>${escapeHtml(plan.dueDate)}</td>
              <td>${statusBadge(plan.priority)}</td>
              <td><button class="danger-button" data-delete="plans" data-id="${plan.id}" type="button">删除</button></td>
            </tr>`,
          )
          .join("");
}

function renderPrices() {
  const keyword = $("#price-search").value.trim().toLowerCase();
  const rows = state.prices.filter((item) =>
    [item.vendor, item.item].some((value) => value.toLowerCase().includes(keyword)),
  );
  $("#prices-table").innerHTML =
    rows.length === 0
      ? renderEmpty(7, "暂无价格")
      : rows
          .map(
            (item) => `<tr>
              <td>${escapeHtml(item.vendor)}</td>
              <td>${escapeHtml(item.item)}</td>
              <td>${escapeHtml(item.unit)}</td>
              <td>${money(item.price)}</td>
              <td>${escapeHtml(item.effectiveDate)}</td>
              <td>${item.taxRate || 0}%</td>
              <td><button class="danger-button" data-delete="prices" data-id="${item.id}" type="button">删除</button></td>
            </tr>`,
          )
          .join("");
}

function renderProgressSelect() {
  const select = $("#progress-plan-select");
  select.innerHTML =
    state.plans.length === 0
      ? `<option value="">请先新增外协计划</option>`
      : state.plans
          .map((plan) => `<option value="${plan.id}">${escapeHtml(plan.project)} / ${escapeHtml(plan.vendor)}</option>`)
          .join("");
}

function renderProgress() {
  renderProgressSelect();
  $("#progress-table").innerHTML =
    state.progress.length === 0
      ? renderEmpty(7, "暂无进度")
      : [...state.progress]
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .map((item) => {
            const plan = planById(item.planId) || { project: "计划已删除", vendor: "-" };
            return `<tr>
              <td>${escapeHtml(plan.project)}</td>
              <td>${escapeHtml(plan.vendor)}</td>
              <td>${statusBadge(item.status)}</td>
              <td>${item.percent}%</td>
              <td>${escapeHtml(item.updatedAt)}</td>
              <td>${escapeHtml(item.remark || "-")}</td>
              <td><button class="danger-button" data-delete="progress" data-id="${item.id}" type="button">删除</button></td>
            </tr>`;
          })
          .join("");
}

function renderContracts() {
  const keyword = $("#contract-search").value.trim().toLowerCase();
  const rows = state.contracts.filter((item) =>
    [item.contractNo, item.vendor, item.project].some((value) => String(value || "").toLowerCase().includes(keyword)),
  );
  $("#contracts-table").innerHTML =
    rows.length === 0
      ? renderEmpty(9, "暂无合同")
      : rows
          .map(
            (item) => `<tr>
              <td>${escapeHtml(item.contractNo)}</td>
              <td>${escapeHtml(item.vendor)}</td>
              <td>${escapeHtml(item.project)}</td>
              <td>${money(item.amount)}</td>
              <td>${escapeHtml(item.signDate)}</td>
              <td>${escapeHtml(item.endDate)}</td>
              <td>${statusBadge(item.status, item.endDate)}</td>
              <td>${escapeHtml(item.owner || "-")}</td>
              <td><button class="danger-button" data-delete="contracts" data-id="${item.id}" type="button">删除</button></td>
            </tr>`,
          )
          .join("");
}

function renderNegotiations() {
  const keyword = $("#negotiation-search").value.trim().toLowerCase();
  const rows = state.negotiations.filter((item) =>
    [item.topic, item.vendor, item.project, item.summary, item.actionItems].some((value) =>
      String(value || "").toLowerCase().includes(keyword),
    ),
  );
  $("#negotiations-table").innerHTML =
    rows.length === 0
      ? renderEmpty(9, "暂无谈判纪要")
      : [...rows]
          .sort((a, b) => String(b.meetingDate || "").localeCompare(String(a.meetingDate || "")))
          .map(
            (item) => `<tr>
              <td>${escapeHtml(item.meetingDate)}</td>
              <td>${escapeHtml(item.vendor)}</td>
              <td>${escapeHtml(item.project)}</td>
              <td>${escapeHtml(item.topic)}</td>
              <td>${escapeHtml(item.summary)}</td>
              <td>${escapeHtml(item.actionItems || "-")}</td>
              <td>${escapeHtml(item.followUpDate || "-")}</td>
              <td>${statusBadge(item.status, item.followUpDate)}</td>
              <td><button class="danger-button" data-delete="negotiations" data-id="${item.id}" type="button">删除</button></td>
            </tr>`,
          )
          .join("");
}

function renderAccounts() {
  const keyword = $("#account-search").value.trim().toLowerCase();
  const rows = state.accounts.filter((item) =>
    [item.vendor, item.project, item.voucher].some((value) => String(value || "").toLowerCase().includes(keyword)),
  );
  $("#accounts-table").innerHTML =
    rows.length === 0
      ? renderEmpty(7, "暂无挂账")
      : rows
          .map(
            (item) => `<tr>
              <td>${escapeHtml(item.vendor)}</td>
              <td>${escapeHtml(item.project)}</td>
              <td>${money(item.amount)}</td>
              <td>${escapeHtml(item.accountDate)}</td>
              <td>${escapeHtml(item.dueDate)}</td>
              <td>${statusBadge(item.payStatus, item.dueDate)}</td>
              <td><button class="danger-button" data-delete="accounts" data-id="${item.id}" type="button">删除</button></td>
            </tr>`,
          )
          .join("");
}

function renderAll() {
  renderDashboard();
  renderPlans();
  renderPrices();
  renderProgress();
  renderContracts();
  renderNegotiations();
  renderAccounts();
}

function switchView(view) {
  $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
  $$(".view").forEach((item) => item.classList.toggle("active", item.id === view));
  $("#page-title").textContent = titles[view][0];
  $("#page-subtitle").textContent = titles[view][1];
}

function addRecord(collection, data) {
  state[collection].push({ id: crypto.randomUUID(), ...data });
  saveState();
  renderAll();
}

function addRecords(collection, records) {
  state[collection].push(...records.map((record) => ({ id: crypto.randomUUID(), ...record })));
  saveState();
  renderAll();
}

function deleteRecord(collection, id) {
  state[collection] = state[collection].filter((item) => item.id !== id);
  if (collection === "plans") {
    state.progress = state.progress.filter((item) => item.planId !== id);
  }
  saveState();
  renderAll();
}

function setupForms() {
  $("#plan-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = formData(event.currentTarget);
    addRecord("plans", { ...data, quantity: Number(data.quantity) });
    resetForm(event.currentTarget);
  });

  $("#price-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = formData(event.currentTarget);
    addRecord("prices", {
      ...data,
      price: Number(data.price),
      taxRate: Number(data.taxRate || 0),
    });
    resetForm(event.currentTarget);
  });

  $("#progress-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = formData(event.currentTarget);
    if (!data.planId) return;
    addRecord("progress", { ...data, percent: Number(data.percent) });
    resetForm(event.currentTarget);
  });

  $("#contract-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = formData(event.currentTarget);
    addRecord("contracts", { ...data, amount: Number(data.amount) });
    resetForm(event.currentTarget);
  });

  $("#negotiation-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = formData(event.currentTarget);
    addRecord("negotiations", data);
    resetForm(event.currentTarget);
  });

  $("#account-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = formData(event.currentTarget);
    addRecord("accounts", { ...data, amount: Number(data.amount) });
    resetForm(event.currentTarget);
  });
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
  const headerIndex = rows.findIndex((row) => row.some((cell) => normalizeHeader(cell) === "项目名称"));
  if (headerIndex < 0) {
    alert("导入失败：未找到“项目名称”表头，请使用外协计划导入模板。");
    return;
  }

  const headers = rows[headerIndex].map(normalizeHeader);
  const indexOf = (...names) => headers.findIndex((header) => names.includes(header));
  const columns = {
    project: indexOf("项目名称"),
    vendor: indexOf("外协方"),
    process: indexOf("工序/内容", "工序", "内容"),
    quantity: indexOf("数量"),
    dueDate: indexOf("计划交期", "交期"),
    priority: indexOf("优先级"),
    note: indexOf("备注"),
  };

  const missing = Object.entries(columns)
    .filter(([key, index]) => ["project", "vendor", "process", "quantity", "dueDate"].includes(key) && index < 0)
    .map(([key]) => key);
  if (missing.length > 0) {
    alert("导入失败：模板缺少必填列，请重新下载模板后填写。");
    return;
  }

  const plans = rows
    .slice(headerIndex + 1)
    .map((row) => ({
      project: String(row[columns.project] || "").trim(),
      vendor: String(row[columns.vendor] || "").trim(),
      process: String(row[columns.process] || "").trim(),
      quantity: Number(row[columns.quantity] || 0),
      dueDate: excelDateToIso(row[columns.dueDate]),
      priority: String(row[columns.priority] || "普通").trim() || "普通",
      note: columns.note >= 0 ? String(row[columns.note] || "").trim() : "",
    }))
    .filter((item) => item.project || item.vendor || item.process || item.quantity || item.dueDate)
    .filter((item) => item.project && item.vendor && item.process && item.quantity > 0 && item.dueDate);

  if (plans.length === 0) {
    alert("没有可导入的计划，请确认模板中已填写必填字段。");
    return;
  }

  addRecords("plans", plans);
  switchView("plans");
  alert(`已导入 ${plans.length} 条外协计划。`);
}

function setupEvents() {
  $$(".nav-item").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });

  ["#plan-search", "#price-search", "#contract-search", "#negotiation-search", "#account-search"].forEach((selector) => {
    $(selector).addEventListener("input", renderAll);
  });

  document.body.addEventListener("click", (event) => {
    const button = event.target.closest("[data-delete]");
    if (!button) return;
    deleteRecord(button.dataset.delete, button.dataset.id);
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
}

async function init() {
  try {
    state = serverStorage ? await loadServerState() : loadLocalState();
  } catch {
    state = loadLocalState();
    alert("未能读取本地数据文件，已临时切换到浏览器本地存储。请确认本地服务正常运行。");
  }

  $$('input[type="date"]:not([data-optional-date])').forEach((input) => {
    input.value = today();
  });
  setupForms();
  setupEvents();
  renderAll();
}

init();
