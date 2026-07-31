/** Quote line-item tool handlers (MRTR-safe: reads + elicitation first, one mutation last). */
import type { InputRequiredResult } from "@modelcontextprotocol/server";
import type { CpqClient, QuoteItemView } from "@wyre-technology/node-connectwise-cpq";
import {
  elicitConfirmation,
  elicitSelection,
  isRefusal,
  type ElicitationContext,
} from "../elicitation.js";
import { extractListParams } from "./list-params.js";
import { resolvePatchOps } from "./patch-args.js";
import {
  errorResult,
  jsonResult,
  requireObject,
  requireString,
  optionalString,
  textResult,
  type ToolResult,
} from "./results.js";

export async function searchQuoteItems(
  client: CpqClient,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const params = extractListParams(args);
  const items = await client.quoteItems.list(params);
  return jsonResult({ count: items.length, items });
}

export async function getQuoteItem(
  client: CpqClient,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const id = requireString(args, "id");
  const item = await client.quoteItems.get(id);
  return jsonResult(item);
}

export async function createQuoteItem(
  client: CpqClient,
  args: Record<string, unknown>,
  elicitation: ElicitationContext
): Promise<ToolResult | InputRequiredResult> {
  const idQuote = requireString(args, "idQuote");
  const item = requireObject(args, "item");
  let idQuoteTabs = optionalString(args, "idQuoteTabs");

  // Resolve the target tab (read-only + elicitation, before the POST).
  if (!idQuoteTabs) {
    const tabs = (await client.quoteTabs.list({ conditions: `idQuote = "${idQuote}"` })).filter(
      (tab) => typeof tab.id === "string" && tab.id !== ""
    );
    if (tabs.length === 0) {
      return errorResult(
        `Quote ${idQuote} has no tabs — a line item needs a tab. Create one in CPQ first.`
      );
    }
    if (tabs.length === 1) {
      idQuoteTabs = tabs[0].id as string;
    } else {
      const selected = elicitSelection(
        elicitation,
        "Which quote tab should this line item be added to?",
        "quoteTab",
        tabs.map((tab) => ({
          value: tab.id as string,
          label: tab.tabName
            ? `${tab.tabName}${typeof tab.tabNumber === "number" ? ` (#${tab.tabNumber})` : ""}`
            : (tab.id as string),
        }))
      );
      if (selected.kind === "ask") return selected.result;
      if (selected.kind !== "answer") {
        const listing = tabs
          .map((tab) => `${tab.tabName ?? "?"} (${tab.id})`)
          .join(", ");
        return errorResult(
          `Quote ${idQuote} has ${tabs.length} tabs — pass "idQuoteTabs" to pick one: ${listing}`
        );
      }
      idQuoteTabs = selected.value;
    }
  }

  const created = await client.quoteItems.create({
    ...item,
    idQuote,
    idQuoteTabs,
  } as Partial<QuoteItemView>);
  return jsonResult({ created });
}

export async function updateQuoteItem(
  client: CpqClient,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const id = requireString(args, "id");
  const ops = resolvePatchOps(args);
  const updated = await client.quoteItems.update(id, ops);
  return jsonResult({ updated });
}

export async function deleteQuoteItem(
  client: CpqClient,
  args: Record<string, unknown>,
  elicitation: ElicitationContext
): Promise<ToolResult | InputRequiredResult> {
  const id = requireString(args, "id");

  // Best-effort read so the confirmation can echo what is being deleted.
  let label = `line item ${id}`;
  try {
    const item = await client.quoteItems.get(id);
    const desc = item.description ?? item.mfgPartNumber;
    if (desc) label = `line item "${desc}"`;
  } catch {
    /* confirmation still shows the id */
  }

  const confirmation = elicitConfirmation(
    elicitation,
    `Permanently delete ${label}? This cannot be undone.`
  );
  if (confirmation.kind === "ask") return confirmation.result;
  if (isRefusal(confirmation)) {
    return textResult(`Deletion cancelled by user — quote item ${id} was NOT deleted.`);
  }

  await client.quoteItems.delete(id);
  return jsonResult({ deleted: true, id });
}
