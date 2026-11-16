import { describe, it, expect, vi } from "vitest";
import { __test__ } from "../../open-sse/executors/qoder.js";

const { wrapQoderSSE } = __test__;
const duplicate = '{"code":"103","message":"Duplicate request"}';
const frame = (statusCodeValue, body) => `data: ${JSON.stringify({ statusCodeValue, body })}\n\n`;

function upstream(chunks, { keepOpen = false } = {}) {
  const cancel = vi.fn();
  const response = new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      if (!keepOpen) controller.close();
    },
    cancel,
  }));
  return { response, cancel };
}

describe("Qoder first-frame errors", () => {
  it.each([
    ["one chunk", [frame(403, duplicate)]],
    ["fragmented frame", [frame(403, duplicate).slice(0, 35), frame(403, duplicate).slice(35)]],
    ["heartbeat prefix", [": keepalive\r\n\r\n", frame(403, duplicate)]],
    ["prefix and frame in one chunk", [": keepalive\n\nevent: message\n" + frame(403, duplicate)]],
    ["EOF without newline", [frame(403, duplicate).trimEnd()]],
    ["object body", [frame(403, JSON.parse(duplicate))]],
  ])("surfaces duplicate-request errors as HTTP 403: %s", async (_name, chunks) => {
    const { response } = upstream(chunks);
    const wrapped = await wrapQoderSSE(response, "qoder/kmodel_latest");
    expect(wrapped.status).toBe(403);
    expect(wrapped.ok).toBe(false);
    expect(wrapped.headers.get("content-type")).toBe("application/json");
    const body = await wrapped.json();
    expect(body.error).toMatchObject({
      code: "103",
      type: "qoder_error",
      message: expect.stringContaining("Duplicate request"),
    });
    expect(body).not.toHaveProperty("choices");
  });

  it("cancels the upstream keepalive immediately after an error", async () => {
    const { response, cancel } = upstream([": keepalive\n\n", frame(403, duplicate)], { keepOpen: true });
    const wrapped = await wrapQoderSSE(response, "qoder/kmodel_latest");
    expect(wrapped.status).toBe(403);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each([401, 429, 500, 503])("preserves non-billing HTTP status %s", async (status) => {
    const { response } = upstream([frame(status, "upstream failure")]);
    const wrapped = await wrapQoderSSE(response, "qoder/auto");
    expect(wrapped.status).toBe(status);
    expect((await wrapped.json()).error).toMatchObject({
      code: status,
      message: expect.stringContaining("upstream failure"),
    });
  });

  it.each([0, 302, 600, 403.5])("maps invalid error status %s to 502", async (status) => {
    const { response } = upstream([frame(status, "invalid upstream status")]);
    const wrapped = await wrapQoderSSE(response, "qoder/auto");
    expect(wrapped.status).toBe(502);
  });

  it("replays successful frames after a heartbeat without losing or duplicating content", async () => {
    const first = JSON.stringify({ choices: [{ delta: { content: "hello" } }] });
    const second = JSON.stringify({ choices: [{ delta: { content: "world" } }] });
    const { response } = upstream([": keepalive\n\n", frame(200, first) + frame(200, second) + "data: [DONE]\n\n"]);
    const wrapped = await wrapQoderSSE(response, "qoder/auto");
    expect(wrapped.status).toBe(200);
    const events = (await wrapped.text()).trim().split("\n\n");
    expect(events).toHaveLength(3);
    expect(events.slice(0, 2).map((event) => JSON.parse(event.slice(6)))).toEqual([
      { choices: [{ delta: { content: "hello" } }], model: "qoder/auto" },
      { choices: [{ delta: { content: "world" } }], model: "qoder/auto" },
    ]);
    expect(events[2]).toBe("data: [DONE]");
  });

  it("starts forwarding success without waiting for the upstream to close", async () => {
    const inner = JSON.stringify({ choices: [{ delta: { content: "hello" } }] });
    const { response, cancel } = upstream([": keepalive\n\n", frame(200, inner)], { keepOpen: true });
    const wrapped = await wrapQoderSSE(response, "qoder/auto");
    const reader = wrapped.body.getReader();
    try {
      const { value } = await reader.read();
      expect(JSON.parse(new TextDecoder().decode(value).slice(6))).toEqual({
        choices: [{ delta: { content: "hello" } }],
        model: "qoder/auto",
      });
    } finally {
      await reader.cancel();
    }
    expect(cancel).toHaveBeenCalledOnce();
  });
});
