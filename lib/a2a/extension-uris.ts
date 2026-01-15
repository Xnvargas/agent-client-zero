/**
 * A2A Extension URIs
 * Reference: https://github.com/i-am-bee/agentstack/blob/main/apps/agentstack-sdk-ts/src/client/a2a/extensions/
 */

// Service Extension URIs (Platform -> Agent)
export const EXTENSION_URIS = {
  // Service Extensions
  LLM: 'https://a2a-extensions.agentstack.beeai.dev/services/llm/v1',
  EMBEDDING: 'https://a2a-extensions.agentstack.beeai.dev/services/embedding/v1',
  MCP: 'https://a2a-extensions.agentstack.beeai.dev/services/mcp/v1',
  OAUTH_PROVIDER: 'https://a2a-extensions.agentstack.beeai.dev/services/oauth-provider/v1',
  SECRETS: 'https://a2a-extensions.agentstack.beeai.dev/services/secrets/v1',
  PLATFORM_API: 'https://a2a-extensions.agentstack.beeai.dev/services/platform-api/v1',
  FORM_SERVICE: 'https://a2a-extensions.agentstack.beeai.dev/services/form/v1',

  // UI Extensions (Agent -> Platform)
  CITATION: 'https://a2a-extensions.agentstack.beeai.dev/ui/citation/v1',
  TRAJECTORY: 'https://a2a-extensions.agentstack.beeai.dev/ui/trajectory/v1',
  ERROR: 'https://a2a-extensions.agentstack.beeai.dev/ui/error/v1',
  FORM_REQUEST: 'https://a2a-extensions.agentstack.beeai.dev/ui/form-request/v1',
  CANVAS: 'https://a2a-extensions.agentstack.beeai.dev/ui/canvas/v1',
  AGENT_DETAIL: 'https://a2a-extensions.agentstack.beeai.dev/ui/agent-detail/v1',
  OAUTH_REQUEST: 'https://a2a-extensions.agentstack.beeai.dev/ui/oauth/v1',
  SETTINGS: 'https://a2a-extensions.agentstack.beeai.dev/ui/settings/v1',
} as const

export type ExtensionUri = typeof EXTENSION_URIS[keyof typeof EXTENSION_URIS]
