/** Extract the shared CPQ list parameters from tool arguments. */
import type { CpqListParams } from "@wyre-technology/node-connectwise-cpq";
import { optionalBoolean, optionalNumber, optionalString } from "./results.js";

export function extractListParams(args: Record<string, unknown>): CpqListParams {
  const params: CpqListParams = {};
  const conditions = optionalString(args, "conditions");
  const includeFields = optionalString(args, "includeFields");
  const page = optionalNumber(args, "page");
  const pageSize = optionalNumber(args, "pageSize");
  const showAllVersions = optionalBoolean(args, "showAllVersions");
  if (conditions !== undefined) params.conditions = conditions;
  if (includeFields !== undefined) params.includeFields = includeFields;
  if (page !== undefined) params.page = page;
  if (pageSize !== undefined) params.pageSize = pageSize;
  if (showAllVersions !== undefined) params.showAllVersions = showAllVersions;
  return params;
}
