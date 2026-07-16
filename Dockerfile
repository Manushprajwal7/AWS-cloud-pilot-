# syntax=docker/dockerfile:1

# Multi-stage build for the Next.js app. Every stage shares the same base
# image so Prisma's generated query engine binary always matches the OS
# it actually runs on (no manual binaryTargets juggling).
#
# Stages:
#   base    - Node + pnpm, nothing else
#   deps    - full node_modules (pnpm install), reused by `builder` and by
#             docker-compose's one-off `migrate` service (see docker-compose.yml)
#   builder - generates the Prisma client and runs `next build`
#             (output: 'standalone' — see next.config.mjs)
#   runner  - the actual runtime image: only the standalone server output,
#             not the full node_modules tree, plus a pinned Terraform CLI
#             for lib/terraform/sandbox.ts's host-binary execution path

FROM node:20-slim AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

FROM deps AS builder
COPY . .
RUN pnpm prisma generate
RUN pnpm build
# Standalone output's node_modules is trace-pruned by Next.js and can miss
# Prisma's native query engine binary (a known Next.js + Prisma interaction,
# since it's loaded via a dynamic require Next's tracer doesn't always
# follow). pnpm's node_modules are symlinks into its .pnpm store, which
# COPY --from can't resolve across stages, so dereference them (-L) into a
# real directory inside the standalone output now, while both are still in
# the same filesystem.
RUN mkdir -p .next/standalone/node_modules/.prisma .next/standalone/node_modules/@prisma/client \
    && cp -rL node_modules/.prisma/. .next/standalone/node_modules/.prisma/ \
    && cp -rL node_modules/@prisma/client/. .next/standalone/node_modules/@prisma/client/

FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Pinned Terraform CLI — matches the version lib/terraform/sandbox.ts uses
# for its Docker-isolated path (TERRAFORM_DOCKER_IMAGE), so behavior is
# consistent whether or not the container has access to a Docker socket.
ARG TERRAFORM_VERSION=1.9.8
RUN apt-get update && apt-get install -y --no-install-recommends curl unzip ca-certificates \
    && curl -fsSL "https://releases.hashicorp.com/terraform/${TERRAFORM_VERSION}/terraform_${TERRAFORM_VERSION}_linux_amd64.zip" -o /tmp/terraform.zip \
    && unzip /tmp/terraform.zip -d /usr/local/bin \
    && rm /tmp/terraform.zip \
    && apt-get purge -y --auto-remove unzip \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
