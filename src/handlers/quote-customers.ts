/** Quote-customer tool handlers (customers exist only per-quote, synced from CRM). */
import type { CpqClient } from "@wyre-technology/node-connectwise-cpq";
import { elicitConfirmation } from "../elicitation.js";
import { resolvePatchOps } from "./patch-args.js";
import { jsonResult, requireString, textResult, type ToolResult } from "./results.js";

export async function listQuoteCustomers(
  client: CpqClient,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const quoteId = requireString(args, "quoteId");
  const customers = await client.quoteCustomers.list(quoteId);
  return jsonResult({ quoteId, count: customers.length, customers });
}

export async function updateQuoteCustomer(
  client: CpqClient,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const quoteId = requireString(args, "quoteId");
  const id = requireString(args, "id");
  const ops = resolvePatchOps(args);
  const updated = await client.quoteCustomers.update(quoteId, id, ops);
  return jsonResult({ updated });
}

export async function deleteQuoteCustomer(
  client: CpqClient,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const quoteId = requireString(args, "quoteId");
  const id = requireString(args, "id");

  // Best-effort read so the confirmation can echo who is being removed.
  let label = `customer record ${id}`;
  try {
    const customers = await client.quoteCustomers.list(quoteId);
    const match = customers.find((c) => c.id === id);
    if (match) {
      const person = [match.firstName, match.lastName].filter(Boolean).join(" ");
      const who = match.companyName ?? person;
      if (who) label = `customer record "${who}"`;
    }
  } catch {
    /* confirmation still shows the id */
  }

  const confirmed = await elicitConfirmation(
    `Permanently remove ${label} from quote ${quoteId}? This cannot be undone.`
  );
  if (confirmed === false) {
    return textResult(`Deletion cancelled by user — customer record ${id} was NOT removed.`);
  }

  await client.quoteCustomers.delete(quoteId, id);
  return jsonResult({ deleted: true, quoteId, id });
}
