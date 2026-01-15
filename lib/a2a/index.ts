/**
 * A2A Client Module Exports
 */

// Core client
export { A2AClient } from './client'
export type {
  AgentCard,
  A2AClientConfig,
  A2AExtensionConfig,
  StreamChunk,
  A2AMessage,
  A2AMessagePart,
  A2AError,
} from './client'

// Extension handler
export {
  handleAgentCard,
  extractDemandsFromAgentCard,
  buildFulfillments,
  resolveMetadata,
} from './extension-handler'
export type { PlatformConfig } from './extension-handler'

// Extension types
export * from './extension-types'

// Extension URIs
export { EXTENSION_URIS, type ExtensionUri } from './extension-uris'

// UI Extension parser
export {
  parseUIExtensions,
  extractCitations,
  extractTrajectory,
  extractError,
  extractFormRequest,
} from './ui-extension-parser'
export type {
  Citation,
  CitationMetadata,
  TrajectoryMetadata,
  ErrorMetadata,
  FormRequestMetadata,
  FormField,
  CanvasEditMetadata,
  AgentDetailMetadata,
  ParsedUIExtensions,
} from './ui-extension-parser'
