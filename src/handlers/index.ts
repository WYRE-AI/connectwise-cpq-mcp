/**
 * tools/call dispatch. The SDK client is bound per request by the caller
 * (mcp-server.ts); this module maps tool names to handlers and normalizes
 * every failure into an isError text result — errors are never thrown out.
 */
import type { InputRequiredResult } from "@modelcontextprotocol/server";
import { CpqError, type CpqClient } from "@wyre-technology/node-connectwise-cpq";
import { NO_ELICITATION, type ElicitationContext } from "../elicitation.js";
import {
  listQuoteCustomers,
  updateQuoteCustomer,
  deleteQuoteCustomer,
} from "./quote-customers.js";
import {
  searchQuoteItems,
  getQuoteItem,
  createQuoteItem,
  updateQuoteItem,
  deleteQuoteItem,
} from "./quote-items.js";
import {
  listQuoteTerms,
  createQuoteTerm,
  updateQuoteTerm,
  deleteQuoteTerm,
} from "./quote-terms.js";
import {
  searchQuotes,
  getQuote,
  getQuoteVersions,
  createQuoteFromTemplate,
  updateQuote,
  deleteQuote,
  deleteQuoteVersion,
} from "./quotes.js";
import {
  testConnection,
  searchQuoteTabs,
  listTemplates,
  listTaxCodes,
  listRecurringRevenues,
  listUsers,
} from "./lookups.js";
import { errorResult, ToolInputError, type ToolResult } from "./results.js";

type ToolHandler = (
  client: CpqClient,
  args: Record<string, unknown>,
  elicitation: ElicitationContext
) => Promise<ToolResult | InputRequiredResult>;

const HANDLERS: Record<string, ToolHandler> = {
  cpq_test_connection: (client) => testConnection(client),
  cpq_search_quotes: searchQuotes,
  cpq_get_quote: getQuote,
  cpq_get_quote_versions: getQuoteVersions,
  cpq_search_quote_items: searchQuoteItems,
  cpq_get_quote_item: getQuoteItem,
  cpq_list_quote_customers: listQuoteCustomers,
  cpq_search_quote_tabs: searchQuoteTabs,
  cpq_list_quote_terms: listQuoteTerms,
  cpq_list_templates: (client) => listTemplates(client),
  cpq_list_tax_codes: listTaxCodes,
  cpq_list_recurring_revenues: listRecurringRevenues,
  cpq_list_users: listUsers,
  cpq_create_quote_from_template: createQuoteFromTemplate,
  cpq_update_quote: updateQuote,
  cpq_create_quote_item: createQuoteItem,
  cpq_update_quote_item: updateQuoteItem,
  cpq_update_quote_customer: updateQuoteCustomer,
  cpq_create_quote_term: createQuoteTerm,
  cpq_update_quote_term: updateQuoteTerm,
  cpq_delete_quote_item: deleteQuoteItem,
  cpq_delete_quote_term: deleteQuoteTerm,
  cpq_delete_quote_customer: deleteQuoteCustomer,
  cpq_delete_quote_version: deleteQuoteVersion,
  cpq_delete_quote: deleteQuote,
};

function describeCpqError(error: CpqError): string {
  let body = "";
  if (error.response !== undefined && error.response !== null && error.response !== "") {
    try {
      body = ` Response: ${JSON.stringify(error.response)}`;
    } catch {
      body = "";
    }
  }
  return `ConnectWise CPQ error (HTTP ${error.statusCode}): ${error.message}.${body}`;
}

export async function handleToolCall(
  client: CpqClient,
  name: string,
  args: Record<string, unknown>,
  elicitation: ElicitationContext = NO_ELICITATION
): Promise<ToolResult | InputRequiredResult> {
  const handler = HANDLERS[name];
  if (!handler) {
    return errorResult(`Unknown tool: ${name}`);
  }
  try {
    return await handler(client, args, elicitation);
  } catch (error) {
    if (error instanceof ToolInputError) {
      return errorResult(`Invalid arguments for ${name}: ${error.message}`);
    }
    if (error instanceof CpqError) {
      return errorResult(describeCpqError(error));
    }
    const message = error instanceof Error ? error.message : String(error);
    return errorResult(`Error calling ${name}: ${message}`);
  }
}
