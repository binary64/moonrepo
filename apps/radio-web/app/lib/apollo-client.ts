import { ApolloClient, HttpLink, InMemoryCache, split } from "@apollo/client";
import { GraphQLWsLink } from "@apollo/client/link/subscriptions";
import { getMainDefinition } from "@apollo/client/utilities";
import { createClient } from "graphql-ws";

const HASURA_HTTP =
  process.env.NEXT_PUBLIC_HASURA_HTTP_URL ||
  "http://hasura.hasura.svc.cluster.local:8080/v1/graphql";

const HASURA_WS =
  process.env.NEXT_PUBLIC_HASURA_WS_URL ||
  "ws://hasura.hasura.svc.cluster.local:8080/v1/graphql";

const ADMIN_SECRET = process.env.HASURA_ADMIN_SECRET ?? "";

const httpLink = new HttpLink({
  uri: HASURA_HTTP,
  headers: ADMIN_SECRET ? { "x-hasura-admin-secret": ADMIN_SECRET } : {},
});

// Only create WS link on the client side
function makeClient() {
  if (typeof window === "undefined") {
    // Server-side: HTTP only
    return new ApolloClient({
      link: httpLink,
      cache: new InMemoryCache(),
      ssrMode: true,
    });
  }

  // Never send the admin secret from the browser — it would be visible in
  // client-side bundles and DevTools. Public/anonymous WebSocket connections
  // only; server-side HTTP requests carry the secret via httpLink above.
  const wsLink = new GraphQLWsLink(
    createClient({
      url: HASURA_WS,
      connectionParams: {},
    }),
  );

  const splitLink = split(
    ({ query }) => {
      const def = getMainDefinition(query);
      return (
        def.kind === "OperationDefinition" && def.operation === "subscription"
      );
    },
    wsLink,
    httpLink,
  );

  return new ApolloClient({
    link: splitLink,
    cache: new InMemoryCache(),
  });
}

let clientInstance: ApolloClient | null = null;

export function getApolloClient() {
  if (typeof window === "undefined") {
    // Always create a new client on the server
    return makeClient();
  }
  if (!clientInstance) {
    clientInstance = makeClient();
  }
  return clientInstance;
}
