/**
 * A2A to Carbon AI Chat Translator
 *
 * Translates A2A protocol streaming events to Carbon AI Chat's expected format.
 *
 * References:
 * - Carbon AI Chat streaming: https://github.com/carbon-design-system/carbon-ai-chat/blob/main/examples/react/reasoning-and-chain-of-thought/src/scenarios.ts
 * - A2A Protocol types: https://github.com/a2aproject/a2a-python/blob/main/src/a2a/types.py
 */

import type { StreamChunk, A2AMessagePart } from '@/lib/a2a'
import { parseUIExtensions, extractCitations, extractTrajectory } from '@/lib/a2a'

// =============================================================================
// CARBON AI CHAT TYPES
// Based on @carbon/ai-chat package types
// =============================================================================

/**
 * Carbon message response types
 */
export const MessageResponseTypes = {
  TEXT: 'text',
  USER_DEFINED: 'user_defined',
  INLINE_ERROR: 'inline_error',
  OPTION: 'option',
} as const

export type MessageResponseType = typeof MessageResponseTypes[keyof typeof MessageResponseTypes]

/**
 * Chain of thought step status
 */
export enum ChainOfThoughtStepStatus {
  IN_PROGRESS = 'in_progress',
  SUCCESS = 'success',
  ERROR = 'error',
}

/**
 * Reasoning step open state
 */
export enum ReasoningStepOpenState {
  OPEN = 'open',
  CLOSE = 'close',
  DEFAULT = 'default',
}

/**
 * User type for response profile
 */
export enum UserType {
  HUMAN = 'human',
  BOT = 'bot',
  WATSONX = 'watsonx',
}

/**
 * Response user profile
 */
export interface ResponseUserProfile {
  id: string
  nickname: string
  user_type: UserType
  profile_picture_url?: string
}

/**
 * Reasoning step structure
 */
export interface ReasoningStep {
  title: string
  content?: string
  open_state?: ReasoningStepOpenState
}

/**
 * Chain of thought step structure
 */
export interface ChainOfThoughtStep {
  title: string
  description?: string
  tool_name?: string
  request?: { args: unknown }
  response?: { content: unknown }
  status: ChainOfThoughtStepStatus
}

/**
 * Message response options
 */
export interface MessageResponseOptions {
  response_user_profile?: ResponseUserProfile
  reasoning?: {
    open_state?: ReasoningStepOpenState
    steps?: ReasoningStep[]
    content?: string
  }
  chain_of_thought?: ChainOfThoughtStep[]
}

/**
 * Item streaming metadata
 */
export interface ItemStreamingMetadata {
  id: string
  cancellable?: boolean
  stream_stopped?: boolean
}

/**
 * Generic item (text response)
 */
export interface TextItem {
  response_type: typeof MessageResponseTypes.TEXT
  text: string
  streaming_metadata?: ItemStreamingMetadata
  message_item_options?: {
    feedback?: {
      is_on?: boolean
      id?: string
    }
  }
}

/**
 * User defined item (custom content)
 */
export interface UserDefinedItem {
  response_type: typeof MessageResponseTypes.USER_DEFINED
  user_defined: Record<string, unknown>
}

/**
 * Generic item union type
 */
export type GenericItem = TextItem | UserDefinedItem

/**
 * Partial item chunk for streaming
 */
export interface PartialItemChunk {
  partial_item: Partial<GenericItem> & {
    response_type: MessageResponseType
    streaming_metadata?: ItemStreamingMetadata
  }
  partial_response?: {
    message_options?: Partial<MessageResponseOptions>
  }
  streaming_metadata: {
    response_id: string
  }
}

/**
 * Complete item chunk
 */
export interface CompleteItemChunk {
  complete_item: GenericItem
  partial_response?: {
    message_options?: Partial<MessageResponseOptions>
  }
  streaming_metadata: {
    response_id: string
  }
}

/**
 * Final response chunk
 */
export interface FinalResponseChunk {
  final_response: {
    id: string
    output: {
      generic: GenericItem[]
    }
    message_options?: MessageResponseOptions
  }
}

/**
 * Stream chunk union type
 */
export type CarbonStreamChunk = PartialItemChunk | CompleteItemChunk | FinalResponseChunk

/**
 * Carbon message for addMessage() API
 */
export interface CarbonMessage {
  output: {
    generic: GenericItem[]
  }
  message_options?: MessageResponseOptions
}

// =============================================================================
// LEGACY CARBON MESSAGE TYPE (for backward compatibility with EnhancedChatWrapper)
// =============================================================================

/**
 * Legacy Carbon Message format (used by EnhancedChatWrapper)
 * This is the older format that works with Carbon's addMessage() API directly
 */
export interface LegacyCarbonMessage {
  response_type: string
  text?: string
  reasoning_steps?: {
    steps: Array<{ content: string }>
    openState?: 'open' | 'closed'
  }
  chain_of_thought?: {
    steps: ChainOfThoughtStep[]
  }
  user_defined?: Record<string, unknown>
  metadata?: Record<string, unknown>
}

// =============================================================================
// A2A PART TYPES WITH METADATA
// =============================================================================

/**
 * Extended A2A part with metadata support
 */
export interface A2APartWithMetadata extends A2AMessagePart {
  metadata?: {
    content_type?: 'thinking' | 'response' | 'status' | string
    [key: string]: unknown
  }
}

/**
 * Tool call data structure
 */
export interface ToolCallData {
  type: 'tool_call'
  tool_name?: string
  args?: unknown
}

/**
 * Tool result data structure
 */
export interface ToolResultData {
  type: 'tool_result'
  tool_name?: string
  result_preview?: unknown
  success?: boolean
}

// =============================================================================
// TRANSLATOR CLASS
// =============================================================================

/**
 * Translator state for tracking streaming progress
 */
interface TranslatorState {
  responseId: string
  itemId: string
  accumulatedText: string
  reasoningSteps: ReasoningStep[]
  chainOfThought: ChainOfThoughtStep[]
  pendingToolCalls: Map<string, number> // tool_name -> index in chainOfThought
  hasStartedStreaming: boolean
  shellMessageSent: boolean
}

/**
 * A2A to Carbon AI Chat Translator
 *
 * Manages the translation of A2A streaming events to Carbon AI Chat format.
 * Maintains state across multiple chunks to properly accumulate text and
 * track reasoning/tool call progress.
 */
export class A2AToCarbonTranslator {
  private state: TranslatorState
  private agentProfile: ResponseUserProfile

  constructor(agentProfile?: Partial<ResponseUserProfile>) {
    this.agentProfile = {
      id: agentProfile?.id || 'a2a-agent',
      nickname: agentProfile?.nickname || 'AI Assistant',
      user_type: agentProfile?.user_type || UserType.BOT,
      profile_picture_url: agentProfile?.profile_picture_url,
    }
    this.state = this.createInitialState()
  }

  /**
   * Create initial translator state
   */
  private createInitialState(): TranslatorState {
    return {
      responseId: this.generateResponseId(),
      itemId: '1',
      accumulatedText: '',
      reasoningSteps: [],
      chainOfThought: [],
      pendingToolCalls: new Map(),
      hasStartedStreaming: false,
      shellMessageSent: false,
    }
  }

  /**
   * Generate unique response ID
   */
  private generateResponseId(): string {
    return `response-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`
  }

  /**
   * Reset state for new message
   */
  reset(): void {
    this.state = this.createInitialState()
  }

  /**
   * Get current response ID
   */
  getResponseId(): string {
    return this.state.responseId
  }

  /**
   * Get current item ID
   */
  getItemId(): string {
    return this.state.itemId
  }

  /**
   * Update agent profile
   */
  setAgentProfile(profile: Partial<ResponseUserProfile>): void {
    this.agentProfile = { ...this.agentProfile, ...profile }
  }

  /**
   * Get current agent profile
   */
  getAgentProfile(): ResponseUserProfile {
    return this.agentProfile
  }

  /**
   * Check if shell message has been sent
   */
  hasShellBeenSent(): boolean {
    return this.state.shellMessageSent
  }

  /**
   * Mark shell message as sent
   */
  markShellSent(): void {
    this.state.shellMessageSent = true
  }

  /**
   * Get accumulated text
   */
  getAccumulatedText(): string {
    return this.state.accumulatedText
  }

  /**
   * Get current reasoning steps
   */
  getReasoningSteps(): ReasoningStep[] {
    return [...this.state.reasoningSteps]
  }

  /**
   * Get current chain of thought
   */
  getChainOfThought(): ChainOfThoughtStep[] {
    return [...this.state.chainOfThought]
  }

  /**
   * Check if streaming has started
   */
  hasStartedStreaming(): boolean {
    return this.state.hasStartedStreaming
  }

  // ===========================================================================
  // SHELL MESSAGE CREATION
  // ===========================================================================

  /**
   * Create shell message to initialize Carbon's reducer
   *
   * IMPORTANT: This MUST be called before sending any other chunks.
   * It seeds the message shell so reducers create the container before
   * reasoning steps or text stream in.
   */
  createShellMessage(includeReasoning: boolean = true): PartialItemChunk {
    this.state.shellMessageSent = true

    const chunk: PartialItemChunk = {
      partial_item: {
        response_type: MessageResponseTypes.TEXT,
        text: '',
        streaming_metadata: {
          id: this.state.itemId,
        },
      },
      partial_response: {
        message_options: {
          response_user_profile: this.agentProfile,
        },
      },
      streaming_metadata: {
        response_id: this.state.responseId,
      },
    }

    // Initialize empty reasoning if requested
    if (includeReasoning) {
      chunk.partial_response!.message_options!.reasoning = { steps: [] }
    }

    return chunk
  }

  // ===========================================================================
  // A2A PART TRANSLATION
  // ===========================================================================

  /**
   * Translate a single streaming A2A part to a legacy Carbon message
   * Used for real-time streaming updates (backward compatibility with EnhancedChatWrapper)
   * @param part The A2A part to translate
   * @param metadata Optional extension metadata from the artifact
   */
  translateStreamingPart(part: A2APartWithMetadata, metadata?: Record<string, unknown>): LegacyCarbonMessage | null {
    const contentType = part.metadata?.content_type

    // Handle thinking/reasoning content
    if (contentType === 'thinking' && part.kind === 'text' && part.text) {
      return {
        response_type: 'reasoning_steps',
        reasoning_steps: {
          steps: [{ content: part.text }],
          openState: 'closed',
        },
        metadata,
      }
    }

    // Handle tool call data part
    if (part.kind === 'data' && part.data) {
      const dataType = (part.data as { type?: string }).type

      if (dataType === 'tool_call') {
        const toolData = part.data as unknown as ToolCallData
        return {
          response_type: 'chain_of_thought',
          chain_of_thought: {
            steps: [{
              title: toolData.tool_name || 'Tool Call',
              description: `Calling ${toolData.tool_name || 'tool'}`,
              tool_name: toolData.tool_name,
              request: { args: toolData.args },
              status: ChainOfThoughtStepStatus.IN_PROGRESS,
            }],
          },
          metadata,
        }
      }

      if (dataType === 'tool_result') {
        const resultData = part.data as unknown as ToolResultData
        return {
          response_type: 'chain_of_thought',
          chain_of_thought: {
            steps: [{
              title: resultData.tool_name || 'Tool Result',
              description: `Result from ${resultData.tool_name || 'tool'}`,
              tool_name: resultData.tool_name,
              response: { content: resultData.result_preview },
              status: resultData.success === false
                ? ChainOfThoughtStepStatus.ERROR
                : ChainOfThoughtStepStatus.SUCCESS,
            }],
          },
          metadata,
        }
      }
    }

    // Handle regular text content
    if (part.kind === 'text' && part.text) {
      return {
        response_type: 'text',
        text: part.text,
        metadata,
      }
    }

    // Handle file parts
    if (part.kind === 'file' && part.file) {
      return {
        response_type: 'user_defined',
        user_defined: {
          type: 'file_attachment',
          fileName: part.file.name,
          mimeType: part.file.mimeType,
          downloadUrl: part.file.uri || `data:${part.file.mimeType};base64,${part.file.bytes}`,
        },
        metadata,
      }
    }

    return null
  }

  /**
   * Translate an A2A message part to Carbon format
   *
   * @param part - The A2A message part to translate
   * @param artifactMetadata - Optional metadata from artifact level
   * @returns Carbon stream chunk or null if no action needed
   */
  translatePart(
    part: A2APartWithMetadata,
    artifactMetadata?: Record<string, unknown>
  ): CarbonStreamChunk | null {
    const contentType = part.metadata?.content_type

    // Handle thinking/reasoning content
    if (contentType === 'thinking' && part.kind === 'text' && part.text) {
      return this.translateThinkingPart(part.text, part.metadata)
    }

    // Handle trajectory extension (alternative to thinking)
    const partExtensions = parseUIExtensions(part.metadata as Record<string, unknown>)
    if (partExtensions.trajectory) {
      return this.translateTrajectoryPart(partExtensions.trajectory)
    }

    // Handle tool call data part
    if (part.kind === 'data' && part.data) {
      const dataType = (part.data as { type?: string }).type

      if (dataType === 'tool_call') {
        return this.translateToolCallPart(part.data as unknown as ToolCallData)
      }

      if (dataType === 'tool_result') {
        return this.translateToolResultPart(part.data as unknown as ToolResultData)
      }
    }

    // Handle regular text content
    if (part.kind === 'text' && part.text) {
      // Skip if this is thinking content (already handled above)
      if (contentType === 'thinking') {
        return null
      }
      return this.translateTextPart(part.text, artifactMetadata)
    }

    // Handle file parts
    if (part.kind === 'file' && part.file) {
      return this.translateFilePart(part.file)
    }

    return null
  }

  /**
   * Translate thinking/reasoning content to Carbon reasoning step
   */
  private translateThinkingPart(
    text: string,
    metadata?: Record<string, unknown>
  ): PartialItemChunk {
    const newStep: ReasoningStep = {
      title: (metadata?.title as string) || 'Reasoning',
      content: text,
      open_state: ReasoningStepOpenState.DEFAULT,
    }

    this.state.reasoningSteps.push(newStep)

    return {
      partial_item: {
        response_type: MessageResponseTypes.TEXT,
        text: '',
        streaming_metadata: {
          id: this.state.itemId,
          cancellable: true,
        },
      },
      partial_response: {
        message_options: {
          response_user_profile: this.agentProfile,
          reasoning: {
            steps: this.state.reasoningSteps,
          },
        },
      },
      streaming_metadata: {
        response_id: this.state.responseId,
      },
    }
  }

  /**
   * Translate trajectory extension to Carbon reasoning step
   */
  private translateTrajectoryPart(
    trajectory: { title?: string | null; content?: string | null; group_id?: string | null }
  ): PartialItemChunk {
    const newStep: ReasoningStep = {
      title: trajectory.title || 'Processing',
      content: trajectory.content || '',
      open_state: ReasoningStepOpenState.DEFAULT,
    }

    this.state.reasoningSteps.push(newStep)

    return {
      partial_item: {
        response_type: MessageResponseTypes.TEXT,
        text: '',
        streaming_metadata: {
          id: this.state.itemId,
          cancellable: true,
        },
      },
      partial_response: {
        message_options: {
          response_user_profile: this.agentProfile,
          reasoning: {
            steps: this.state.reasoningSteps,
          },
        },
      },
      streaming_metadata: {
        response_id: this.state.responseId,
      },
    }
  }

  /**
   * Translate tool call to Carbon chain of thought (IN_PROGRESS)
   */
  private translateToolCallPart(toolData: ToolCallData): PartialItemChunk {
    const toolName = toolData.tool_name || 'tool'

    const cotStep: ChainOfThoughtStep = {
      title: toolName,
      description: `Calling ${toolName}`,
      tool_name: toolName,
      request: { args: toolData.args },
      status: ChainOfThoughtStepStatus.IN_PROGRESS,
    }

    const index = this.state.chainOfThought.length
    this.state.chainOfThought.push(cotStep)
    this.state.pendingToolCalls.set(toolName, index)

    return {
      partial_item: {
        response_type: MessageResponseTypes.TEXT,
        text: '',
        streaming_metadata: {
          id: this.state.itemId,
          cancellable: true,
        },
      },
      partial_response: {
        message_options: {
          response_user_profile: this.agentProfile,
          chain_of_thought: this.state.chainOfThought,
        },
      },
      streaming_metadata: {
        response_id: this.state.responseId,
      },
    }
  }

  /**
   * Translate tool result to Carbon chain of thought (SUCCESS/ERROR)
   */
  private translateToolResultPart(resultData: ToolResultData): PartialItemChunk {
    const toolName = resultData.tool_name || 'tool'
    const index = this.state.pendingToolCalls.get(toolName)

    if (index !== undefined && index < this.state.chainOfThought.length) {
      // Update existing tool call with result
      this.state.chainOfThought[index] = {
        ...this.state.chainOfThought[index],
        response: { content: resultData.result_preview },
        status: resultData.success === false
          ? ChainOfThoughtStepStatus.ERROR
          : ChainOfThoughtStepStatus.SUCCESS,
      }
      this.state.pendingToolCalls.delete(toolName)
    } else {
      // No matching tool call found, create new completed step
      const cotStep: ChainOfThoughtStep = {
        title: toolName,
        description: `Result from ${toolName}`,
        tool_name: toolName,
        response: { content: resultData.result_preview },
        status: resultData.success === false
          ? ChainOfThoughtStepStatus.ERROR
          : ChainOfThoughtStepStatus.SUCCESS,
      }
      this.state.chainOfThought.push(cotStep)
    }

    return {
      partial_item: {
        response_type: MessageResponseTypes.TEXT,
        text: '',
        streaming_metadata: {
          id: this.state.itemId,
          cancellable: true,
        },
      },
      partial_response: {
        message_options: {
          response_user_profile: this.agentProfile,
          chain_of_thought: this.state.chainOfThought,
        },
      },
      streaming_metadata: {
        response_id: this.state.responseId,
      },
    }
  }

  /**
   * Translate text part to Carbon partial item
   */
  private translateTextPart(
    text: string,
    _artifactMetadata?: Record<string, unknown>
  ): PartialItemChunk {
    this.state.accumulatedText += text
    this.state.hasStartedStreaming = true

    return {
      partial_item: {
        response_type: MessageResponseTypes.TEXT,
        text: text, // Send just the new text chunk
        streaming_metadata: {
          id: this.state.itemId,
          cancellable: true,
        },
      },
      partial_response: {
        message_options: {
          response_user_profile: this.agentProfile,
        },
      },
      streaming_metadata: {
        response_id: this.state.responseId,
      },
    }
  }

  /**
   * Translate file part to Carbon user defined item
   */
  private translateFilePart(file: {
    name: string
    mimeType: string
    bytes?: string
    uri?: string
  }): PartialItemChunk {
    return {
      partial_item: {
        response_type: MessageResponseTypes.USER_DEFINED,
        user_defined: {
          type: 'file_attachment',
          fileName: file.name,
          mimeType: file.mimeType,
          downloadUrl: file.uri || `data:${file.mimeType};base64,${file.bytes}`,
        },
        streaming_metadata: {
          id: `file-${Date.now()}`,
        },
      },
      streaming_metadata: {
        response_id: this.state.responseId,
      },
    }
  }

  // ===========================================================================
  // COMPLETE AND FINAL RESPONSE
  // ===========================================================================

  /**
   * Create complete item chunk
   *
   * Call this to finalize a specific item while other items may still be streaming.
   * Optional but useful for accessibility and corrections.
   */
  createCompleteItem(wasStopped: boolean = false): CompleteItemChunk {
    return {
      complete_item: {
        response_type: MessageResponseTypes.TEXT,
        text: this.state.accumulatedText,
        streaming_metadata: {
          id: this.state.itemId,
          stream_stopped: wasStopped,
        },
      },
      partial_response: {
        message_options: {
          response_user_profile: this.agentProfile,
          reasoning: this.state.reasoningSteps.length > 0
            ? { steps: this.state.reasoningSteps }
            : undefined,
          chain_of_thought: this.state.chainOfThought.length > 0
            ? this.state.chainOfThought
            : undefined,
        },
      },
      streaming_metadata: {
        response_id: this.state.responseId,
      },
    }
  }

  /**
   * Create final response chunk
   *
   * CRITICAL: This MUST be called to end streaming and clear the typing indicator.
   * Without this, the UI will remain in a loading state.
   */
  createFinalResponse(): FinalResponseChunk {
    return {
      final_response: {
        id: this.state.responseId,
        output: {
          generic: [
            {
              response_type: MessageResponseTypes.TEXT,
              text: this.state.accumulatedText,
              streaming_metadata: {
                id: this.state.itemId,
              },
            },
          ],
        },
        message_options: {
          response_user_profile: this.agentProfile,
          reasoning: this.state.reasoningSteps.length > 0
            ? { steps: this.state.reasoningSteps }
            : undefined,
          chain_of_thought: this.state.chainOfThought.length > 0
            ? this.state.chainOfThought
            : undefined,
        },
      },
    }
  }

  /**
   * Create error response
   */
  createErrorResponse(errorMessage: string): FinalResponseChunk {
    return {
      final_response: {
        id: this.state.responseId,
        output: {
          generic: [
            {
              response_type: MessageResponseTypes.TEXT,
              text: errorMessage,
              streaming_metadata: {
                id: this.state.itemId,
              },
            },
          ],
        },
        message_options: {
          response_user_profile: this.agentProfile,
        },
      },
    }
  }

  // ===========================================================================
  // CITATION HANDLING
  // ===========================================================================

  /**
   * Create citations message
   *
   * Call this after the main response to add a sources list.
   */
  createCitationsMessage(
    citations: Array<{
      url?: string | null
      title?: string | null
      description?: string | null
    }>
  ): CarbonMessage {
    return {
      output: {
        generic: [
          {
            response_type: MessageResponseTypes.USER_DEFINED,
            user_defined: {
              type: 'sources_list',
              citations,
            },
          } as UserDefinedItem,
        ],
      },
      message_options: {
        response_user_profile: this.agentProfile,
      },
    }
  }

  // ===========================================================================
  // FULL A2A STREAM CHUNK TRANSLATION
  // ===========================================================================

  /**
   * Translate a complete A2A stream chunk to Carbon format
   *
   * This is the main entry point for processing A2A SSE events.
   * Returns an array of Carbon chunks since one A2A event may produce
   * multiple Carbon updates (e.g., multiple parts in a message).
   */
  translateStreamChunk(chunk: StreamChunk): CarbonStreamChunk[] {
    const results: CarbonStreamChunk[] = []

    // Ensure shell message is sent first
    if (!this.state.shellMessageSent) {
      results.push(this.createShellMessage())
    }

    if (chunk.kind === 'status-update' && chunk.status?.message) {
      const message = chunk.status.message

      // Process message-level metadata (citations, errors, etc.)
      // These are typically added to state rather than returned as chunks

      // Process each part in the message
      for (const part of message.parts) {
        const carbonChunk = this.translatePart(
          part as A2APartWithMetadata,
          message.metadata
        )
        if (carbonChunk) {
          results.push(carbonChunk)
        }
      }
    }

    if (chunk.kind === 'artifact-update' && chunk.artifact?.parts) {
      // Process artifact parts
      for (const part of chunk.artifact.parts) {
        const carbonChunk = this.translatePart(
          part as A2APartWithMetadata,
          chunk.artifact.metadata
        )
        if (carbonChunk) {
          results.push(carbonChunk)
        }
      }
    }

    // Handle stream completion
    if (chunk.final === true || chunk.status?.state === 'completed') {
      results.push(this.createFinalResponse())
    }

    return results
  }
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Create a translator with default settings
 */
export function createTranslator(
  agentName?: string,
  agentIconUrl?: string
): A2AToCarbonTranslator {
  return new A2AToCarbonTranslator({
    nickname: agentName,
    profile_picture_url: agentIconUrl,
  })
}

/**
 * Check if a Carbon chunk is a final response
 */
export function isFinalResponse(chunk: CarbonStreamChunk): chunk is FinalResponseChunk {
  return 'final_response' in chunk
}

/**
 * Check if a Carbon chunk is a partial item
 */
export function isPartialItem(chunk: CarbonStreamChunk): chunk is PartialItemChunk {
  return 'partial_item' in chunk
}

/**
 * Check if a Carbon chunk is a complete item
 */
export function isCompleteItem(chunk: CarbonStreamChunk): chunk is CompleteItemChunk {
  return 'complete_item' in chunk
}
