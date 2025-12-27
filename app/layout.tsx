import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agent Client Zero",
  description: "A2A Agent Chat Client powered by Carbon AI",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
