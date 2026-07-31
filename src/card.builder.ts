/**
 * Quote-card payload builder for the MCP Apps (SEP-1865) UI surface.
 *
 * `cpq_get_quote` results get a normalized `_card` object attached that the
 * ui:// quote card renders from. The card is progressive enhancement:
 * normalization is best-effort, and a null return simply means the host
 * renders no card while the model-visible JSON payload is unchanged.
 */

import type { QuoteItemView, QuoteView } from "@wyre-technology/node-connectwise-cpq";

export const CARD_RESOURCE_URI = "ui://connectwise-cpq/quote-card.html";

/** Tool whose results carry the `_card` payload and advertise the UI. */
export const CARD_TOOL = "cpq_get_quote";

/** MCP Apps resource MIME (RESOURCE_MIME_TYPE in @modelcontextprotocol/ext-apps). */
export const MCP_APP_RESOURCE_MIME = "text/html;profile=mcp-app";

/**
 * Tool `_meta` advertising the card. Carries both the canonical flat key
 * (RESOURCE_URI_META_KEY in ext-apps) and the nested form ext-apps'
 * registerAppTool emits, so any MCP Apps host revision finds it.
 */
export const CARD_META = {
  "ui/resourceUri": CARD_RESOURCE_URI,
  ui: { resourceUri: CARD_RESOURCE_URI },
} as const;

/** Line-item summary row rendered by the card. */
export interface QuoteCardItem {
  description?: string;
  quantity?: number;
  extendedPrice?: number;
}

/** Mirror of QuoteCard in ui/quote-card.ts — keep in sync. */
export interface QuoteCard {
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

/** Brand overrides injected into the card as `window.__BRAND__`. */
export interface CardBrand {
  name?: string;
  logoUrl?: string;
  primaryColor?: string;
  accentColor?: string;
  bg?: string;
  text?: string;
}

/** The comment marker in ui/index.html that serve-time injection replaces. */
const BRAND_INJECT_MARKER = /<!--\s*BRAND_INJECT[\s\S]*?-->/;

/**
 * Replace the card's BRAND_INJECT comment with a `window.__BRAND__` script.
 * The card ships neutral; this is the customization mechanism. An empty
 * brand returns the HTML unchanged. `<` is escaped so brand values can
 * never break out of the injected script tag.
 */
export function applyBrandInjection(html: string, brand: CardBrand): string {
  const entries = Object.entries(brand).filter(
    ([, value]) => typeof value === "string" && value !== ""
  );
  if (entries.length === 0) return html;
  const json = JSON.stringify(Object.fromEntries(entries)).replace(/</g, "\\u003c");
  return html.replace(BRAND_INJECT_MARKER, `<script>window.__BRAND__=${json}</script>`);
}

/**
 * Resolve brand overrides from MCP_BRAND_* environment variables. Returns
 * an empty brand (HTML served unchanged) when none are set.
 */
export function resolveBrandFromEnv(): CardBrand {
  if (typeof process === "undefined" || !process.env) return {};
  const env = process.env;
  const brand: CardBrand = {};
  if (env.MCP_BRAND_NAME) brand.name = env.MCP_BRAND_NAME;
  if (env.MCP_BRAND_LOGO_URL) brand.logoUrl = env.MCP_BRAND_LOGO_URL;
  if (env.MCP_BRAND_PRIMARY_COLOR) brand.primaryColor = env.MCP_BRAND_PRIMARY_COLOR;
  if (env.MCP_BRAND_ACCENT_COLOR) brand.accentColor = env.MCP_BRAND_ACCENT_COLOR;
  if (env.MCP_BRAND_BG) brand.bg = env.MCP_BRAND_BG;
  if (env.MCP_BRAND_TEXT) brand.text = env.MCP_BRAND_TEXT;
  return brand;
}

const CARD_MAX_ITEMS = 5;

/**
 * Normalize a QuoteView (+ optional first page of line items) into the flat
 * payload the ui:// quote card renders from. Returns null when the quote is
 * not renderable (no id) — the host then simply shows no card.
 */
export function buildQuoteCard(
  quote: Partial<QuoteView> | null | undefined,
  items?: QuoteItemView[]
): QuoteCard | null {
  if (!quote || typeof quote.id !== "string" || quote.id === "") return null;

  const card: QuoteCard = {
    id: quote.id,
    name: typeof quote.name === "string" && quote.name !== "" ? quote.name : "Quote",
    badges: [],
  };

  if (typeof quote.quoteNumber === "number") card.quoteNumber = quote.quoteNumber;
  if (typeof quote.quoteVersion === "number") card.quoteVersion = quote.quoteVersion;
  if (typeof quote.accountName === "string" && quote.accountName) {
    card.customer = quote.accountName;
  }
  if (typeof quote.quoteStatus === "string" && quote.quoteStatus) {
    card.status = quote.quoteStatus;
  }
  if (quote.isAccepted === true) card.badges.push("Accepted");
  if (quote.isSent === true) card.badges.push("Sent");
  if (quote.isArchive === true) card.badges.push("Archived");
  if (quote.isLost === true) card.badges.push("Lost");
  if (quote.requiresApproval === true && typeof quote.approvalStatus === "string") {
    card.approvalStatus = quote.approvalStatus;
  }

  if (Array.isArray(items)) {
    card.itemCount = items.length;
    card.itemsTruncated = items.length > CARD_MAX_ITEMS;
    card.items = items.slice(0, CARD_MAX_ITEMS).map((item) => {
      const row: QuoteCardItem = {};
      if (typeof item.description === "string" && item.description) {
        row.description = item.description;
      } else if (typeof item.mfgPartNumber === "string" && item.mfgPartNumber) {
        row.description = item.mfgPartNumber;
      }
      if (typeof item.quantity === "number") row.quantity = item.quantity;
      if (typeof item.extendedPrice === "number") row.extendedPrice = item.extendedPrice;
      return row;
    });
  }

  if (typeof quote.subtotal === "number") card.subtotal = quote.subtotal;
  if (typeof quote.tax === "number") card.tax = quote.tax;
  if (typeof quote.quoteTotal === "number") card.quoteTotal = quote.quoteTotal;
  if (typeof quote.grossMargin === "number") card.grossMargin = quote.grossMargin;
  if (typeof quote.createDate === "string") card.createDate = quote.createDate;
  if (typeof quote.modifyDate === "string") card.modifyDate = quote.modifyDate;
  if (typeof quote.expirationDate === "string") card.expirationDate = quote.expirationDate;
  if (typeof quote.expectedCloseDate === "string") {
    card.expectedCloseDate = quote.expectedCloseDate;
  }

  return card;
}

/**
 * Attach a `_card` payload to a quote result — best-effort by construction.
 * A build failure or non-object result returns the result unchanged, so
 * non-App hosts and every failure mode get the full JSON.
 */
export function attachCard(result: unknown, items?: QuoteItemView[]): unknown {
  try {
    const card = buildQuoteCard(result as Partial<QuoteView>, items);
    if (card && result && typeof result === "object" && !Array.isArray(result)) {
      return { ...result, _card: card };
    }
  } catch {
    // Card building must never break the tool result.
  }
  return result;
}
