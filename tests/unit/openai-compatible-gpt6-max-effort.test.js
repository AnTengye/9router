import { describe, expect, it } from "vitest";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

// #5186: OpenAI publishes "max" as a reasoning.effort value for GPT-5.6 and GPT-6.
// The codex provider already keeps it; an OpenAI Compatible node pointing at the
// same models silently clamped it to "xhigh".
const NODE = "openai-compatible-chat-test";
const MAX_MODELS = ["gpt-6-astra", "gpt-6.1-sol", "gpt-6-luna", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"];

describe("OpenAI Compatible node keeps effort max for GPT-5.6 / GPT-6 (#5186)", () => {
  it.each(MAX_MODELS)("%s: max reaches the wire as max (chat)", (model) => {
    const out = applyThinking(FORMATS.OPENAI, model, { reasoning_effort: "max" }, NODE);
    expect(out.reasoning_effort).toBe("max");
  });

  it.each(MAX_MODELS)("%s: Claude-style output_config.effort max stays max", (model) => {
    const out = applyThinking(FORMATS.OPENAI, model, { output_config: { effort: "max" } }, NODE);
    expect(out.reasoning_effort).toBe("max");
  });

  it("level list offers max and ultra for the picker", () => {
    expect(getThinkingLevels(NODE, "gpt-6-astra")).toContain("max");
    expect(getThinkingLevels(NODE, "gpt-6-astra")).toContain("ultra");
  });

  it("older GPT models on a node also support max and ultra", () => {
    const out = applyThinking(FORMATS.OPENAI, "gpt-5", { reasoning_effort: "ultra" }, NODE);
    expect(out.reasoning_effort).toBe("ultra");
  });

  it("built-in openai provider also supports max and ultra", () => {
    const out = applyThinking(FORMATS.OPENAI, "gpt-5", { reasoning_effort: "ultra" }, "openai");
    expect(out.reasoning_effort).toBe("ultra");
  });
});
