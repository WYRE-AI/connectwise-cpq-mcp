/**
 * Handler tests against a stubbed CpqClient. Elicitation is exercised through
 * the real MRTR helpers by passing an ElicitationContext: a form-capable
 * caller with no responses gets an `input_required` ask; a retried request
 * carries the answer in `inputResponses`; no context means no elicitation
 * (the stateless legacy fallback).
 */
import { describe, expect, it, vi } from "vitest";
import type { InputRequiredResult } from "@modelcontextprotocol/server";
import type { CpqClient } from "@wyre-technology/node-connectwise-cpq";
import type { ElicitationContext } from "../elicitation.js";
import { handleToolCall } from "../handlers/index.js";
import type { ToolResult } from "../handlers/results.js";

type Stub = Record<string, Record<string, ReturnType<typeof vi.fn>>>;

function stubClient(overrides: Stub = {}): CpqClient {
  const base: Stub = {
    quotes: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue({ id: "q-1", name: "Quote A", quoteNumber: 7 }),
      update: vi.fn().mockResolvedValue({ id: "q-1" }),
      updateFields: vi.fn().mockResolvedValue({ id: "q-1", name: "Renamed" }),
      delete: vi.fn().mockResolvedValue(undefined),
      copyFromTemplate: vi.fn().mockResolvedValue({ id: "q-new", name: "Copy" }),
      listVersions: vi.fn().mockResolvedValue([]),
      getVersion: vi.fn().mockResolvedValue({ id: "q-1", name: "Quote A" }),
      deleteVersion: vi.fn().mockResolvedValue(undefined),
    },
    quoteItems: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue({ id: "qi-1", description: "Widget" }),
      create: vi.fn().mockResolvedValue({ id: "qi-new" }),
      update: vi.fn().mockResolvedValue({ id: "qi-1" }),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    quoteCustomers: {
      list: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({ id: "qc-1" }),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    quoteTabs: { list: vi.fn().mockResolvedValue([]), listItems: vi.fn() },
    quoteTerms: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: "qt-new" }),
      update: vi.fn().mockResolvedValue({ id: "qt-1" }),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    templates: { list: vi.fn().mockResolvedValue([]) },
    taxCodes: { list: vi.fn().mockResolvedValue([]) },
    recurringRevenues: { list: vi.fn().mockResolvedValue([]) },
    users: { list: vi.fn().mockResolvedValue([{ id: "u-1" }]) },
  };
  for (const [key, methods] of Object.entries(overrides)) {
    base[key] = { ...base[key], ...methods };
  }
  return base as unknown as CpqClient;
}

const FORM_CAPABLE: ElicitationContext = { clientCapabilities: { elicitation: {} } };

/** A retried request carrying the user's accepted answer for `key`. */
function answered(key: string, content: Record<string, unknown>): ElicitationContext {
  return {
    clientCapabilities: { elicitation: {} },
    inputResponses: { [key]: { action: "accept", content } },
  };
}

/** Narrow a handler result to a plain tool result (i.e. not an MRTR ask). */
function asTool(result: ToolResult | InputRequiredResult): ToolResult {
  expect((result as { resultType?: string }).resultType).toBeUndefined();
  return result as ToolResult;
}

function parse(result: ToolResult | InputRequiredResult): Record<string, unknown> {
  return JSON.parse(asTool(result).content[0].text);
}

describe("dispatch", () => {
  it("unknown tool → isError", async () => {
    const result = await handleToolCall(stubClient(), "cpq_nope", {});
    expect(result.isError).toBe(true);
  });

  it("missing required argument → isError, no vendor call", async () => {
    const client = stubClient();
    const result = asTool(await handleToolCall(client, "cpq_get_quote", {}));
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('"id"');
    expect((client.quotes.get as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });
});

describe("cpq_search_quotes", () => {
  it("passes conditions through untouched", async () => {
    const client = stubClient();
    await handleToolCall(client, "cpq_search_quotes", { conditions: 'name = "X"' });
    expect(client.quotes.list).toHaveBeenCalledWith(
      expect.objectContaining({ conditions: 'name = "X"' })
    );
  });

  it("no conditions + no elicitation → defaults to last 90 days with a note", async () => {
    const client = stubClient();
    const result = await handleToolCall(client, "cpq_search_quotes", {});
    const payload = parse(result);
    expect(payload.conditions).toMatch(/^createDate >= \[\d{4}-\d{2}-\d{2}\]$/);
    expect(payload.note).toContain("last 90 days");
  });

  it("no conditions + form-capable caller → asks for a date before listing", async () => {
    const client = stubClient();
    const result = await handleToolCall(client, "cpq_search_quotes", {}, FORM_CAPABLE);
    expect((result as InputRequiredResult).resultType).toBe("input_required");
    expect(client.quotes.list).not.toHaveBeenCalled();
  });

  it("no conditions + elicited date → uses the user's date", async () => {
    const client = stubClient();
    const result = await handleToolCall(
      client,
      "cpq_search_quotes",
      {},
      answered("fromDate", { fromDate: "2026-05-01" })
    );
    expect(parse(result).conditions).toBe("createDate >= [2026-05-01]");
  });
});

describe("cpq_get_quote (card tool)", () => {
  it("attaches an additive _card and keeps the full quote JSON", async () => {
    const client = stubClient({
      quoteItems: {
        list: vi.fn().mockResolvedValue([
          { id: "qi-1", description: "Widget", quantity: 2, extendedPrice: 100 },
        ]),
      },
    });
    const result = await handleToolCall(client, "cpq_get_quote", { id: "q-1" });
    const payload = parse(result);
    expect(payload.id).toBe("q-1");
    expect(payload.name).toBe("Quote A");
    const card = payload._card as Record<string, unknown>;
    expect(card.id).toBe("q-1");
    expect((card.items as unknown[]).length).toBe(1);
  });

  it("items fetch failure still returns the quote (card without line summary)", async () => {
    const client = stubClient({
      quoteItems: { list: vi.fn().mockRejectedValue(new Error("boom")) },
    });
    const result = await handleToolCall(client, "cpq_get_quote", { id: "q-1" });
    expect(result.isError).toBeUndefined();
    const payload = parse(result);
    expect(payload.id).toBe("q-1");
    expect((payload._card as Record<string, unknown>).items).toBeUndefined();
  });
});

describe("cpq_create_quote_from_template", () => {
  it("requires templateId or templateName", async () => {
    const result = await handleToolCall(stubClient(), "cpq_create_quote_from_template", {});
    expect(result.isError).toBe(true);
  });

  it("resolves a unique templateName and copies it", async () => {
    const client = stubClient({
      templates: {
        list: vi.fn().mockResolvedValue([
          { id: "t-1", name: "MSP Onboarding" },
          { id: "t-2", name: "Hardware Refresh" },
        ]),
      },
    });
    const result = await handleToolCall(client, "cpq_create_quote_from_template", {
      templateName: "hardware refresh",
    });
    expect(client.quotes.copyFromTemplate).toHaveBeenCalledWith("t-2");
    expect(result.isError).toBeUndefined();
  });

  it("ambiguous name without elicitation → error listing candidates, no POST", async () => {
    const client = stubClient({
      templates: {
        list: vi.fn().mockResolvedValue([
          { id: "t-1", name: "Standard Quote" },
          { id: "t-2", name: "Standard Quote (EU)" },
        ]),
      },
    });
    const result = asTool(
      await handleToolCall(client, "cpq_create_quote_from_template", {
        templateName: "standard",
      })
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("t-1");
    expect(client.quotes.copyFromTemplate).not.toHaveBeenCalled();
  });

  it("newName triggers the follow-up rename PATCH after the copy", async () => {
    const client = stubClient();
    const result = await handleToolCall(client, "cpq_create_quote_from_template", {
      templateId: "t-1",
      newName: "ACME Q3",
    });
    expect(client.quotes.copyFromTemplate).toHaveBeenCalledWith("t-1");
    expect(client.quotes.updateFields).toHaveBeenCalledWith("q-new", { name: "ACME Q3" });
    expect(result.isError).toBeUndefined();
  });
});

describe("update tools (fields/patch)", () => {
  it("fields become replace ops", async () => {
    const client = stubClient();
    await handleToolCall(client, "cpq_update_quote", {
      id: "q-1",
      fields: { name: "New name", isArchive: true },
    });
    expect(client.quotes.update).toHaveBeenCalledWith("q-1", [
      { op: "replace", path: "/name", value: "New name" },
      { op: "replace", path: "/isArchive", value: true },
    ]);
  });

  it("raw patch ops pass through", async () => {
    const client = stubClient();
    const ops = [{ op: "replace", path: "/quantity", value: 3 }];
    await handleToolCall(client, "cpq_update_quote_item", { id: "qi-1", patch: ops });
    expect(client.quoteItems.update).toHaveBeenCalledWith("qi-1", ops);
  });

  it("both fields and patch → isError", async () => {
    const result = await handleToolCall(stubClient(), "cpq_update_quote", {
      id: "q-1",
      fields: { name: "x" },
      patch: [{ op: "replace", path: "/name", value: "y" }],
    });
    expect(result.isError).toBe(true);
  });

  it("neither fields nor patch → isError", async () => {
    const result = await handleToolCall(stubClient(), "cpq_update_quote", { id: "q-1" });
    expect(result.isError).toBe(true);
  });
});

describe("cpq_create_quote_item tab resolution", () => {
  it("single tab is used automatically", async () => {
    const client = stubClient({
      quoteTabs: {
        list: vi.fn().mockResolvedValue([{ id: "tab-1", tabName: "Hardware" }]),
        listItems: vi.fn(),
      },
    });
    await handleToolCall(client, "cpq_create_quote_item", {
      idQuote: "q-1",
      item: { description: "Widget", quantity: 1 },
    });
    expect(client.quoteItems.create).toHaveBeenCalledWith(
      expect.objectContaining({ idQuote: "q-1", idQuoteTabs: "tab-1", description: "Widget" })
    );
  });

  it("multiple tabs without elicitation → error listing tabs, no POST", async () => {
    const client = stubClient({
      quoteTabs: {
        list: vi.fn().mockResolvedValue([
          { id: "tab-1", tabName: "Hardware" },
          { id: "tab-2", tabName: "Services" },
        ]),
        listItems: vi.fn(),
      },
    });
    const result = asTool(
      await handleToolCall(client, "cpq_create_quote_item", {
        idQuote: "q-1",
        item: {},
      })
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("tab-2");
    expect(client.quoteItems.create).not.toHaveBeenCalled();
  });

  it("multiple tabs with elicitation → selected tab wins", async () => {
    const client = stubClient({
      quoteTabs: {
        list: vi.fn().mockResolvedValue([
          { id: "tab-1", tabName: "Hardware" },
          { id: "tab-2", tabName: "Services" },
        ]),
        listItems: vi.fn(),
      },
    });
    await handleToolCall(
      client,
      "cpq_create_quote_item",
      { idQuote: "q-1", item: {} },
      answered("quoteTab", { quoteTab: "tab-2" })
    );
    expect(client.quoteItems.create).toHaveBeenCalledWith(
      expect.objectContaining({ idQuoteTabs: "tab-2" })
    );
  });
});

describe("delete confirmations (MRTR-safe: reads first, DELETE last)", () => {
  it("no elicitation support → proceeds (pre-elicitation behavior preserved)", async () => {
    const client = stubClient();
    const result = await handleToolCall(client, "cpq_delete_quote_item", { id: "qi-1" });
    expect(client.quoteItems.delete).toHaveBeenCalledWith("qi-1");
    expect(parse(result).deleted).toBe(true);
  });

  it("form-capable caller → asks for confirmation, DELETE has not fired", async () => {
    const client = stubClient();
    const result = await handleToolCall(client, "cpq_delete_quote", { id: "q-1" }, FORM_CAPABLE);
    expect((result as InputRequiredResult).resultType).toBe("input_required");
    expect(client.quotes.delete).not.toHaveBeenCalled();
  });

  it("explicit decline → cancelled, DELETE never fires", async () => {
    const client = stubClient();
    const result = await handleToolCall(
      client,
      "cpq_delete_quote",
      { id: "q-1" },
      answered("confirm", { confirm: false })
    );
    expect(client.quotes.delete).not.toHaveBeenCalled();
    expect(asTool(result).content[0].text).toContain("cancelled");
  });

  it("confirmation echoes quote context read before the DELETE", async () => {
    const client = stubClient({
      quoteItems: { list: vi.fn().mockResolvedValue([{ id: "qi-1" }, { id: "qi-2" }]) },
    });
    // First round: the ask embeds the read-back context in its message.
    const ask = await handleToolCall(client, "cpq_delete_quote", { id: "q-1" }, FORM_CAPABLE);
    const params = (ask as InputRequiredResult).inputRequests?.confirm?.params as {
      message: string;
    };
    expect(params.message).toContain("Quote A");
    expect(params.message).toContain("2 line item(s)");
    expect(client.quotes.delete).not.toHaveBeenCalled();

    // Retry round: the accepted confirmation lets the DELETE fire.
    await handleToolCall(
      client,
      "cpq_delete_quote",
      { id: "q-1" },
      answered("confirm", { confirm: true })
    );
    expect(client.quotes.delete).toHaveBeenCalledWith("q-1");
  });

  it("delete version validates integers", async () => {
    const result = await handleToolCall(stubClient(), "cpq_delete_quote_version", {
      quoteNumber: 7,
      quoteVersion: "not-a-number",
    });
    expect(result.isError).toBe(true);
  });
});

describe("vendor error mapping", () => {
  it("CpqError surfaces status + message as isError text", async () => {
    const { NotFoundError } = await import("@wyre-technology/node-connectwise-cpq");
    const client = stubClient({
      quotes: {
        get: vi.fn().mockRejectedValue(new NotFoundError("Resource not found", { message: "nope" })),
      },
    });
    const result = asTool(await handleToolCall(client, "cpq_get_quote", { id: "missing" }));
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("HTTP 404");
  });
});
