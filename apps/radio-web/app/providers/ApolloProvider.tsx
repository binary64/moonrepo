"use client";

import { ApolloProvider as BaseApolloProvider } from "@apollo/client/react";
import { getApolloClient } from "../lib/apollo-client";

export default function ApolloProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const client = getApolloClient();
  return <BaseApolloProvider client={client}>{children}</BaseApolloProvider>;
}
