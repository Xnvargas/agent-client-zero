'use client';

import React, { useRef, useCallback, useState, useMemo, useEffect } from 'react';
import type {
  A2AChatProps,
  AgentConfig,
  AgentConnectionState,
} from '../types';
import type { Citation, ErrorMetadata, FormRequestMetadata } from '../lib/a2a';
import { useAgentContextOptional } from './AgentProvider';
import { A2AToCarbonTranslator, createTranslator } from '../lib/translator';
import { CitationRenderer } from './renderers/CitationRenderer';
import { ErrorRenderer } from './renderers/ErrorRenderer';
import { FormRenderer } from './renderers/FormRenderer';

// =============================================================================
// HELPER UTILITIES
// =============================================================================

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

/**
 * Main A2A Chat component
 *
 * Connects to A2A agents and renders chat UI using Carbon AI Chat components.
 *
 * @example
 * // Direct agent config
 * <A2AChat
 *   agent={{ id: 'my-agent', name: 'My Agent', url: 'https://...' }}
 *   layout="sidebar"
 * />
 *
 * @example
 * // Using AgentProvider context
 * <AgentProvider agents={[...]}>
 *   <A2AChat agentId="research" />
 * </AgentProvider>
 *
 * @example
 * // Simple URL-only
 * <A2AChat agentUrl="https://my-agent.example.com" layout="fullscreen" />
 */
export function A2AChat({
  // Agent configuration
  agent: agentProp,
  agentId,
  agentUrl,
  apiKey,

  // Display options
  embedded = false,
  layout = 'fullscreen',
  allowLayoutSwitch = false,
  defaultOpen = true,
  className = '',
  agentName,
  agentIconUrl,

  // Behavior options
  showThinking = true,
  showChainOfThought = true,
  allowCancel = true,
  extensions,

  // Callbacks
  onOpen,
  onClose,
  onSend,
  onResponse,
  onConnectionChange,
  onError,
  onDisconnect,

  // Custom renderers
  renderCitations,
  renderError,
  renderForm,
  renderUserDefined,
}: A2AChatProps) {
  // ---------------------------------------------------------------------------
  // RESOLVE AGENT CONFIG
  // ---------------------------------------------------------------------------

  const agentContext = useAgentContextOptional();

  const agent = useMemo((): AgentConfig | null => {
    // Priority: direct prop > context lookup > URL-only
    if (agentProp) {
      return agentProp;
    }

    if (agentId && agentContext) {
      return agentContext.getAgent(agentId) ?? null;
    }

    if (!agentProp && !agentId && agentContext?.currentAgent) {
      return agentContext.currentAgent;
    }

    if (agentUrl) {
      return {
        id: 'default',
        name: agentName ?? 'AI Assistant',
        url: agentUrl,
        apiKey,
        iconUrl: agentIconUrl,
      };
    }

    return null;
  }, [agentProp, agentId, agentUrl, apiKey, agentName, agentIconUrl, agentContext]);

  // ---------------------------------------------------------------------------
  // STATE
  // ---------------------------------------------------------------------------

  const [connectionState, setConnectionState] = useState<AgentConnectionState>('disconnected');
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentFormRequest, setCurrentFormRequest] = useState<FormRequestMetadata | null>(null);
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  const [carbonLoaded, setCarbonLoaded] = useState(false);
  const [CarbonComponents, setCarbonComponents] = useState<{
    ChatCustomElement?: React.ComponentType<any>;
    ChatContainer?: React.ComponentType<any>;
  }>({});

  const instanceRef = useRef<any>(null);
  const translatorRef = useRef<A2AToCarbonTranslator | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Track whether Carbon has fully initialized (for embedded mode)
  // Prevents responding to VIEW_CHANGE events fired during initialization
  const embeddedInitializedRef = useRef(false);

  // ---------------------------------------------------------------------------
  // SIDEBAR VIEW STATE (for minimize/maximize handling)
  // ---------------------------------------------------------------------------

  // Track Carbon's view state - controls whether chat content is visible
  // In EMBEDDED mode, this is not used (parent controls visibility via mount/unmount)
  const [isViewOpen, setIsViewOpen] = useState(true);

  // External launcher visibility - shown when sidebar is minimized in STANDALONE mode
  // In EMBEDDED mode, this is always false (parent provides open button)
  const [showExternalLauncher, setShowExternalLauncher] = useState(false);

  // Track closing animation state (STANDALONE mode only)
  const [sidebarClosing, setSidebarClosing] = useState(false);

  // Ref to access current layout in callbacks (callbacks capture initial values)
  const layoutRef = useRef(layout);
  useEffect(() => {
    layoutRef.current = layout;
  }, [layout]);

  // Reset initialization state on unmount (for embedded mode)
  // This ensures clean state if parent remounts the component
  useEffect(() => {
    return () => {
      if (embedded) {
        embeddedInitializedRef.current = false;
      }
    };
  }, [embedded]);

  // ---------------------------------------------------------------------------
  // LOAD CARBON COMPONENTS
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (typeof window !== 'undefined') {
      import('@carbon/ai-chat')
        .then((mod) => {
          setCarbonComponents({
            ChatCustomElement: mod.ChatCustomElement,
            ChatContainer: mod.ChatContainer,
          });
          setCarbonLoaded(true);
        })
        .catch((err) => {
          console.error('[A2AChat] Failed to load @carbon/ai-chat:', err);
        });
    }
  }, []);

  // ---------------------------------------------------------------------------
  // UPDATE CONNECTION STATE
  // ---------------------------------------------------------------------------

  useEffect(() => {
    onConnectionChange?.(connectionState);
  }, [connectionState, onConnectionChange]);

  // ---------------------------------------------------------------------------
  // VIEW CHANGE HANDLERS (for sidebar minimize/maximize)
  // ---------------------------------------------------------------------------

  // Animation duration - should match CSS transition
  const SIDEBAR_ANIMATION_MS = 250;

  /**
   * Handle view state changes from Carbon AI Chat
   *
   * CRITICAL: When we provide onViewChange, it REPLACES Carbon's default handler.
   *
   * EMBEDDED MODE: When minimize is clicked, we signal the parent to close
   * via onClose callback. Parent handles unmounting - we don't manage view state.
   *
   * STANDALONE MODE: We manage our own view state and show external launcher.
   */
  const onViewChange = useCallback(
    (event: { newViewState: { mainWindow: boolean } }) => {
      const currentLayout = layoutRef.current;

      // EMBEDDED MODE: Signal parent to close, don't manage internal state
      if (embedded) {
        // CRITICAL: Ignore view changes until Carbon has fully initialized.
        // Carbon may fire VIEW_CHANGE during initialization with mainWindow: false,
        // which would incorrectly trigger onClose and unmount the component.
        if (!embeddedInitializedRef.current) {
          console.log('[A2AChat] Ignoring view change during initialization');
          return;
        }

        // CRITICAL FIX: Always ensure hidden class is removed when chat should be visible
        // This handles edge cases where Carbon might re-add the class
        if (event.newViewState.mainWindow) {
          const chatElement = instanceRef.current?.hostElement?.parentElement;
          if (chatElement) {
            chatElement.classList.remove('cds-aichat--hidden');
          }
        }

        if (!event.newViewState.mainWindow) {
          // User clicked minimize - tell parent to close the sidebar
          onClose?.();
        }
        // In embedded mode, parent controls visibility via mount/unmount
        // so we don't update internal view state
        return;
      }

      // STANDALONE MODE: Manage our own view state
      setIsViewOpen(event.newViewState.mainWindow);

      // Sidebar-specific handling for standalone mode
      if (currentLayout === 'sidebar') {
        if (event.newViewState.mainWindow) {
          // Chat is opening/restoring
          setShowExternalLauncher(false);
          setSidebarClosing(false);
          onOpen?.();
        } else {
          // Chat is minimizing
          setSidebarClosing(false);
          setShowExternalLauncher(true);
          onClose?.();
        }
      }
    },
    [embedded, onOpen, onClose]
  );

  /**
   * Handle pre-view-change for animations
   * Allows us to run closing animation before view actually changes
   */
  const onViewPreChange = useCallback(
    async (event: { newViewState: { mainWindow: boolean } }) => {
      // EMBEDDED MODE: Skip animations, parent handles unmount transition
      if (embedded) {
        return;
      }

      // STANDALONE MODE: Only sidebar needs closing animation
      if (layoutRef.current === 'sidebar' && !event.newViewState.mainWindow) {
        setSidebarClosing(true);
        // Wait for CSS animation to complete
        await new Promise((resolve) => setTimeout(resolve, SIDEBAR_ANIMATION_MS));
      }
    },
    [embedded]
  );

  /**
   * Open the sidebar by triggering Carbon's changeView action
   * Used by the external launcher button when sidebar is minimized
   * NOT used in embedded mode (parent handles opening via mount)
   */
  const handleOpenSidebar = useCallback(() => {
    if (embedded) return;

    const instance = instanceRef.current;
    if (instance?.actions?.changeView) {
      instance.actions.changeView('MAIN_WINDOW');
    }
  }, [embedded]);

  // ---------------------------------------------------------------------------
  // MESSAGE HANDLER
  // ---------------------------------------------------------------------------

  const handleSendMessage = useCallback(
    async (message: string) => {
      if (!agent) {
        console.error('[A2AChat] No agent configured');
        return;
      }

      const instance = instanceRef.current;
      if (!instance) {
        console.error('[A2AChat] Chat instance not ready');
        return;
      }

      onSend?.(message);
      setIsStreaming(true);
      setConnectionState('streaming');

      // Create translator for this response
      translatorRef.current = createTranslator(
        agent.name,
        agent.iconUrl ?? '/bot.svg'
      );

      // Create abort controller
      abortControllerRef.current = new AbortController();

      try {
        const response = await fetch('/api/agent/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentUrl: agent.url,
            apiKey: agent.apiKey,
            message,
            extensions: extensions ?? agent.extensions,
          }),
          signal: abortControllerRef.current.signal,
        });

        if (!response.ok) {
          throw new Error(`Request failed: ${response.status}`);
        }

        if (!response.body) {
          throw new Error('Response body is null');
        }

        // Process SSE stream
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmedLine = line.trim();
            if (trimmedLine.startsWith('data: ')) {
              const dataStr = trimmedLine.slice(6);
              if (!dataStr || dataStr === '[DONE]') continue;

              try {
                const data = JSON.parse(dataStr);
                if (data.result) {
                  const carbonChunks = translatorRef.current?.translateStreamChunk(data.result) ?? [];
                  for (const chunk of carbonChunks) {
                    await instance.messaging.addMessageChunk(chunk);
                  }

                  // Check for form requests
                  if (data.result.status?.state === 'input-required') {
                    const formRequest = extractFormRequest(data.result);
                    if (formRequest) {
                      setCurrentFormRequest(formRequest);
                      setPendingTaskId(data.result.taskId);
                    }
                  }
                }
              } catch (e) {
                console.warn('[A2AChat] Failed to parse SSE data:', e);
              }
            }
          }
        }

        setConnectionState('connected');
        onResponse?.(translatorRef.current?.getState?.() ?? {});
      } catch (error) {
        if ((error as Error).name === 'AbortError') {
          console.log('[A2AChat] Request cancelled');
        } else {
          console.error('[A2AChat] Error:', error);
          setConnectionState('error');
          onError?.(error as Error);
        }
      } finally {
        setIsStreaming(false);
        abortControllerRef.current = null;
      }
    },
    [agent, extensions, onSend, onResponse, onError]
  );

  // ---------------------------------------------------------------------------
  // CANCEL HANDLER
  // ---------------------------------------------------------------------------

  const handleCancel = useCallback(() => {
    abortControllerRef.current?.abort();
    setIsStreaming(false);
    setConnectionState('connected');
  }, []);

  // ---------------------------------------------------------------------------
  // CUSTOM RESPONSE RENDERER
  // ---------------------------------------------------------------------------

  const renderCustomResponse = useCallback(
    (state: any, _instance: any) => {
      const messageItem = state.messageItem;
      const userDefined = messageItem?.user_defined;

      if (!userDefined) return null;

      // Custom renderer provided by consumer
      if (renderUserDefined) {
        return renderUserDefined(userDefined, messageItem);
      }

      // Text with citations
      if (userDefined.type === 'text_with_citations') {
        if (renderCitations) {
          return renderCitations(userDefined.citations || [], userDefined.text);
        }
        return (
          <CitationRenderer text={userDefined.text} citations={userDefined.citations || []} />
        );
      }

      // Sources list
      if (userDefined.type === 'sources_list' && userDefined.citations) {
        const citations = userDefined.citations as Citation[];
        if (citations.length === 0) return null;

        const uniqueCitations = citations.filter(
          (c, i, arr) => c.url && arr.findIndex((x) => x.url === c.url) === i
        );

        return (
          <div className="a2a-sources-list">
            <h4 className="a2a-sources-list__title">Sources</h4>
            <ol className="a2a-sources-list__items">
              {uniqueCitations.map((citation, idx) => (
                <li key={idx} className="a2a-sources-list__item">
                  <a href={citation.url ?? '#'} target="_blank" rel="noopener noreferrer">
                    {citation.title || citation.url}
                  </a>
                </li>
              ))}
            </ol>
          </div>
        );
      }

      // Error
      if (userDefined.type === 'error' && userDefined.error) {
        if (renderError) {
          return renderError(userDefined.error as ErrorMetadata);
        }
        return <ErrorRenderer error={userDefined.error as ErrorMetadata} />;
      }

      return null;
    },
    [renderCitations, renderError, renderUserDefined]
  );

  // ---------------------------------------------------------------------------
  // FORM HANDLERS
  // ---------------------------------------------------------------------------

  const handleFormSubmit = useCallback(
    async (values: Record<string, unknown>) => {
      if (!pendingTaskId) return;

      setCurrentFormRequest(null);
      const taskId = pendingTaskId;
      setPendingTaskId(null);

      const formResponseMessage = JSON.stringify({
        type: 'form_response',
        taskId,
        values,
      });

      await handleSendMessage(formResponseMessage);
    },
    [pendingTaskId, handleSendMessage]
  );

  const handleFormCancel = useCallback(() => {
    setCurrentFormRequest(null);
    setPendingTaskId(null);
  }, []);

  // ---------------------------------------------------------------------------
  // AFTER RENDER HANDLER
  // ---------------------------------------------------------------------------

  const handleAfterRender = useCallback((instance: any) => {
    instanceRef.current = instance;

    // Mark embedded mode as initialized - safe to respond to view changes now
    if (embedded) {
      embeddedInitializedRef.current = true;

      // CRITICAL FIX: Remove Carbon's hidden class in embedded mode
      // Carbon applies cds-aichat--hidden by default, which collapses the element to 0x0.
      // In embedded mode, the parent controls visibility via mount/unmount, so we must
      // ensure the chat is visible when mounted.
      requestAnimationFrame(() => {
        const chatElement = instanceRef.current?.hostElement?.parentElement;
        if (chatElement) {
          chatElement.classList.remove('cds-aichat--hidden');
          console.log('[A2AChat] Removed cds-aichat--hidden class for embedded mode');
        } else {
          // Fallback: Query by class name
          const embeddedElement = document.querySelector('.a2a-chat__element--embedded');
          if (embeddedElement) {
            embeddedElement.classList.remove('cds-aichat--hidden');
            console.log('[A2AChat] Removed cds-aichat--hidden class via fallback query');
          }
        }
      });

      console.log('[A2AChat] Embedded mode initialized');
    }

    console.log('[A2AChat] Chat instance ready');
  }, [embedded]);

  // ---------------------------------------------------------------------------
  // ELEMENT CLASS NAME (includes view state and embedded mode)
  // ---------------------------------------------------------------------------

  const elementClassName = useMemo(() => {
    const classes = ['a2a-chat__element'];

    // Layout-specific classes
    if (layout === 'sidebar') {
      classes.push('a2a-chat__element--sidebar');

      if (sidebarClosing && !embedded) {
        classes.push('a2a-chat__element--sidebar-closing');
      }
    } else if (layout === 'fullscreen') {
      classes.push('a2a-chat__element--fullscreen');
    }

    // EMBEDDED MODE: Add embedded class for relative positioning (both sidebar and fullscreen)
    if (embedded && (layout === 'sidebar' || layout === 'fullscreen')) {
      classes.push('a2a-chat__element--embedded');
    }

    // Hidden state - controlled by React state, not Carbon's DOM manipulation
    // In EMBEDDED mode, never apply hidden class (parent controls visibility via mount/unmount)
    if (!isViewOpen && !embedded) {
      classes.push('cds-aichat--hidden');
    }

    return classes.join(' ');
  }, [layout, embedded, isViewOpen, sidebarClosing]);

  // ---------------------------------------------------------------------------
  // RENDER
  // ---------------------------------------------------------------------------

  if (!agent) {
    return (
      <div className={`a2a-chat a2a-chat--error ${className}`}>
        <p>No agent configured. Provide `agent`, `agentId`, or `agentUrl` prop.</p>
      </div>
    );
  }

  if (!carbonLoaded) {
    return (
      <div className={`a2a-chat a2a-chat--loading ${className}`}>
        <div className="a2a-chat__spinner" />
      </div>
    );
  }

  const { ChatCustomElement, ChatContainer } = CarbonComponents;

  // Form overlay
  const formOverlay = currentFormRequest && (
    <div className="a2a-chat__form-overlay">
      {renderForm ? (
        renderForm(currentFormRequest, handleFormSubmit)
      ) : (
        <FormRenderer
          form={currentFormRequest}
          onSubmit={handleFormSubmit}
          onCancel={handleFormCancel}
        />
      )}
    </div>
  );

  // Render based on layout
  if (layout === 'float' && ChatContainer) {
    return (
      <div className={`a2a-chat a2a-chat--float ${className}`}>
        <ChatContainer
          {...({
            debug: false,
            aiEnabled: true,
            injectCarbonTheme: 'white',
          } as any)}
          header={{
            title: agent?.name ?? 'AI Assistant',
          }}
          launcher={{
            isOn: true,
          }}
          onAfterRender={handleAfterRender}
          renderUserDefinedResponse={renderCustomResponse}
          messaging={{
            skipWelcome: true,
            customSendMessage: async (
              request: any,
              _options: any,
              _instance: any
            ) => {
              const text = request?.input?.text;
              if (text) {
                await handleSendMessage(text);
              }
            },
          } as any}
        />
        {formOverlay}
      </div>
    );
  }

  if (ChatCustomElement) {
    return (
      <div className={`a2a-chat a2a-chat--${layout} ${className}`}>
        <ChatCustomElement
          {...({
            className: elementClassName,
            debug: false,
            aiEnabled: true,
            openChatByDefault: true,
            injectCarbonTheme: 'white',
          } as any)}
          header={{
            title: agent?.name ?? 'AI Assistant',
            // EMBEDDED MODE: Always show minimize - it's the close mechanism
            // STANDALONE: Show for sidebar only (fullscreen doesn't need it)
            showMinimize: embedded || layout === 'sidebar',
          }}
          launcher={{
            isOn: layout === 'float',  // Only show built-in launcher for float
          }}
          layout={{
            showFrame: layout === 'float',
            // EMBEDDED MODE: Hide close/restart since parent controls lifecycle
            // STANDALONE: Show for non-fullscreen layouts
            showCloseAndRestartButton: !embedded && layout !== 'fullscreen',
          }}
          onViewChange={onViewChange}
          onViewPreChange={onViewPreChange}
          onAfterRender={handleAfterRender}
          renderUserDefinedResponse={renderCustomResponse}
          messaging={{
            skipWelcome: true,
            messageLoadingIndicatorTimeoutSecs: 0,
            customSendMessage: async (
              request: any,
              _options: any,
              _instance: any
            ) => {
              const text = request?.input?.text;
              if (text) {
                await handleSendMessage(text);
              }
            },
          } as any}
        />

        {/* External launcher for sidebar mode - visible when sidebar is minimized */}
        {/* NEVER shown in embedded mode - parent app handles opening */}
        {layout === 'sidebar' && showExternalLauncher && !embedded && (
          <button
            className="a2a-chat__external-launcher"
            onClick={handleOpenSidebar}
            aria-label="Open chat"
            title="Open chat"
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 32 32"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M17.74 30L16 29l4-7h6a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h9v2H6a4 4 0 0 1-4-4V8a4 4 0 0 1 4-4h20a4 4 0 0 1 4 4v12a4 4 0 0 1-4 4h-4.84Z" />
              <path d="M8 10h16v2H8zM8 16h10v2H8z" />
            </svg>
          </button>
        )}

        {formOverlay}
      </div>
    );
  }

  return (
    <div className={`a2a-chat a2a-chat--loading ${className}`}>
      <div className="a2a-chat__spinner" />
    </div>
  );
}

// Helper to extract form request from chunk
function extractFormRequest(chunk: any): FormRequestMetadata | null {
  const metadata = chunk.status?.message?.metadata;
  if (!metadata) return null;

  const formData = metadata['https://a2a-extensions.agentstack.beeai.dev/ui/form-request/v1'];
  if (!formData) return null;

  return formData as FormRequestMetadata;
}

export default A2AChat;
