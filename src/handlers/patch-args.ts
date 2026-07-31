/** Shared `fields`/`patch` argument handling for the JSON Patch update tools. */
import { fieldsToReplaceOps, type JsonPatchOp } from "@wyre-technology/node-connectwise-cpq";
import { ToolInputError } from "./results.js";

/**
 * Resolve the RFC 6902 ops for an update tool from its `fields` (partial
 * object → replace ops) or `patch` (raw ops) argument. Exactly one of the
 * two must be provided and must be non-empty.
 */
export function resolvePatchOps(args: Record<string, unknown>): JsonPatchOp[] {
  const fields = args.fields;
  const patch = args.patch;

  if (fields !== undefined && patch !== undefined) {
    throw new ToolInputError('Provide either "fields" or "patch", not both.');
  }

  if (patch !== undefined) {
    if (!Array.isArray(patch) || patch.length === 0) {
      throw new ToolInputError('"patch" must be a non-empty array of RFC 6902 operations.');
    }
    for (const op of patch) {
      if (
        op === null ||
        typeof op !== "object" ||
        typeof (op as JsonPatchOp).op !== "string" ||
        typeof (op as JsonPatchOp).path !== "string"
      ) {
        throw new ToolInputError(
          'Every "patch" entry needs string "op" and "path" properties (RFC 6902).'
        );
      }
    }
    return patch as JsonPatchOp[];
  }

  if (fields !== undefined) {
    if (fields === null || typeof fields !== "object" || Array.isArray(fields)) {
      throw new ToolInputError('"fields" must be an object of field values.');
    }
    const ops = fieldsToReplaceOps(fields as Record<string, unknown>);
    if (ops.length === 0) {
      throw new ToolInputError('"fields" must contain at least one defined field.');
    }
    return ops;
  }

  throw new ToolInputError('Provide "fields" (partial object) or "patch" (RFC 6902 ops).');
}
