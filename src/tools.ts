/**
 * The complete ConnectWise CPQ tool surface — 25 tools, FLAT (no router).
 *
 * Deterministic ordering rule: all tools live in this single module-scope
 * `TOOLS` array, in the exact order of design.md §2 (grouped by entity, reads
 * before writes). `tools/list` returns this array by reference for every
 * request, every era, every caller. Never sorted at runtime, never filtered
 * per-session, never varied by credentials.
 *
 * Hand-written JSON Schema (no zod). Destructive tools follow fleet
 * convention §2.7b: description prefix + MCP annotations, and every
 * destructive description ends with "Confirm with the user before invoking."
 */
import type { Tool } from "@modelcontextprotocol/server";
import { CARD_META } from "./card.builder.js";
import { CONFIRM_ARG_PROPERTY } from "./elicitation.js";

// ── Shared schema fragments ────────────────────────────────────────────────

const conditionsProp = {
  type: "string" as const,
  description:
    'Manage-style condition string. Strings "double-quoted", booleans True/False, dates ' +
    "bracketed DATE-ONLY (time components are rejected): createDate >= [2026-07-01]. " +
    'Example: idQuote = "<guid>" and isArchive = False',
};

const includeFieldsProp = {
  type: "string" as const,
  description:
    "Comma-separated list of fields to return. Strongly encouraged — QuoteView has 204 " +
    "properties (e.g. id,name,quoteNumber,quoteVersion,quoteTotal).",
};

const pageProp = {
  type: "number" as const,
  description: "1-based page number (default 1).",
};

const pageSizeProp = {
  type: "number" as const,
  description: "Results per page (default 100, max 1000).",
};

const showAllVersionsProp = {
  type: "boolean" as const,
  description: "Include every quote version, not just the latest (default false).",
};

const fieldsProp = {
  type: "object" as const,
  additionalProperties: true,
  description:
    "Partial object of fields to set — each entry becomes an RFC 6902 replace op. " +
    "Use this OR `patch`, not both.",
};

const patchProp = {
  type: "array" as const,
  description: "Raw RFC 6902 JSON Patch operations. Use this OR `fields`, not both.",
  items: {
    type: "object" as const,
    properties: {
      op: {
        type: "string" as const,
        enum: ["add", "remove", "replace", "move", "copy", "test"],
      },
      path: { type: "string" as const, description: "JSON pointer, e.g. /name" },
      value: { description: "Value for add/replace/test ops." },
      from: { type: "string" as const, description: "Source pointer for move/copy ops." },
    },
    required: ["op", "path"],
  },
};

const READ_ANNOTATIONS = { readOnlyHint: true } as const;
const WRITE_ANNOTATIONS = { readOnlyHint: false } as const;
// Tier A/B destructive annotations are written inline on each destructive tool so
// scripts/lint-destructive-warnings.mjs finds the literal `destructiveHint: true`
// within its per-tool window.

// ── The 25 tools, design.md §2 order ───────────────────────────────────────

export const TOOLS: Tool[] = [
  // 1
  {
    name: "cpq_test_connection",
    description: "Verify ConnectWise CPQ credentials and report the authenticated API user.",
    inputSchema: { type: "object", properties: {} },
    annotations: READ_ANNOTATIONS,
  },
  // 2
  {
    name: "cpq_search_quotes",
    description:
      "Search quotes with Manage-style conditions, field selection, and paging. With no " +
      "conditions it asks for (or defaults to) a created-since date range.",
    inputSchema: {
      type: "object",
      properties: {
        conditions: conditionsProp,
        includeFields: includeFieldsProp,
        page: pageProp,
        pageSize: pageSizeProp,
        showAllVersions: showAllVersionsProp,
      },
    },
    annotations: READ_ANNOTATIONS,
  },
  // 3 — the only _meta-marked (MCP Apps card) tool
  {
    name: "cpq_get_quote",
    description: "Get a quote by GUID id (full QuoteView) — renders the quote card.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Quote GUID id." },
      },
      required: ["id"],
    },
    annotations: READ_ANNOTATIONS,
    _meta: { ...CARD_META },
  },
  // 4
  {
    name: "cpq_get_quote_versions",
    description:
      "List all versions of a quote number, or get the latest/a specific version.",
    inputSchema: {
      type: "object",
      properties: {
        quoteNumber: { type: "number", description: "Integer quote number." },
        version: {
          type: ["number", "string"],
          description:
            "Optional: 'latest' or a version integer. Omit to list all versions.",
        },
      },
      required: ["quoteNumber"],
    },
    annotations: READ_ANNOTATIONS,
  },
  // 5
  {
    name: "cpq_search_quote_items",
    description:
      'Search quote line items. Filter by quote or tab via conditions (idQuote = "<guid>" ' +
      'or idQuoteTabs = "<guid>").',
    inputSchema: {
      type: "object",
      properties: {
        conditions: conditionsProp,
        includeFields: includeFieldsProp,
        page: pageProp,
        pageSize: pageSizeProp,
        showAllVersions: showAllVersionsProp,
      },
    },
    annotations: READ_ANNOTATIONS,
  },
  // 6
  {
    name: "cpq_get_quote_item",
    description: "Get a quote line item by id.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Quote item GUID id." },
      },
      required: ["id"],
    },
    annotations: READ_ANNOTATIONS,
  },
  // 7
  {
    name: "cpq_list_quote_customers",
    description: "List the customer records attached to a quote.",
    inputSchema: {
      type: "object",
      properties: {
        quoteId: { type: "string", description: "Quote GUID id." },
      },
      required: ["quoteId"],
    },
    annotations: READ_ANNOTATIONS,
  },
  // 8
  {
    name: "cpq_search_quote_tabs",
    description:
      'Search quote tabs/sections. Filter by quote via conditions (idQuote = "<guid>").',
    inputSchema: {
      type: "object",
      properties: {
        conditions: conditionsProp,
        includeFields: includeFieldsProp,
        page: pageProp,
        pageSize: pageSizeProp,
        showAllVersions: showAllVersionsProp,
      },
    },
    annotations: READ_ANNOTATIONS,
  },
  // 9
  {
    name: "cpq_list_quote_terms",
    description: "List payment/financing term options on a quote.",
    inputSchema: {
      type: "object",
      properties: {
        quoteId: { type: "string", description: "Quote GUID id." },
        conditions: conditionsProp,
        page: pageProp,
        pageSize: pageSizeProp,
      },
      required: ["quoteId"],
    },
    annotations: READ_ANNOTATIONS,
  },
  // 10
  {
    name: "cpq_list_templates",
    description: "List quote templates (the source objects for quote creation).",
    inputSchema: { type: "object", properties: {} },
    annotations: READ_ANNOTATIONS,
  },
  // 11
  {
    name: "cpq_list_tax_codes",
    description: "List tax codes and rates.",
    inputSchema: {
      type: "object",
      properties: {
        conditions: conditionsProp,
        page: pageProp,
        pageSize: pageSizeProp,
      },
    },
    annotations: READ_ANNOTATIONS,
  },
  // 12
  {
    name: "cpq_list_recurring_revenues",
    description: "List recurring-revenue period definitions.",
    inputSchema: {
      type: "object",
      properties: {
        conditions: conditionsProp,
        page: pageProp,
        pageSize: pageSizeProp,
      },
    },
    annotations: READ_ANNOTATIONS,
  },
  // 13
  {
    name: "cpq_list_users",
    description: "List CPQ users (API users, approvers, admins).",
    inputSchema: {
      type: "object",
      properties: {
        conditions: conditionsProp,
        page: pageProp,
        pageSize: pageSizeProp,
      },
    },
    annotations: READ_ANNOTATIONS,
  },
  // 14
  {
    name: "cpq_create_quote_from_template",
    description:
      "Create a new quote by copying a template or existing quote — the API's only quote " +
      "create path. Provide templateId, or templateName to resolve (ambiguous names are " +
      "elicited). newName renames the copy via a follow-up PATCH.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: {
          type: "string",
          description: "GUID of the template (or quote) to copy.",
        },
        templateName: {
          type: "string",
          description:
            "Template name to resolve when the GUID is unknown. Ambiguous matches are " +
            "elicited; without elicitation support, candidates are listed as an error.",
        },
        newName: {
          type: "string",
          description: "Optional name for the new quote (applied via follow-up PATCH).",
        },
      },
    },
    annotations: WRITE_ANNOTATIONS,
  },
  // 15
  {
    name: "cpq_update_quote",
    description:
      "⚠ HIGH-IMPACT. Update quote fields (name, status, dates, custom fields) via JSON " +
      "Patch. Changes to quoteStatus, isArchive, isLost, expirationDate, orderPorter* or " +
      "approval fields can flip customer-facing/workflow state — status, archive, and " +
      "order-porter changes affect what the customer sees. Confirm with the user before invoking.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Quote GUID id." },
        fields: fieldsProp,
        patch: patchProp,
      },
      required: ["id"],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  // 16
  {
    name: "cpq_create_quote_item",
    description:
      "Add a line item to a quote tab. If idQuoteTabs is omitted, a single tab is used " +
      "automatically and multiple tabs prompt a selection.",
    inputSchema: {
      type: "object",
      properties: {
        idQuote: { type: "string", description: "Quote GUID id." },
        idQuoteTabs: {
          type: "string",
          description: "Quote tab GUID id (elicited if omitted and the quote has several tabs).",
        },
        item: {
          type: "object",
          additionalProperties: true,
          description:
            "Line item fields (e.g. mfgPartNumber, description, quantity, basePrice, cost).",
        },
      },
      required: ["idQuote", "item"],
    },
    annotations: WRITE_ANNOTATIONS,
  },
  // 17
  {
    name: "cpq_update_quote_item",
    description: "Update a quote line item (pricing, quantity, flags) via JSON Patch.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Quote item GUID id." },
        fields: fieldsProp,
        patch: patchProp,
      },
      required: ["id"],
    },
    annotations: WRITE_ANNOTATIONS,
  },
  // 18
  {
    name: "cpq_update_quote_customer",
    description: "Update a customer record on a quote via JSON Patch.",
    inputSchema: {
      type: "object",
      properties: {
        quoteId: { type: "string", description: "Quote GUID id." },
        id: { type: "string", description: "Customer record GUID id." },
        fields: fieldsProp,
        patch: patchProp,
      },
      required: ["quoteId", "id"],
    },
    annotations: WRITE_ANNOTATIONS,
  },
  // 19
  {
    name: "cpq_create_quote_term",
    description: "Add a payment/financing term option to a quote.",
    inputSchema: {
      type: "object",
      properties: {
        quoteId: { type: "string", description: "Quote GUID id." },
        term: {
          type: "object",
          additionalProperties: true,
          description: "Term fields (e.g. name, periods, interestRate, paymentAmount).",
        },
      },
      required: ["quoteId", "term"],
    },
    annotations: WRITE_ANNOTATIONS,
  },
  // 20
  {
    name: "cpq_update_quote_term",
    description: "Update a quote term via JSON Patch.",
    inputSchema: {
      type: "object",
      properties: {
        quoteId: { type: "string", description: "Quote GUID id." },
        id: { type: "string", description: "Quote term GUID id." },
        fields: fieldsProp,
        patch: patchProp,
      },
      required: ["quoteId", "id"],
    },
    annotations: WRITE_ANNOTATIONS,
  },
  // 21
  {
    name: "cpq_delete_quote_item",
    description:
      "⚠ DESTRUCTIVE — IRREVERSIBLE. Permanently delete a quote line item. Confirm with " +
      "the user before invoking.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Quote item GUID id." },
        ...CONFIRM_ARG_PROPERTY,
      },
      required: ["id"],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  // 22
  {
    name: "cpq_delete_quote_term",
    description:
      "⚠ DESTRUCTIVE — IRREVERSIBLE. Permanently delete a quote term option. Confirm with " +
      "the user before invoking.",
    inputSchema: {
      type: "object",
      properties: {
        quoteId: { type: "string", description: "Quote GUID id." },
        id: { type: "string", description: "Quote term GUID id." },
        ...CONFIRM_ARG_PROPERTY,
      },
      required: ["quoteId", "id"],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  // 23
  {
    name: "cpq_delete_quote_customer",
    description:
      "⚠ DESTRUCTIVE — IRREVERSIBLE. Remove a customer record from a quote. Confirm with " +
      "the user before invoking.",
    inputSchema: {
      type: "object",
      properties: {
        quoteId: { type: "string", description: "Quote GUID id." },
        id: { type: "string", description: "Customer record GUID id." },
        ...CONFIRM_ARG_PROPERTY,
      },
      required: ["quoteId", "id"],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  // 24
  {
    name: "cpq_delete_quote_version",
    description:
      "⚠ DESTRUCTIVE — IRREVERSIBLE. Permanently delete a specific version of a quote. " +
      "Confirm with the user before invoking.",
    inputSchema: {
      type: "object",
      properties: {
        quoteNumber: { type: "number", description: "Integer quote number." },
        quoteVersion: { type: "number", description: "Integer version to delete." },
        ...CONFIRM_ARG_PROPERTY,
      },
      required: ["quoteNumber", "quoteVersion"],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  // 25
  {
    name: "cpq_delete_quote",
    description:
      "⚠ DESTRUCTIVE — IRREVERSIBLE. Permanently delete a quote and all of its line items, " +
      "tabs, and terms. Confirm with the user before invoking.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Quote GUID id." },
        ...CONFIRM_ARG_PROPERTY,
      },
      required: ["id"],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
];

/** Deterministic name list (used by tests and the smoke script). */
export const TOOL_NAMES: string[] = TOOLS.map((t) => t.name);
