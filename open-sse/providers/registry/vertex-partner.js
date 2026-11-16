export default {
  id: "vertex-partner",
  priority: 260,
  alias: "vertex-partner",
  aliases: [
    "vxp",
  ],
  uiAlias: "vxp",
  display: {
    name: "Vertex Partner",
    icon: "cloud",
    color: "#34A853",
    textIcon: "VP",
    website: "https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/use-partner-models",
    notice: {
      apiKeyUrl: "https://console.cloud.google.com/iam-admin/serviceaccounts",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://aiplatform.googleapis.com",
  },
  models: [
    { id: "claude-fable-5-2", name: "Claude Fable 5.2 (Vertex)", targetFormat: "claude" },
    { id: "claude-opus-5-5", name: "Claude Opus 5.5 (Vertex)", targetFormat: "claude" },
    { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5 (Vertex)", targetFormat: "claude" },
    { id: "claude-haiku-5-5", name: "Claude Haiku 5.5 (Vertex)", targetFormat: "claude" },
    { id: "claude-fable-5-1", name: "Claude Fable 5.1 (Vertex)", targetFormat: "claude" },
    { id: "claude-opus-4-6", name: "Claude Opus 4.6 (Vertex)", targetFormat: "claude" },
    { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6 (Vertex)", targetFormat: "claude" },
    { id: "claude-haiku-4-5@20251001", name: "Claude Haiku 4.5 (Vertex)", targetFormat: "claude" },
    { id: "deepseek-ai/deepseek-v3.2-maas", name: "DeepSeek V3.2 (Vertex)" },
    { id: "qwen/qwen3-next-80b-a3b-thinking-maas", name: "Qwen3 Next 80B Thinking (Vertex)" },
    { id: "qwen/qwen3-next-80b-a3b-instruct-maas", name: "Qwen3 Next 80B Instruct (Vertex)" },
    { id: "zai-org/glm-5-maas", name: "GLM-5 (Vertex)" },
  ],
};
