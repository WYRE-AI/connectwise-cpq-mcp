/**
 * Quote tool handlers.
 *
 * MRTR rule enforced throughout: all reads and all elicitation complete
 * BEFORE the single mutating vendor call, which is always the last operation
 * (the one sanctioned exception is cpq_create_quote_from_template's optional
 * rename PATCH, which follows the copy but still comes after all elicitation).
 */
import type { InputRequiredResult } from "@modelcontextprotocol/server";
import type {
  CpqClient,
  QuoteItemView,
  QuoteView,
} from "@wyre-technology/node-connectwise-cpq";
import { attachCard } from "../card.builder.js";
import {
  confirmDestructive,
  elicitSelection,
  elicitText,
  type ElicitationContext,
} from "../elicitation.js";
import { extractListParams } from "./list-params.js";
import { resolvePatchOps } from "./patch-args.js";
import {
  errorResult,
  jsonResult,
  requireInteger,
  requireString,
  optionalString,
  textResult,
  type ToolResult,
} from "./results.js";

const ISO_DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// ── Reads ──────────────────────────────────────────────────────────────────

export async function searchQuotes(
  client: CpqClient,
  args: Record<string, unknown>,
  elicitation: ElicitationContext
): Promise<ToolResult | InputRequiredResult> {
  const params = extractListParams(args);
  let note: string | undefined;

  if (!params.conditions) {
    // Elicitation point (read-only, MRTR-safe): ask for a created-since date.
    const asked = elicitText(
      elicitation,
      "No search conditions were given. From what creation date should quotes be " +
        "included? (YYYY-MM-DD)",
      "fromDate",
      "Date-only, e.g. 2026-05-01"
    );
    if (asked.kind === "ask") return asked.result;
    const answer = asked.kind === "answer" ? asked.value : null;
    if (answer && ISO_DATE_ONLY.test(answer.trim())) {
      params.conditions = `createDate >= [${answer.trim()}]`;
      note = `Filtered to quotes created since ${answer.trim()} (user-selected).`;
    } else {
      // Null-fallback: default to the last 90 days and say so in the result.
      const since = dateOnly(new Date(Date.now() - 90 * 24 * 60 * 60 * 1000));
      params.conditions = `createDate >= [${since}]`;
      note =
        `No conditions given; defaulted to quotes created in the last 90 days ` +
        `(createDate >= [${since}]). Pass "conditions" for a different filter.`;
    }
  }

  const quotes = await client.quotes.list(params);
  return jsonResult({ conditions: params.conditions, note, count: quotes.length, quotes });
}

export async function getQuote(
  client: CpqClient,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const id = requireString(args, "id");
  const quote = await client.quotes.get(id);

  // Best-effort line summary for the MCP Apps card: on error the card simply
  // renders without it, and the model-visible JSON is the full QuoteView
  // either way (the `_card` field is purely additive).
  let items: QuoteItemView[] | undefined;
  try {
    items = await client.quoteItems.list({
      conditions: `idQuote = "${id}"`,
      includeFields: "id,description,mfgPartNumber,quantity,extendedPrice",
      pageSize: 6,
    });
  } catch {
    items = undefined;
  }

  return jsonResult(attachCard(quote, items));
}

export async function getQuoteVersions(
  client: CpqClient,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const quoteNumber = requireInteger(args, "quoteNumber");
  const rawVersion = args.version;

  if (rawVersion === undefined || rawVersion === null) {
    const versions = await client.quotes.listVersions(quoteNumber);
    return jsonResult({ quoteNumber, count: versions.length, versions });
  }
  if (rawVersion === "latest") {
    const version = await client.quotes.getVersion(quoteNumber, "latest");
    return jsonResult(version);
  }
  const versionNumber = Number(rawVersion);
  if (!Number.isInteger(versionNumber)) {
    return errorResult('Argument "version" must be an integer or the string "latest".');
  }
  const version = await client.quotes.getVersion(quoteNumber, versionNumber);
  return jsonResult(version);
}

// ── Writes ─────────────────────────────────────────────────────────────────

export async function createQuoteFromTemplate(
  client: CpqClient,
  args: Record<string, unknown>,
  elicitation: ElicitationContext
): Promise<ToolResult | InputRequiredResult> {
  let templateId = optionalString(args, "templateId");
  const templateName = optionalString(args, "templateName");
  const newName = optionalString(args, "newName");

  if (!templateId && !templateName) {
    return errorResult('Provide "templateId" or "templateName".');
  }

  // Resolve templateName → templateId (read-only + elicitation, before any POST).
  if (!templateId && templateName) {
    const templates = await client.templates.list();
    const named = templates.filter((t) => typeof t.id === "string" && t.id !== "");
    const wanted = templateName.trim().toLowerCase();
    let matches = named.filter((t) => (t.name ?? "").trim().toLowerCase() === wanted);
    if (matches.length === 0) {
      matches = named.filter((t) => (t.name ?? "").toLowerCase().includes(wanted));
    }

    if (matches.length === 0) {
      const available = named
        .map((t) => t.name)
        .filter(Boolean)
        .slice(0, 25);
      return errorResult(
        `No template matches "${templateName}". Available templates: ` +
          `${available.join(", ") || "(none)"}`
      );
    }
    if (matches.length === 1) {
      templateId = matches[0].id as string;
    } else {
      // Elicitation point: ambiguous name → user selects, before the POST fires.
      const selected = elicitSelection(
        elicitation,
        `Multiple templates match "${templateName}". Which one should be copied?`,
        "template",
        matches.map((t) => ({
          value: t.id as string,
          label: t.name ?? (t.id as string),
        }))
      );
      if (selected.kind === "ask") return selected.result;
      if (selected.kind !== "answer") {
        const candidates = matches.map((t) => `${t.name ?? "?"} (${t.id})`).join(", ");
        return errorResult(
          `Multiple templates match "${templateName}" — pass "templateId" to pick one: ` +
            candidates
        );
      }
      templateId = selected.value;
    }
  }

  const created = await client.quotes.copyFromTemplate(templateId as string);

  // Optional rename: a follow-up PATCH after the copy. Acceptable under MRTR
  // because it comes after all elicitation — on retry the elicitation resolves
  // from the client's remembered answer before any POST re-fires.
  if (newName && typeof created.id === "string" && created.id !== "") {
    const renamed = await client.quotes.updateFields(created.id, {
      name: newName,
    } as Partial<QuoteView>);
    return jsonResult({ created: renamed, note: `Renamed to "${newName}" after copy.` });
  }
  return jsonResult({ created });
}

export async function updateQuote(
  client: CpqClient,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const id = requireString(args, "id");
  const ops = resolvePatchOps(args);
  const updated = await client.quotes.update(id, ops);
  return jsonResult({ updated });
}

export async function deleteQuote(
  client: CpqClient,
  args: Record<string, unknown>,
  elicitation: ElicitationContext
): Promise<ToolResult | InputRequiredResult> {
  const id = requireString(args, "id");

  // Read-only context for the confirmation (both best-effort).
  let summary = `quote ${id}`;
  let itemCount: number | undefined;
  try {
    const quote = await client.quotes.get(id);
    const label = quote.name ?? id;
    const num =
      typeof quote.quoteNumber === "number"
        ? ` (#${quote.quoteNumber}${typeof quote.quoteVersion === "number" ? ` v${quote.quoteVersion}` : ""})`
        : "";
    summary = `"${label}"${num}`;
  } catch {
    /* confirmation still shows the id */
  }
  try {
    const items = await client.quoteItems.list({
      conditions: `idQuote = "${id}"`,
      includeFields: "id",
      pageSize: 1000,
    });
    itemCount = items.length;
  } catch {
    itemCount = undefined;
  }

  const gate = confirmDestructive(
    elicitation,
    args,
    `Permanently delete quote ${summary}` +
      `${itemCount !== undefined ? ` and its ${itemCount} line item(s)` : ""}, ` +
      `including all tabs and terms? This cannot be undone.`
  );
  if (gate.kind === "ask") return gate.result;
  if (gate.kind === "blocked") return errorResult(gate.message);
  if (gate.kind === "refused") {
    return textResult(`Deletion cancelled by user — quote ${id} was NOT deleted.`);
  }

  await client.quotes.delete(id);
  return jsonResult({ deleted: true, id });
}

export async function deleteQuoteVersion(
  client: CpqClient,
  args: Record<string, unknown>,
  elicitation: ElicitationContext
): Promise<ToolResult | InputRequiredResult> {
  const quoteNumber = requireInteger(args, "quoteNumber");
  const quoteVersion = requireInteger(args, "quoteVersion");

  // Best-effort read for the confirmation echo.
  let label = "";
  try {
    const version = await client.quotes.getVersion(quoteNumber, quoteVersion);
    if (version.name) label = ` ("${version.name}")`;
  } catch {
    /* confirmation still shows number/version */
  }

  const gate = confirmDestructive(
    elicitation,
    args,
    `Permanently delete version ${quoteVersion} of quote #${quoteNumber}${label}? ` +
      `This cannot be undone.`
  );
  if (gate.kind === "ask") return gate.result;
  if (gate.kind === "blocked") return errorResult(gate.message);
  if (gate.kind === "refused") {
    return textResult(
      `Deletion cancelled by user — quote #${quoteNumber} v${quoteVersion} was NOT deleted.`
    );
  }

  await client.quotes.deleteVersion(quoteNumber, quoteVersion);
  return jsonResult({ deleted: true, quoteNumber, quoteVersion });
}
