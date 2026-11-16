import { describe, expect, it } from "vitest";
import "./registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const MODEL = "gpt-6.1-sol";
const PROVIDER = "openai-compatible-responses-contract-test";
const chat = (extra = {}) => ({
  model: MODEL,
  messages: [{ role: "user", content: "Return a JSON object with ok=true." }],
  stream: true,
  max_tokens: 12288,
  reasoning_effort: "medium",
  thinking: { type: "enabled" },
  response_format: { type: "json_object" },
  ...extra,
});
const translate = (body, source = FORMATS.OPENAI, target = FORMATS.OPENAI_RESPONSES, provider = PROVIDER) =>
  translateRequest(source, target, MODEL, structuredClone(body), true, null, provider);

describe("OpenAI Responses upstream request contract", () => {
  it.each([PROVIDER, "openai", "codex"])("keeps the nested effort after the full pipeline for %s", (provider) => {
    const out = translate(chat(), FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, provider);

    expect(out.reasoning).toMatchObject({ effort: "medium" });
    expect(out).not.toHaveProperty("reasoning_effort");
    expect(out).not.toHaveProperty("thinking");
    expect(out).not.toHaveProperty("messages");
    expect(out.max_output_tokens).toBe(12288);
    expect(out).not.toHaveProperty("max_tokens");
  });

  it("keeps Chat Completions parameters when the upstream uses Chat Completions", () => {
    const out = translate(chat(), FORMATS.OPENAI, FORMATS.OPENAI);

    expect(out.reasoning_effort).toBe("medium");
    expect(out).not.toHaveProperty("reasoning");
    expect(out.response_format).toEqual({ type: "json_object" });
    expect(out.max_tokens).toBe(12288);
  });

  it("preserves native Responses reasoning options during normalization", () => {
    const reasoning = { effort: "high", summary: "detailed", mode: "standard" };
    const out = translate({
      model: MODEL,
      input: [{ role: "user", content: "Return JSON." }],
      reasoning,
    }, FORMATS.OPENAI_RESPONSES);

    expect(out.reasoning).toEqual(reasoning);
    expect(out).not.toHaveProperty("reasoning_effort");
  });

  it("leaves auto effort to the upstream instead of sending an unsupported enum", () => {
    const out = translate(chat({ reasoning_effort: undefined }));

    expect(out.reasoning?.effort).toBeUndefined();
    expect(out).not.toHaveProperty("reasoning_effort");
    expect(out).not.toHaveProperty("thinking");
  });

  it("preserves an explicit none effort on a model that can disable reasoning", () => {
    const out = translateRequest(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, "gpt-5.1", {
      messages: [{ role: "user", content: "Hello" }],
      reasoning_effort: "none",
    }, true, null, PROVIDER);

    expect(out.reasoning).toEqual({ effort: "none" });
    expect(out).not.toHaveProperty("reasoning_effort");
  });

  it.each(["json_object", "text"])("maps response_format %s to text.format", (type) => {
    const out = translate(chat({ response_format: { type } }));

    expect(out.text).toEqual({ format: { type } });
    expect(out).not.toHaveProperty("response_format");
  });

  it("preserves strict JSON Schema constraints in the Responses format", () => {
    const jsonSchema = {
      name: "review_result",
      description: "Structured review result",
      strict: true,
      schema: {
        type: "object",
        properties: { ok: { type: "boolean" } },
        required: ["ok"],
        additionalProperties: false,
      },
    };
    const out = translate(chat({ response_format: { type: "json_schema", json_schema: jsonSchema } }));

    expect(out.text).toEqual({ format: { type: "json_schema", ...jsonSchema } });
    expect(out).not.toHaveProperty("response_format");
  });

  it("also converts response_format for Responses input sent through the Chat endpoint", () => {
    const out = translate({
      model: MODEL,
      input: [{ role: "user", content: "Return JSON." }],
      reasoning_effort: "medium",
      max_completion_tokens: 1024,
      response_format: { type: "json_object" },
      text: { verbosity: "low" },
    });

    expect(out.text).toEqual({ verbosity: "low", format: { type: "json_object" } });
    expect(out.reasoning.effort).toBe("medium");
    expect(out).not.toHaveProperty("reasoning_effort");
    expect(out).not.toHaveProperty("response_format");
    expect(out.max_output_tokens).toBe(1024);
  });

  it("preserves an explicit native text format instead of replacing it with an alias", () => {
    const text = { verbosity: "low", format: { type: "json_object" } };
    const out = translate(chat({ text, response_format: { type: "text" } }));

    expect(out.text).toEqual(text);
  });
});
