/**
 * Elicitation helpers for MCP tool handlers.
 *
 * Purely additive: every helper is wrapped in try/catch with a timeout and
 * returns null when the client doesn't support elicitation, declines, times
 * out, or errors — callers fall back to their pre-elicitation behavior.
 *
 * MRTR note (2026-07-28 spec): `server.elicitInput()` is delivered via MRTR
 * (`resultType: 'input_required'`) and the client retries the ORIGINAL
 * request, so the tool handler may re-execute from the top. Handlers must
 * complete all reads and elicitation BEFORE the single mutating vendor call.
 */
import { getServerRef } from "./server-ref.js";

export const DEFAULT_ELICITATION_TIMEOUT_MS = 60_000;

function elicitationTimeoutMs(): number {
  const raw = Number(process.env.ELICITATION_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_ELICITATION_TIMEOUT_MS;
}

/** Race a promise against the elicitation timeout; timeout resolves null. */
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export interface ElicitOption {
  value: string;
  label: string;
}

/** Ask the user to select from a list of options. Null on any failure. */
export async function elicitSelection(
  message: string,
  fieldName: string,
  options: ElicitOption[],
  timeoutMs = elicitationTimeoutMs()
): Promise<string | null> {
  const server = getServerRef();
  if (!server) return null;

  try {
    const result = await withTimeout(
      server.elicitInput({
        message,
        requestedSchema: {
          type: "object" as const,
          properties: {
            [fieldName]: {
              type: "string" as const,
              title: fieldName,
              description: `Select a ${fieldName}`,
              enum: options.map((o) => o.value),
              enumNames: options.map((o) => o.label),
            },
          },
          required: [fieldName],
        },
      }),
      timeoutMs
    );

    if (result && result.action === "accept" && result.content) {
      return (result.content[fieldName] as string) ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

/** Ask the user for a free-text input. Null on any failure. */
export async function elicitText(
  message: string,
  fieldName: string,
  description?: string,
  timeoutMs = elicitationTimeoutMs()
): Promise<string | null> {
  const server = getServerRef();
  if (!server) return null;

  try {
    const result = await withTimeout(
      server.elicitInput({
        message,
        requestedSchema: {
          type: "object" as const,
          properties: {
            [fieldName]: {
              type: "string" as const,
              title: fieldName,
              description: description ?? `Enter ${fieldName}`,
            },
          },
          required: [fieldName],
        },
      }),
      timeoutMs
    );

    if (result && result.action === "accept" && result.content) {
      return (result.content[fieldName] as string) ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Ask the user to confirm an action. Returns:
 * - true  — user confirmed
 * - false — user explicitly declined (callers should cancel)
 * - null  — elicitation unavailable/timed out/errored (callers proceed,
 *           preserving pre-elicitation behavior)
 */
export async function elicitConfirmation(
  message: string,
  timeoutMs = elicitationTimeoutMs()
): Promise<boolean | null> {
  const server = getServerRef();
  if (!server) return null;

  try {
    const result = await withTimeout(
      server.elicitInput({
        message,
        requestedSchema: {
          type: "object" as const,
          properties: {
            confirm: {
              type: "boolean" as const,
              title: "Confirm",
              description: "Confirm this action",
            },
          },
          required: ["confirm"],
        },
      }),
      timeoutMs
    );

    if (result === null) return null;
    if (result.action === "accept" && result.content) {
      return result.content.confirm === true;
    }
    // Explicit decline/cancel from the user.
    return false;
  } catch {
    return null;
  }
}
