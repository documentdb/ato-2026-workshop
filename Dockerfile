FROM node:24.13.0-bookworm-slim@sha256:4660b1ca8b28d6d1906fd644abe34b2ed81d15434d26d845ef0aced307cf4b6f
WORKDIR /app
ARG NPM_REGISTRY=https://registry.npmjs.org/
COPY --chown=node:node package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund --registry="$NPM_REGISTRY"
COPY --chown=node:node src ./src
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node examples ./examples
COPY --chown=node:node exercises ./exercises
COPY --chown=node:node data ./data
COPY --chown=node:node test ./test
USER node
EXPOSE 3000
CMD ["node", "--watch", "src/server.js"]
