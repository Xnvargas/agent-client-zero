interface A2ATask {
  id: string
  status: {
    state: 'submitted' | 'working' | 'completed' | 'failed'
    message?: any
  }
  artifacts: Array<{
    artifactId: string
    name?: string
    description?: string
    parts: Array<{
      kind: 'text' | 'file' | 'data'
      text?: string
      file?: {
        name: string
        mimeType: string
        bytes?: string
        uri?: string
      }
      data?: Record<string, any>
    }>
  }>
  history: Array<any>
}

interface CarbonMessage {
  response_type: string
  text?: string
  user_defined?: Record<string, any>
}

export class A2AToCarbonTranslator {
  translateTask(task: A2ATask): CarbonMessage[] {
    const messages: CarbonMessage[] = []

    for (const artifact of task.artifacts) {
      for (const part of artifact.parts) {
        const message = this.translatePart(part, artifact)
        if (message) messages.push(message)
      }
    }

    return messages
  }

  private translatePart(part: any, artifact: any): CarbonMessage | null {
    switch (part.kind) {
      case 'text':
        return {
          response_type: 'text',
          text: part.text
        }

      case 'file':
        const mimeType = part.file.mimeType

        // Handle images
        if (mimeType.startsWith('image/')) {
          return {
            response_type: 'image',
            user_defined: {
              type: 'image',
              url: part.file.uri || this.base64ToDataUrl(part.file.bytes, mimeType),
              alt: part.file.name,
              caption: artifact.description
            }
          }
        }

        // Handle charts (images with specific naming patterns)
        if (part.file.name?.includes('chart') || part.file.name?.includes('graph')) {
          return {
            response_type: 'user_defined',
            user_defined: {
              type: 'chart',
              imageUrl: part.file.uri || this.base64ToDataUrl(part.file.bytes, mimeType),
              title: artifact.name,
              description: artifact.description
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

      case 'data':
        // Handle structured JSON data
        const data = part.data

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

      default:
        return null
    }
  }

  private base64ToDataUrl(base64: string, mimeType: string): string {
    return `data:${mimeType};base64,${base64}`
  }
}
