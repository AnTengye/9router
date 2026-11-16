import { afterEach, describe, expect, it, vi } from "vitest";

describe("proxyAwareFetch abort handling", () => {
  afterEach(() => {
    vi.doUnmock("undici");
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("does not fall back to direct with an already-aborted signal", async () => {
    const controller = new AbortController();
    const abortError = new DOMException("deadline exceeded", "AbortError");
    const fetchMock = vi.fn().mockImplementation(async () => {
      controller.abort(abortError);
      throw abortError;
    });
    vi.resetModules();
    vi.doMock("undici", async (importOriginal) => {
      const actual = await importOriginal();
      return { ...actual, fetch: fetchMock };
    });
    const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");

    await expect(proxyAwareFetch(
      "https://example.com/v1/chat/completions",
      { method: "POST", signal: controller.signal },
      { enabled: true, url: "http://127.0.0.1:7890" },
    )).rejects.toBe(abortError);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
