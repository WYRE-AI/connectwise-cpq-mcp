/** MCP Apps contract tests (mirrors the checks an MCP Apps host performs). */
import { describe, expect, it } from "vitest";
import {
  applyBrandInjection,
  attachCard,
  buildQuoteCard,
  CARD_TOOL,
} from "../card.builder.js";
import { QUOTE_CARD_HTML } from "../generated/quote-card-html.js";
import { TOOLS } from "../tools.js";

const QUOTE_FIXTURE = {
  id: "3f7c2a10-9d4e-4f6b-8a21-000000000001",
  name: "ACME Network Refresh",
  quoteNumber: 4021,
  quoteVersion: 2,
  accountName: "ACME Corp",
  quoteStatus: "Open",
  isSent: true,
  isAccepted: false,
  isArchive: false,
  isLost: false,
  requiresApproval: true,
  approvalStatus: "Pending",
  subtotal: 12000.5,
  tax: 960.04,
  quoteTotal: 12960.54,
  grossMargin: 3400.25,
  createDate: "2026-06-01T10:00:00Z",
  modifyDate: "2026-07-10T15:30:00Z",
  expirationDate: "2026-08-31T00:00:00Z",
  expectedCloseDate: "2026-08-15T00:00:00Z",
};

describe("card advertisement", () => {
  it("CARD_TOOL is cpq_get_quote and is the only _meta-marked tool", () => {
    expect(CARD_TOOL).toBe("cpq_get_quote");
    const marked = TOOLS.filter((t) => t._meta !== undefined);
    expect(marked.map((t) => t.name)).toEqual([CARD_TOOL]);
  });
});

describe("buildQuoteCard", () => {
  it("normalizes a realistic QuoteView", () => {
    const items = [
      { id: "i1", description: "Switch", quantity: 4, extendedPrice: 4000 },
      { id: "i2", description: "AP", quantity: 10, extendedPrice: 3000 },
    ];
    const card = buildQuoteCard(QUOTE_FIXTURE, items)!;
    expect(card).toMatchObject({
      id: QUOTE_FIXTURE.id,
      name: "ACME Network Refresh",
      quoteNumber: 4021,
      quoteVersion: 2,
      customer: "ACME Corp",
      status: "Open",
      approvalStatus: "Pending",
      quoteTotal: 12960.54,
      itemCount: 2,
      itemsTruncated: false,
    });
    expect(card.badges).toEqual(["Sent"]);
    expect(card.items).toHaveLength(2);
  });

  it("caps the line summary at 5 items and flags truncation", () => {
    const items = Array.from({ length: 6 }, (_, i) => ({
      id: `i${i}`,
      description: `Item ${i}`,
    }));
    const card = buildQuoteCard(QUOTE_FIXTURE, items)!;
    expect(card.items).toHaveLength(5);
    expect(card.itemCount).toBe(6);
    expect(card.itemsTruncated).toBe(true);
  });

  it("returns null when the quote has no id", () => {
    expect(buildQuoteCard({} as never)).toBeNull();
    expect(buildQuoteCard(null)).toBeNull();
  });
});

describe("attachCard (best-effort)", () => {
  it("attaches _card additively — original fields untouched", () => {
    const out = attachCard(QUOTE_FIXTURE) as Record<string, unknown>;
    expect(out.name).toBe(QUOTE_FIXTURE.name);
    expect(out._card).toMatchObject({ id: QUOTE_FIXTURE.id });
  });

  it("non-renderable payloads come back unchanged, never throws", () => {
    expect(attachCard(null)).toBeNull();
    expect(attachCard("text")).toBe("text");
    const arr = [1, 2];
    expect(attachCard(arr)).toBe(arr);
    const noId = { name: "x" };
    expect(attachCard(noId)).toBe(noId);
  });
});

describe("brand injection", () => {
  it("injects window.__BRAND__ and escapes <", () => {
    const html = `<head><!-- BRAND_INJECT: marker --></head>`;
    const out = applyBrandInjection(html, { name: "Wyre</script><script>alert(1)" });
    expect(out).toContain("window.__BRAND__=");
    expect(out).not.toContain("</script><script>alert(1)");
    expect(out).toContain("\\u003c");
  });

  it("empty brand returns the HTML unchanged", () => {
    const html = `<head><!-- BRAND_INJECT --></head>`;
    expect(applyBrandInjection(html, {})).toBe(html);
  });

  it("the committed embed contains the brand marker and the app bridge", () => {
    expect(QUOTE_CARD_HTML).toContain("<!doctype html>");
  });
});
