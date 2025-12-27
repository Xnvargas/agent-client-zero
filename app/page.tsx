import AgentChatApp from "@/components/AgentChatApp";

export default function Home() {
  // Environment variables for optional default configuration
  // If set, the app will try to connect automatically
  // If not set, users will see the setup screen to enter their agent URL
  const defaultAgentUrl = process.env.NEXT_PUBLIC_AGENT_URL;
  const defaultApiKey = process.env.NEXT_PUBLIC_AGENT_API_KEY;

  return (
    <main className="min-h-screen">
      <AgentChatApp
        defaultAgentUrl={defaultAgentUrl}
        defaultApiKey={defaultApiKey}
      />
    </main>
  );
}
