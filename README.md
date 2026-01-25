# @kuntur/a2a-carbon-chat-adapter

A2A protocol adapter for Carbon AI Chat - connect any A2A agent to Carbon UI.

## Installation

```bash
npm install @kuntur/a2a-carbon-chat-adapter @carbon/ai-chat react react-dom
```

## Quick Start

```tsx
import { A2AChat } from '@kuntur/a2a-carbon-chat-adapter';
import '@kuntur/a2a-carbon-chat-adapter/styles'; // Adapter layout styles
import '@carbon/ai-chat/dist/styles.css';        // Carbon AI Chat styles (if not already imported)

function App() {
  return (
    <A2AChat
      agentUrl="https://your-agent.example.com"
      agentName="My Agent"
      layout="sidebar"
    />
  );
}
```

## Multi-Agent Setup

```tsx
import { AgentProvider, A2AChat, AgentSwitcher, useAgentContext } from '@kuntur/a2a-carbon-chat-adapter';

const agents = [
  { id: 'research', name: 'Research Agent', url: 'https://research.example.com' },
  { id: 'code', name: 'Code Agent', url: 'https://code.example.com' },
];

function App() {
  return (
    <AgentProvider agents={agents} defaultAgentId="research">
      <ChatWithSwitcher />
    </AgentProvider>
  );
}

function ChatWithSwitcher() {
  const { agents, currentAgent, selectAgent } = useAgentContext();

  return (
    <div>
      <AgentSwitcher
        agents={agents}
        currentAgentId={currentAgent?.id}
        onSelect={selectAgent}
        variant="tabs"
      />
      <A2AChat />
    </div>
  );
}
```

## Server Setup (Next.js)

```typescript
// app/api/agent/chat/route.ts
import { createA2AHandler } from '@kuntur/a2a-carbon-chat-adapter/server';

export const POST = createA2AHandler({
  allowedAgentUrls: ['https://trusted-agent.example.com'],
  timeout: 120000,
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
```

## Programmatic Usage with Hooks

```tsx
import { useA2AAgent } from '@kuntur/a2a-carbon-chat-adapter';

function MyComponent() {
  const { sendMessage, isStreaming, state } = useA2AAgent({
    agent: { id: 'my-agent', name: 'My Agent', url: 'https://...' },
    onMessage: (message) => console.log('Received:', message),
    onError: (error) => console.error('Error:', error),
  });

  const handleSend = async () => {
    await sendMessage('Hello, agent!');
  };

  return (
    <button onClick={handleSend} disabled={isStreaming}>
      {isStreaming ? 'Sending...' : 'Send Message'}
    </button>
  );
}
```

## Components

### A2AChat

Main chat component that connects to A2A agents.

```tsx
<A2AChat
  // Agent configuration (pick one)
  agent={{ id: 'agent', name: 'Agent', url: '...' }}
  // OR
  agentId="agent" // with AgentProvider
  // OR
  agentUrl="https://..." // simple URL-only

  // Display options
  layout="fullscreen" // 'fullscreen' | 'sidebar' | 'float'
  className="my-chat"

  // Behavior
  showThinking={true}
  showChainOfThought={true}
  allowCancel={true}

  // Callbacks
  onSend={(message) => {}}
  onResponse={(response) => {}}
  onError={(error) => {}}

  // Custom renderers
  renderCitations={(citations, text) => <MyCitations ... />}
  renderError={(error) => <MyError ... />}
/>
```

### AgentProvider

Context provider for multi-agent applications.

```tsx
<AgentProvider
  agents={[...]}
  defaultAgentId="research"
  persistSelection={true}
  storageKey="my-app-agent"
>
  {children}
</AgentProvider>
```

### AgentSwitcher

UI component for switching between agents.

```tsx
<AgentSwitcher
  agents={agents}
  currentAgentId={currentAgentId}
  onSelect={handleSelect}
  variant="dropdown" // 'dropdown' | 'tabs' | 'cards'
  showDescriptions={true}
  showIcons={true}
/>
```

## Hooks

### useA2AAgent

Programmatic agent interaction.

```tsx
const {
  agent,           // Current agent config
  state,           // { connectionState, error, taskId, contextId }
  sendMessage,     // Send a message
  cancelStream,    // Cancel ongoing stream
  disconnect,      // Disconnect
  isStreaming,     // Boolean
  isConnected,     // Boolean
  error,           // Last error
} = useA2AAgent(options);
```

### useMultiAgent

Manage multiple agents without AgentProvider.

```tsx
const {
  agents,          // All agents
  currentAgent,    // Currently selected
  switchAgent,     // Switch by ID
  registerAgent,   // Add new agent
  unregisterAgent, // Remove agent
} = useMultiAgent(options);
```

### useAgentContext

Access AgentProvider context.

```tsx
const { currentAgent, agents, selectAgent, getAgent, hasAgent } = useAgentContext();
```

## Renderers

Built-in renderers for A2A UI extensions:

- `CitationRenderer` - Renders text with inline citations
- `ErrorRenderer` - Renders error messages with optional stack trace
- `FormRenderer` - Renders dynamic forms from agent requests

## Exports

### From main package

```tsx
import {
  // Components
  A2AChat,
  AgentProvider,
  AgentSwitcher,
  CitationRenderer,
  ErrorRenderer,
  FormRenderer,

  // Hooks
  useA2AAgent,
  useMultiAgent,
  useAgentContext,
  useAgentContextOptional,

  // A2A Client
  A2AClient,
  EXTENSION_URIS,

  // Translator
  A2AToCarbonTranslator,
  createTranslator,

  // Types
  type AgentConfig,
  type A2AChatProps,
  // ... more types
} from '@kuntur/a2a-carbon-chat-adapter';
```

### From server subpath

```tsx
import { createA2AHandler } from '@kuntur/a2a-carbon-chat-adapter/server';
```

### Styles (optional)

```tsx
import '@kuntur/a2a-carbon-chat-adapter/styles';
```

## License

MIT
