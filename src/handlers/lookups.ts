/** Read-only lookup handlers: connection test, tabs, templates, tax codes, RR, users. */
import type { CpqClient } from "@wyre-technology/node-connectwise-cpq";
import { extractListParams } from "./list-params.js";
import { jsonResult, type ToolResult } from "./results.js";

export async function testConnection(client: CpqClient): Promise<ToolResult> {
  // No dedicated ping endpoint exists; the users list is the cheapest
  // authenticated read that also reports who can use the API.
  const users = await client.users.list({ pageSize: 25 });
  return jsonResult({
    ok: true,
    message: "ConnectWise CPQ credentials are valid.",
    userCount: users.length,
    users: users.slice(0, 5),
  });
}

export async function searchQuoteTabs(
  client: CpqClient,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const params = extractListParams(args);
  const tabs = await client.quoteTabs.list(params);
  return jsonResult({ count: tabs.length, tabs });
}

export async function listTemplates(client: CpqClient): Promise<ToolResult> {
  const templates = await client.templates.list();
  return jsonResult({ count: templates.length, templates });
}

export async function listTaxCodes(
  client: CpqClient,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const params = extractListParams(args);
  const taxCodes = await client.taxCodes.list(params);
  return jsonResult({ count: taxCodes.length, taxCodes });
}

export async function listRecurringRevenues(
  client: CpqClient,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const params = extractListParams(args);
  const recurringRevenues = await client.recurringRevenues.list(params);
  return jsonResult({ count: recurringRevenues.length, recurringRevenues });
}

export async function listUsers(
  client: CpqClient,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const params = extractListParams(args);
  const users = await client.users.list(params);
  return jsonResult({ count: users.length, users });
}
