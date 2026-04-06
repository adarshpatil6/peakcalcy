from __future__ import annotations

import ast
import math
import operator
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import pandas as pd
import streamlit as st


st.set_page_config(
    page_title="RMS Pro Sentinel",
    layout="wide",
    initial_sidebar_state="expanded",
)


CUSTOM_CSS = """
<style>
:root {
    --ink: #102a43;
    --muted: #52606d;
    --panel: #ffffff;
    --canvas: #f5f7f2;
    --border: #d9e2ec;
    --accent: #0f766e;
    --accent-soft: #e6f7f4;
    --danger: #b42318;
    --danger-soft: #fef3f2;
    --shadow: 0 10px 30px rgba(15, 23, 42, 0.08);
}
.stApp {
    background:
        radial-gradient(circle at top right, rgba(15, 118, 110, 0.09), transparent 26%),
        radial-gradient(circle at top left, rgba(18, 78, 120, 0.09), transparent 22%),
        var(--canvas);
}
.block-container { padding-top: 1.5rem; padding-bottom: 2rem; }
.hero-panel {
    background: linear-gradient(135deg, #0f766e 0%, #124e78 48%, #1f2937 100%);
    border-radius: 22px; padding: 1.35rem 1.5rem 1.4rem; color: #fff;
    box-shadow: var(--shadow); margin-bottom: 1rem;
}
.hero-eyebrow { text-transform: uppercase; letter-spacing: 0.16em; font-size: 0.72rem; font-weight: 700; opacity: 0.88; }
.hero-title { font-size: 2.2rem; line-height: 1.05; font-weight: 800; margin-top: 0.35rem; }
.hero-copy { max-width: 860px; font-size: 0.98rem; line-height: 1.5; opacity: 0.96; margin-top: 0.45rem; }
.metric-card {
    background: var(--panel); border: 1px solid var(--border); border-radius: 18px;
    padding: 1rem 1.05rem; box-shadow: var(--shadow); margin-bottom: 0.6rem;
}
.metric-label { color: var(--muted); font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 700; }
.metric-value { font-size: 1.65rem; line-height: 1.2; color: var(--ink); font-weight: 800; margin-top: 0.35rem; }
.metric-delta { font-size: 0.92rem; margin-top: 0.2rem; color: var(--muted); }
.status-box {
    border-radius: 18px; padding: 1rem 1.1rem; margin-top: 0.85rem; border-left: 6px solid; box-shadow: var(--shadow);
}
.status-box.safe { background: var(--accent-soft); border-left-color: var(--accent); color: #0f5132; }
.status-box.stress { background: var(--danger-soft); border-left-color: var(--danger); color: #7a271a; }
.status-title { font-size: 0.82rem; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 800; }
.status-value { font-size: 1.55rem; font-weight: 800; margin-top: 0.2rem; }
.status-copy { margin-top: 0.25rem; line-height: 1.45; }
.math-proof {
    background: #0f172a; color: #e2e8f0; border-radius: 18px; padding: 1rem 1.1rem;
    font-family: Consolas, "Courier New", monospace; line-height: 1.75; margin-top: 0.8rem; box-shadow: var(--shadow);
}
.liquidation-card {
    background: var(--panel); border: 1px solid var(--border); border-radius: 18px;
    padding: 0.95rem 1rem; box-shadow: var(--shadow); margin-bottom: 0.8rem;
}
.liquidation-topline { display: flex; flex-wrap: wrap; gap: 0.65rem; align-items: center; margin-bottom: 0.45rem; }
.badge { display: inline-flex; align-items: center; border-radius: 999px; padding: 0.26rem 0.7rem; font-size: 0.78rem; font-weight: 800; }
.badge-high { background: #dcfce7; color: #166534; }
.badge-medium { background: #dbeafe; color: #1d4ed8; }
.badge-low { background: #ffedd5; color: #9a3412; }
.liquidation-symbol { font-size: 1.1rem; font-weight: 800; color: var(--ink); }
.liquidation-meta { color: var(--muted); font-size: 0.92rem; }
</style>
"""
st.markdown(CUSTOM_CSS, unsafe_allow_html=True)


FUND_LABELS = {
    "opening_balance": ["Opening balance", "Opening Balance"],
    "collateral": ["Total collateral", "Collateral", "Available collateral"],
    "span": ["SPAN", "Span"],
    "exposure": ["Exposure", "Exposure margin"],
    "option_premium": ["Options premium", "Option premium", "Premium"],
    "delivery_margin": ["Delivery margin", "Delivery"],
    "payin": ["Payin", "Pay in"],
    "payout": ["Payout", "Pay out"],
}

FIELD_TITLES = {
    "opening_balance": "Opening Balance",
    "collateral": "Collateral",
    "span": "SPAN",
    "exposure": "Exposure",
    "option_premium": "Option Premium",
    "delivery_margin": "Delivery Margin",
    "payin": "Payin",
    "payout": "Payout",
}

COLUMN_HINTS = {
    "symbol": ["tradingsymbol", "instrument", "symbol", "trading symbol", "instrument name"],
    "quantity": ["net qty", "netqty", "quantity", "qty", "net quantity"],
    "product": ["product", "product type", "product_code"],
    "exchange": ["exchange", "exchange segment", "segment"],
    "lot_size": ["lot size", "lot_size", "lotsize"],
    "total_margin": ["total margin", "margin", "margin used", "required margin", "margin blocked"],
    "span_margin": ["span", "span margin"],
    "exposure_margin": ["exposure", "exposure margin"],
}

SUPPORTED_PRODUCTS = {"NRML", "MIS", "MTF", "CO", "BO"}
IGNORED_PRODUCTS = {"CNC"}
AMOUNT_REGEX = r"([-+]?(?:\d[\d,]*)(?:\.\d+)?)"


@dataclass
class PositionSpec:
    tradingsymbol: str
    exchange: str
    product: str
    signed_quantity: int
    quantity: int
    lot_size: int
    transaction_type: str
    estimated_margin_total: float


def ensure_session_defaults() -> None:
    defaults = {
        "funds_summary_text": "",
        "ignore_option_premium": False,
        "include_delivery_margin": False,
        "funds_result": None,
        "scratchpad_rows": [],
    }
    for key, value in defaults.items():
        if key not in st.session_state:
            st.session_state[key] = value


def money(value: float) -> str:
    return f"Rs. {value:,.2f}"


def percent(value: float) -> str:
    return f"{value:,.2f}%"


def render_metric_card(label: str, value: str, delta: str = "") -> None:
    st.markdown(
        f"""
        <div class="metric-card">
            <div class="metric-label">{label}</div>
            <div class="metric-value">{value}</div>
            <div class="metric-delta">{delta}</div>
        </div>
        """,
        unsafe_allow_html=True,
    )


def render_status_box(kind: str, title: str, value: str, copy_text: str) -> None:
    st.markdown(
        f"""
        <div class="status-box {kind}">
            <div class="status-title">{title}</div>
            <div class="status-value">{value}</div>
            <div class="status-copy">{copy_text}</div>
        </div>
        """,
        unsafe_allow_html=True,
    )


def normalise_amount(raw_value: str) -> float:
    return float(raw_value.replace(",", "").strip())


def extract_label_value(text: str, aliases: list[str]) -> tuple[float, str]:
    for alias in aliases:
        pattern = rf"(?im){re.escape(alias)}\s*(?:[:=\-]|is)?\s*(?:rs\.?|inr)?\s*{AMOUNT_REGEX}"
        match = re.search(pattern, text)
        if match:
            return normalise_amount(match.group(1)), alias
    return 0.0, "Not found"


def parse_funds_summary(text: str, ignore_option_premium: bool, include_delivery_margin: bool) -> dict[str, Any]:
    extracted: dict[str, float] = {}
    sources: dict[str, str] = {}
    for field_name, aliases in FUND_LABELS.items():
        value, source = extract_label_value(text, aliases)
        extracted[field_name] = value
        sources[field_name] = source

    cash_after_transfers = extracted["opening_balance"] + extracted["payin"] - extracted["payout"]
    total_available = cash_after_transfers + extracted["collateral"]
    option_component = 0.0 if ignore_option_premium else max(extracted["option_premium"], 0.0)
    delivery_component = extracted["delivery_margin"] if include_delivery_margin else 0.0
    total_required = extracted["span"] + extracted["exposure"] + option_component + delivery_component
    net_buffer = total_available - total_required
    shortfall = abs(net_buffer) if net_buffer < 0 else 0.0
    free_buffer = max(net_buffer, 0.0)
    utilization_pct = (total_required / total_available * 100) if total_available > 0 else 0.0

    details = []
    for field_name, label in FIELD_TITLES.items():
        details.append({"Field": label, "Value": extracted[field_name], "Matched Label": sources[field_name]})

    return {
        "inputs": extracted,
        "cash_after_transfers": cash_after_transfers,
        "total_available": total_available,
        "total_required": total_required,
        "net_buffer": net_buffer,
        "shortfall": shortfall,
        "free_buffer": free_buffer,
        "utilization_pct": utilization_pct,
        "option_component": option_component,
        "delivery_component": delivery_component,
        "details_df": pd.DataFrame(details),
    }


def guess_column(columns: list[str], hints: list[str]) -> str | None:
    normalised = {column: re.sub(r"[^a-z0-9]+", "", column.lower()) for column in columns}
    for hint in hints:
        hint_key = re.sub(r"[^a-z0-9]+", "", hint.lower())
        for column, column_key in normalised.items():
            if column_key == hint_key or hint_key in column_key:
                return column
    return None


def read_numeric(row: pd.Series, column: str | None) -> float:
    if not column:
        return 0.0
    value = pd.to_numeric(pd.Series([row.get(column, 0)]), errors="coerce").fillna(0).iloc[0]
    return float(value)


def prepare_positions(
    df: pd.DataFrame,
    symbol_col: str,
    quantity_col: str,
    product_col: str | None,
    exchange_col: str | None,
    lot_size_col: str | None,
    total_margin_col: str | None,
    span_margin_col: str | None,
    exposure_margin_col: str | None,
) -> tuple[list[PositionSpec], pd.DataFrame]:
    cleaned = df.copy().dropna(subset=[symbol_col, quantity_col])
    cleaned[quantity_col] = pd.to_numeric(cleaned[quantity_col], errors="coerce").fillna(0).astype(int)
    cleaned = cleaned[cleaned[quantity_col] != 0]

    positions: list[PositionSpec] = []
    skipped_rows: list[dict[str, Any]] = []

    for _, row in cleaned.iterrows():
        symbol = str(row[symbol_col]).strip().upper()
        quantity = int(row[quantity_col])
        product = str(row.get(product_col, "NRML")).strip().upper() if product_col else "NRML"
        if not product:
            product = "NRML"
        if product in IGNORED_PRODUCTS:
            skipped_rows.append({"Symbol": symbol, "Reason": f"Skipped {product} position"})
            continue
        if product not in SUPPORTED_PRODUCTS:
            product = "NRML"

        exchange = str(row.get(exchange_col, "-")).strip().upper() if exchange_col else "-"
        lot_size = max(int(read_numeric(row, lot_size_col) or 1), 1)
        total_margin = abs(read_numeric(row, total_margin_col))
        if total_margin == 0:
            total_margin = abs(read_numeric(row, span_margin_col)) + abs(read_numeric(row, exposure_margin_col))

        positions.append(
            PositionSpec(
                tradingsymbol=symbol,
                exchange=exchange or "-",
                product=product,
                signed_quantity=quantity,
                quantity=abs(quantity),
                lot_size=lot_size,
                transaction_type="BUY" if quantity > 0 else "SELL",
                estimated_margin_total=total_margin,
            )
        )

    return positions, pd.DataFrame(skipped_rows)


def impact_label(release: float, target_release: float) -> str:
    if release >= max(100000.0, target_release * 0.3):
        return "High Impact"
    if release >= max(30000.0, target_release * 0.12):
        return "Medium Impact"
    return "Low Impact"


def impact_class(label: str) -> str:
    if label == "High Impact":
        return "badge badge-high"
    if label == "Medium Impact":
        return "badge badge-medium"
    return "badge badge-low"


def run_liquidation_scan(positions: list[PositionSpec], target_release: float, progress_bar: Any) -> dict[str, Any]:
    baseline_rows: list[dict[str, Any]] = []
    step_pool: list[dict[str, Any]] = []
    base_margin = 0.0

    for position in positions:
        lots_held = max(math.ceil(position.quantity / position.lot_size), 1)
        release_per_lot = position.estimated_margin_total / lots_held if lots_held else 0.0
        base_margin += position.estimated_margin_total
        baseline_rows.append(
            {
                "Instrument": position.tradingsymbol,
                "Exchange": position.exchange,
                "Product": position.product,
                "Direction": position.transaction_type,
                "Lot Size": position.lot_size,
                "Current Qty": position.signed_quantity,
                "Margin Released Per Lot": release_per_lot,
                "Estimated Position Margin": position.estimated_margin_total,
                "Impact": impact_label(release_per_lot, target_release),
            }
        )
        for lot_index in range(lots_held):
            closable_qty = position.lot_size if lot_index < lots_held - 1 else max(position.quantity - position.lot_size * (lots_held - 1), 1)
            step_pool.append(
                {
                    "Instrument": position.tradingsymbol,
                    "Exchange": position.exchange,
                    "Direction": position.transaction_type,
                    "Qty Closed": closable_qty,
                    "Margin Released": release_per_lot,
                    "Impact": impact_label(release_per_lot, target_release),
                }
            )

    ranked_steps = sorted(step_pool, key=lambda item: item["Margin Released"], reverse=True)
    achieved_release = 0.0
    steps: list[dict[str, Any]] = []
    max_steps = len(ranked_steps)

    for step_number, step in enumerate(ranked_steps, start=1):
        achieved_release += step["Margin Released"]
        steps.append({"Step": step_number, **step, "Cumulative Release": achieved_release})
        if max_steps:
            progress_bar.progress(step_number / max_steps)
        if target_release > 0 and achieved_release >= target_release:
            break

    progress_bar.empty()

    baseline_df = pd.DataFrame(baseline_rows)
    if not baseline_df.empty:
        baseline_df = baseline_df.sort_values(by="Margin Released Per Lot", ascending=False)

    steps_df = pd.DataFrame(steps)
    summary_df = pd.DataFrame()
    if not steps_df.empty:
        summary_df = (
            steps_df.groupby(["Instrument", "Exchange", "Direction"], as_index=False)
            .agg(
                Lots_To_Close=("Qty Closed", lambda x: len(list(x))),
                Quantity_To_Close=("Qty Closed", "sum"),
                Estimated_Release=("Margin Released", "sum"),
                Average_Release_Per_Lot=("Margin Released", "mean"),
            )
            .sort_values(by="Estimated_Release", ascending=False)
        )
        summary_df["Impact"] = summary_df["Average_Release_Per_Lot"].apply(lambda value: impact_label(value, target_release))

    return {
        "base_margin": base_margin,
        "achieved_release": achieved_release,
        "remaining_shortfall": max(target_release - achieved_release, 0.0),
        "baseline_df": baseline_df,
        "steps_df": steps_df,
        "summary_df": summary_df,
    }


ALLOWED_BIN_OPS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
}

ALLOWED_UNARY_OPS = {ast.UAdd: lambda value: value, ast.USub: lambda value: -value}
ALLOWED_FUNCTIONS = {"abs": abs, "round": round, "sqrt": math.sqrt, "ceil": math.ceil, "floor": math.floor}
ALLOWED_NAMES = {"pi": math.pi, "e": math.e}


def evaluate_expression(expression: str) -> float:
    cleaned = re.sub(r"(?<=\d),(?=\d)", "", expression.strip())
    if not cleaned:
        raise ValueError("Please enter a formula.")

    tree = ast.parse(cleaned, mode="eval")

    def _evaluate(node: ast.AST) -> float:
        if isinstance(node, ast.Expression):
            return _evaluate(node.body)
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
            return float(node.value)
        if isinstance(node, ast.Name) and node.id in ALLOWED_NAMES:
            return float(ALLOWED_NAMES[node.id])
        if isinstance(node, ast.BinOp) and type(node.op) in ALLOWED_BIN_OPS:
            return float(ALLOWED_BIN_OPS[type(node.op)](_evaluate(node.left), _evaluate(node.right)))
        if isinstance(node, ast.UnaryOp) and type(node.op) in ALLOWED_UNARY_OPS:
            return float(ALLOWED_UNARY_OPS[type(node.op)](_evaluate(node.operand)))
        if isinstance(node, ast.Call):
            if not isinstance(node.func, ast.Name) or node.func.id not in ALLOWED_FUNCTIONS:
                raise ValueError("Unsupported function in formula.")
            if node.keywords:
                raise ValueError("Keyword arguments are not supported.")
            return float(ALLOWED_FUNCTIONS[node.func.id](*[_evaluate(argument) for argument in node.args]))
        raise ValueError("Unsupported formula. Use numbers, brackets, and simple math only.")

    return float(_evaluate(tree))


def reset_funds_state() -> None:
    st.session_state.funds_summary_text = ""
    st.session_state.ignore_option_premium = False
    st.session_state.include_delivery_margin = False
    st.session_state.funds_result = None


def render_sidebar() -> None:
    with st.sidebar:
        st.header("Desk Controls")
        st.caption("This version runs fully offline. No Kite Connect login, secrets, or API calls are required.")
        st.markdown("#### Liquidation input")
        st.write("Upload a CSV with position quantity and either a total margin column or SPAN plus exposure columns.")
        st.markdown("#### Best columns")
        st.write("`tradingsymbol`, `qty`, `product`, `exchange`, `lot_size`, `margin`")


def render_header() -> None:
    st.markdown(
        """
        <div class="hero-panel">
            <div class="hero-eyebrow">Daily RMS desk</div>
            <div class="hero-title">RMS Pro Sentinel</div>
            <div class="hero-copy">
                An offline Streamlit control room for margin visibility, liquidation planning, stress testing, and quick desk math.
                Paste the Funds tab, upload open positions, and estimate which lots to close first without any broker API dependency.
            </div>
        </div>
        """,
        unsafe_allow_html=True,
    )


def render_funds_tab() -> None:
    left_col, right_col = st.columns([1.05, 1.35], gap="large")

    with left_col:
        st.subheader("Funds Parser")
        st.text_area(
            "Paste the Funds tab summary",
            key="funds_summary_text",
            height=360,
            placeholder=(
                "Opening balance: 500000.00\n"
                "Total collateral: 300000.00\n"
                "SPAN: 225000.00\n"
                "Exposure: 85000.00\n"
                "Options premium: 12000.00\n"
                "Delivery margin: 5000.00"
            ),
        )
        opt_col, dlv_col = st.columns(2)
        with opt_col:
            st.checkbox("Ignore option premium", key="ignore_option_premium")
        with dlv_col:
            st.checkbox("Include delivery margin", key="include_delivery_margin")

        btn_col_one, btn_col_two = st.columns(2)
        with btn_col_one:
            parse_clicked = st.button("Parse and calculate", type="primary", use_container_width=True)
        with btn_col_two:
            clear_clicked = st.button("Reset", use_container_width=True)

        if clear_clicked:
            reset_funds_state()
            st.rerun()

        if parse_clicked:
            raw_text = st.session_state.funds_summary_text.strip()
            if not raw_text:
                st.warning("Paste the Funds tab summary before calculating.")
            else:
                st.session_state.funds_result = parse_funds_summary(
                    raw_text,
                    st.session_state.ignore_option_premium,
                    st.session_state.include_delivery_margin,
                )

    with right_col:
        st.subheader("RMS Snapshot")
        result = st.session_state.funds_result
        if not result:
            st.info("Run the parser to see margin availability, shortfall, and utilization.")
            return

        metric_cols = st.columns(4)
        with metric_cols[0]:
            render_metric_card("Available", money(result["total_available"]), "Cash plus collateral")
        with metric_cols[1]:
            render_metric_card("Required", money(result["total_required"]), "SPAN plus exposure and optional burdens")
        with metric_cols[2]:
            label = "Shortfall" if result["shortfall"] > 0 else "Buffer"
            value = result["shortfall"] if result["shortfall"] > 0 else result["free_buffer"]
            render_metric_card(label, money(value), "Net available minus required margin")
        with metric_cols[3]:
            free_pct = max(100.0 - result["utilization_pct"], 0.0)
            render_metric_card("Utilization", percent(result["utilization_pct"]), f"{free_pct:,.2f}% free headroom")

        if result["shortfall"] > 0:
            render_status_box(
                "stress",
                "Margin Stress",
                money(result["shortfall"]),
                "The account is under required margin. Use the liquidation tab to estimate which positions may release the most margin first.",
            )
        else:
            render_status_box(
                "safe",
                "Margin Buffer",
                money(result["free_buffer"]),
                "The account has a positive margin cushion based on the pasted Funds tab snapshot.",
            )

        proof_lines = [
            f"CASH AFTER PAYIN/PAYOUT : {money(result['cash_after_transfers'])}",
            f"COLLATERAL              : {money(result['inputs']['collateral'])}",
            f"TOTAL AVAILABLE         : {money(result['total_available'])}",
            "",
            f"SPAN                    : {money(result['inputs']['span'])}",
            f"EXPOSURE                : {money(result['inputs']['exposure'])}",
            f"OPTION PREMIUM USED     : {money(result['option_component'])}",
            f"DELIVERY MARGIN USED    : {money(result['delivery_component'])}",
            f"TOTAL REQUIRED          : {money(result['total_required'])}",
            "",
            f"NET BUFFER              : {money(result['net_buffer'])}",
            f"MARGIN UTILIZATION      : {percent(result['utilization_pct'])}",
        ]
        st.markdown(f"<div class='math-proof'>{'<br>'.join(proof_lines)}</div>", unsafe_allow_html=True)

        details_df = result["details_df"].copy()
        details_df["Value"] = details_df["Value"].map(money)
        st.dataframe(details_df, use_container_width=True, hide_index=True)


def render_liquidation_tab() -> None:
    st.subheader("Portfolio Deep Scan")
    st.caption("This mode is offline. Margin release is estimated from the CSV's own margin columns, not from a broker API.")

    target_default = float(st.session_state.funds_result["shortfall"]) if st.session_state.funds_result else 0.0
    uploaded_file = st.file_uploader("Upload positions CSV", type=["csv"])
    target_release = st.number_input("Target margin to release", min_value=0.0, value=target_default, step=1000.0)

    if uploaded_file is None:
        st.info("Upload a CSV with positions and margin columns to start the liquidation estimate.")
        return

    positions_df = pd.read_csv(uploaded_file)
    positions_df.columns = [str(column).strip().replace('"', "") for column in positions_df.columns]
    st.dataframe(positions_df.head(10), use_container_width=True)

    columns = list(positions_df.columns)
    with st.expander("Column mapping", expanded=True):
        mapping_cols = st.columns(8)
        symbol_guess = guess_column(columns, COLUMN_HINTS["symbol"])
        quantity_guess = guess_column(columns, COLUMN_HINTS["quantity"])
        product_guess = guess_column(columns, COLUMN_HINTS["product"])
        exchange_guess = guess_column(columns, COLUMN_HINTS["exchange"])
        lot_guess = guess_column(columns, COLUMN_HINTS["lot_size"])
        margin_guess = guess_column(columns, COLUMN_HINTS["total_margin"])
        span_guess = guess_column(columns, COLUMN_HINTS["span_margin"])
        exposure_guess = guess_column(columns, COLUMN_HINTS["exposure_margin"])

        with mapping_cols[0]:
            symbol_col = st.selectbox("Symbol", columns, index=columns.index(symbol_guess) if symbol_guess in columns else 0)
        with mapping_cols[1]:
            quantity_col = st.selectbox("Qty", columns, index=columns.index(quantity_guess) if quantity_guess in columns else 0)
        with mapping_cols[2]:
            product_options = ["<not available>"] + columns
            product_choice = st.selectbox("Product", product_options, index=product_options.index(product_guess) if product_guess in product_options else 0)
        with mapping_cols[3]:
            exchange_options = ["<not available>"] + columns
            exchange_choice = st.selectbox("Exchange", exchange_options, index=exchange_options.index(exchange_guess) if exchange_guess in exchange_options else 0)
        with mapping_cols[4]:
            lot_options = ["<not available>"] + columns
            lot_choice = st.selectbox("Lot size", lot_options, index=lot_options.index(lot_guess) if lot_guess in lot_options else 0)
        with mapping_cols[5]:
            margin_options = ["<not available>"] + columns
            margin_choice = st.selectbox("Total margin", margin_options, index=margin_options.index(margin_guess) if margin_guess in margin_options else 0)
        with mapping_cols[6]:
            span_options = ["<not available>"] + columns
            span_choice = st.selectbox("SPAN", span_options, index=span_options.index(span_guess) if span_guess in span_options else 0)
        with mapping_cols[7]:
            exposure_options = ["<not available>"] + columns
            exposure_choice = st.selectbox("Exposure", exposure_options, index=exposure_options.index(exposure_guess) if exposure_guess in exposure_options else 0)

    if not st.button("Run deep scan", type="primary"):
        return

    total_margin_col = None if margin_choice == "<not available>" else margin_choice
    span_margin_col = None if span_choice == "<not available>" else span_choice
    exposure_margin_col = None if exposure_choice == "<not available>" else exposure_choice

    if total_margin_col is None and span_margin_col is None and exposure_margin_col is None:
        st.error("Map either a total margin column or SPAN and Exposure columns to estimate liquidation impact.")
        return

    positions, skipped_df = prepare_positions(
        positions_df,
        symbol_col,
        quantity_col,
        None if product_choice == "<not available>" else product_choice,
        None if exchange_choice == "<not available>" else exchange_choice,
        None if lot_choice == "<not available>" else lot_choice,
        total_margin_col,
        span_margin_col,
        exposure_margin_col,
    )

    if not skipped_df.empty:
        st.warning("Some rows were skipped while building the liquidation model.")
        st.dataframe(skipped_df, use_container_width=True, hide_index=True)

    if not positions:
        st.error("No usable positions were found after parsing the CSV.")
        return

    progress_bar = st.progress(0.0)
    scan = run_liquidation_scan(positions, target_release, progress_bar)

    summary_cols = st.columns(4)
    with summary_cols[0]:
        render_metric_card("Estimated Margin", money(scan["base_margin"]), "Sum of mapped position margins")
    with summary_cols[1]:
        render_metric_card("Release Achieved", money(scan["achieved_release"]), "From the generated liquidation path")
    with summary_cols[2]:
        render_metric_card("Target Release", money(target_release), "Requested release amount")
    with summary_cols[3]:
        render_metric_card("Gap Left", money(scan["remaining_shortfall"]), "Uncovered release after the scan")

    st.warning("Liquidation output is a heuristic estimate based on uploaded margin data. It is not a live broker-side margin calculation.")

    summary_df = scan["summary_df"]
    if not summary_df.empty:
        st.markdown("#### Recommended Liquidation Plan")
        for _, row in summary_df.iterrows():
            badge_class = impact_class(row["Impact"])
            st.markdown(
                f"""
                <div class="liquidation-card">
                    <div class="liquidation-topline">
                        <span class="{badge_class}">{row["Impact"]}</span>
                        <span class="liquidation-symbol">{row["Instrument"]}</span>
                    </div>
                    <div class="liquidation-meta">
                        Exchange: {row["Exchange"]} | Direction: {row["Direction"]} | Lots to close: {int(row["Lots_To_Close"])}
                    </div>
                    <div class="liquidation-meta">
                        Quantity to close: {int(row["Quantity_To_Close"])} | Estimated release: {money(float(row["Estimated_Release"]))}
                    </div>
                    <div class="liquidation-meta">
                        Average release per lot: {money(float(row["Average_Release_Per_Lot"]))}
                    </div>
                </div>
                """,
                unsafe_allow_html=True,
            )

        display_summary = summary_df.copy()
        display_summary["Estimated_Release"] = display_summary["Estimated_Release"].map(money)
        display_summary["Average_Release_Per_Lot"] = display_summary["Average_Release_Per_Lot"].map(money)
        st.dataframe(display_summary, use_container_width=True, hide_index=True)

    baseline_df = scan["baseline_df"]
    if not baseline_df.empty:
        baseline_df = baseline_df.copy()
        baseline_df["Margin Released Per Lot"] = baseline_df["Margin Released Per Lot"].map(money)
        baseline_df["Estimated Position Margin"] = baseline_df["Estimated Position Margin"].map(money)
        st.markdown("#### Per-Lot Efficiency Ranking")
        st.dataframe(baseline_df, use_container_width=True, hide_index=True)

    steps_df = scan["steps_df"]
    if not steps_df.empty:
        steps_df = steps_df.copy()
        steps_df["Margin Released"] = steps_df["Margin Released"].map(money)
        steps_df["Cumulative Release"] = steps_df["Cumulative Release"].map(money)
        st.markdown("#### Step-by-Step Simulation")
        st.dataframe(steps_df, use_container_width=True, hide_index=True)


def render_stress_tab() -> None:
    st.subheader("Stress Test")
    result = st.session_state.funds_result
    if not result:
        st.info("Run the Funds parser first to open stress-testing controls.")
        return

    slider_cols = st.columns(2)
    with slider_cols[0]:
        required_shock = st.slider("Required margin shock (%)", min_value=0, max_value=75, value=0)
    with slider_cols[1]:
        collateral_haircut = st.slider("Collateral haircut (%)", min_value=0, max_value=75, value=0)

    shocked_required = result["total_required"] * (1 + required_shock / 100)
    shocked_collateral = result["inputs"]["collateral"] * (1 - collateral_haircut / 100)
    shocked_available = result["cash_after_transfers"] + shocked_collateral
    shocked_buffer = shocked_available - shocked_required
    shocked_utilization = (shocked_required / shocked_available * 100) if shocked_available > 0 else 0.0

    metric_cols = st.columns(4)
    with metric_cols[0]:
        render_metric_card("Shocked Required", money(shocked_required), "Margin after the stress shock")
    with metric_cols[1]:
        render_metric_card("Shocked Collateral", money(shocked_collateral), "Collateral after haircut")
    with metric_cols[2]:
        render_metric_card("Shocked Available", money(shocked_available), "Cash plus shocked collateral")
    with metric_cols[3]:
        render_metric_card("Shocked Utilization", percent(shocked_utilization), "Required divided by available")

    if shocked_buffer < 0:
        render_status_box("stress", "Scenario Shortfall", money(abs(shocked_buffer)), "Under this stress case, the account would fall below the required margin threshold.")
    else:
        render_status_box("safe", "Scenario Buffer", money(shocked_buffer), "The account still keeps a positive margin cushion under the selected stress assumptions.")


def render_scratchpad_tab() -> None:
    st.subheader("Excel-Style Scratchpad")
    st.caption("Formulas are evaluated with a safe AST parser, not with Python eval.")

    with st.form("scratchpad_form", clear_on_submit=True):
        form_cols = st.columns([1.2, 2.3, 0.8])
        with form_cols[0]:
            label = st.text_input("Label", placeholder="Optional")
        with form_cols[1]:
            expression = st.text_input("Formula", placeholder="50000 * 1.05 or 12500 + 4500")
        with form_cols[2]:
            submitted = st.form_submit_button("Add line", type="primary", use_container_width=True)

    if submitted:
        try:
            result = evaluate_expression(expression)
            st.session_state.scratchpad_rows.append(
                {
                    "Time": datetime.now().strftime("%H:%M:%S"),
                    "Label": label.strip() or "-",
                    "Formula": expression.strip(),
                    "Result": result,
                }
            )
        except Exception as exc:
            st.error(f"Could not evaluate formula: {exc}")

    action_cols = st.columns(2)
    with action_cols[0]:
        if st.button("Remove last line", use_container_width=True) and st.session_state.scratchpad_rows:
            st.session_state.scratchpad_rows.pop()
            st.rerun()
    with action_cols[1]:
        if st.button("Clear scratchpad", use_container_width=True):
            st.session_state.scratchpad_rows = []
            st.rerun()

    if not st.session_state.scratchpad_rows:
        st.info("Add formulas to build a running total.")
        return

    history_df = pd.DataFrame(st.session_state.scratchpad_rows)
    total_value = float(history_df["Result"].sum())
    display_df = history_df.copy()
    display_df.insert(0, "Row", range(1, len(display_df) + 1))
    display_df["Result"] = display_df["Result"].map(lambda value: f"{value:,.2f}")
    total_row = pd.DataFrame([{"Row": "", "Time": "", "Label": "TOTAL", "Formula": "", "Result": f"{total_value:,.2f}"}])
    display_df = pd.concat([display_df, total_row], ignore_index=True)

    st.dataframe(display_df, use_container_width=True, hide_index=True)
    render_metric_card("Scratchpad Total", f"{total_value:,.2f}", "Running total of all results above")
    st.download_button("Download scratchpad CSV", data=history_df.to_csv(index=False).encode("utf-8"), file_name="scratchpad_history.csv", mime="text/csv")


def main() -> None:
    ensure_session_defaults()
    render_sidebar()
    render_header()

    funds_tab, liquidation_tab, stress_tab, scratchpad_tab = st.tabs(["Funds and RMS", "Liquidation", "Stress Test", "Scratchpad"])
    with funds_tab:
        render_funds_tab()
    with liquidation_tab:
        render_liquidation_tab()
    with stress_tab:
        render_stress_tab()
    with scratchpad_tab:
        render_scratchpad_tab()


if __name__ == "__main__":
    main()
