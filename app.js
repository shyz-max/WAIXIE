const appVersion = "0.5.0";
const storageKey = "outsourcing-management-data";
const serverStorage = location.protocol === "http:" || location.protocol === "https:";

const titles = {
  dashboard: ["概览", "查看外协业务的关键状态和风险。"],
  plans: ["新增外协计划", "登记外协任务、交期、数量和优先级。"],
  tasks: ["外协任务汇总", "批量查看任务价格状态，并快速生成合同和挂账。"],
  prices: ["价格库", "维护供应商价格、单位、税率和生效日期。"],
  progress: ["外协进度", "跟踪每个计划的状态、完成率和异常说明。"],
  contracts: ["外协合同", "登记合同编号、金额、期限、状态和负责人。"],
  negotiations: ["谈判纪要", "记录外协谈判过程、结论和后续跟进事项。"],
  accounts: ["挂账管理", "记录外协应付、到期日和付款状态。"],
};

let state = createDefaultState();
let selectedTaskIds = new Set();
let editingPriceId = null;
let editingContractId = null;
let editingNegotiationId = null;
let editingAccountId = null;

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
  const response = await fetch("/api/data", { cache: "no-store" });
  if (!response.ok) throw new Error("读取本地数据文件失败");
  return normalizeState(await response.json());
}

function normalizeState(data) {
  const source = data && data.data && typeof data.data === "object" ? data.data : data;
  return {
    plans: Array.isArray(source && source.plans) ? source.plans.map((plan, index) => normalizePlan(plan, index)) : [],
    prices: Array.isArray(source && source.prices) ? source.prices : [],
    progress: Array.isArray(source && source.progress) ? source.progress : [],
    contracts: Array.isArray(source && source.contracts) ? source.contracts : [],
    negotiations: Array.isArray(source && source.negotiations) ? source.negotiations : [],
    accounts: Array.isArray(source && source.accounts) ? source.accounts : [],
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
    status === "已交付"
  ) {
    return `<span class="badge ok">${label}</span>`;
  }
  if (status === "异常" || status === "逾期" || isOverdue(dueDate, false)) return `<span class="badge danger">${label}</span>`;
  if (
    status === "加急" ||
    status === "部分付款" ||
    status === "草拟中" ||
    status === "待跟进" ||
    status === "未签合同" ||
    status === "进行中" ||
    status === "已发出" ||
    status === "加工中" ||
    status === "待检验" ||
    status === "待发出"
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

function selectedTaskVendor() {
  const select = $("#task-vendor-select");
  return select ? select.value : "";
}

function findTaskPrice(plan, vendor = selectedTaskVendor()) {
  const targetVendor = vendor || plan.vendor;
  return state.prices
    .filter((item) => {
      if (item.vendor !== targetVendor || item.item !== plan.process) return false;
      if (item.drawingNo && item.drawingNo !== planDrawingNo(plan)) return false;
      if (item.name && item.name !== planName(plan)) return false;
      return true;
    })
    .sort((a, b) => String(b.effectiveDate || "").localeCompare(String(a.effectiveDate || "")))[0];
}

function findPlanPrice(plan) {
  return findTaskPrice(plan, plan.vendor);
}

function taskAmount(plan, vendor = selectedTaskVendor()) {
  const price = findTaskPrice(plan, vendor);
  if (!price) return null;
  return Number(plan.quantity || 0) * Number(price.price || 0);
}

function findPriceForContractItem(parts, vendor) {
  return state.prices
    .filter((item) => {
      if (item.vendor !== vendor) return false;
      if (parts.process && item.item !== parts.process) return false;
      if (parts.drawingNo && item.drawingNo && item.drawingNo !== parts.drawingNo) return false;
      if (parts.name && item.name && item.name !== parts.name) return false;
      return true;
    })
    .sort((a, b) => String(b.effectiveDate || "").localeCompare(String(a.effectiveDate || "")))[0];
}

function contractItemPriceInfo(parts, vendor) {
  const price = findPriceForContractItem(parts, vendor);
  const unitPrice = parts.unitPrice || (price ? String(price.price) : "");
  const quantityMatch = String(parts.quantityUnit || "").match(/[\d.]+/);
  const quantity = Number(quantityMatch ? quantityMatch[0] : 0);
  const amount = parts.amount || (unitPrice && quantity ? String(Number(unitPrice) * quantity) : "");
  return { unitPrice, amount };
}

function findPlanContract(plan) {
  return state.contracts.find((contract) => {
    const projectText = contractItemsSummary(contract);
    const keys = [planLabel(plan), planDrawingNo(plan), planName(plan)].filter(Boolean);
    return keys.some((key) => projectText.includes(key)) && contractAutoStatus(contract) !== "草拟中" && contractAutoStatus(contract) !== "异常";
  });
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

  const negotiations = [...state.negotiations]
    .sort((a, b) => String(a.followUpDate || "9999-12-31").localeCompare(String(b.followUpDate || "9999-12-31")))
    .slice(0, 6);
  $("#negotiation-alerts-table").innerHTML =
    negotiations.length === 0
      ? renderEmpty(4, "暂无谈判纪要")
      : negotiations
          .map(
            (item) => `<tr>
              <td>${escapeHtml(item.negotiationNo || "-")}</td>
              <td>${escapeHtml(item.vendor)}</td>
              <td>${escapeHtml(negotiationItemsSummary(item))}</td>
              <td>${escapeHtml(item.followUpDate || "-")}</td>
            </tr>`,
          )
          .join("");
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

function renderPlans() {
  const keyword = $("#plan-search").value.trim().toLowerCase();
  const rows = state.plans.filter((plan) =>
    [planTaskNo(plan), planDrawingNo(plan), planName(plan), planLabel(plan), plan.vendor, plan.process].some((value) =>
      String(value || "").toLowerCase().includes(keyword),
    ),
  );
  $("#plans-table").innerHTML =
    rows.length === 0
      ? renderEmpty(9, "暂无计划")
      : rows
          .map(
            (plan) => `<tr>
              <td>${escapeHtml(planTaskNo(plan))}</td>
              <td>${escapeHtml(planDrawingNo(plan))}</td>
              <td>${escapeHtml(planName(plan))}</td>
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

function renderTaskFilterOptions() {
  setSelectOptions($("#task-filter-vendor"), uniqueValues(state.plans.map((plan) => plan.vendor)), "全部外协方");
}

function taskProgressStatus(plan) {
  const progress = latestProgress(plan.id);
  return progress ? progress.status : "待发出";
}

function taskMatchesFilters(plan, selectedVendor) {
  const keyword = $("#task-search").value.trim().toLowerCase();
  const vendorFilter = $("#task-filter-vendor").value;
  const progressFilter = $("#task-filter-progress").value;
  const priceFilter = $("#task-filter-price").value;
  const contractFilter = $("#task-filter-contract").value;
  const hasPrice = Boolean(findTaskPrice(plan, selectedVendor));
  const hasContract = Boolean(findPlanContract(plan));

  if (
    keyword &&
    ![planTaskNo(plan), planDrawingNo(plan), planName(plan), planLabel(plan), plan.vendor, plan.process].some((value) =>
      String(value || "").toLowerCase().includes(keyword),
    )
  ) {
    return false;
  }
  if (vendorFilter && plan.vendor !== vendorFilter) return false;
  if (progressFilter && taskProgressStatus(plan) !== progressFilter) return false;
  if (priceFilter === "priced" && !hasPrice) return false;
  if (priceFilter === "missing" && hasPrice) return false;
  if (contractFilter === "signed" && !hasContract) return false;
  if (contractFilter === "unsigned" && hasContract) return false;
  return true;
}

function filteredTaskRows() {
  const vendor = selectedTaskVendor();
  return state.plans.filter((plan) => taskMatchesFilters(plan, vendor));
}

function plansForPrice(price) {
  return state.plans.filter((plan) => {
    if (plan.vendor !== price.vendor || plan.process !== price.item) return false;
    if (price.drawingNo && price.drawingNo !== planDrawingNo(plan)) return false;
    if (price.name && price.name !== planName(plan)) return false;
    return true;
  });
}

function renderPriceFilterOptions() {
  setSelectOptions($("#price-filter-vendor"), uniqueValues(state.prices.map((item) => item.vendor)), "全部外协方");
  setSelectOptions($("#price-filter-item"), uniqueValues(state.prices.map((item) => item.item)), "全部工序/物料");
}

function priceMatchesFilters(item) {
  const keyword = $("#price-search").value.trim().toLowerCase();
  const vendorFilter = $("#price-filter-vendor").value;
  const itemFilter = $("#price-filter-item").value;
  const dateFrom = $("#price-filter-date-from").value;
  const dateTo = $("#price-filter-date-to").value;
  const relatedFilter = $("#price-filter-related").value;
  const relatedPlans = plansForPrice(item);
  const drawingNos = item.drawingNo || relatedPlans.map(planDrawingNo).join("、");
  const names = item.name || relatedPlans.map(planName).join("、");

  if (
    keyword &&
    ![item.vendor, item.item, item.unit, item.price, item.effectiveDate, item.taxRate, item.negotiationNo, item.priceSheetNo, drawingNos, names].some((value) =>
      String(value || "").toLowerCase().includes(keyword),
    )
  ) {
    return false;
  }
  if (vendorFilter && item.vendor !== vendorFilter) return false;
  if (itemFilter && item.item !== itemFilter) return false;
  if (dateFrom && String(item.effectiveDate || "") < dateFrom) return false;
  if (dateTo && String(item.effectiveDate || "") > dateTo) return false;
  if (relatedFilter === "related" && relatedPlans.length === 0) return false;
  if (relatedFilter === "unrelated" && relatedPlans.length > 0) return false;
  return true;
}

function pricePayload(data) {
  return {
    ...data,
    drawingNo: String(data.drawingNo || "").trim(),
    name: String(data.name || "").trim(),
    price: Number(data.price),
    taxRate: Number(data.taxRate || 0),
  };
}

function resetPriceEdit() {
  editingPriceId = null;
  $("#price-edit-panel").hidden = true;
  resetForm($("#price-edit-form"));
}

function startPriceEdit(id) {
  const item = state.prices.find((price) => price.id === id);
  if (!item) return;
  $("#price-create-panel").hidden = true;
  editingPriceId = id;
  const form = $("#price-edit-form");
  form.elements.drawingNo.value = item.drawingNo || "";
  form.elements.name.value = item.name || "";
  form.elements.vendor.value = item.vendor || "";
  form.elements.item.value = item.item || "";
  form.elements.unit.value = item.unit || "";
  form.elements.price.value = item.price || 0;
  form.elements.effectiveDate.value = item.effectiveDate || today();
  form.elements.taxRate.value = item.taxRate || 0;
  form.elements.negotiationNo.value = item.negotiationNo || "";
  form.elements.priceSheetNo.value = item.priceSheetNo || "";
  $("#price-edit-panel").hidden = false;
  switchView("prices");
  form.elements.drawingNo.focus();
}

function contractPayload(data) {
  const contractItems = parseContractItems(data.contractItemsText || data.project);
  const project = contractItems.map((item) => item.label).join("、");
  const { contractItemsText, ...rest } = data;
  return {
    ...rest,
    project,
    contractItems,
    amount: Number(data.amount),
  };
}

function parseContractItems(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((label) => ({ label }));
}

function contractItemsSummary(contract) {
  if (Array.isArray(contract.contractItems) && contract.contractItems.length > 0) {
    return contract.contractItems.map((item) => item.label || "").filter(Boolean).join("、");
  }
  return String(contract.project || "");
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

function accountItemKeys() {
  const keys = new Set();
  state.accounts.forEach((account) => {
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
  if (contract.status === "异常" || contract.status === "草拟中") return contract.status;
  const items = Array.isArray(contract.contractItems) && contract.contractItems.length > 0 ? contract.contractItems : parseContractItems(contract.project);
  if (items.length === 0) return "履行中";
  const accountKeys = accountItemKeys();
  return items.every((item) => accountKeys.has(contractItemKey(item))) ? "已完成" : "履行中";
}

function parseContractItemParts(label) {
  const parts = String(label || "").split(/\s*\/\s*/).map((s) => s.trim()).filter(Boolean);
  const hasTaskNo = /^TASK-\d+$/i.test(parts[0] || "");
  const offset = hasTaskNo ? 1 : 0;
  return {
    seq: hasTaskNo ? parts[0] : "",
    drawingNo: parts[offset] || "",
    name: parts[offset + 1] || "",
    process: parts[offset + 2] || "",
    quantityUnit: parts[offset + 3] || "",
    unitPrice: parts[offset + 4] || "",
    amount: parts[offset + 5] || "",
    note: parts.slice(offset + 6).join(" / ") || "",
  };
}

function resetContractEdit() {
  editingContractId = null;
  $("#contract-edit-panel").hidden = true;
  resetForm($("#contract-edit-form"));
}

function startContractEdit(id) {
  const item = state.contracts.find((contract) => contract.id === id);
  if (!item) return;
  $("#contract-create-panel").hidden = true;
  editingContractId = id;
  const form = $("#contract-edit-form");
  form.elements.contractNo.value = item.contractNo || "";
  form.elements.vendor.value = item.vendor || "";
  form.elements.contractItemsText.value = contractItemsText(item);
  form.elements.amount.value = item.amount || 0;
  form.elements.signDate.value = item.signDate || today();
  form.elements.status.value = item.status || "草拟中";
  form.elements.note.value = item.note || "";
  $("#contract-edit-panel").hidden = false;
  switchView("contracts");
  form.elements.contractNo.focus();
}

function resetNegotiationEdit() {
  editingNegotiationId = null;
  $("#negotiation-edit-panel").hidden = true;
  resetForm($("#negotiation-edit-form"));
}

function startNegotiationEdit(id) {
  const item = state.negotiations.find((negotiation) => negotiation.id === id);
  if (!item) return;
  $("#negotiation-create-panel").hidden = true;
  editingNegotiationId = id;
  const form = $("#negotiation-edit-form");
  form.elements.meetingDate.value = item.meetingDate || today();
  form.elements.negotiationNo.value = item.negotiationNo || "";
  form.elements.vendor.value = item.vendor || "";
  form.elements.negotiationItemsText.value = negotiationItemsText(item);
  form.elements.followUpDate.value = item.followUpDate || "";
  $("#negotiation-edit-panel").hidden = false;
  switchView("negotiations");
  form.elements.meetingDate.focus();
}

function resetAccountEdit() {
  editingAccountId = null;
  $("#account-edit-panel").hidden = true;
  resetForm($("#account-edit-form"));
}

function startAccountEdit(id) {
  const item = state.accounts.find((account) => account.id === id);
  if (!item) return;
  $("#account-create-panel").hidden = true;
  editingAccountId = id;
  const form = $("#account-edit-form");
  form.elements.vendor.value = item.vendor || "";
  form.elements.accountItemsText.value = accountItemsText(item);
  form.elements.amount.value = item.amount || 0;
  form.elements.accountDate.value = item.accountDate || today();
  form.elements.dueDate.value = item.dueDate || today();
  form.elements.payStatus.value = item.payStatus || "未付款";
  form.elements.voucher.value = item.voucher || "";
  $("#account-edit-panel").hidden = false;
  switchView("accounts");
  form.elements.vendor.focus();
}

function renderTasks() {
  renderTaskVendorOptions();
  renderTaskFilterOptions();
  const vendor = selectedTaskVendor();
  const rows = filteredTaskRows();
  selectedTaskIds = new Set([...selectedTaskIds].filter((id) => state.plans.some((plan) => plan.id === id)));

  const checkAll = $("#task-check-all");
  if (checkAll) {
    checkAll.checked = rows.length > 0 && rows.every((plan) => selectedTaskIds.has(plan.id));
    checkAll.indeterminate = rows.some((plan) => selectedTaskIds.has(plan.id)) && !checkAll.checked;
  }

  $("#tasks-table").innerHTML =
    rows.length === 0
      ? renderEmpty(14, "暂无任务")
      : rows
          .map((plan) => {
            const price = findTaskPrice(plan, vendor);
            const amount = taskAmount(plan, vendor);
            const contract = findPlanContract(plan);
            const progressStatus = taskProgressStatus(plan);
            const overdueBadge = isOverdue(plan.dueDate, progressStatus === "已完成" || progressStatus === "已交付")
              ? ` ${statusBadge("逾期")}`
              : "";
            return `<tr>
              <td><input class="task-check" data-task-id="${plan.id}" type="checkbox" ${
                selectedTaskIds.has(plan.id) ? "checked" : ""
              } /></td>
              <td>${escapeHtml(planTaskNo(plan))}</td>
              <td>${escapeHtml(planDrawingNo(plan))}</td>
              <td>${escapeHtml(planName(plan))}</td>
              <td>${escapeHtml(plan.vendor)}</td>
              <td>${escapeHtml(plan.process)}</td>
              <td>${plan.quantity}</td>
              <td>${escapeHtml(plan.dueDate)}</td>
              <td>${statusBadge(progressStatus)}${overdueBadge}</td>
              <td>${price ? statusBadge("已有价格") : statusBadge("缺少价格", today())}</td>
              <td>${contract ? statusBadge("已签合同") : statusBadge("未签合同")}</td>
              <td>${contract ? escapeHtml(contract.contractNo) : "-"}</td>
              <td>${price ? money(price.price) : "-"}</td>
              <td>${amount === null ? "-" : money(amount)}</td>
            </tr>`;
          })
          .join("");
}

function renderPrices() {
  renderPriceFilterOptions();
  const rows = state.prices.filter(priceMatchesFilters);
  $("#prices-table").innerHTML =
    rows.length === 0
      ? renderEmpty(11, "暂无价格")
      : rows
          .map((item) => {
            const relatedPlans = plansForPrice(item);
            const drawingNos = item.drawingNo || uniqueValues(relatedPlans.map(planDrawingNo)).join("、") || "-";
            const names = item.name || uniqueValues(relatedPlans.map(planName)).join("、") || "-";
            return `<tr>
              <td>${escapeHtml(item.vendor)}</td>
              <td>${escapeHtml(drawingNos)}</td>
              <td>${escapeHtml(names)}</td>
              <td>${escapeHtml(item.item)}</td>
              <td>${escapeHtml(item.unit)}</td>
              <td>${money(item.price)}</td>
              <td>${escapeHtml(item.effectiveDate)}</td>
              <td>${item.taxRate || 0}%</td>
              <td>${escapeHtml(item.negotiationNo || "-")}</td>
              <td>${escapeHtml(item.priceSheetNo || "-")}</td>
              <td>
                <button class="ghost-button" data-edit-price="${item.id}" type="button">修改</button>
                <button class="danger-button" data-delete="prices" data-id="${item.id}" type="button">删除</button>
              </td>
            </tr>`;
          })
          .join("");
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
  const header = ["外协方", "图号", "名称", "工序/物料", "单位", "单价", "生效日期", "税率", "谈判纪要编号", "价格单号"];
  const data = rows.map((item) => {
    const relatedPlans = plansForPrice(item);
    const drawingNos = item.drawingNo || uniqueValues(relatedPlans.map(planDrawingNo)).join("、") || "";
    const names = item.name || uniqueValues(relatedPlans.map(planName)).join("、") || "";
    return [
      item.vendor || "",
      drawingNos,
      names,
      item.item || "",
      item.unit || "",
      Number(item.price || 0),
      item.effectiveDate || "",
      (item.taxRate || 0) + "%",
      item.negotiationNo || "",
      item.priceSheetNo || "",
    ];
  });
  const sheet = XLSX.utils.aoa_to_sheet([header, ...data]);
  sheet["!cols"] = header.map(() => ({ wch: 20 }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "价格库");
  XLSX.writeFile(workbook, `价格库_${today().replaceAll("-", "")}.xlsx`);
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

function renderProgress() {
  renderProgressSelect();
  $("#progress-table").innerHTML =
    state.progress.length === 0
      ? renderEmpty(8, "暂无进度")
      : [...state.progress]
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
              <td><button class="danger-button" data-delete="progress" data-id="${item.id}" type="button">删除</button></td>
            </tr>`;
          })
          .join("");
}

function renderContracts() {
  const keyword = $("#contract-search").value.trim().toLowerCase();
  const rows = state.contracts.filter((item) =>
    [item.contractNo, item.vendor, contractItemsSummary(item)].some((value) => String(value || "").toLowerCase().includes(keyword)),
  );
  $("#contracts-table").innerHTML =
    rows.length === 0
      ? renderEmpty(8, "暂无合同")
      : rows
          .map((item) => {
            const items = Array.isArray(item.contractItems) && item.contractItems.length > 0 ? item.contractItems : [];
            const hasItems = items.length > 0;
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
                    return `<tr>
                      <td>${idx + 1}</td>
                      <td>${escapeHtml(parts.drawingNo)}</td>
                      <td>${escapeHtml(parts.name)}</td>
                      <td>${escapeHtml(parts.process)}</td>
                      <td>${escapeHtml(parts.quantityUnit)}</td>
                      <td>${priceInfo.unitPrice ? money(priceInfo.unitPrice) : "-"}</td>
                      <td>${priceInfo.amount ? money(priceInfo.amount) : "-"}</td>
                      <td>${escapeHtml(parts.note || "-")}</td>
                    </tr>`;
                  })
                  .join("")
              : `<tr><td colspan="8" class="empty">暂无标的物明细</td></tr>`;

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
              <td>${statusBadge(contractAutoStatus(item))}</td>
              <td>
                <button class="ghost-button" data-edit-contract="${item.id}" type="button">修改</button>
                <button class="danger-button" data-delete="contracts" data-id="${item.id}" type="button">删除</button>
              </td>
            </tr>
            <tr class="contract-sub-row" id="contract-sub-${item.id}" hidden>
              <td colspan="8">
                <table class="contract-sub-table">
                  <thead>
                    <tr>
                      <th>序号</th>
                      <th>图号</th>
                      <th>名称</th>
                      <th>工序/规格</th>
                      <th>数量/单位</th>
                      <th>单价</th>
                      <th>金额</th>
                      <th>备注</th>
                    </tr>
                  </thead>
                  <tbody>${subRows}</tbody>
                </table>
              </td>
            </tr>`;
          })
          .join("");
}

function renderNegotiations() {
  const keyword = $("#negotiation-search").value.trim().toLowerCase();
  const rows = state.negotiations.filter((item) =>
    [item.negotiationNo, item.vendor, negotiationItemsSummary(item)].some((value) =>
      String(value || "").toLowerCase().includes(keyword),
    ),
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
                    </tr>`;
                  })
                  .join("")
              : `<tr><td colspan="3" class="empty">暂无图号名称明细</td></tr>`;

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

function renderAccounts() {
  const keyword = $("#account-search").value.trim().toLowerCase();
  const rows = state.accounts.filter((item) =>
    [item.vendor, accountItemsSummary(item), item.voucher].some((value) => String(value || "").toLowerCase().includes(keyword)),
  );
  $("#accounts-table").innerHTML =
    rows.length === 0
      ? renderEmpty(7, "暂无挂账")
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
              <td>${statusBadge(item.payStatus, item.dueDate)}</td>
              <td>
                <button class="ghost-button" data-edit-account="${item.id}" type="button">修改</button>
                <button class="danger-button" data-delete="accounts" data-id="${item.id}" type="button">删除</button>
              </td>
            </tr>
            <tr class="contract-sub-row" id="account-sub-${item.id}" hidden>
              <td colspan="7">
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

function renderAll() {
  renderDashboard();
  renderPlans();
  renderTasks();
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

function updateRecord(collection, id, data) {
  state[collection] = state[collection].map((item) => (item.id === id ? { ...item, ...data } : item));
  saveState();
  renderAll();
}

function assertSelectedTasksHavePrices(tasks, vendor) {
  const missing = tasks.filter((plan) => !findTaskPrice(plan, vendor));
  if (missing.length > 0) {
    alert(`有 ${missing.length} 个任务缺少该厂家的价格，请先维护价格后再操作。`);
    return false;
  }
  return true;
}

function createContractFromSelectedTasks() {
  const tasks = selectedTasks();
  const vendor = selectedTaskVendor();
  if (tasks.length === 0) {
    alert("请先选择任务。");
    return;
  }
  if (!vendor) {
    alert("请先选择厂家。");
    return;
  }
  if (!assertSelectedTasksHavePrices(tasks, vendor)) return;

  const amount = tasks.reduce((sum, plan) => sum + taskAmount(plan, vendor), 0);
  const contractNo = $("#task-contract-no").value.trim() || `WX-${today().replaceAll("-", "")}-${Date.now().toString().slice(-4)}`;
  const signDate = $("#task-sign-date").value || today();
  const project = tasks.map((plan) => planLabel(plan)).join("、");
  const note = tasks.map((plan) => `${planTaskNo(plan)}/${planLabel(plan)}/${plan.process}/${plan.quantity}`).join("；");

  addRecord("contracts", {
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
  selectedTaskIds.clear();
  renderAll();
  switchView("contracts");
}

function createAccountFromSelectedTasks() {
  const tasks = selectedTasks();
  const vendor = selectedTaskVendor();
  if (tasks.length === 0) {
    alert("请先选择任务。");
    return;
  }
  if (!vendor) {
    alert("请先选择厂家。");
    return;
  }
  if (!assertSelectedTasksHavePrices(tasks, vendor)) return;

  const amount = tasks.reduce((sum, plan) => sum + taskAmount(plan, vendor), 0);
  const project = tasks.map((plan) => planLabel(plan)).join("、");
  const taskDueDates = tasks.map((plan) => plan.dueDate).sort();
  const dueDate = $("#task-account-due-date").value || taskDueDates[taskDueDates.length - 1] || today();

  addRecord("accounts", {
    vendor,
    project,
    accountItems: tasks.map((plan) => ({
      label: `${planDrawingNo(plan)} / ${planName(plan)}`,
      taskNo: planTaskNo(plan),
      drawingNo: planDrawingNo(plan),
      name: planName(plan),
    })),
    amount,
    accountDate: today(),
    dueDate,
    payStatus: "未付款",
    voucher: "外协任务汇总一键挂账",
  });
  selectedTaskIds.clear();
  renderAll();
  switchView("accounts");
}

function deleteRecord(collection, id) {
  state[collection] = state[collection].filter((item) => item.id !== id);
  if (collection === "plans") {
    selectedTaskIds.delete(id);
    state.progress = state.progress.filter((item) => item.planId !== id);
  }
  saveState();
  renderAll();
}

function setupForms() {
  $("#plan-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = formData(event.currentTarget);
    addRecord("plans", normalizePlan({ ...data, taskNo: nextTaskNo(), quantity: Number(data.quantity) }));
    resetForm(event.currentTarget);
  });

  $("#price-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = formData(event.currentTarget);
    addRecord("prices", pricePayload(data));
    resetForm(event.currentTarget);
    $("#price-create-panel").hidden = true;
  });

  $("#price-edit-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!editingPriceId) return;
    const data = formData(event.currentTarget);
    const original = state.prices.find((price) => price.id === editingPriceId);
    data.item = original ? original.item : data.item;
    updateRecord("prices", editingPriceId, pricePayload(data));
    resetPriceEdit();
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
    addRecord("contracts", contractPayload(data));
    resetForm(event.currentTarget);
    $("#contract-create-panel").hidden = true;
  });

  $("#contract-edit-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!editingContractId) return;
    const data = formData(event.currentTarget);
    updateRecord("contracts", editingContractId, contractPayload(data));
    resetContractEdit();
  });

  $("#negotiation-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = formData(event.currentTarget);
    addRecord("negotiations", negotiationPayload(data));
    resetForm(event.currentTarget);
    $("#negotiation-create-panel").hidden = true;
  });

  $("#negotiation-edit-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!editingNegotiationId) return;
    const data = formData(event.currentTarget);
    updateRecord("negotiations", editingNegotiationId, negotiationPayload(data));
    resetNegotiationEdit();
  });

  $("#account-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = formData(event.currentTarget);
    addRecord("accounts", accountPayload(data));
    resetForm(event.currentTarget);
    $("#account-create-panel").hidden = true;
  });

  $("#account-edit-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!editingAccountId) return;
    const data = formData(event.currentTarget);
    updateRecord("accounts", editingAccountId, accountPayload(data));
    resetAccountEdit();
  });
}

async function importContractItemsExcel(file, targetName) {
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
  const indexOf = (...names) => headers.findIndex((header) => names.includes(header));
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
      if (columns.process >= 0) parts.push(String(row[columns.process] || "").trim());
      if (columns.unit >= 0) {
        const unit = String(row[columns.unit] || "").trim();
        const qty = columns.quantity >= 0 ? Number(row[columns.quantity] || 0) : 0;
        if (unit && qty) parts.push(`${qty}${unit}`);
        else if (unit) parts.push(unit);
        else if (qty) parts.push(String(qty));
      }
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

  const form = document.querySelector(`[name="${targetName}"]`);
  if (form) {
    form.value = form.value.trim() ? form.value.trim() + "\n" + lines.join("\n") : lines.join("\n");
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
  const indexOf = (...names) => headers.findIndex((header) => names.includes(header));
  const columns = {
    drawingNo: indexOf("图号", "项目图号", "零件图号"),
    name: indexOf("名称", "零件名称", "项目名称"),
    project: indexOf("项目名称"),
    vendor: indexOf("外协方"),
    process: indexOf("工序/内容", "工序", "内容"),
    quantity: indexOf("数量"),
    dueDate: indexOf("计划交期", "交期"),
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
  switchView("plans");
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
    unit: indexOf("单位"),
    price: indexOf("单价", "价格"),
    effectiveDate: indexOf("生效日期", "生效日"),
    taxRate: indexOf("税率"),
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
        unit: String(row[columns.unit] || "").trim(),
        price: Number(row[columns.price] || 0),
        effectiveDate: excelDateToIso(row[columns.effectiveDate]),
        taxRate: columns.taxRate >= 0 ? Number(row[columns.taxRate] || 0) : 0,
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
  $$(".nav-item").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });

  ["#plan-search", "#price-search", "#contract-search", "#negotiation-search", "#account-search"].forEach((selector) => {
    $(selector).addEventListener("input", renderAll);
  });
  ["#price-filter-vendor", "#price-filter-item", "#price-filter-date-from", "#price-filter-date-to", "#price-filter-related"].forEach(
    (selector) => {
      $(selector).addEventListener("change", renderAll);
    },
  );
  $("#clear-price-filters").addEventListener("click", () => {
    $("#price-search").value = "";
    $("#price-filter-vendor").value = "";
    $("#price-filter-item").value = "";
    $("#price-filter-date-from").value = "";
    $("#price-filter-date-to").value = "";
    $("#price-filter-related").value = "";
    renderAll();
  });
  $("#task-search").addEventListener("input", renderAll);
  $("#task-vendor-select").addEventListener("change", renderAll);
  ["#task-filter-vendor", "#task-filter-progress", "#task-filter-price", "#task-filter-contract"].forEach((selector) => {
    $(selector).addEventListener("change", renderAll);
  });
  $("#clear-task-filters").addEventListener("click", () => {
    $("#task-search").value = "";
    $("#task-filter-vendor").value = "";
    $("#task-filter-progress").value = "";
    $("#task-filter-price").value = "";
    $("#task-filter-contract").value = "";
    renderAll();
  });
  $("#cancel-price-edit").addEventListener("click", resetPriceEdit);
  $("#cancel-contract-edit").addEventListener("click", resetContractEdit);
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
    resetContractEdit();
    $("#contract-create-panel").hidden = false;
    $("#contract-form").elements.contractNo.focus();
  });
  $("#contract-cancel-button").addEventListener("click", () => {
    $("#contract-create-panel").hidden = true;
    resetForm($("#contract-form"));
  });
  $("#negotiation-toggle-button").addEventListener("click", () => {
    resetNegotiationEdit();
    $("#negotiation-create-panel").hidden = false;
    $("#negotiation-form").elements.meetingDate.focus();
  });
  $("#negotiation-cancel-button").addEventListener("click", () => {
    $("#negotiation-create-panel").hidden = true;
    resetForm($("#negotiation-form"));
  });
  $("#cancel-negotiation-edit").addEventListener("click", resetNegotiationEdit);
  $("#account-toggle-button").addEventListener("click", () => {
    resetAccountEdit();
    $("#account-create-panel").hidden = false;
    $("#account-form").elements.vendor.focus();
  });
  $("#account-cancel-button").addEventListener("click", () => {
    $("#account-create-panel").hidden = true;
    resetForm($("#account-form"));
  });
  $("#cancel-account-edit").addEventListener("click", resetAccountEdit);
  $("#task-check-all").addEventListener("change", (event) => {
    filteredTaskRows().forEach((plan) => {
      if (event.target.checked) selectedTaskIds.add(plan.id);
      else selectedTaskIds.delete(plan.id);
    });
    renderAll();
  });
  $("#select-all-tasks").addEventListener("click", () => {
    filteredTaskRows().forEach((plan) => selectedTaskIds.add(plan.id));
    renderAll();
  });
  $("#clear-task-selection").addEventListener("click", () => {
    selectedTaskIds.clear();
    renderAll();
  });
  $("#create-contract-from-tasks").addEventListener("click", createContractFromSelectedTasks);
  $("#create-account-from-tasks").addEventListener("click", createAccountFromSelectedTasks);

  document.body.addEventListener("click", (event) => {
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
    const editAccountButton = event.target.closest("[data-edit-account]");
    if (editAccountButton) {
      startAccountEdit(editAccountButton.dataset.editAccount);
      return;
    }
    const button = event.target.closest("[data-delete]");
    if (!button) return;
    if (button.dataset.delete === "prices" && button.dataset.id === editingPriceId) {
      resetPriceEdit();
    }
    if (button.dataset.delete === "contracts" && button.dataset.id === editingContractId) {
      resetContractEdit();
    }
    if (button.dataset.delete === "negotiations" && button.dataset.id === editingNegotiationId) {
      resetNegotiationEdit();
    }
    if (button.dataset.delete === "accounts" && button.dataset.id === editingAccountId) {
      resetAccountEdit();
    }
    deleteRecord(button.dataset.delete, button.dataset.id);
  });
  document.body.addEventListener("change", (event) => {
    const checkbox = event.target.closest(".task-check");
    if (!checkbox) return;
    if (checkbox.checked) selectedTaskIds.add(checkbox.dataset.taskId);
    else selectedTaskIds.delete(checkbox.dataset.taskId);
    renderAll();
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
  $("#contract-items-excel-import").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (file) {
      try {
        await importContractItemsExcel(file, "contractItemsText");
      } catch (error) {
        alert(`导入失败：${error.message}`);
      }
    }
    event.target.value = "";
  });
  $("#contract-edit-items-excel-import").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (file) {
      try {
        await importContractItemsExcel(file, "contractItemsText");
      } catch (error) {
        alert(`导入失败：${error.message}`);
      }
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
