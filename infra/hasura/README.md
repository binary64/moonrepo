# Hasura Migrations

Apply migrations via `hasura migrate apply` pointing at hasura.brandwhisper.cloud. Admin secret from k8s secret `hasura-admin`.

## Prerequisites

Install the [Hasura CLI](https://hasura.io/docs/latest/hasura-cli/install-hasura-cli/).

## Apply Migrations

```bash
hasura migrate apply \
  --endpoint https://hasura.brandwhisper.cloud \
  --admin-secret <HASURA_GRAPHQL_ADMIN_SECRET> \
  --database-name default \
  --project infra/hasura
```

The admin secret is stored in the k8s SealedSecret `hasura-admin` (key: `HASURA_GRAPHQL_ADMIN_SECRET`) in the `hasura` namespace.

To retrieve it from the cluster:
```bash
kubectl get secret hasura-admin -n hasura -o jsonpath='{.data.HASURA_GRAPHQL_ADMIN_SECRET}' | base64 -d
```

## Tables

- **pawpicks_products** — product catalogue (asin, name, brand, slug)
- **pawpicks_stock_checks** — time-series stock check results (status, price, error, checked_at)

## Notes

- A read-only Hasura role (`public` or `vercel-build`) should be created to avoid exposing the admin secret in Vercel build environment. Until then, `HASURA_ADMIN_SECRET` is used for both the CronJob and Vercel build.
- Hasura schema is managed here; console/API changes should be tracked as new migration files.
