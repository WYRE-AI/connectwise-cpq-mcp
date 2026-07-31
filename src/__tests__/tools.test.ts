/** Tool-surface contract tests: count, names, order, schemas, warnings, annotations. */
import { describe, expect, it } from "vitest";
import { CARD_RESOURCE_URI } from "../card.builder.js";
import { TOOLS, TOOL_NAMES } from "../tools.js";

/** design.md §2 order — the single source of truth for the surface. */
const EXPECTED_ORDER = [
  "cpq_test_connection",
  "cpq_search_quotes",
  "cpq_get_quote",
  "cpq_get_quote_versions",
  "cpq_search_quote_items",
  "cpq_get_quote_item",
  "cpq_list_quote_customers",
  "cpq_search_quote_tabs",
  "cpq_list_quote_terms",
  "cpq_list_templates",
  "cpq_list_tax_codes",
  "cpq_list_recurring_revenues",
  "cpq_list_users",
  "cpq_create_quote_from_template",
  "cpq_update_quote",
  "cpq_create_quote_item",
  "cpq_update_quote_item",
  "cpq_update_quote_customer",
  "cpq_create_quote_term",
  "cpq_update_quote_term",
  "cpq_delete_quote_item",
  "cpq_delete_quote_term",
  "cpq_delete_quote_customer",
  "cpq_delete_quote_version",
  "cpq_delete_quote",
];

const TIER_A = [
  "cpq_delete_quote_item",
  "cpq_delete_quote_term",
  "cpq_delete_quote_customer",
  "cpq_delete_quote_version",
  "cpq_delete_quote",
];

describe("tool surface", () => {
  it("has exactly 25 tools in the design.md order", () => {
    expect(TOOLS).toHaveLength(25);
    expect(TOOL_NAMES).toEqual(EXPECTED_ORDER);
  });

  it("every tool has a description and an object inputSchema", () => {
    for (const tool of TOOLS) {
      expect(tool.description, tool.name).toBeTruthy();
      expect(tool.inputSchema.type, tool.name).toBe("object");
    }
  });

  it("Tier A deletes carry the IRREVERSIBLE prefix, confirm suffix, and annotations", () => {
    for (const name of TIER_A) {
      const tool = TOOLS.find((t) => t.name === name)!;
      expect(tool.description, name).toMatch(/^⚠ DESTRUCTIVE — IRREVERSIBLE\./u);
      expect(tool.description, name).toMatch(/Confirm with the user before invoking\.$/u);
      expect(tool.annotations, name).toMatchObject({
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      });
    }
  });

  it("cpq_update_quote is Tier B (HIGH-IMPACT, idempotent)", () => {
    const tool = TOOLS.find((t) => t.name === "cpq_update_quote")!;
    expect(tool.description).toMatch(/^⚠ HIGH-IMPACT\./u);
    expect(tool.description).toMatch(/Confirm with the user before invoking\.$/u);
    expect(tool.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    });
  });

  it("reads are readOnlyHint:true, plain writes readOnlyHint:false without warnings", () => {
    const reads = EXPECTED_ORDER.slice(0, 13);
    for (const name of reads) {
      const tool = TOOLS.find((t) => t.name === name)!;
      expect(tool.annotations?.readOnlyHint, name).toBe(true);
      expect(tool.description, name).not.toContain("⚠");
    }
    const plainWrites = [
      "cpq_create_quote_from_template",
      "cpq_create_quote_item",
      "cpq_update_quote_item",
      "cpq_update_quote_customer",
      "cpq_create_quote_term",
      "cpq_update_quote_term",
    ];
    for (const name of plainWrites) {
      const tool = TOOLS.find((t) => t.name === name)!;
      expect(tool.annotations?.readOnlyHint, name).toBe(false);
      expect(tool.description, name).not.toContain("⚠");
    }
  });

  it("only cpq_get_quote advertises the MCP Apps card via _meta (both key forms)", () => {
    for (const tool of TOOLS) {
      if (tool.name === "cpq_get_quote") {
        expect(tool._meta?.["ui/resourceUri"]).toBe(CARD_RESOURCE_URI);
        expect((tool._meta?.ui as { resourceUri?: string })?.resourceUri).toBe(
          CARD_RESOURCE_URI
        );
      } else {
        expect(tool._meta, tool.name).toBeUndefined();
      }
    }
  });

  it("required arguments match the design table", () => {
    const required = (name: string) =>
      (TOOLS.find((t) => t.name === name)!.inputSchema as { required?: string[] }).required ??
      [];
    expect(required("cpq_get_quote")).toEqual(["id"]);
    expect(required("cpq_get_quote_versions")).toEqual(["quoteNumber"]);
    expect(required("cpq_list_quote_customers")).toEqual(["quoteId"]);
    expect(required("cpq_list_quote_terms")).toEqual(["quoteId"]);
    expect(required("cpq_update_quote")).toEqual(["id"]);
    expect(required("cpq_create_quote_item")).toEqual(["idQuote", "item"]);
    expect(required("cpq_create_quote_term")).toEqual(["quoteId", "term"]);
    expect(required("cpq_update_quote_customer")).toEqual(["quoteId", "id"]);
    expect(required("cpq_delete_quote_version")).toEqual(["quoteNumber", "quoteVersion"]);
    expect(required("cpq_delete_quote")).toEqual(["id"]);
  });
});
