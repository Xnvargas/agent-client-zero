/**
 * Extension Handler for agent-client-zero
 *
 * This module handles:
 * 1. Parsing agent card to extract extension demands
 * 2. Building metadata with fulfillments for A2A requests
 * 3. Parsing UI extension metadata from agent responses
 *
 * Reference: https://raw.githubusercontent.com/i-am-bee/agentstack/main/docs/development/custom-ui/client-sdk/extensions.mdx
 */

import { EXTENSION_URIS } from './extension-uris'
import type {
  LLMDemands,
  LLMFulfillments,
  EmbeddingDemands,
  EmbeddingFulfillments,
  MCPDemands,
  MCPFulfillments,
  SecretDemands,
  SecretFulfillments,
  SettingsDemands,
  SettingsFulfillments,
  FormDemands,
  FormFulfillments,
  OAuthDemands,
  OAuthFulfillments,
  ExtractedDemands,
  Fulfillments,
} from './extension-types'
import type { AgentCard } from './client'

/**
 * Platform configuration for fulfilling extension demands
 * Users configure these values to provide services to agents
 */
export interface PlatformConfig {
  // LLM Configuration
  llm?: {
    apiBase: string // e.g., 'http://192.168.0.58:11434/v1'
    apiKey: string // API key for the LLM provider
    defaultModel: string // e.g., 'qwen3-next:80b'
  }

  // Embedding Configuration
  embedding?: {
    apiBase: string
    apiKey: string
    defaultModel: string
  }

  // MCP Configuration
  mcp?: {
    servers: Record<string, { url: string }>
  }

  // OAuth Configuration
  oauth?: {
    redirectUri: string
    providers: Record<string, { accessToken: string }>
  }

  // Secrets (user-provided API keys, etc.)
  secrets?: Record<string, string>

  // Settings values
  settings?: Record<string, unknown>
}

/**
 * Extract service extension demands from agent card capabilities
 *
 * Reference: https://github.com/i-am-bee/agentstack/blob/main/apps/agentstack-sdk-ts/src/client/a2a/extensions/handle-agent-card.ts
 */
export function extractDemandsFromAgentCard(agentCard: AgentCard): ExtractedDemands {
  const extensions = agentCard.extensions || []

  const demands: ExtractedDemands = {
    llmDemands: null,
    embeddingDemands: null,
    mcpDemands: null,
    oauthDemands: null,
    settingsDemands: null,
    secretDemands: null,
    formDemands: null,
  }

  for (const extUri of extensions) {
    // Parse extension URI to extract demands
    // Format: "uri#json_encoded_params" or just "uri"
    const hashIndex = extUri.indexOf('#')
    const uri = hashIndex >= 0 ? extUri.substring(0, hashIndex) : extUri
    const paramsStr = hashIndex >= 0 ? extUri.substring(hashIndex + 1) : null

    let params: Record<string, unknown> = {}
    if (paramsStr) {
      try {
        params = JSON.parse(decodeURIComponent(paramsStr))
      } catch {
        console.warn(`Failed to parse extension params for ${uri}:`, paramsStr)
      }
    }

    switch (uri) {
      case EXTENSION_URIS.LLM:
        demands.llmDemands = params as LLMDemands
        break
      case EXTENSION_URIS.EMBEDDING:
        demands.embeddingDemands = params as EmbeddingDemands
        break
      case EXTENSION_URIS.MCP:
        demands.mcpDemands = params as MCPDemands
        break
      case EXTENSION_URIS.OAUTH_PROVIDER:
        demands.oauthDemands = params as OAuthDemands
        break
      case EXTENSION_URIS.SETTINGS:
        demands.settingsDemands = params as SettingsDemands
        break
      case EXTENSION_URIS.SECRETS:
        demands.secretDemands = params as SecretDemands
        break
      case EXTENSION_URIS.FORM_SERVICE:
        demands.formDemands = params as FormDemands
        break
    }
  }

  return demands
}

/**
 * Build fulfillment functions based on platform configuration
 */
export function buildFulfillments(config: PlatformConfig): Partial<Fulfillments> {
  const fulfillments: Partial<Fulfillments> = {}

  // LLM Fulfillment
  if (config.llm) {
    const llmConfig = config.llm
    fulfillments.llm = async (demands: LLMDemands): Promise<LLMFulfillments> => {
      const result: LLMFulfillments['llm_fulfillments'] = {}

      for (const [key, demand] of Object.entries(demands.llm_demands)) {
        // Use suggested model if available, otherwise use default
        const model = demand.suggested?.[0] || llmConfig.defaultModel

        result[key] = {
          identifier: 'custom_llm',
          api_base: llmConfig.apiBase,
          api_key: llmConfig.apiKey,
          api_model: model,
        }
      }

      return { llm_fulfillments: result }
    }
  }

  // Embedding Fulfillment
  if (config.embedding) {
    const embeddingConfig = config.embedding
    fulfillments.embedding = async (demands: EmbeddingDemands): Promise<EmbeddingFulfillments> => {
      const result: EmbeddingFulfillments['embedding_fulfillments'] = {}

      for (const [key, demand] of Object.entries(demands.embedding_demands)) {
        const model = demand.suggested?.[0] || embeddingConfig.defaultModel

        result[key] = {
          api_base: embeddingConfig.apiBase,
          api_key: embeddingConfig.apiKey,
          api_model: model,
        }
      }

      return { embedding_fulfillments: result }
    }
  }

  // MCP Fulfillment
  if (config.mcp) {
    const mcpConfig = config.mcp
    fulfillments.mcp = async (demands: MCPDemands): Promise<MCPFulfillments> => {
      const result: MCPFulfillments['mcp_fulfillments'] = {}

      for (const [key, demand] of Object.entries(demands.mcp_demands)) {
        const serverName = demand.suggested?.[0]
        if (serverName && mcpConfig.servers[serverName]) {
          result[key] = mcpConfig.servers[serverName]
        }
      }

      return { mcp_fulfillments: result }
    }
  }

  // Secrets Fulfillment
  if (config.secrets) {
    const secretsConfig = config.secrets
    fulfillments.secrets = async (demands: SecretDemands): Promise<SecretFulfillments> => {
      const result: SecretFulfillments['secret_fulfillments'] = {}

      for (const key of Object.keys(demands.secret_demands)) {
        if (secretsConfig[key]) {
          result[key] = { secret: secretsConfig[key] }
        }
      }

      return { secret_fulfillments: result }
    }
  }

  // Settings Fulfillment
  if (config.settings) {
    const settingsConfig = config.settings
    fulfillments.settings = async (_demands: SettingsDemands): Promise<SettingsFulfillments> => {
      return { values: settingsConfig }
    }
  }

  // OAuth Fulfillment
  if (config.oauth) {
    const oauthConfig = config.oauth
    fulfillments.oauth = async (demands: OAuthDemands): Promise<OAuthFulfillments> => {
      const result: OAuthFulfillments['oauth_fulfillments'] = {}

      for (const key of Object.keys(demands.oauth_demands)) {
        if (oauthConfig.providers[key]) {
          result[key] = { access_token: oauthConfig.providers[key].accessToken }
        }
      }

      return { oauth_fulfillments: result }
    }

    fulfillments.oauthRedirectUri = () => oauthConfig.redirectUri
  } else {
    fulfillments.oauthRedirectUri = () => null
  }

  // Form Fulfillment (typically handled by UI, return empty)
  fulfillments.form = async (_demands: FormDemands): Promise<FormFulfillments> => {
    return { values: {} }
  }

  // Context Token (placeholder - implement if using AgentStack platform)
  fulfillments.getContextToken = () => ({ token: '', expires_at: null })

  return fulfillments
}

/**
 * Resolve metadata to send with A2A requests
 * This builds the metadata object that fulfills agent extension demands
 *
 * Reference: https://github.com/i-am-bee/agentstack/blob/main/apps/agentstack-sdk-ts/src/client/a2a/extensions/handle-agent-card.ts#L60-L100
 */
export async function resolveMetadata(
  demands: ExtractedDemands,
  fulfillments: Partial<Fulfillments>
): Promise<Record<string, unknown>> {
  const metadata: Record<string, unknown> = {}

  // Fulfill LLM demands
  if (demands.llmDemands && fulfillments.llm) {
    const llmFulfillment = await fulfillments.llm(demands.llmDemands)
    metadata[EXTENSION_URIS.LLM] = llmFulfillment
  }

  // Fulfill Embedding demands
  if (demands.embeddingDemands && fulfillments.embedding) {
    const embeddingFulfillment = await fulfillments.embedding(demands.embeddingDemands)
    metadata[EXTENSION_URIS.EMBEDDING] = embeddingFulfillment
  }

  // Fulfill MCP demands
  if (demands.mcpDemands && fulfillments.mcp) {
    const mcpFulfillment = await fulfillments.mcp(demands.mcpDemands)
    metadata[EXTENSION_URIS.MCP] = mcpFulfillment
  }

  // Fulfill OAuth demands
  if (demands.oauthDemands && fulfillments.oauth) {
    const oauthFulfillment = await fulfillments.oauth(demands.oauthDemands)
    metadata[EXTENSION_URIS.OAUTH_PROVIDER] = oauthFulfillment
  }

  // Fulfill Settings demands
  if (demands.settingsDemands && fulfillments.settings) {
    const settingsFulfillment = await fulfillments.settings(demands.settingsDemands)
    metadata[EXTENSION_URIS.SETTINGS] = settingsFulfillment
  }

  // Fulfill Secrets demands
  if (demands.secretDemands && fulfillments.secrets) {
    const secretsFulfillment = await fulfillments.secrets(demands.secretDemands)
    metadata[EXTENSION_URIS.SECRETS] = secretsFulfillment
  }

  // Fulfill Form demands
  if (demands.formDemands && fulfillments.form) {
    const formFulfillment = await fulfillments.form(demands.formDemands)
    metadata[EXTENSION_URIS.FORM_SERVICE] = formFulfillment
  }

  // Add OAuth redirect URI if configured
  if (fulfillments.oauthRedirectUri) {
    const redirectUri = fulfillments.oauthRedirectUri()
    if (redirectUri) {
      metadata[EXTENSION_URIS.OAUTH_REQUEST] = { redirect_uri: redirectUri }
    }
  }

  // Add Platform API token if available
  if (fulfillments.getContextToken) {
    const token = fulfillments.getContextToken()
    if (token.token) {
      metadata[EXTENSION_URIS.PLATFORM_API] = { context_token: token.token }
    }
  }

  return metadata
}

/**
 * Main handler function - combines extraction and resolution
 *
 * Usage:
 * ```typescript
 * const { demands, resolveMetadata } = handleAgentCard(agentCard);
 * const metadata = await resolveMetadata(fulfillments);
 * await client.sendMessage(message, metadata);
 * ```
 */
export function handleAgentCard(agentCard: AgentCard) {
  const demands = extractDemandsFromAgentCard(agentCard)

  return {
    demands,
    resolveMetadata: (fulfillments: Partial<Fulfillments>) => resolveMetadata(demands, fulfillments),
  }
}

// Re-export types for convenience
export type { AgentCard } from './client'
