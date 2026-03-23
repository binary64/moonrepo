# Dependencies:
# - node: Pure Node.js — no native deps, no external packages
# Uses only built-in `http` and `net` modules.

FROM node:20-alpine

WORKDIR /app
COPY index.js ./

EXPOSE 3200

USER node
CMD ["node", "index.js"]

# trigger: 2026-03-23
