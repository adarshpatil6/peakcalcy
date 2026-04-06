const STORAGE_KEY = "peakcalcy-sheet-v1";

const FUND_LABELS = {
  available_margin: ["Available margin", "Available Margin", "Net available margin"],
  used_margin: ["Used margin", "Used Margin", "Margin used"],
  available_cash: ["Available cash", "Available Cash", "Cash available"],
  opening_balance: ["Opening balance", "Opening Balance"],
  collateral: ["Total collateral", "Collateral", "Available collateral"],
  span: ["SPAN", "Span"],
  exposure: ["Exposure", "Exposure margin"],
  option_premium: ["Options premium", "Option premium", "Premium"],
  delivery_margin: ["Delivery margin", "Delivery"],
  payin: ["Payin", "Pay in"],
  payout: ["Payout", "Pay out"],
};

const FIELD_TITLES = {
  available_margin: "Available Margin",
  used_margin: "Used Margin",
  available_cash: "Available Cash",
  opening_balance: "Opening Balance",
  collateral: "Collateral",
  span: "SPAN",
  exposure: "Exposure",
  option_premium: "Option Premium",
  delivery_margin: "Delivery Margin",
  payin: "Payin",
  payout: "Payout",
};

const state = {
  activeTab: "funds",
  fundsResult: null,
  scratchpadRows: [],
};

const elements = {
  tabButtons: Array.from(document.querySelectorAll(".tab-button")),
  tabPanels: Array.from(document.querySelectorAll(".tab-panel")),
  fundsInput: document.getElementById("funds-input"),
  ignoreOptionPremium: document.getElementById("ignore-option-premium"),
  includeDeliveryMargin: document.getElementById("include-delivery-margin"),
  parseFundsButton: document.getElementById("parse-funds-button"),
  resetFundsButton: document.getElementById("reset-funds-button"),
  fundsMetrics: document.getElementById("funds-metrics"),
  fundsStatus: document.getElementById("funds-status"),
  fundsProof: document.getElementById("funds-proof"),
  fundsDetailsTable: document.getElementById("funds-details-table").querySelector("tbody"),
  addScratchpadRowButton: document.getElementById("add-scratchpad-row-button"),
  clearScratchpadButton: document.getElementById("clear-scratchpad-button"),
  downloadScratchpadButton: document.getElementById("download-scratchpad-button"),
  scratchpadTotal: document.getElementById("scratchpad-total"),
  scratchpadSheetBody: document.getElementById("scratchpad-sheet-body"),
};


function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}


function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}


function safeNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}


function formatMoney(value) {
  const numeric = safeNumber(value);
  return `Rs. ${numeric.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}


function formatPercent(value) {
  return `${safeNumber(value).toFixed(2)}%`;
}


function normaliseAmount(rawValue) {
  return safeNumber(String(rawValue).replaceAll(",", "").trim());
}


function hasMatch(matchedLabel) {
  return matchedLabel && matchedLabel !== "Not found";
}


function createScratchpadRow(label = "", formula = "") {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    label,
    formula,
  };
}


function createScratchpadRows(count = 6) {
  return Array.from({ length: count }, () => createScratchpadRow());
}


function storagePayload() {
  return {
    activeTab: state.activeTab,
    fundsInput: elements.fundsInput.value,
    ignoreOptionPremium: elements.ignoreOptionPremium.checked,
    includeDeliveryMargin: elements.includeDeliveryMargin.checked,
    fundsResult: state.fundsResult,
    scratchpadRows: state.scratchpadRows,
  };
}


function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(storagePayload()));
}


function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      state.scratchpadRows = createScratchpadRows();
      return;
    }

    const parsed = JSON.parse(raw);
    elements.fundsInput.value = parsed.fundsInput || "";
    elements.ignoreOptionPremium.checked = Boolean(parsed.ignoreOptionPremium);
    elements.includeDeliveryMargin.checked = Boolean(parsed.includeDeliveryMargin);
    state.fundsResult = parsed.fundsResult || null;
    state.activeTab = parsed.activeTab || "funds";
    state.scratchpadRows = Array.isArray(parsed.scratchpadRows) && parsed.scratchpadRows.length
      ? parsed.scratchpadRows
      : createScratchpadRows();
  } catch (error) {
    console.warn("Could not restore saved state.", error);
    state.scratchpadRows = createScratchpadRows();
  }
}


function renderMetricCards(container, metrics) {
  if (!metrics.length) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = metrics
    .map(
      (metric) => `
        <article class="metric-card">
          <div class="metric-label">${escapeHtml(metric.label)}</div>
          <div class="metric-value">${escapeHtml(metric.value)}</div>
          <div class="metric-delta">${escapeHtml(metric.delta || "")}</div>
        </article>
      `
    )
    .join("");
}


function renderStatusBox(container, kind, title, value, copyText) {
  container.innerHTML = `
    <div class="status-box ${kind}">
      <div class="status-title">${escapeHtml(title)}</div>
      <div class="status-value">${escapeHtml(value)}</div>
      <div class="status-copy">${escapeHtml(copyText)}</div>
    </div>
  `;
}


function extractLabelValue(text, aliases) {
  for (const alias of aliases) {
    const escapedAlias = escapeRegex(alias);
    const patterns = [
      new RegExp(`${escapedAlias}\\s*(?::|=|is)?\\s*(?:rs\\.?|inr)?\\s*([+-]?(?:\\d[\\d,]*)(?:\\.\\d+)?)`, "i"),
      new RegExp(`${escapedAlias}\\s*(?:rs\\.?|inr)?\\s*\\n\\s*([+-]?(?:\\d[\\d,]*)(?:\\.\\d+)?)`, "i"),
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        return {
          value: normaliseAmount(match[1]),
          matchedLabel: alias,
        };
      }
    }
  }
  return { value: 0, matchedLabel: "Not found" };
}


function parseFundsSummary(text, ignoreOptionPremium, includeDeliveryMargin) {
  const inputs = {};
  const sources = {};

  for (const [fieldName, aliases] of Object.entries(FUND_LABELS)) {
    const result = extractLabelValue(text, aliases);
    inputs[fieldName] = result.value;
    sources[fieldName] = result.matchedLabel;
  }

  const hasAvailableMargin = hasMatch(sources.available_margin);
  const hasUsedMargin = hasMatch(sources.used_margin);
  const hasAvailableCash = hasMatch(sources.available_cash);
  const hasOpeningBalance = hasMatch(sources.opening_balance);

  const baseCash = hasOpeningBalance
    ? inputs.opening_balance
    : hasAvailableCash
      ? inputs.available_cash
      : 0;
  const cashAfterTransfers = baseCash + inputs.payin - inputs.payout;
  const optionComponent = ignoreOptionPremium ? 0 : Math.max(inputs.option_premium, 0);
  const deliveryComponent = includeDeliveryMargin ? inputs.delivery_margin : 0;
  const componentRequired = inputs.span + inputs.exposure + optionComponent + deliveryComponent;
  const directRequired = hasUsedMargin ? inputs.used_margin : 0;
  const totalRequired = Math.max(componentRequired, directRequired);
  const totalAvailable = hasAvailableMargin
    ? inputs.available_margin + totalRequired
    : cashAfterTransfers + inputs.collateral;
  const netAvailable = hasAvailableMargin
    ? inputs.available_margin
    : totalAvailable - totalRequired;
  const shortfall = netAvailable < 0 ? Math.abs(netAvailable) : 0;
  const freeBuffer = Math.max(netAvailable, 0);
  const utilizationPct = totalAvailable > 0 ? (totalRequired / totalAvailable) * 100 : 0;

  const details = Object.entries(FIELD_TITLES).map(([key, label]) => ({
    field: label,
    value: inputs[key],
    matchedLabel: sources[key],
  }));

  return {
    inputs,
    details,
    cashAfterTransfers,
    totalAvailable,
    netAvailable,
    totalRequired,
    netBuffer: netAvailable,
    shortfall,
    freeBuffer,
    utilizationPct,
    optionComponent,
    deliveryComponent,
    componentRequired,
    directRequired,
    hasAvailableMargin,
    hasUsedMargin,
  };
}


function renderFundsOutput() {
  if (!state.fundsResult) {
    elements.fundsMetrics.innerHTML = "";
    elements.fundsStatus.innerHTML = "";
    elements.fundsProof.textContent = "Run the parser to generate a breakdown.";
    elements.fundsProof.classList.add("empty-state");
    elements.fundsDetailsTable.innerHTML = `<tr><td colspan="3" class="empty-cell">No parsed data yet.</td></tr>`;
    saveState();
    return;
  }

  const result = state.fundsResult;
  const freePct = result.totalAvailable > 0 ? Math.max(100 - result.utilizationPct, 0) : 0;

  renderMetricCards(elements.fundsMetrics, [
    {
      label: "Available",
      value: formatMoney(result.netAvailable),
      delta: result.hasAvailableMargin ? "Direct available margin" : "Free amount after required usage",
    },
    {
      label: "Required",
      value: formatMoney(result.totalRequired),
      delta: result.hasUsedMargin ? "Used margin or component burden" : "SPAN plus exposure and optional burden",
    },
    {
      label: "Capacity",
      value: formatMoney(result.totalAvailable),
      delta: "Available plus required",
    },
    { label: "Utilization", value: formatPercent(result.utilizationPct), delta: `${freePct.toFixed(2)}% free headroom` },
  ]);

  if (result.shortfall > 0) {
    renderStatusBox(
      elements.fundsStatus,
      "shortfall",
      "Shortfall",
      formatMoney(result.shortfall),
      "Net available margin is below zero in this snapshot."
    );
  } else {
    renderStatusBox(
      elements.fundsStatus,
      "safe",
      "Buffer",
      formatMoney(result.freeBuffer),
      "Net available margin is positive in this snapshot."
    );
  }

  elements.fundsProof.classList.remove("empty-state");
  elements.fundsProof.textContent = [
    `NET AVAILABLE MARGIN    : ${formatMoney(result.netAvailable)}`,
    `TOTAL USED MARGIN       : ${formatMoney(result.totalRequired)}`,
    `TOTAL CAPACITY          : ${formatMoney(result.totalAvailable)}`,
    "",
    `CASH AFTER PAYIN/PAYOUT : ${formatMoney(result.cashAfterTransfers)}`,
    `COLLATERAL              : ${formatMoney(result.inputs.collateral)}`,
    `AVAILABLE CASH          : ${formatMoney(result.inputs.available_cash)}`,
    `OPENING BALANCE         : ${formatMoney(result.inputs.opening_balance)}`,
    "",
    `SPAN                    : ${formatMoney(result.inputs.span)}`,
    `EXPOSURE                : ${formatMoney(result.inputs.exposure)}`,
    `OPTION PREMIUM USED     : ${formatMoney(result.optionComponent)}`,
    `DELIVERY MARGIN USED    : ${formatMoney(result.deliveryComponent)}`,
    `COMPONENT REQUIRED      : ${formatMoney(result.componentRequired)}`,
    `DIRECT USED MARGIN      : ${formatMoney(result.directRequired)}`,
    "",
    `NET BUFFER              : ${formatMoney(result.netAvailable)}`,
    `UTILIZATION             : ${formatPercent(result.utilizationPct)}`,
  ].join("\n");

  elements.fundsDetailsTable.innerHTML = result.details
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.field)}</td>
          <td>${escapeHtml(formatMoney(row.value))}</td>
          <td>${escapeHtml(row.matchedLabel)}</td>
        </tr>
      `
    )
    .join("");

  saveState();
}


function tokenize(expression) {
  const tokens = [];
  let index = 0;

  while (index < expression.length) {
    const char = expression[index];
    const next = expression[index + 1];

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (/\d|\./.test(char)) {
      let value = char;
      index += 1;
      while (index < expression.length && /[\d.]/.test(expression[index])) {
        value += expression[index];
        index += 1;
      }
      tokens.push({ type: "number", value: Number(value) });
      continue;
    }

    if (/[a-zA-Z_]/.test(char)) {
      let value = char;
      index += 1;
      while (index < expression.length && /[a-zA-Z0-9_]/.test(expression[index])) {
        value += expression[index];
        index += 1;
      }
      tokens.push({ type: "identifier", value });
      continue;
    }

    if (char === "*" && next === "*") {
      tokens.push({ type: "operator", value: "**" });
      index += 2;
      continue;
    }

    if (char === "/" && next === "/") {
      tokens.push({ type: "operator", value: "//" });
      index += 2;
      continue;
    }

    if ("+-*/%,()".includes(char)) {
      tokens.push({ type: "operator", value: char });
      index += 1;
      continue;
    }

    throw new Error(`Unexpected character: ${char}`);
  }

  return tokens;
}


function evaluateExpression(rawExpression) {
  const expression = rawExpression.trim().replace(/^=/, "").replaceAll(",", "");
  if (!expression) {
    return null;
  }

  const tokens = tokenize(expression);
  let position = 0;
  const constants = { pi: Math.PI, e: Math.E };
  const functions = {
    abs: (value) => Math.abs(value),
    round: (value, digits = 0) => {
      const factor = 10 ** digits;
      return Math.round(value * factor) / factor;
    },
    sqrt: (value) => Math.sqrt(value),
    ceil: (value) => Math.ceil(value),
    floor: (value) => Math.floor(value),
    min: (...values) => Math.min(...values),
    max: (...values) => Math.max(...values),
  };

  function peek() {
    return tokens[position];
  }

  function consume(expected) {
    const token = tokens[position];
    if (!token || (expected && token.value !== expected)) {
      throw new Error(`Expected ${expected || "token"}`);
    }
    position += 1;
    return token;
  }

  function parseExpression() {
    let value = parseTerm();
    while (peek() && (peek().value === "+" || peek().value === "-")) {
      const operator = consume().value;
      const right = parseTerm();
      value = operator === "+" ? value + right : value - right;
    }
    return value;
  }

  function parseTerm() {
    let value = parsePower();
    while (peek() && ["*", "/", "//", "%"].includes(peek().value)) {
      const operator = consume().value;
      const right = parsePower();
      if (operator === "*") {
        value *= right;
      } else if (operator === "/") {
        value /= right;
      } else if (operator === "//") {
        value = Math.floor(value / right);
      } else {
        value %= right;
      }
    }
    return value;
  }

  function parsePower() {
    let value = parseUnary();
    if (peek() && peek().value === "**") {
      consume("**");
      value = value ** parsePower();
    }
    return value;
  }

  function parseUnary() {
    if (peek() && peek().value === "+") {
      consume("+");
      return parseUnary();
    }
    if (peek() && peek().value === "-") {
      consume("-");
      return -parseUnary();
    }
    return parsePrimary();
  }

  function parsePrimary() {
    const token = peek();
    if (!token) {
      throw new Error("Incomplete formula.");
    }

    if (token.type === "number") {
      consume();
      return token.value;
    }

    if (token.type === "identifier") {
      consume();
      if (peek() && peek().value === "(") {
        consume("(");
        const args = [];
        if (peek() && peek().value !== ")") {
          args.push(parseExpression());
          while (peek() && peek().value === ",") {
            consume(",");
            args.push(parseExpression());
          }
        }
        consume(")");
        if (!functions[token.value]) {
          throw new Error(`Unsupported function: ${token.value}`);
        }
        return functions[token.value](...args);
      }
      if (!(token.value in constants)) {
        throw new Error(`Unknown identifier: ${token.value}`);
      }
      return constants[token.value];
    }

    if (token.value === "(") {
      consume("(");
      const value = parseExpression();
      consume(")");
      return value;
    }

    throw new Error("Unsupported formula.");
  }

  const result = parseExpression();
  if (position < tokens.length) {
    throw new Error("Unexpected extra input in formula.");
  }
  if (!Number.isFinite(result)) {
    throw new Error("Formula did not produce a finite result.");
  }
  return result;
}


function getScratchpadComputedRows() {
  return state.scratchpadRows.map((row) => {
    const formula = row.formula.trim();
    if (!formula) {
      return { ...row, result: "", numericResult: 0, error: "" };
    }

    try {
      const numericResult = evaluateExpression(formula);
      return {
        ...row,
        result: numericResult.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        numericResult,
        error: "",
      };
    } catch (error) {
      return { ...row, result: "", numericResult: 0, error: error.message || "Error" };
    }
  });
}


function focusScratchpadField(rowId, field) {
  requestAnimationFrame(() => {
    const selector = `input[data-row-id="${CSS.escape(rowId)}"][data-field="${field}"]`;
    const input = elements.scratchpadSheetBody.querySelector(selector);
    if (input) {
      input.focus();
      input.select();
    }
  });
}


function renderScratchpad() {
  if (!state.scratchpadRows.length) {
    state.scratchpadRows = createScratchpadRows();
  }

  const rows = getScratchpadComputedRows();
  const total = rows.reduce((sum, row) => sum + (row.error ? 0 : row.numericResult), 0);
  elements.scratchpadTotal.textContent = `Grand total: ${total.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  elements.scratchpadSheetBody.innerHTML = rows
    .map(
      (row, index) => `
        <tr data-row-id="${escapeHtml(row.id)}">
          <td class="sheet-row-number">${index + 1}</td>
          <td>
            <input
              class="sheet-input"
              type="text"
              value="${escapeHtml(row.label)}"
              placeholder="Optional"
              data-row-id="${escapeHtml(row.id)}"
              data-field="label"
            >
          </td>
          <td>
            <input
              class="sheet-input"
              type="text"
              value="${escapeHtml(row.formula)}"
              placeholder="=50000*1.05"
              data-row-id="${escapeHtml(row.id)}"
              data-field="formula"
            >
          </td>
          <td class="sheet-result ${row.error ? "error" : ""}">
            ${row.error ? escapeHtml(row.error) : escapeHtml(row.result || "")}
          </td>
          <td>
            <button class="sheet-remove-button" type="button" data-remove-row="${escapeHtml(row.id)}">Remove</button>
          </td>
        </tr>
      `
    )
    .join("");

  elements.scratchpadSheetBody.querySelectorAll("input[data-row-id]").forEach((input) => {
    input.addEventListener("input", (event) => {
      const rowId = event.target.dataset.rowId;
      const field = event.target.dataset.field;
      const targetRow = state.scratchpadRows.find((row) => row.id === rowId);
      if (!targetRow) {
        return;
      }
      targetRow[field] = event.target.value;
      renderScratchpad();
    });

    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") {
        return;
      }

      event.preventDefault();
      const rowId = event.target.dataset.rowId;
      const field = event.target.dataset.field;
      const rowIndex = state.scratchpadRows.findIndex((row) => row.id === rowId);
      if (rowIndex === -1) {
        return;
      }

      if (rowIndex === state.scratchpadRows.length - 1) {
        state.scratchpadRows.push(createScratchpadRow());
        renderScratchpad();
        focusScratchpadField(state.scratchpadRows[rowIndex + 1].id, field);
        return;
      }

      focusScratchpadField(state.scratchpadRows[rowIndex + 1].id, field);
    });
  });

  elements.scratchpadSheetBody.querySelectorAll("button[data-remove-row]").forEach((button) => {
    button.addEventListener("click", () => {
      const rowId = button.dataset.removeRow;
      state.scratchpadRows = state.scratchpadRows.filter((row) => row.id !== rowId);
      if (!state.scratchpadRows.length) {
        state.scratchpadRows = createScratchpadRows();
      }
      renderScratchpad();
    });
  });

  saveState();
}


function downloadScratchpadCsv() {
  const rows = getScratchpadComputedRows();
  const lines = ["Row,Label,Formula,Result"];
  rows.forEach((row, index) => {
    const values = [
      index + 1,
      row.label,
      row.formula,
      row.error ? row.error : row.result,
    ].map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`);
    lines.push(values.join(","));
  });

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "peakcalcy_sheet.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}


function activateTab(name) {
  state.activeTab = name;
  elements.tabButtons.forEach((button) => {
    const active = button.dataset.tabTarget === name;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });
  elements.tabPanels.forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.tabPanel === name);
  });
  saveState();
}


function bindEvents() {
  elements.tabButtons.forEach((button) => {
    button.addEventListener("click", () => activateTab(button.dataset.tabTarget));
  });

  elements.parseFundsButton.addEventListener("click", () => {
    const text = elements.fundsInput.value.trim();
    if (!text) {
      alert("Paste the Funds tab summary before calculating.");
      return;
    }
    state.fundsResult = parseFundsSummary(
      text,
      elements.ignoreOptionPremium.checked,
      elements.includeDeliveryMargin.checked
    );
    renderFundsOutput();
  });

  elements.resetFundsButton.addEventListener("click", () => {
    elements.fundsInput.value = "";
    elements.ignoreOptionPremium.checked = false;
    elements.includeDeliveryMargin.checked = false;
    state.fundsResult = null;
    renderFundsOutput();
  });

  elements.addScratchpadRowButton.addEventListener("click", () => {
    state.scratchpadRows.push(createScratchpadRow());
    renderScratchpad();
  });

  elements.clearScratchpadButton.addEventListener("click", () => {
    state.scratchpadRows = createScratchpadRows();
    renderScratchpad();
  });

  elements.downloadScratchpadButton.addEventListener("click", downloadScratchpadCsv);
}


function init() {
  loadState();
  bindEvents();
  activateTab(state.activeTab);
  renderFundsOutput();
  renderScratchpad();
}


init();
