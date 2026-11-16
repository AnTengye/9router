// Guards forceStream moved from chatCore hardcode → PROVIDERS schema (#5).
import { beforeEach, describe, expect, it, vi } from "vitest";

const { executeMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
}));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: vi.fn(() => ({
    execute: executeMock,
    refreshCredentials: vi.fn().mockResolvedValue(null),
  })),
}));

vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: vi.fn(async () => ({
    logClientRawRequest: vi.fn(),
    logRawRequest: vi.fn(),
    logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(),
    logConvertedResponse: vi.fn(),
    logError: vi.fn(),
  })),
}));

vi.mock("../../open-sse/utils/clientDetector.js", () => ({
  detectClientTool: vi.fn(() => null),
  isNativePassthrough: vi.fn(() => false),
}));

vi.mock("../../open-sse/utils/bypassHandler.js", () => ({
  handleBypassRequest: vi.fn(() => null),
}));

vi.mock("../../open-sse/utils/streamHandler.js", () => ({
  createStreamController: vi.fn(() => ({
    signal: undefined,
    handleComplete: vi.fn(),
    handleError: vi.fn(),
  })),
}));

vi.mock("../../open-sse/services/tokenRefresh.js", () => ({
  refreshWithRetry: vi.fn(),
}));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  default: vi.fn(),
  proxyAwareFetch: vi.fn(),
}));

vi.mock("../../open-sse/translator/formats/claude.js", () => ({
  normalizeClaudePassthrough: vi.fn(),
}));

vi.mock("../../open-sse/utils/toolDeduper.js", () => ({
  dedupeTools: vi.fn((tools) => ({ tools, stripped: [] })),
}));

vi.mock("../../open-sse/rtk/caveman.js", () => ({
  injectCaveman: vi.fn(),
}));

vi.mock("../../open-sse/rtk/ponytail.js", () => ({
  injectPonytail: vi.fn(),
}));

vi.mock("../../open-sse/rtk/index.js", () => ({
  compressMessages: vi.fn(() => null),
  formatRtkLog: vi.fn(() => ""),
}));

vi.mock("../../open-sse/rtk/headroom.js", () => ({
  compressWithHeadroom: vi.fn(async () => null),
  formatHeadroomLog: vi.fn(() => ""),
  // chatCore also imports these (fb543a1f); a mock missing them fails the import.
  formatHeadroomSizeLog: vi.fn(() => ""),
  isHeadroomPhantomSavings: vi.fn(() => false),
}));

vi.mock("../../open-sse/providers/capabilities.js", () => ({
  getCapabilitiesForModel: vi.fn(() => ({})),
}));

vi.mock("../../open-sse/translator/concerns/modality.js", () => ({
  stripUnsupportedModalities: vi.fn(() => false),
}));

vi.mock("../../open-sse/translator/concerns/prefetch.js", () => ({
  prefetchRemoteImages: vi.fn(async () => 0),
}));

vi.mock("../../open-sse/handlers/chatCore/requestDetail.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    buildRequestDetail: vi.fn((detail) => detail),
    extractRequestConfig: vi.fn((body, stream) => ({ body, stream })),
    saveUsageStats: vi.fn(),
  };
});

vi.mock("../../open-sse/utils/error.js", () => ({
  createErrorResult: vi.fn((status, message) => ({ success: false, status, error: message })),
  formatProviderError: vi.fn((error) => error.message),
  parseUpstreamError: vi.fn(),
}));

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(() => Promise.resolve()),
  saveRequestDetail: vi.fn(() => Promise.resolve()),
}));

const FORCED = ["openai", "codex", "commandcode", "qoder"];

function makeOptions(bodyStream) {
  const body = {
    model: "gpt-4.1",
    messages: [{ role: "user", content: "hello" }],
  };
  if (bodyStream !== undefined) body.stream = bodyStream;

  return {
    body,
    modelInfo: { provider: "openai", model: "gpt-4.1" },
    credentials: { apiKey: "sk-test" },
    clientRawRequest: {
      endpoint: "/v1/chat/completions",
      body,
      headers: { accept: "application/json" },
    },
    connectionId: "test-connection",
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}

// The first test pays for importing chatCore's module graph (3s+ under full-suite
// load); a test that times out keeps running and its late fetch call leaks into the
// next test's mock counts, so give the file room instead of cascading failures.
describe("forceStream provider config", { timeout: 20_000 }, () => {
  beforeEach(() => {
    executeMock.mockReset();
    executeMock.mockRejectedValue(new Error("boom"));
  });

  it("declares providers whose upstream transport always streams", async () => {
    const { PROVIDERS } = await import("../../open-sse/config/providers.js");
    for (const id of FORCED) {
      expect(PROVIDERS[id]?.forceStream, `${id} forced`).toBe(true);
    }
    // a sample of others must NOT force
    for (const id of ["deepseek", "claude", "gemini", "openrouter"]) {
      expect(PROVIDERS[id]?.forceStream, `${id} not forced`).not.toBe(true);
    }
  });

  it.each([undefined, false])( "keeps forced-stream providers streaming for JSON clients when body.stream is %s", async (bodyStream) => {
    const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

    await handleChatCore(makeOptions(bodyStream));

    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(executeMock.mock.calls[0][0].stream).toBe(true);
  });

  it("defaults omitted body.stream to false on OpenAI chat completions for non-forced providers (e.g. Immersive Translate)", async () => {
    const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
    const upstreamJson = {
      id: "chatcmpl-test-611",
      object: "chat.completion",
      created: 1700000000,
      model: "qwen3.8-flash",
      choices: [{ index: 0, message: { role: "assistant", content: "你好" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
    };
    executeMock.mockResolvedValueOnce({
      response: new Response(JSON.stringify(upstreamJson), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
      url: "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions",
      headers: {},
      transformedBody: null,
    });

    const body = {
      model: "ali-tp/qwen3.8-flash",
      messages: [{ role: "user", content: "hello" }],
    };
    const result = await handleChatCore({
      body,
      modelInfo: { provider: "openai-compatible-chat-test", model: "qwen3.8-flash" },
      credentials: { apiKey: "sk-test" },
      clientRawRequest: {
        endpoint: "/api/v1/chat/completions",
        body,
        headers: { accept: "*/*" },
      },
      connectionId: "test-connection",
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(executeMock.mock.calls[0][0].stream).toBe(false);
    expect(result.success).toBe(true);
    expect(result.response.headers.get("content-type")).toContain("application/json");
    const rawText = await result.response.text();
    expect(rawText).not.toContain("data: [DONE]");
    expect(() => JSON.parse(rawText)).not.toThrow();
    expect(JSON.parse(rawText).choices[0].message.content).toBe("你好");
  });

  it("returns valid JSON without trailing [DONE] when forced-stream provider answers with application/json for non-streaming client", async () => {
    const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
    const upstreamJson = {
      id: "chatcmpl-forced-json",
      object: "chat.completion",
      created: 1700000000,
      model: "gpt-4.1",
      choices: [{ index: 0, message: { role: "assistant", content: "hello" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
    };
    executeMock.mockResolvedValueOnce({
      response: new Response(JSON.stringify(upstreamJson), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
      url: "https://api.openai.com/v1/chat/completions",
      headers: {},
      transformedBody: null,
    });

    const opts = makeOptions(undefined);
    opts.clientRawRequest.headers = { accept: "*/*" };
    const result = await handleChatCore(opts);

    expect(result.success).toBe(true);
    const rawText = await result.response.text();
    expect(rawText).not.toContain("data: [DONE]");
    expect(() => JSON.parse(rawText)).not.toThrow();
  });
});
