import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
}));

vi.mock("@/lib/localDb", () => dbMocks);
vi.mock("@/lib/network/connectionProxy", () => ({
  pickProxyPoolId: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
}));
vi.mock("@/shared/constants/providers.js", () => ({
  FREE_PROVIDERS: {},
  resolveProviderId: (provider) => provider,
}));
vi.mock("@/sse/utils/logger.js", () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn() }));

const { markAccountUnavailable } = await import("../../src/sse/services/auth.js");

beforeEach(() => vi.clearAllMocks());

describe("gateway-local response-header timeout", () => {
  it("falls back for the request without persisting an account lock", async () => {
    const result = await markAccountUnavailable(
      "connection-a",
      504,
      "[504]: UPSTREAM_HEADERS_TIMEOUT: upstream response headers timeout after 150000ms",
      "openai-compatible-chat-test",
      "qwen3.8-max",
    );

    expect(result).toEqual({ shouldFallback: true, cooldownMs: 0, accountNeutral: true });
    expect(dbMocks.getProviderConnections).not.toHaveBeenCalled();
    expect(dbMocks.updateProviderConnection).not.toHaveBeenCalled();
  });
});
