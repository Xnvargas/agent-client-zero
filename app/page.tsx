import EnhancedChatWrapper from "@/components/EnhancedChatWrapper";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-between">
      {/* In production, agentUrl would come from user config passed via props or context, 
          but typically the wrapper handles the specific agent connection details 
          via the API route proxy if using the secure pattern. 
          Here we assume the insecure direct connection pattern for the wrapper as described 
          in the first part of the guide, OR the secure pattern where agentUrl points to our API.
      */}
      <EnhancedChatWrapper 
        agentUrl={process.env.NEXT_PUBLIC_AGENT_URL || '/api/agent/send'} 
        apiKey={process.env.NEXT_PUBLIC_AGENT_API_KEY || ''} 
      />
    </main>
  );
}
