# MVP Build Checklist (Empty Directory to Deployed on Lightsail)

This is an actionable, end-to-end checklist that gets you from an empty directory to a deployed MVP on a single Lightsail instance using Docker Compose. It assumes a Compose-first stack with:
- Frontend: static site (Next.js export or Astro)
- Backend: API + Worker (same codebase, different entrypoints)
- Postgres (+ pgvector)
- Redis
- MinIO

You can swap language later; this checklist is written to be implementation-agnostic and focuses on deliverables and order of operations.

---

## 0) Prereqs and decisions (fast)

### Choose these now (write them down)
- Backend language/framework: **Python/FastAPI** OR **Node/Fastify** - Chosen : Node/Fastify
- Database: **Postgres + pgvector** (recommended) OR **SQLite + in-memory vector store** (acceptable for MVP) - Chosen : Postgres + pgvector
- Object storage: **MinIO** (recommended) OR local filesystem (acceptable for MVP) - Chosen : MinIO
- Frontend framework: **Next.js** OR **Astro** - Chosen : Next.js
- LLM provider: **OpenAI API** OR **AWS Bedrock** - Chosen : OpenAI API
- GitHub access method: **GitHub App** (recommended) OR **PAT** (acceptable for MVP) - Chosen : GitHub App
- Domain/TLS plan: **Cloudflare** (recommended) OR Lightsail DNS - Chosen : Lightsail DNS

### Accounts and credentials you will need
- GitHub
- LLM API key
- Lightsail instance SSH key

---

## 1) Create the repository scaffold (empty directory -> initial structure)

### 1.1 Create directories
- Create repo root folder
- Add this structure:
  - `apps/web/`
  - `apps/api/`
  - `apps/worker/` (or worker entrypoint within api)
  - `packages/shared/` (schemas/types/constants)
  - `infra/compose/`
  - `infra/caddy/` (optional)
  - `scripts/`
  - `docs/`

### 1.2 Initialize git
- `git init`
- Add `.gitignore`
- Add `README.md` with:
  - What the MVP does
  - How to run locally
  - Deployment notes

---

## 2) Define the MVP feature boundary (write specs into docs)

### 2.1 MVP scope (must work)
- Homepage lists projects (from a local config file)
- Chat widget on homepage
- Chat answers using indexed data from allowlisted GitHub repos
- Citations link to GitHub (README/docs at minimum)
- Admin reindex endpoint (protected)
- Rate limits for public chat

### 2.2 Out of scope for MVP
- Full commit diff Q and A (can be v2)
- Issues/PR ingestion
- Payments/Stripe

### 2.3 Create configuration file
- `projects.yaml` (or JSON) containing:
  - project name, repo URL, description, tags, featured flag
  - optional: docs paths to prioritize

---

## 3) Implement the backend core (API)

### 3.1 Define internal interfaces (ports)
Create interfaces in `apps/api/src/core/ports/` (or similar):
- `ObjectStore` (MinIO now, S3 later)
- `VectorIndex` (pgvector now, OpenSearch later)
- `Queue` (Redis now, SQS later)
- `GitProvider` (GitHub App/PAT)

### 3.2 Define data schemas
In `packages/shared/`:
- Chat request/response schema
- Ingest job schema
- Project schema
- Citation schema

### 3.3 Define API endpoints
Minimum endpoints:
- `GET /healthz`
- `GET /projects` -> returns project list
- `POST /chat` -> streams response (SSE recommended)
- `POST /admin/reindex` -> enqueue reindex jobs (admin-only)
- `POST /webhooks/github` -> optional for MVP; can come later

### 3.4 Implement SSE streaming
- `/chat` returns SSE chunks while generating
- Add per-request token caps

### 3.5 Add rate limiting
- Rate limit `/chat` by IP + session using Redis
- Include:
  - per-minute limit
  - burst limit
  - daily limit (optional)

---

## 4) Implement storage (Postgres + pgvector)

### 4.1 Create DB migrations
Use your migration tool of choice.
Create tables:
- `tenants`
- `projects`
- `sources`
- `chunks` (includes text + embedding)
- `ingest_jobs`
- `chat_sessions`
- `chat_messages`
- `usage_events`

### 4.2 Enable pgvector
- Ensure the Postgres image supports pgvector OR install extension
- Run `CREATE EXTENSION vector;` in init scripts

### 4.3 Implement VectorIndex adapter
- Insert/update embeddings into `chunks`
- Query top K by similarity
- Filter by repo/project

---

## 5) Implement object storage (MinIO)

### 5.1 MinIO bucket strategy
Create buckets:
- `artifacts` (raw ingested files, diffs later)
- `exports` (optional)

### 5.2 Key layout (S3-friendly)
Use keys like:
- `tenants/{tenant_id}/repos/{owner}/{repo}/refs/{ref}/files/{path}`
- `tenants/{tenant_id}/repos/{owner}/{repo}/ingest/{job_id}/...`

### 5.3 Implement ObjectStore adapter
- put/get/list
- signed URL support optional

---

## 6) Implement ingestion (Worker)

### 6.1 Define ingest job types
- `INGEST_REPO_DOCS` (MVP)
- later: `INGEST_COMMITS`, `INGEST_RELEASES`, etc.

### 6.2 Worker execution model
Option A (simplest): worker polls Redis queue.
Option B: worker is a separate process consuming a queue.

### 6.3 MVP ingestion steps
For each repo in allowlist:
1) Fetch README + docs paths
2) Normalize to text (markdown/plain)
3) Chunk content
4) Embed chunks
5) Store:
   - raw content in MinIO
   - chunk records + embeddings in Postgres
   - source metadata with GitHub URLs

### 6.4 Add a scheduled reindex
- Daily cron-like schedule in the worker OR manual admin trigger only for MVP

---

## 7) Implement retrieval and answer generation

### 7.1 Retrieval pipeline
- Parse question
- Determine relevant projects (optional: ask the model to classify)
- Vector search top K chunks
- Construct context with citations

### 7.2 Answer generation
- Call LLM with:
  - system prompt: “answer using sources, cite, be honest when unsure”
  - retrieved context
  - citation format spec

### 7.3 Citation format
Return citations as:
- repo, file path, ref, URL
- optionally include “chunk excerpt” for UI display

---

## 8) Implement the frontend (web)

### 8.1 Project list page
- Load from `GET /projects`
- Render cards with tags

### 8.2 Chat widget
- Input box + stream output
- Show citations under each assistant message
- Provide “scope” selector (All projects vs selected project) (optional)

### 8.3 MVP styling
- Keep it simple: clean layout, readable typography

---

## 9) Dockerize everything

### 9.1 Create Dockerfiles
- `apps/api/Dockerfile`
- `apps/web/Dockerfile`
- Optional: one image for api+worker

### 9.2 Compose file
Create `infra/compose/docker-compose.yml` with services:
- `api`
- `worker`
- `web`
- `postgres`
- `redis`
- `minio`

Include:
- environment variables
- volumes
- health checks
- network

### 9.3 Local run
- `docker compose up --build`
- Verify:
  - `/healthz` ok
  - `/projects` returns expected list
  - `/admin/reindex` triggers ingestion
  - chat responds with citations

---

## 10) Security basics (minimum viable)

### 10.1 Secret management
- Use `.env` locally
- On Lightsail, store env vars securely (avoid committing)

### 10.2 Protect admin endpoints
- Require an admin API key header
- IP allowlist optional

### 10.3 Repo allowlist
- Only ingest specified repos
- Never accept arbitrary repo URLs from public users

---

## 11) Deploy to Lightsail

### 11.1 Provision instance
- Ubuntu LTS
- Size: start with 2-4GB RAM depending on embeddings workload

### 11.2 Install dependencies
- Docker
- Docker Compose plugin

### 11.3 Copy the repo
Options:
- `git clone` from GitHub
- or rsync

### 11.4 Configure environment
- Create `.env` on server
- Set:
  - DB creds
  - Redis
  - MinIO creds
  - GitHub token/app creds
  - LLM API key
  - admin key

### 11.5 Run Compose
- `docker compose up -d --build`
- Verify health and logs

---

## 12) Add domain + TLS

### 12.1 Reverse proxy
Use Caddy/Traefik/Nginx.
- Terminate TLS
- Route:
  - `/` -> web
  - `/api/*` -> api

### 12.2 DNS
- Create A record to Lightsail static IP

---

## 13) MVP acceptance tests (definition of “deployed MVP”)

### Must pass
- Homepage loads over HTTPS
- Project cards render and link to GitHub
- Chat widget works and streams responses
- Answers reference your projects and include citations
- Admin reindex successfully rebuilds the index
- Rate limiting prevents abuse

### Nice-to-have
- Basic analytics counters (requests/day)
- Error reporting (simple logs are fine)

---

## 14) Post-MVP: prepare for monetization and AWS migration

### 14.1 Monetization readiness
- Ensure tenant_id everywhere
- Record `usage_events`
- Add plan flags (free/pro)

### 14.2 Migration sequence (later)
- MinIO -> S3
- Postgres -> RDS
- Redis -> ElastiCache
- Redis queue -> SQS
- api/worker -> App Runner or ECS
- pgvector -> OpenSearch vector (only if needed)

