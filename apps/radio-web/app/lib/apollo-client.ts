import { ApolloClient, HttpLink, InMemoryCache, split } from "@apollo/client";
import { GraphQLWsLink } from "@apollo/client/link/subscriptions";
import { getMainDefinition } from "@apollo/client/utilities";
import { createClient } from "graphql-ws";

const HASURA_HTTP =
  process.env.NEXT_PUBLIC_HASURA_HTTP_URL ||
  "https://hasura.brandwhisper.cloud/v1/graphql";

const HASURA_WS =
  process.env.NEXT_PUBLIC_HASURA_WS_URL ||
  "wss://hasura.brandwhisper.cloud/v1/graphql";

const httpLink = new HttpLink({
  uri: HASURA_HTTP,
});

function makeClient() {
  if (typeof window === "undefined") {
    return new ApolloClient({
      link: httpLink,
      cache: new InMemoryCache(),
      ssrMode: true,
    });
  }

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
