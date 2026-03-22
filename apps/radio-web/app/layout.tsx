import type { Metadata } from "next";
import "./globals.css";
import ApolloProvider from "./providers/ApolloProvider";

export const metadata: Metadata = {
  title: "Arthur Radio",
  description: "Live radio stream — now playing, history, and more",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <ApolloProvider>{children}</ApolloProvider>
      </body>
    </html>
  );
}
