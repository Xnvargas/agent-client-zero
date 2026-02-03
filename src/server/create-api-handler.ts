/**
 * Factory for creating Next.js API route handlers for A2A proxy
 *
 * IMPORTANT: This handler automatically transforms extensions.context
 * to message.metadata['swot-context'] because AgentStack doesn't expose
 * params.extensions to agent functions. Agents read context from
 * input.metadata['swot-context'] instead.
 *
 * @example
 * // app/api/agent/chat/route.ts
 * import { createA2AHandler } from '@kuntur/a2a-carbon-chat-adapter/server';
 *
 * export const POST = createA2AHandler({
 *   allowedAgentUrls: ['https://trusted-agents.example.com']
 * });
 */

export interface A2AHandlerOptions {
  /**
   * Called before forwarding request to agent
   * Use for authentication, validation, rate limiting
   */
  onRequest?: (request: {
    agentUrl: string;
    apiKey?: string;
    message: string;
    extensions?: Record<string, unknown>;
  }) => Promise<typeof request> | typeof request;

  /**
   * Called on error
   */
  onError?: (error: Error) => void;

  /**
   * Request timeout in milliseconds
   * @default 120000 (2 minutes)
   */
  timeout?: number;

  /**
   * Allowed agent URL patterns (for security)
   * If provided, requests to non-matching URLs will be rejected
   */
  allowedAgentUrls?: (string | RegExp)[];

  /**
   * Key used for context in message metadata
   * @default 'swot-context'
   */
  contextMetadataKey?: string;
}

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function createA2AHandler(options: A2AHandlerOptions = {}) {
  const {
    onRequest,
    onError,
    timeout = 120000,
    allowedAgentUrls,
    contextMetadataKey = 'swot-context'
  } = options;

  return async function handler(request: Request): Promise<Response> {
    try {
      let body = await request.json();

      // Validate required fields
      if (!body.agentUrl || !body.message) {
        return new Response(
          JSON.stringify({ error: 'Missing required fields: agentUrl, message' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Check allowed URLs
      if (allowedAgentUrls && allowedAgentUrls.length > 0) {
        const isAllowed = allowedAgentUrls.some((pattern) => {
          if (typeof pattern === 'string') {
            return body.agentUrl.startsWith(pattern);
          }
          return pattern.test(body.agentUrl);
        });

        if (!isAllowed) {
          return new Response(
            JSON.stringify({ error: 'Agent URL not allowed' }),
            { status: 403, headers: { 'Content-Type': 'application/json' } }
          );
        }
      }

      // Allow request transformation
      if (onRequest) {
        body = await onRequest(body);
      }

      // Normalize URL
      let normalizedUrl = body.agentUrl.replace(/\/$/, '');
      if (!normalizedUrl.endsWith('/jsonrpc')) {
        normalizedUrl = `${normalizedUrl}/jsonrpc/`;
      } else {
        normalizedUrl = `${normalizedUrl}/`;
      }

      // =====================================================================
      // CONTEXT TRANSFORMATION
      // =====================================================================
      // AgentStack doesn't expose params.extensions to agent functions.
      // We move extensions.context to message.metadata where agents CAN
      // access it via the input: Message parameter.
      // =====================================================================

      const extensions = body.extensions || {};
      const { context: appContext, ...otherExtensions } = extensions;

      // Build message with optional context in metadata
      const message: Record<string, unknown> = {
        role: 'user',
        messageId: generateUUID(),
        parts: [{ kind: 'text', text: body.message }],
      };

      // Add context to message metadata if provided
      if (appContext) {
        message.metadata = {
          [contextMetadataKey]: appContext
        };
        console.log(`[A2A Handler] Context added to message.metadata['${contextMetadataKey}']`);
      }

      // Build A2A payload
      const payload = {
        jsonrpc: '2.0',
        method: 'message/stream',
        params: {
          message,
          // Only include extensions if there are non-context extensions
          ...(Object.keys(otherExtensions).length > 0 && { extensions: otherExtensions }),
        },
        id: generateUUID(),
      };

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      };

      if (body.apiKey) {
        headers['Authorization'] = `Bearer ${body.apiKey}`;
      }

      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        const agentResponse = await fetch(normalizedUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!agentResponse.ok) {
          const errorText = await agentResponse.text();
          return new Response(
            JSON.stringify({
              error: `Agent error: ${agentResponse.status}`,
              details: errorText,
            }),
            { status: agentResponse.status, headers: { 'Content-Type': 'application/json' } }
          );
        }

        if (!agentResponse.body) {
          return new Response(
            JSON.stringify({ error: 'Agent response body is null' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
          );
        }

        // Stream the response
        return new Response(agentResponse.body, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          },
        });
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error) {
      onError?.(error as Error);

      if ((error as Error).name === 'AbortError') {
        return new Response(
          JSON.stringify({ error: 'Request timeout' }),
          { status: 504, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({
          error: 'Internal server error',
          message: (error as Error).message,
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  };
}

export default createA2AHandler;
