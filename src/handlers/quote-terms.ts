/** Quote payment/financing term tool handlers. */
import type { CpqClient, QuoteTermView } from "@wyre-technology/node-connectwise-cpq";
import { elicitConfirmation } from "../elicitation.js";
import { extractListParams } from "./list-params.js";
import { resolvePatchOps } from "./patch-args.js";
import {
  jsonResult,
  requireObject,
  requireString,
  textResult,
  type ToolResult,
} from "./results.js";

export async function listQuoteTerms(
  client: CpqClient,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const quoteId = requireString(args, "quoteId");
  const params = extractListParams(args);
  const terms = await client.quoteTerms.list(quoteId, params);
  return jsonResult({ quoteId, count: terms.length, terms });
}

export async function createQuoteTerm(
  client: CpqClient,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const quoteId = requireString(args, "quoteId");
  const term = requireObject(args, "term");
  const created = await client.quoteTerms.create(quoteId, term as Partial<QuoteTermView>);
  return jsonResult({ created });
}

export async function updateQuoteTerm(
  client: CpqClient,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const quoteId = requireString(args, "quoteId");
  const id = requireString(args, "id");
  const ops = resolvePatchOps(args);
  const updated = await client.quoteTerms.update(quoteId, id, ops);
  return jsonResult({ updated });
}

export async function deleteQuoteTerm(
  client: CpqClient,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const quoteId = requireString(args, "quoteId");
  const id = requireString(args, "id");

  // Best-effort read so the confirmation can echo the term's name.
  let label = `term ${id}`;
  try {
    const terms = await client.quoteTerms.list(quoteId);
    const match = terms.find((t) => t.id === id);
    if (match?.name) label = `term "${match.name}"`;
  } catch {
    /* confirmation still shows the id */
  }

  const confirmed = await elicitConfirmation(
    `Permanently delete ${label} from quote ${quoteId}? This cannot be undone.`
  );
  if (confirmed === false) {
    return textResult(`Deletion cancelled by user — quote term ${id} was NOT deleted.`);
  }

  await client.quoteTerms.delete(quoteId, id);
  return jsonResult({ deleted: true, quoteId, id });
}
