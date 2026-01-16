/**
 * Extension type definitions based on agentstack-sdk
 * Reference: https://github.com/i-am-bee/agentstack/blob/main/apps/agentstack-sdk-ts/src/client/a2a/extensions/services/llm.ts
 */

// LLM Extension Types
export interface LLMDemand {
  description?: string | null
  suggested?: string[] | null
}

export interface LLMDemands {
  llm_demands: Record<string, LLMDemand>
}

export interface LLMFulfillment {
  identifier?: string | null
  api_base: string
  api_key: string
  api_model: string
}

export interface LLMFulfillments {
  llm_fulfillments: Record<string, LLMFulfillment>
}

// Embedding Extension Types
export interface EmbeddingDemand {
  description?: string | null
  suggested?: string[] | null
}

export interface EmbeddingDemands {
  embedding_demands: Record<string, EmbeddingDemand>
}

export interface EmbeddingFulfillment {
  api_base: string
  api_key: string
  api_model: string
}

export interface EmbeddingFulfillments {
  embedding_fulfillments: Record<string, EmbeddingFulfillment>
}

// MCP Extension Types
export interface MCPDemand {
  suggested?: string[] | null
}

export interface MCPDemands {
  mcp_demands: Record<string, MCPDemand>
}

export interface MCPFulfillment {
  url: string
}

export interface MCPFulfillments {
  mcp_fulfillments: Record<string, MCPFulfillment>
}

// Secrets Extension Types
export interface SecretDemand {
  name?: string
  description?: string
}

export interface SecretDemands {
  secret_demands: Record<string, SecretDemand>
}

export interface SecretFulfillment {
  secret: string
}

export interface SecretFulfillments {
  secret_fulfillments: Record<string, SecretFulfillment>
}

// Settings Extension Types
export interface SettingsDemands {
  fields: unknown[]
}

export interface SettingsFulfillments {
  values: Record<string, unknown>
}

// Form Extension Types
export interface FormDemands {
  initial_form?: unknown
}

export interface FormFulfillments {
  values: Record<string, unknown>
}

// OAuth Extension Types
export interface OAuthDemand {
  scopes?: string[]
  redirect_uri?: string
}

export interface OAuthDemands {
  oauth_demands: Record<string, OAuthDemand>
}

export interface OAuthFulfillment {
  access_token: string
}

export interface OAuthFulfillments {
  oauth_fulfillments: Record<string, OAuthFulfillment>
}

// Context Token (for Platform API access)
export interface ContextToken {
  token: string
  expires_at?: string | null
}

// Aggregated Fulfillments interface
export interface Fulfillments {
  llm: (demand: LLMDemands) => Promise<LLMFulfillments>
  embedding: (demand: EmbeddingDemands) => Promise<EmbeddingFulfillments>
  mcp: (demand: MCPDemands) => Promise<MCPFulfillments>
  oauth: (demand: OAuthDemands) => Promise<OAuthFulfillments>
  settings: (demand: SettingsDemands) => Promise<SettingsFulfillments>
  secrets: (demand: SecretDemands) => Promise<SecretFulfillments>
  form: (demand: FormDemands) => Promise<FormFulfillments>
  oauthRedirectUri: () => string | null
  getContextToken: () => ContextToken
}

// Extracted demands from agent card
export interface ExtractedDemands {
  llmDemands: LLMDemands | null
  embeddingDemands: EmbeddingDemands | null
  mcpDemands: MCPDemands | null
  oauthDemands: OAuthDemands | null
  settingsDemands: SettingsDemands | null
  secretDemands: SecretDemands | null
  formDemands: FormDemands | null
}
