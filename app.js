const STORAGE_KEY = "peakcalcy-static-v1";

const FUND_LABELS = {
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
  opening_balance: "Opening Balance",
  collateral: "Collateral",
  span: "SPAN",
  exposure: "Exposure",
  option_premium: "Option Premium",
  delivery_margin: "Delivery Margin",
  payin: "Payin",
  payout: "Payout",
};

const COLUMN_HINTS = {
  symbol: ["tradingsymbol", "instrument", "symbol", "trading symbol", "instrument name"],
  quantity: ["net qty", "netqty", "quantity", "qty", "net quantity"],
  product: ["product", "product type", "product_code"],
  exchange: ["exchange", "exchange segment", "segment"],
  lot_size: ["lot size", "lot_size", "lotsize"],
  total_margin: ["total margin", "margin", "margin used", "required margin", "margin blocked"],
  span_margin: ["span", "span margin"],
  exposure_margin: ["exposure", "exposure margin"],
};

const SUPPORTED_PRODUCTS = new Set(["NRML", "MIS", "MTF", "CO", "BO"]);
const IGNORED_PRODUCTS = new Set(["CNC"]);

const state = {
  activeTab: "funds",
  fundsResult: null,
  csvData: null,
  mapping: {},
  liquidationResult: null,
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
  positionsFile: document.getElementById("positions-file"),
  targetRelease: document.getElementById("target-release"),
  csvPreviewWrap: document.getElementById("csv-preview-wrap"),
  csvPreview: document.getElementById("csv-preview"),
  mappingWrap: document.getElementById("mapping-wrap"),
  runLiquidationButton: document.getElementById("run-liquidation-button"),
  clearLiquidationButton: document.getElementById("clear-liquidation-button"),
  liquidationMetrics: document.getElementById("liquidation-metrics"),
  liquidationAlert: document.getElementById("liquidation-alert"),
  liquidationCards: document.getElementById("liquidation-cards"),
  baselineTable: document.getElementById("baseline-table"),
  stepsTable: document.getElementById("steps-table"),
  requiredShock: document.getElementById("required-shock"),
  requiredShockValue: document.getElementById("required-shock-value"),
  collateralHaircut: document.getElementById("collateral-haircut"),
  collateralHaircutValue: document.getElementById("collateral-haircut-value"),
  stressMetrics: document.getElementById("stress-metrics"),
  stressStatus: document.getElementById("stress-status"),
  scratchpadLabel: document.getElementById("scratchpad-label"),
  scratchpadExpression: document.getElementById("scratchpad-expression"),
  addScratchpadButton: document.getElementById("add-scratchpad-button"),
  removeScratchpadButton: document.getElementById("remove-scratchpad-button"),
  clearScratchpadButton: document.getElementById("clear-scratchpad-button"),
  downloadScratchpadButton: document.getElementById("download-scratchpad-button"),
  scratchpadTotal: document.getElementById("scratchpad-total"),
  scratchpadTable: document.getElementById("scratchpad-table"),
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


function formatMoney(value) {
  const numeric = Number(value || 0);
  return `Rs. ${numeric.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}


function formatPercent(value) {
  const numeric = Number(value || 0);
  return `${numeric.toFixed(2)}%`;
}


function safeNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}


function normaliseAmount(rawValue) {
  return safeNumber(String(rawValue).replaceAll(",", "").trim());
}


function readNumeric(row, key) {
  if (!key) {
    return 0;
  }
  return normaliseAmount(row[key] ?? 0);
}


function storagePayload() {
  return {
    activeTab: state.activeTab,
    fundsInput: elements.fundsInput.value,
    ignoreOptionPremium: elements.ignoreOptionPremium.checked,
    includeDeliveryMargin: elements.includeDeliveryMargin.checked,
    fundsResult: state.fundsResult,
    scratchpadRows: state.scratchpadRows,
    requiredShock: elements.requiredShock.value,
    collateralHaircut: elements.collateralHaircut.value,
  };
}


function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(storagePayload()));
}


function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return;
    }
    const parsed = JSON.parse(raw);
    elements.fundsInput.value = parsed.fundsInput || "";
    elements.ignoreOptionPremium.checked = Boolean(parsed.ignoreOptionPremium);
    elements.includeDeliveryMargin.checked = Boolean(parsed.includeDeliveryMargin);
    elements.requiredShock.value = parsed.requiredShock || "0";
    elements.collateralHaircut.value = parsed.collateralHaircut || "0";
    state.fundsResult = parsed.fundsResult || null;
    state.scratchpadRows = Array.isArray(parsed.scratchpadRows) ? parsed.scratchpadRows : [];
    state.activeTab = parsed.activeTab || "funds";
  } catch (error) {
    console.warn("Could not restore saved state.", error);
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


function renderTable(container, columns, rows, emptyMessage) {
  if (!rows.length) {
    container.innerHTML = `
      <table>
        <tbody>
          <tr><td class="empty-cell">${escapeHtml(emptyMessage)}</td></tr>
        </tbody>
      </table>
    `;
    return;
  }

  const headerHtml = columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("");
  const rowHtml = rows
    .map((row) => {
      const cells = columns
        .map((column) => `<td>${column.render ? column.render(row[column.key], row) : escapeHtml(row[column.key] ?? "")}</td>`)
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  container.innerHTML = `
    <table>
      <thead><tr>${headerHtml}</tr></thead>
      <tbody>${rowHtml}</tbody>
    </table>
  `;
}


function extractLabelValue(text, aliases) {
  for (const alias of aliases) {
    const pattern = new RegExp(`${escapeRegex(alias)}\\s*(?:[:=\\-]|is)?\\s*(?:rs\\.?|inr)?\\s*([-+]?(?:\\d[\\d,]*)(?:\\.\\d+)?)`, "i");
    const match = text.match(pattern);
    if (match) {
      return {
        value: normaliseAmount(match[1]),
        matchedLabel: alias,
      };
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

  const cashAfterTransfers = inputs.opening_balance + inputs.payin - inputs.payout;
  const totalAvailable = cashAfterTransfers + inputs.collateral;
  const optionComponent = ignoreOptionPremium ? 0 : Math.max(inputs.option_premium, 0);
  const deliveryComponent = includeDeliveryMargin ? inputs.delivery_margin : 0;
  const totalRequired = inputs.span + inputs.exposure + optionComponent + deliveryComponent;
  const netBuffer = totalAvailable - totalRequired;
  const shortfall = netBuffer < 0 ? Math.abs(netBuffer) : 0;
  const freeBuffer = Math.max(netBuffer, 0);
  const utilizationPct = totalAvailable > 0 ? (totalRequired / totalAvailable) * 100 : 0;

  const details = Object.entries(FIELD_TITLES).map(([key, label]) => ({
    field: label,
    value: inputs[key],
    matchedLabel: sources[key],
  }));

  return {
    inputs,
    sources,
    details,
    cashAfterTransfers,
    totalAvailable,
    totalRequired,
    netBuffer,
    shortfall,
    freeBuffer,
    utilizationPct,
    optionComponent,
    deliveryComponent,
  };
}


function renderFundsOutput() {
  if (!state.fundsResult) {
    elements.fundsMetrics.innerHTML = "";
    elements.fundsStatus.innerHTML = "";
    elements.fundsProof.textContent = "Run the parser to generate a breakdown.";
    elements.fundsProof.classList.add("empty-state");
    elements.fundsDetailsTable.innerHTML = `<tr><td colspan="3" class="empty-cell">No parsed data yet.</td></tr>`;
    renderStressOutput();
    return;
  }

  const result = state.fundsResult;
  const freePct = Math.max(100 - result.utilizationPct, 0);

  renderMetricCards(elements.fundsMetrics, [
    { label: "Available", value: formatMoney(result.totalAvailable), delta: "Cash plus collateral" },
    { label: "Required", value: formatMoney(result.totalRequired), delta: "SPAN plus exposure and optional burdens" },
    {
      label: result.shortfall > 0 ? "Shortfall" : "Buffer",
      value: formatMoney(result.shortfall > 0 ? result.shortfall : result.freeBuffer),
      delta: "Net available minus required margin",
    },
    { label: "Utilization", value: formatPercent(result.utilizationPct), delta: `${freePct.toFixed(2)}% free headroom` },
  ]);

  if (result.shortfall > 0) {
    renderStatusBox(
      elements.fundsStatus,
      "stress",
      "Margin Stress",
      formatMoney(result.shortfall),
      "The account is under required margin. Use the liquidation tab to estimate which positions may release the most margin first."
    );
  } else {
    renderStatusBox(
      elements.fundsStatus,
      "safe",
      "Margin Buffer",
      formatMoney(result.freeBuffer),
      "The account has a positive margin cushion based on the pasted Funds tab snapshot."
    );
  }

  elements.fundsProof.classList.remove("empty-state");
  elements.fundsProof.textContent = [
    `CASH AFTER PAYIN/PAYOUT : ${formatMoney(result.cashAfterTransfers)}`,
    `COLLATERAL              : ${formatMoney(result.inputs.collateral)}`,
    `TOTAL AVAILABLE         : ${formatMoney(result.totalAvailable)}`,
    "",
    `SPAN                    : ${formatMoney(result.inputs.span)}`,
    `EXPOSURE                : ${formatMoney(result.inputs.exposure)}`,
    `OPTION PREMIUM USED     : ${formatMoney(result.optionComponent)}`,
    `DELIVERY MARGIN USED    : ${formatMoney(result.deliveryComponent)}`,
    `TOTAL REQUIRED          : ${formatMoney(result.totalRequired)}`,
    "",
    `NET BUFFER              : ${formatMoney(result.netBuffer)}`,
    `MARGIN UTILIZATION      : ${formatPercent(result.utilizationPct)}`,
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

  if (Number(elements.targetRelease.value) === 0 && result.shortfall > 0) {
    elements.targetRelease.value = String(Math.round(result.shortfall));
  }

  renderStressOutput();
}


function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      if (row.some((cell) => String(cell).trim() !== "")) {
        rows.push(row);
      }
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  row.push(field);
  if (row.some((cell) => String(cell).trim() !== "")) {
    rows.push(row);
  }

  if (!rows.length) {
    return { headers: [], rows: [] };
  }

  const headers = rows[0].map((header) => String(header).trim().replaceAll('"', ""));
  const dataRows = rows.slice(1).map((cells) => {
    const item = {};
    headers.forEach((header, index) => {
      item[header] = cells[index] ?? "";
    });
    return item;
  });

  return { headers, rows: dataRows };
}


function guessColumn(headers, hints) {
  const normalised = Object.fromEntries(headers.map((header) => [header, header.toLowerCase().replace(/[^a-z0-9]+/g, "")]));
  for (const hint of hints) {
    const hintKey = hint.toLowerCase().replace(/[^a-z0-9]+/g, "");
    for (const header of headers) {
      const headerKey = normalised[header];
      if (headerKey === hintKey || headerKey.includes(hintKey)) {
        return header;
      }
    }
  }
  return "";
}


function renderCsvPreview() {
  if (!state.csvData || !state.csvData.rows.length) {
    elements.csvPreviewWrap.classList.add("hidden");
    elements.csvPreview.innerHTML = "";
    return;
  }

  const columns = state.csvData.headers.slice(0, 8).map((header) => ({ key: header, label: header }));
  const rows = state.csvData.rows.slice(0, 8);
  elements.csvPreviewWrap.classList.remove("hidden");
  renderTable(elements.csvPreview, columns, rows, "No preview rows available.");
}


function buildMappingCard(label, key, headers, guessedValue, allowEmpty = false) {
  const options = allowEmpty ? ['<option value="">Not available</option>'] : [];
  options.push(
    ...headers.map((header) => {
      const selected = guessedValue === header ? " selected" : "";
      return `<option value="${escapeHtml(header)}"${selected}>${escapeHtml(header)}</option>`;
    })
  );

  return `
    <div class="mapping-card">
      <label for="mapping-${escapeHtml(key)}">${escapeHtml(label)}</label>
      <select id="mapping-${escapeHtml(key)}" data-mapping-key="${escapeHtml(key)}">
        ${options.join("")}
      </select>
    </div>
  `;
}


function renderMappingControls() {
  if (!state.csvData || !state.csvData.headers.length) {
    elements.mappingWrap.classList.add("hidden");
    elements.mappingWrap.innerHTML = "";
    return;
  }

  const headers = state.csvData.headers;
  const guessed = {
    symbol: guessColumn(headers, COLUMN_HINTS.symbol),
    quantity: guessColumn(headers, COLUMN_HINTS.quantity),
    product: guessColumn(headers, COLUMN_HINTS.product),
    exchange: guessColumn(headers, COLUMN_HINTS.exchange),
    lot_size: guessColumn(headers, COLUMN_HINTS.lot_size),
    total_margin: guessColumn(headers, COLUMN_HINTS.total_margin),
    span_margin: guessColumn(headers, COLUMN_HINTS.span_margin),
    exposure_margin: guessColumn(headers, COLUMN_HINTS.exposure_margin),
  };

  state.mapping = { ...guessed, ...state.mapping };
  elements.mappingWrap.classList.remove("hidden");
  elements.mappingWrap.innerHTML = [
    buildMappingCard("Symbol", "symbol", headers, state.mapping.symbol, false),
    buildMappingCard("Quantity", "quantity", headers, state.mapping.quantity, false),
    buildMappingCard("Product", "product", headers, state.mapping.product, true),
    buildMappingCard("Exchange", "exchange", headers, state.mapping.exchange, true),
    buildMappingCard("Lot size", "lot_size", headers, state.mapping.lot_size, true),
    buildMappingCard("Total margin", "total_margin", headers, state.mapping.total_margin, true),
    buildMappingCard("SPAN", "span_margin", headers, state.mapping.span_margin, true),
    buildMappingCard("Exposure", "exposure_margin", headers, state.mapping.exposure_margin, true),
  ].join("");

  elements.mappingWrap.querySelectorAll("select[data-mapping-key]").forEach((select) => {
    select.addEventListener("change", () => {
      state.mapping[select.dataset.mappingKey] = select.value;
    });
  });
}


function preparePositions() {
  const mapping = state.mapping;
  const rows = state.csvData?.rows || [];
  const positions = [];
  const skipped = [];

  for (const row of rows) {
    const symbol = String(row[mapping.symbol] ?? "").trim().toUpperCase();
    const quantity = Math.trunc(readNumeric(row, mapping.quantity));
    if (!symbol || quantity === 0) {
      continue;
    }

    let product = mapping.product ? String(row[mapping.product] ?? "NRML").trim().toUpperCase() : "NRML";
    if (!product) {
      product = "NRML";
    }
    if (IGNORED_PRODUCTS.has(product)) {
      skipped.push({ Symbol: symbol, Reason: `Skipped ${product} position` });
      continue;
    }
    if (!SUPPORTED_PRODUCTS.has(product)) {
      product = "NRML";
    }

    const exchange = mapping.exchange ? String(row[mapping.exchange] ?? "-").trim().toUpperCase() || "-" : "-";
    const lotSize = Math.max(Math.trunc(readNumeric(row, mapping.lot_size) || 1), 1);
    let totalMargin = Math.abs(readNumeric(row, mapping.total_margin));
    if (!totalMargin) {
      totalMargin = Math.abs(readNumeric(row, mapping.span_margin)) + Math.abs(readNumeric(row, mapping.exposure_margin));
    }

    positions.push({
      tradingsymbol: symbol,
      exchange,
      product,
      signed_quantity: quantity,
      quantity: Math.abs(quantity),
      lot_size: lotSize,
      transaction_type: quantity > 0 ? "BUY" : "SELL",
      estimated_margin_total: totalMargin,
    });
  }

  return { positions, skipped };
}


function impactLabel(release, targetRelease) {
  if (release >= Math.max(100000, targetRelease * 0.3)) {
    return "High Impact";
  }
  if (release >= Math.max(30000, targetRelease * 0.12)) {
    return "Medium Impact";
  }
  return "Low Impact";
}


function impactClass(label) {
  if (label === "High Impact") {
    return "badge badge-high";
  }
  if (label === "Medium Impact") {
    return "badge badge-medium";
  }
  return "badge badge-low";
}


function runLiquidationScan(positions, targetRelease) {
  let baseMargin = 0;
  const baselineRows = [];
  const stepPool = [];

  positions.forEach((position) => {
    const lotsHeld = Math.max(Math.ceil(position.quantity / position.lot_size), 1);
    const releasePerLot = lotsHeld ? position.estimated_margin_total / lotsHeld : 0;
    baseMargin += position.estimated_margin_total;

    baselineRows.push({
      Instrument: position.tradingsymbol,
      Exchange: position.exchange,
      Product: position.product,
      Direction: position.transaction_type,
      "Lot Size": position.lot_size,
      "Current Qty": position.signed_quantity,
      "Margin Released Per Lot": releasePerLot,
      "Estimated Position Margin": position.estimated_margin_total,
      Impact: impactLabel(releasePerLot, targetRelease),
    });

    for (let lotIndex = 0; lotIndex < lotsHeld; lotIndex += 1) {
      const qtyClosed = lotIndex < lotsHeld - 1
        ? position.lot_size
        : Math.max(position.quantity - position.lot_size * (lotsHeld - 1), 1);
      stepPool.push({
        Instrument: position.tradingsymbol,
        Exchange: position.exchange,
        Direction: position.transaction_type,
        "Qty Closed": qtyClosed,
        "Margin Released": releasePerLot,
        Impact: impactLabel(releasePerLot, targetRelease),
      });
    }
  });

  const rankedSteps = [...stepPool].sort((left, right) => right["Margin Released"] - left["Margin Released"]);
  let achievedRelease = 0;
  const steps = [];

  rankedSteps.forEach((step, index) => {
    if (targetRelease > 0 && achievedRelease >= targetRelease) {
      return;
    }
    achievedRelease += step["Margin Released"];
    steps.push({
      Step: index + 1,
      ...step,
      "Cumulative Release": achievedRelease,
    });
  });

  const summaryMap = new Map();
  steps.forEach((step) => {
    const key = `${step.Instrument}__${step.Exchange}__${step.Direction}`;
    if (!summaryMap.has(key)) {
      summaryMap.set(key, {
        Instrument: step.Instrument,
        Exchange: step.Exchange,
        Direction: step.Direction,
        Lots_To_Close: 0,
        Quantity_To_Close: 0,
        Estimated_Release: 0,
        Average_Release_Per_Lot: 0,
      });
    }
    const item = summaryMap.get(key);
    item.Lots_To_Close += 1;
    item.Quantity_To_Close += step["Qty Closed"];
    item.Estimated_Release += step["Margin Released"];
  });

  const summaryRows = [...summaryMap.values()]
    .map((item) => ({
      ...item,
      Average_Release_Per_Lot: item.Lots_To_Close ? item.Estimated_Release / item.Lots_To_Close : 0,
      Impact: impactLabel(item.Lots_To_Close ? item.Estimated_Release / item.Lots_To_Close : 0, targetRelease),
    }))
    .sort((left, right) => right.Estimated_Release - left.Estimated_Release);

  baselineRows.sort((left, right) => right["Margin Released Per Lot"] - left["Margin Released Per Lot"]);

  return {
    baseMargin,
    achievedRelease,
    remainingShortfall: Math.max(targetRelease - achievedRelease, 0),
    baselineRows,
    steps,
    summaryRows,
  };
}


function renderLiquidationOutput() {
  if (!state.liquidationResult) {
    elements.liquidationMetrics.innerHTML = "";
    elements.liquidationCards.innerHTML = "";
    elements.liquidationAlert.className = "empty-state";
    elements.liquidationAlert.textContent = "Upload a CSV and run the scan.";
    renderTable(elements.baselineTable, [], [], "No ranking yet.");
    renderTable(elements.stepsTable, [], [], "No simulation steps yet.");
    return;
  }

  const result = state.liquidationResult;
  renderMetricCards(elements.liquidationMetrics, [
    { label: "Estimated Margin", value: formatMoney(result.baseMargin), delta: "Sum of mapped position margins" },
    { label: "Release Achieved", value: formatMoney(result.achievedRelease), delta: "From the generated liquidation path" },
    { label: "Target Release", value: formatMoney(result.targetRelease), delta: "Requested release amount" },
    { label: "Gap Left", value: formatMoney(result.remainingShortfall), delta: "Uncovered release after the scan" },
  ]);

  elements.liquidationAlert.className = "status-box stress";
  elements.liquidationAlert.innerHTML = `
    <div class="status-title">Offline estimate</div>
    <div class="status-copy">
      Liquidation output is a heuristic estimate based on uploaded margin data. It is not a live broker-side margin calculation.
    </div>
  `;

  if (!result.summaryRows.length) {
    elements.liquidationCards.innerHTML = `<div class="empty-state">No positive liquidation path was found for the current input.</div>`;
  } else {
    elements.liquidationCards.innerHTML = result.summaryRows
      .map(
        (row) => `
          <article class="liquidation-card">
            <div class="liquidation-topline">
              <span class="${impactClass(row.Impact)}">${escapeHtml(row.Impact)}</span>
              <strong class="liquidation-symbol">${escapeHtml(row.Instrument)}</strong>
            </div>
            <div class="liquidation-meta">
              Exchange: ${escapeHtml(row.Exchange)} | Direction: ${escapeHtml(row.Direction)} | Lots to close: ${escapeHtml(row.Lots_To_Close)}
            </div>
            <div class="liquidation-meta">
              Quantity to close: ${escapeHtml(row.Quantity_To_Close)} | Estimated release: ${escapeHtml(formatMoney(row.Estimated_Release))}
            </div>
            <div class="liquidation-meta">
              Average release per lot: ${escapeHtml(formatMoney(row.Average_Release_Per_Lot))}
            </div>
          </article>
        `
      )
      .join("");
  }

  renderTable(
    elements.baselineTable,
    [
      { key: "Instrument", label: "Instrument" },
      { key: "Exchange", label: "Exchange" },
      { key: "Direction", label: "Direction" },
      { key: "Lot Size", label: "Lot Size" },
      { key: "Current Qty", label: "Current Qty" },
      { key: "Margin Released Per Lot", label: "Margin Released Per Lot", render: (value) => escapeHtml(formatMoney(value)) },
      { key: "Estimated Position Margin", label: "Estimated Position Margin", render: (value) => escapeHtml(formatMoney(value)) },
      { key: "Impact", label: "Impact" },
    ],
    result.baselineRows,
    "No ranking yet."
  );

  renderTable(
    elements.stepsTable,
    [
      { key: "Step", label: "Step" },
      { key: "Instrument", label: "Instrument" },
      { key: "Exchange", label: "Exchange" },
      { key: "Direction", label: "Direction" },
      { key: "Qty Closed", label: "Qty Closed" },
      { key: "Margin Released", label: "Margin Released", render: (value) => escapeHtml(formatMoney(value)) },
      { key: "Cumulative Release", label: "Cumulative Release", render: (value) => escapeHtml(formatMoney(value)) },
    ],
    result.steps,
    "No simulation steps yet."
  );
}


function renderStressOutput() {
  elements.requiredShockValue.textContent = `${elements.requiredShock.value}%`;
  elements.collateralHaircutValue.textContent = `${elements.collateralHaircut.value}%`;

  if (!state.fundsResult) {
    elements.stressMetrics.innerHTML = "";
    elements.stressStatus.className = "empty-state";
    elements.stressStatus.textContent = "Parse the Funds tab first to enable stress testing.";
    saveState();
    return;
  }

  const result = state.fundsResult;
  const requiredShock = safeNumber(elements.requiredShock.value);
  const collateralHaircut = safeNumber(elements.collateralHaircut.value);
  const shockedRequired = result.totalRequired * (1 + requiredShock / 100);
  const shockedCollateral = result.inputs.collateral * (1 - collateralHaircut / 100);
  const shockedAvailable = result.cashAfterTransfers + shockedCollateral;
  const shockedBuffer = shockedAvailable - shockedRequired;
  const shockedUtilization = shockedAvailable > 0 ? (shockedRequired / shockedAvailable) * 100 : 0;

  renderMetricCards(elements.stressMetrics, [
    { label: "Shocked Required", value: formatMoney(shockedRequired), delta: "Margin after the stress shock" },
    { label: "Shocked Collateral", value: formatMoney(shockedCollateral), delta: "Collateral after haircut" },
    { label: "Shocked Available", value: formatMoney(shockedAvailable), delta: "Cash plus shocked collateral" },
    { label: "Shocked Utilization", value: formatPercent(shockedUtilization), delta: "Required divided by available" },
  ]);

  if (shockedBuffer < 0) {
    renderStatusBox(
      elements.stressStatus,
      "stress",
      "Scenario Shortfall",
      formatMoney(Math.abs(shockedBuffer)),
      "Under this stress case, the account would fall below the required margin threshold."
    );
  } else {
    renderStatusBox(
      elements.stressStatus,
      "safe",
      "Scenario Buffer",
      formatMoney(shockedBuffer),
      "The account still keeps a positive margin cushion under the selected stress assumptions."
    );
  }

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


function evaluateExpression(expression) {
  const tokens = tokenize(expression.replaceAll(",", ""));
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


function renderScratchpad() {
  if (!state.scratchpadRows.length) {
    elements.scratchpadTotal.textContent = "No calculations yet.";
    elements.scratchpadTable.innerHTML = `
      <table>
        <tbody>
          <tr><td class="empty-cell">Add formulas to build a running total.</td></tr>
        </tbody>
      </table>
    `;
    saveState();
    return;
  }

  const total = state.scratchpadRows.reduce((sum, row) => sum + safeNumber(row.result), 0);
  elements.scratchpadTotal.textContent = `Running total: ${total.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const rows = state.scratchpadRows.map((row, index) => ({
    Row: index + 1,
    Time: row.time,
    Label: row.label,
    Formula: row.formula,
    Result: row.result,
  }));

  rows.push({
    Row: "",
    Time: "",
    Label: "TOTAL",
    Formula: "",
    Result: total,
  });

  renderTable(
    elements.scratchpadTable,
    [
      { key: "Row", label: "Row" },
      { key: "Time", label: "Time" },
      { key: "Label", label: "Label" },
      { key: "Formula", label: "Formula" },
      { key: "Result", label: "Result", render: (value) => escapeHtml(safeNumber(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })) },
    ],
    rows,
    "Add formulas to build a running total."
  );

  saveState();
}


function downloadScratchpadCsv() {
  if (!state.scratchpadRows.length) {
    return;
  }
  const lines = ["Time,Label,Formula,Result"];
  state.scratchpadRows.forEach((row) => {
    const escaped = [row.time, row.label, row.formula, row.result].map((value) => `"${String(value).replaceAll('"', '""')}"`);
    lines.push(escaped.join(","));
  });
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "scratchpad_history.csv";
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


function resetLiquidationArea() {
  state.csvData = null;
  state.mapping = {};
  state.liquidationResult = null;
  elements.positionsFile.value = "";
  elements.csvPreviewWrap.classList.add("hidden");
  elements.mappingWrap.classList.add("hidden");
  elements.csvPreview.innerHTML = "";
  elements.mappingWrap.innerHTML = "";
  renderLiquidationOutput();
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
    saveState();
  });

  elements.resetFundsButton.addEventListener("click", () => {
    elements.fundsInput.value = "";
    elements.ignoreOptionPremium.checked = false;
    elements.includeDeliveryMargin.checked = false;
    state.fundsResult = null;
    renderFundsOutput();
    saveState();
  });

  elements.positionsFile.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      resetLiquidationArea();
      return;
    }
    const text = await file.text();
    state.csvData = parseCSV(text);
    state.mapping = {};
    state.liquidationResult = null;
    renderCsvPreview();
    renderMappingControls();
    renderLiquidationOutput();
  });

  elements.runLiquidationButton.addEventListener("click", () => {
    if (!state.csvData || !state.csvData.rows.length) {
      alert("Upload a positions CSV first.");
      return;
    }

    const mapping = state.mapping;
    if (!mapping.symbol || !mapping.quantity) {
      alert("Map at least the symbol and quantity columns.");
      return;
    }
    if (!mapping.total_margin && !mapping.span_margin && !mapping.exposure_margin) {
      alert("Map either a total margin column or SPAN and Exposure columns.");
      return;
    }

    const targetRelease = Math.max(safeNumber(elements.targetRelease.value), 0);
    const prepared = preparePositions();
    if (prepared.skipped.length && !prepared.positions.length) {
      alert("Rows were skipped and no usable positions remain.");
      return;
    }
    if (!prepared.positions.length) {
      alert("No usable positions were found after parsing the CSV.");
      return;
    }

    state.liquidationResult = {
      ...runLiquidationScan(prepared.positions, targetRelease),
      targetRelease,
      skipped: prepared.skipped,
    };
    renderLiquidationOutput();
  });

  elements.clearLiquidationButton.addEventListener("click", resetLiquidationArea);

  elements.requiredShock.addEventListener("input", renderStressOutput);
  elements.collateralHaircut.addEventListener("input", renderStressOutput);

  elements.addScratchpadButton.addEventListener("click", () => {
    const expression = elements.scratchpadExpression.value.trim();
    if (!expression) {
      alert("Enter a formula before adding a line.");
      return;
    }
    try {
      const result = evaluateExpression(expression);
      state.scratchpadRows.push({
        time: new Date().toLocaleTimeString("en-IN", { hour12: false }),
        label: elements.scratchpadLabel.value.trim() || "-",
        formula: expression,
        result,
      });
      elements.scratchpadLabel.value = "";
      elements.scratchpadExpression.value = "";
      renderScratchpad();
    } catch (error) {
      alert(error.message || "Could not evaluate formula.");
    }
  });

  elements.removeScratchpadButton.addEventListener("click", () => {
    state.scratchpadRows.pop();
    renderScratchpad();
  });

  elements.clearScratchpadButton.addEventListener("click", () => {
    state.scratchpadRows = [];
    renderScratchpad();
  });

  elements.downloadScratchpadButton.addEventListener("click", downloadScratchpadCsv);
}


function init() {
  loadState();
  bindEvents();
  activateTab(state.activeTab);
  renderFundsOutput();
  renderCsvPreview();
  renderMappingControls();
  renderLiquidationOutput();
  renderScratchpad();
}


init();
