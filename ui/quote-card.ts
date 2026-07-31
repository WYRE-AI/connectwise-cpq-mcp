/**
 * Iframe bridge + renderer for the ConnectWise CPQ quote card (MCP Apps).
 *
 * Runs inside the host's sandboxed iframe. Uses the official MCP Apps client
 * (`App`) to receive the cpq_get_quote tool result from the host.
 *
 * READ-ONLY by design: no intents, no tool calls back to the server — the
 * card only renders. Rendering uses DOM construction (no innerHTML) — quote
 * names, customer names and item descriptions are untrusted vendor data, so
 * text only ever lands in text nodes.
 *
 * White-label: neutral by default; applies an injected `window.__BRAND__`
 * override (set by the MCP server via MCP_BRAND_* env vars) onto the CSS
 * custom properties.
 */
import { App } from "@modelcontextprotocol/ext-apps";

interface Brand {
  name?: string;
  logoUrl?: string;
  primaryColor?: string;
  accentColor?: string;
  bg?: string;
  text?: string;
}
declare global {
  interface Window {
    __BRAND__?: Brand;
  }
}

/** Mirror of QuoteCard in src/card.builder.ts — keep in sync. */
interface QuoteCardItem {
  description?: string;
  quantity?: number;
  extendedPrice?: number;
}
interface QuoteCard {
  id: string;
  name: string;
  quoteNumber?: number;
  quoteVersion?: number;
  customer?: string;
  status?: string;
  badges: string[];
  approvalStatus?: string;
  items?: QuoteCardItem[];
  itemCount?: number;
  itemsTruncated?: boolean;
  subtotal?: number;
  tax?: number;
  quoteTotal?: number;
  grossMargin?: number;
  createDate?: string;
  modifyDate?: string;
  expirationDate?: string;
  expectedCloseDate?: string;
}

const brand: Brand = window.__BRAND__ ?? {};

function applyBrand(): void {
  const root = document.documentElement.style;
  if (brand.primaryColor) root.setProperty("--brand-primary", brand.primaryColor);
  if (brand.accentColor) root.setProperty("--brand-accent", brand.accentColor);
  if (brand.bg) root.setProperty("--brand-bg", brand.bg);
  if (brand.text) root.setProperty("--brand-text", brand.text);
}

const app = new App({ name: "ConnectWise CPQ Quote Card", version: "1.0.0" });

/** Create an element with a class and (safe, text-node) children. */
function el(
  tag: string,
  className = "",
  ...children: Array<Node | string | null>
): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const child of children) {
    if (child == null) continue;
    node.append(child); // strings become text nodes — never parsed as HTML
  }
  return node;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function fmtMoney(value: number | undefined): string {
  if (typeof value !== "number") return "";
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function field(label: string, value: string | undefined): HTMLElement | null {
  if (!value) return null;
  return el(
    "div",
    "field",
    el("div", "field__label", label),
    el("div", "field__value", value)
  );
}

function badge(text: string | undefined, cls: string): HTMLElement | null {
  return text ? el("span", `badge ${cls}`, text) : null;
}

function itemsTable(card: QuoteCard): HTMLElement | null {
  if (!card.items || card.items.length === 0) return null;
  const head = el(
    "tr",
    "",
    el("th", "", "Item"),
    el("th", "num", "Qty"),
    el("th", "num", "Ext. price")
  );
  const rows = card.items.map((item) =>
    el(
      "tr",
      "",
      el("td", "", item.description ?? "—"),
      el("td", "num", item.quantity != null ? String(item.quantity) : ""),
      el("td", "num", fmtMoney(item.extendedPrice))
    )
  );
  const count =
    card.itemCount != null ? ` (${card.itemsTruncated ? `${card.itemCount}+` : card.itemCount})` : "";
  const table = document.createElement("table");
  table.append(head, ...rows);
  return el("div", "items", el("div", "items__h", `Line items${count}`), table);
}

function totalsBlock(card: QuoteCard): HTMLElement | null {
  const rows: HTMLElement[] = [];
  const add = (label: string, value: number | undefined, grand = false) => {
    if (typeof value !== "number") return;
    rows.push(el("div", "label", label), el("div", grand ? "value grand" : "value", fmtMoney(value)));
  };
  add("Subtotal", card.subtotal);
  add("Tax", card.tax);
  add("Total", card.quoteTotal, true);
  add("Gross margin", card.grossMargin);
  if (rows.length === 0) return null;
  return el("div", "totals", ...rows);
}

function render(card: QuoteCard): void {
  const brandId = el("span", "brandid");
  if (brand.logoUrl) {
    const logo = document.createElement("img");
    logo.src = brand.logoUrl;
    logo.alt = brand.name ?? "";
    logo.style.display = "inline-block";
    brandId.append(logo);
  }
  if (brand.name) brandId.append(el("span", "brand", brand.name));

  const numberLabel =
    card.quoteNumber != null
      ? `#${card.quoteNumber}${card.quoteVersion != null ? ` v${card.quoteVersion}` : ""}`
      : card.id.slice(0, 8);

  const body = el(
    "div",
    "card__body",
    el("div", "brandrow", brandId, el("span", "quoteid", `${numberLabel} · ConnectWise CPQ`)),
    el("h1", "", card.name),
    el(
      "div",
      "badges",
      badge(card.status, "badge--status"),
      ...card.badges.map((b) => badge(b, "badge--flag")),
      badge(card.approvalStatus && `Approval: ${card.approvalStatus}`, "badge--flag")
    ),
    el(
      "div",
      "grid",
      field("Customer", card.customer),
      field("Created", card.createDate && fmtDate(card.createDate)),
      field("Modified", card.modifyDate && fmtDate(card.modifyDate)),
      field("Expires", card.expirationDate && fmtDate(card.expirationDate)),
      field("Expected close", card.expectedCloseDate && fmtDate(card.expectedCloseDate))
    ),
    itemsTable(card),
    totalsBlock(card)
  );

  const root = document.getElementById("root")!;
  root.replaceChildren(el("div", "card", el("div", "card__bar"), body));
}

// connectwise-cpq-mcp returns the QuoteView JSON directly, with the
// normalized card attached as a top-level _card field.
function extractCard(obj: unknown): QuoteCard | null {
  const card = (obj as { _card?: QuoteCard })?._card;
  return card && typeof card.id === "string" && card.name ? card : null;
}

applyBrand();

// Must be set before connect() so the initial tool-result isn't missed.
app.ontoolresult = (result: { content?: Array<{ type: string; text?: string }> }) => {
  const payload = (result.content ?? []).find((c) => c.type === "text");
  if (!payload?.text) return;
  try {
    const card = extractCard(JSON.parse(payload.text));
    if (card) render(card);
  } catch {
    /* ignore malformed payloads */
  }
};

app.connect();
