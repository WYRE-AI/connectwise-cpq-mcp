/**
 * Shared MCP Server reference for elicitation support.
 * Avoids circular imports by decoupling the server instance from tool handlers.
 */
import type { Server } from "@modelcontextprotocol/server";

let _server: Server | null = null;

export function setServerRef(server: Server): void {
  _server = server;
}

export function getServerRef(): Server | null {
  return _server;
}

/** Test hook: drop the shared reference. */
export function clearServerRef(): void {
  _server = null;
}
