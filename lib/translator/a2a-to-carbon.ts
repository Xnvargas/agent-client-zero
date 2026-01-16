/**
 * A2A Protocol to Carbon AI Chat Translator
 * 
 * Translates A2A protocol message parts to Carbon AI Chat message formats,
 * including support for:
 * - Reasoning/thinking traces (accordion display)
 * - Chain of thought / tool calls (with spinner/checkmark status)
 * - Standard text responses
 * - Rich media (images, files, data)
 */

// ==================== A2A Protocol Types ====================

interface A2APart {
  kind: 'text' | 'file' | 'data'
  text?: string
  file?: {
    name: string
    mimeType: string
    bytes?: string
    uri?: string
  }
  data?: Record<string, any>
  metadata?: {
    content_type?: 'thinking' | 'response' | 'status'
    [key: string]: any
  }
}

interface A2AArtifact {
  artifactId: string
  name?: string
  description?: string
  parts: A2APart[]
  metadata?: Record<string, unknown>  // Extension metadata (citations, trajectory, etc.)
}

interface A2ATask {
  id: string
  status: {
    state: 'submitted' | 'working' | 'completed' | 'failed'
    message?: any
  }
  artifacts: A2AArtifact[]
  history: Array<any>
}

// ==================== Carbon AI Chat Types ====================

// Chain of Thought Step Status
export enum ChainOfThoughtStepStatus {
  PROCESSING = 'processing',
  SUCCESS = 'success',
  ERROR = 'error'
}

// Chain of Thought Step (for tool calls)
export interface ChainOfThoughtStep {
  title?: string
  tool_name?: string
  description?: string
  request?: { args?: unknown }
  response?: { content: unknown }
  status?: ChainOfThoughtStepStatus
}

// Reasoning Step (for thinking/reasoning traces)
export interface ReasoningStep {
  content: string
}

// Reasoning Step Open State
export enum ReasoningStepOpenState {
  OPEN = 'open',
  CLOSED = 'closed'
}

// Reasoning Steps container
export interface ReasoningSteps {
  steps: ReasoningStep[]
  openState?: ReasoningStepOpenState
}

// Carbon Message Interface
export interface CarbonMessage {
  response_type: string
  text?: string
  reasoning_steps?: ReasoningSteps
  chain_of_thought?: {
    steps: ChainOfThoughtStep[]
  }
  user_defined?: Record<string, any>
  metadata?: Record<string, unknown>  // Extension metadata (citations, trajectory, etc.)
}

// ==================== Translator Class ====================

export class A2AToCarbonTranslator {
  
  /**
   * Translate an A2A task to Carbon messages
   */
  translateTask(task: A2ATask): CarbonMessage[] {
    const messages: CarbonMessage[] = []

    for (const artifact of task.artifacts) {
      // First, check artifact-level metadata for trajectory
      const artifactTrajectory = extractTrajectoryFromMetadata(artifact.metadata as Record<string, unknown>)
      if (artifactTrajectory) {
        const trajectoryMessage = this.translateTrajectory(artifactTrajectory)
        if (trajectoryMessage) {
          messages.push(trajectoryMessage)
        }
      }

      for (const part of artifact.parts) {
        const message = this.translatePart(part, artifact)
        if (message) messages.push(message)
      }
    }

    return messages
  }

  /**
   * Translate a single streaming A2A part to a Carbon message
   * Used for real-time streaming updates
   * @param part The A2A part to translate
   * @param metadata Optional extension metadata from the artifact
   */
  translateStreamingPart(part: A2APart, metadata?: Record<string, unknown>): CarbonMessage | null {
    // Create a minimal artifact wrapper to preserve metadata
    const artifact: A2AArtifact | null = metadata ? {
      artifactId: '',
      parts: [],
      metadata
    } : null
    return this.translatePart(part, artifact)
  }

  /**
   * Translate an A2A part to a Carbon message
   */
  private translatePart(part: A2APart, artifact: A2AArtifact | null): CarbonMessage | null {
    // Preserve metadata from artifact if present
    const extensionMetadata = artifact?.metadata

    // Handle parts with metadata (thinking, response, status)
    if (part.metadata?.content_type) {
      const message = this.translateMetadataPart(part)
      if (message && extensionMetadata) {
        message.metadata = extensionMetadata
      }
      return message
    }

    // Handle data parts (tool_call, tool_result)
    if (part.kind === 'data' && part.data?.type) {
      const message = this.translateDataPart(part)
      if (message && extensionMetadata) {
        message.metadata = extensionMetadata
      }
      return message
    }

    // Handle standard part types
    switch (part.kind) {
      case 'text':
        return {
          response_type: 'text',
          text: part.text,
          metadata: extensionMetadata
        }

      case 'file':
        const fileMessage = this.translateFilePart(part, artifact)
        if (fileMessage && extensionMetadata) {
          fileMessage.metadata = extensionMetadata
        }
        return fileMessage

      case 'data':
        const dataMessage = this.translateGenericDataPart(part)
        if (dataMessage && extensionMetadata) {
          dataMessage.metadata = extensionMetadata
        }
        return dataMessage

      default:
        return null
    }
  }

  /**
   * Translate parts with metadata (thinking, response, status)
   */
  private translateMetadataPart(part: A2APart): CarbonMessage | null {
    const contentType = part.metadata?.content_type

    switch (contentType) {
      case 'thinking':
        // Reasoning/thinking trace → Accordion display
        return {
          response_type: 'reasoning_steps',
          reasoning_steps: {
            steps: [{
              content: part.text || ''
            }],
            openState: ReasoningStepOpenState.CLOSED
          }
        }

      case 'response':
        // Standard response text
        return {
          response_type: 'text',
          text: part.text
        }

      case 'status':
        // Status update (could be shown as system message)
        return {
          response_type: 'user_defined',
          user_defined: {
            type: 'status_message',
            message: part.text,
            metadata: part.metadata
          }
        }

      default:
        return null
    }
  }

  /**
   * Translate data parts (tool_call, tool_result)
   */
  private translateDataPart(part: A2APart): CarbonMessage | null {
    const dataType = part.data?.type

    switch (dataType) {
      case 'tool_call':
        // Tool invocation → Chain of thought with spinner
        return {
          response_type: 'chain_of_thought',
          chain_of_thought: {
            steps: [{
              title: part.data?.title || `Calling ${part.data?.tool_name || 'tool'}`,
              tool_name: part.data?.tool_name,
              description: part.data?.description,
              request: part.data?.args ? { args: part.data.args } : undefined,
              status: ChainOfThoughtStepStatus.PROCESSING
            }]
          }
        }

      case 'tool_result':
        // Tool result → Chain of thought with checkmark
        return {
          response_type: 'chain_of_thought',
          chain_of_thought: {
            steps: [{
              title: part.data?.title || `${part.data?.tool_name || 'Tool'} completed`,
              tool_name: part.data?.tool_name,
              description: part.data?.description,
              request: part.data?.args ? { args: part.data.args } : undefined,
              response: part.data?.result ? { content: part.data.result } : undefined,
              status: part.data?.error 
                ? ChainOfThoughtStepStatus.ERROR 
                : ChainOfThoughtStepStatus.SUCCESS
            }]
          }
        }

      default:
        return null
    }
  }

  /**
   * Translate file parts (images, attachments)
   */
  private translateFilePart(part: A2APart, artifact: A2AArtifact | null): CarbonMessage | null {
    if (!part.file) return null

    const mimeType = part.file.mimeType

    // Handle images
    if (mimeType.startsWith('image/')) {
      return {
        response_type: 'image',
        user_defined: {
          type: 'image',
          url: part.file.uri || this.base64ToDataUrl(part.file.bytes || '', mimeType),
          alt: part.file.name,
          caption: artifact?.description
        }
      }
    }

    // Handle charts (images with specific naming patterns)
    if (part.file.name?.includes('chart') || part.file.name?.includes('graph')) {
      return {
        response_type: 'user_defined',
        user_defined: {
          type: 'chart',
          imageUrl: part.file.uri || this.base64ToDataUrl(part.file.bytes || '', mimeType),
          title: artifact?.name,
          description: artifact?.description
        }
      }
    }

    // Handle general file attachments
    return {
      response_type: 'user_defined',
      user_defined: {
        type: 'file_attachment',
        fileName: part.file.name,
        mimeType: part.file.mimeType,
        downloadUrl: part.file.uri,
        size: part.file.bytes?.length
      }
    }
  }

  /**
   * Translate generic data parts
   */
  private translateGenericDataPart(part: A2APart): CarbonMessage | null {
    const data = part.data

    if (!data) return null

    // Detect if it's tabular data
    if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object') {
      return {
        response_type: 'user_defined',
        user_defined: {
          type: 'data_table',
          columns: Object.keys(data[0]),
          rows: data
        }
      }
    }

    // Handle general structured data
    return {
      response_type: 'user_defined',
      user_defined: {
        type: 'structured_data',
        data: data
      }
    }
  }

  /**
   * Convert base64 to data URL
   */
  private base64ToDataUrl(base64: string, mimeType: string): string {
    return `data:${mimeType};base64,${base64}`
  }

  /**
   * Create a tool call message (utility method for direct usage)
   */
  static createToolCallMessage(
    toolName: string,
    args?: unknown,
    description?: string
  ): CarbonMessage {
    return {
      response_type: 'chain_of_thought',
      chain_of_thought: {
        steps: [{
          title: `Calling ${toolName}`,
          tool_name: toolName,
          description,
          request: args ? { args } : undefined,
          status: ChainOfThoughtStepStatus.PROCESSING
        }]
      }
    }
  }

  /**
   * Create a tool result message (utility method for direct usage)
   */
  static createToolResultMessage(
    toolName: string,
    result: unknown,
    args?: unknown,
    error?: boolean,
    description?: string
  ): CarbonMessage {
    return {
      response_type: 'chain_of_thought',
      chain_of_thought: {
        steps: [{
          title: `${toolName} ${error ? 'failed' : 'completed'}`,
          tool_name: toolName,
          description,
          request: args ? { args } : undefined,
          response: { content: result },
          status: error ? ChainOfThoughtStepStatus.ERROR : ChainOfThoughtStepStatus.SUCCESS
        }]
      }
    }
  }

  /**
   * Create a reasoning/thinking message (utility method for direct usage)
   */
  static createReasoningMessage(
    content: string,
    openState: ReasoningStepOpenState = ReasoningStepOpenState.CLOSED
  ): CarbonMessage {
    return {
      response_type: 'reasoning_steps',
      reasoning_steps: {
        steps: [{ content }],
        openState
      }
    }
  }
}
