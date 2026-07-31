/** Elicitation helpers: null-fallback on no server / error / timeout / decline. */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  elicitConfirmation,
  elicitSelection,
  elicitText,
} from "../elicitation.js";
import { clearServerRef, setServerRef } from "../server-ref.js";

afterEach(() => clearServerRef());

describe("without a server ref", () => {
  it("all helpers return null", async () => {
    expect(await elicitText("m", "f")).toBeNull();
    expect(await elicitSelection("m", "f", [{ value: "a", label: "A" }])).toBeNull();
    expect(await elicitConfirmation("m")).toBeNull();
  });
});

describe("error and timeout fallbacks", () => {
  it("elicitInput rejection → null (never throws)", async () => {
    setServerRef({ elicitInput: vi.fn().mockRejectedValue(new Error("unsupported")) } as never);
    expect(await elicitText("m", "f")).toBeNull();
    expect(await elicitConfirmation("m")).toBeNull();
  });

  it("hung elicitInput times out to null", async () => {
    setServerRef({ elicitInput: vi.fn().mockReturnValue(new Promise(() => {})) } as never);
    expect(await elicitText("m", "f", undefined, 20)).toBeNull();
    expect(await elicitConfirmation("m", 20)).toBeNull();
    expect(await elicitSelection("m", "f", [{ value: "a", label: "A" }], 20)).toBeNull();
  });
});

describe("accepted answers", () => {
  it("text answers pass through", async () => {
    setServerRef({
      elicitInput: vi.fn().mockResolvedValue({ action: "accept", content: { f: "hello" } }),
    } as never);
    expect(await elicitText("m", "f")).toBe("hello");
  });

  it("selection returns the chosen value", async () => {
    setServerRef({
      elicitInput: vi.fn().mockResolvedValue({ action: "accept", content: { f: "b" } }),
    } as never);
    expect(
      await elicitSelection("m", "f", [
        { value: "a", label: "A" },
        { value: "b", label: "B" },
      ])
    ).toBe("b");
  });

  it("confirmation distinguishes accept-true, accept-false, and decline", async () => {
    setServerRef({
      elicitInput: vi.fn().mockResolvedValue({ action: "accept", content: { confirm: true } }),
    } as never);
    expect(await elicitConfirmation("m")).toBe(true);

    setServerRef({
      elicitInput: vi.fn().mockResolvedValue({ action: "accept", content: { confirm: false } }),
    } as never);
    expect(await elicitConfirmation("m")).toBe(false);

    setServerRef({
      elicitInput: vi.fn().mockResolvedValue({ action: "decline" }),
    } as never);
    expect(await elicitConfirmation("m")).toBe(false);
  });
});
