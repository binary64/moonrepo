import type { CodegenConfig } from "@graphql-codegen/cli";

const config: CodegenConfig = {
  schema: [
    {
      [process.env.NEXT_PUBLIC_HASURA_HTTP_URL ||
      "http://hasura.hasura.svc.cluster.local:8080/v1/graphql"]: {
        headers: {
          "x-hasura-admin-secret":
            process.env.HASURA_ADMIN_SECRET || "",
        },
      },
    },
  ],
  documents: "app/graphql/documents/**/*.graphql",
  generates: {
    "app/graphql/generated/": {
      preset: "client",
      presetConfig: {
        gqlTagName: "gql",
      },
    },
  },
  ignoreNoDocuments: true,
};

export default config;
