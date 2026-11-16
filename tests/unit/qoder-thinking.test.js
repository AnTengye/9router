import { beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { __test__ } from "../../open-sse/executors/qoder.js";
import { getQoderModelConfig } from "../../open-sse/services/qoderModels.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";

vi.mock("../../open-sse/services/qoderModels.js", () => ({
  getQoderModelConfig: vi.fn(),
  resolveQoderModels: vi.fn(),
  isQoderPat: () => false,
  resolveQoderCredentials: vi.fn(),
}));

// The live catalog declares dfmodel switchable, with max as its default effort.
const config = {
  key: "dfmodel",
  source: "system",
  is_reasoning: true,
  max_output_tokens: 32768,
  thinking_config: {
    disabled: { description: "Disable thinking" },
    enabled: {
      efforts: { high: {}, max: { is_default: true }, low: {} },
      is_default: true,
    },
  },
};
const credentials = { accessToken: "test-token", providerSpecificData: { userId: "test-user" } };

async function build(input = {}, { model = "dfmodel", provider = "qoder", source = "openai" } = {}) {
  const body = translateRequest(source, "openai", model, {
    model,
    max_tokens: 2048,
    messages: [{ role: "user", content: "Return only True or False." }],
    ...input,
  }, true, credentials, provider);
  return __test__.buildQoderRequestBody({ model, body, credentials });
}

beforeEach(() => {
  vi.clearAllMocks();
  getQoderModelConfig.mockResolvedValue(structuredClone(config));
});

describe("Qoder thinking through translation and request construction", () => {
  it.each([
    ["enable_thinking", { enable_thinking: false }],
    ["reasoning_effort", { reasoning_effort: "none" }],
    ["Responses reasoning", { reasoning: { effort: "none" } }],
    ["Claude thinking", { thinking: { type: "disabled" } }],
  ])("honors the %s off-switch", async (_name, input) => {
    const { payload } = await build(input);
    expect(payload.parameters).toEqual({ max_tokens: 2048, reasoning_effort: "none", max_thinking_tokens: 0 });
    expect(payload.model_config.is_reasoning).toBe(false);
    expect(payload.chat_context.extra.modelConfig.is_reasoning).toBe(false);
    expect(payload.model_config.thinking_config).toEqual(config.thinking_config);
  });

  it("honors a model suffix over a conflicting request effort", async () => {
    const { payload } = await build({ reasoning_effort: "max" }, { model: "dfmodel(none)" });
    expect(payload.parameters.reasoning_effort).toBe("none");
    expect(payload.model_config.is_reasoning).toBe(false);
  });

  it("preserves Claude off intent through the OpenAI bridge", async () => {
    const { payload } = await build({ thinking: { type: "disabled" } }, { source: "claude" });
    expect(payload.parameters.reasoning_effort).toBe("none");
    expect(payload.parameters.max_thinking_tokens).toBe(0);
  });

  it.each(["low", "high", "max"])("forwards %s without DeepSeek remapping", async (level) => {
    const { payload } = await build({ reasoning_effort: level });
    expect(payload.parameters).toEqual({ max_tokens: 2048, reasoning_effort: level });
    expect(payload.model_config.is_reasoning).toBe(true);
    expect(payload.chat_context.extra.modelConfig.is_reasoning).toBe(true);
  });

  it("keeps an explicit thinking budget", async () => {
    const { payload } = await build({ thinking: { type: "enabled", budget_tokens: 1024 } });
    expect(payload.parameters).toEqual({ max_tokens: 2048, max_thinking_tokens: 1024 });
    expect(payload.model_config.is_reasoning).toBe(true);
  });

  it("leaves the server default untouched when the client sends no thinking option", async () => {
    const { payload } = await build();
    expect(payload.parameters).toEqual({ max_tokens: 2048 });
    expect(payload.model_config).toEqual(config);
  });

  it("does not mutate the cached model configuration when turning thinking off", async () => {
    const cached = structuredClone(config);
    getQoderModelConfig.mockResolvedValue(cached);
    await build({ enable_thinking: false });
    expect(cached).toEqual(config);
    expect((await build()).payload.model_config.is_reasoning).toBe(true);
  });

  it("uses a distinct record when a timed-out thinking request is retried with thinking off", async () => {
    const on = (await build({ reasoning_effort: "max" })).payload;
    const off = (await build({ enable_thinking: false })).payload;
    expect(off.chat_record_id).not.toBe(on.chat_record_id);
    expect(off.request_set_id).not.toBe(on.request_set_id);
  });

  it("trusts live switchability even when the static model table is stale", async () => {
    getQoderModelConfig.mockResolvedValue({ ...structuredClone(config), key: "smodel" });
    const { payload } = await build({ enable_thinking: false }, { model: "smodel" });
    expect(payload.model_config.is_reasoning).toBe(false);
    expect(payload.parameters.reasoning_effort).toBe("none");
  });

  it.each(["qoder", "qoder-cn"])("keeps off intent for a newly published %s model", async (provider) => {
    getQoderModelConfig.mockResolvedValue({ ...structuredClone(config), key: "newmodel" });
    const { payload } = await build({ enable_thinking: false }, { model: "newmodel", provider });
    expect(payload.parameters.reasoning_effort).toBe("none");
    expect(payload.model_config.is_reasoning).toBe(false);
  });

  it("rejects disabling when the live catalog no longer advertises it", async () => {
    const mandatory = structuredClone(config);
    delete mandatory.thinking_config.disabled;
    getQoderModelConfig.mockResolvedValue(mandatory);
    await expect(build({ enable_thinking: false })).rejects.toThrow(/cannot disable thinking/i);
  });

  it("rejects a level the selected model does not advertise", async () => {
    await expect(build({ reasoning_effort: "medium" })).rejects.toThrow(/unsupported reasoning effort.*medium/i);
  });

  it("turns on reasoning-capable models whose top-level catalog flag is false", async () => {
    getQoderModelConfig.mockResolvedValue({ ...structuredClone(config), is_reasoning: false });
    const { payload } = await build({ reasoning_effort: "low" });
    expect(payload.model_config.is_reasoning).toBe(true);
    expect(payload.chat_context.extra.modelConfig.is_reasoning).toBe(true);
  });

  it("enables a binary thinking model without inventing an effort level", async () => {
    getQoderModelConfig.mockResolvedValue({
      ...structuredClone(config), key: "qmodel", is_reasoning: false,
      thinking_config: { disabled: {}, enabled: { is_default: true } },
    });
    const { payload } = await build({}, { model: "qmodel(auto)" });
    expect(payload.parameters).toEqual({ max_tokens: 2048 });
    expect(payload.model_config.is_reasoning).toBe(true);
    expect(payload.chat_context.extra.modelConfig.is_reasoning).toBe(true);
  });

  it("offers dfmodel's actual levels while keeping mandatory models non-switchable", () => {
    expect(getCapabilitiesForModel("qoder", "dfmodel").thinkingCanDisable).toBe(true);
    expect(getThinkingLevels("qoder", "dfmodel")).toEqual(["none", "low", "high", "max"]);
    expect(getThinkingLevels("qoder", "smodel")).not.toContain("none");
  });
});
