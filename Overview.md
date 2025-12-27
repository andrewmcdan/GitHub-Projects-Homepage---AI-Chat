# GitHub Projects Homepage + AI Chat

## Overview
Build a personal homepage that showcases software and hardware projects and includes an AI chat assistant that can answer deep questions about those projects using GitHub as the source of truth. Start with a single, self-contained deployment on a Lightsail instance using Docker Compose to keep costs low. From day one, design clear boundaries (interfaces/adapters) so individual components can later be migrated to AWS managed services (S3, RDS, ElastiCache, SQS, App Runner/ECS) as usage grows and monetization becomes worthwhile.

This plan is intentionally “compose-first, cloud-ready.” You get one deployable system now, while keeping a clean upgrade path to a full SaaS architecture later.

---

## Goals

### Product Goals
- **Showcase projects**: curated list of projects with descriptions, tags, links to repos/docs, and optionally media (photos, diagrams, videos).
- **AI chat on the site**: visitors can ask questions about projects at any depth.
- **Commit-level depth**: visitors can ask about specific commits (what changed, why it matters), files at a given commit, diffs, releases.
- **Citations**: answers should include links back to GitHub (commits, files, docs) so the assistant is trustworthy.
- **Fast iteration**: minimal operational overhead early.

### Engineering Goals
- **Single-box deployment** on Lightsail using Docker Compose.
- **Modular boundaries** so components can be swapped for AWS services later.
- **Cost controls and abuse prevention** for a public chat widget.
- **Monetization-ready** foundation: multi-tenant data model, usage tracking, and plan gating built in early.

---

## Non-Goals (Early)
- Not aiming for perfect semantic understanding across every symbol and every commit on day one.
- Not building a full multi-tenant SaaS UI immediately.
- Not indexing private repos until authentication and access controls are solid.

---

## Architecture Summary (Compose-first)
The system runs as a small set of containers, with the application split into an API and a worker for asynchronous indexing.

### Services (Docker Compose)
1) **web** (frontend)
- Static site or Next.js/Astro.
- Contains the project catalog UI and an embedded chat widget.

2) **api** (backend HTTP)
- Handles chat, retrieval, tool calls, rate limiting, and admin endpoints.
- Streams chat responses (SSE recommended).

3) **worker** (background jobs)
- Runs ingestion and indexing jobs.
- Can share the same codebase/image as the API with a different entrypoint.

4) **postgres** (primary relational store)
- Stores tenants, projects, sources, chat logs, usage records.

5) **redis** (cache + rate limiting + job queue)
- Used for request throttling, caching, and early-stage async jobs.

6) **minio** (S3-compatible object store)
- Stores raw ingested artifacts and caches:
  - repo snapshots (optional)
  - commit diff blobs
  - extracted markdown
  - chunk payloads

7) **vector store** (choose one)
- **Option A: Postgres + pgvector** (recommended first)
  - Minimal moving parts.
  - Good enough for an MVP.
- **Option B: Qdrant**
  - Strong self-hosted vector search.
  - Adds one more moving part.

8) **reverse proxy** (optional but useful)
- Caddy/Traefik/Nginx for TLS and routing.

---

## Core Principle: Replaceable Adapters (“Seams”)
To make migration painless, all external dependencies are accessed through small interfaces in code.

### Interfaces to enforce
- **ObjectStore**
  - put/get/list by key
  - Implementation now: MinIO
  - Later: S3

- **RelationalStore**
  - Postgres now
  - Later: RDS Postgres

- **VectorIndex**
  - upsert/query/delete vectors
  - Now: pgvector (or Qdrant)
  - Later: OpenSearch vector or managed pgvector

- **Queue**
  - enqueue/consume jobs
  - Now: Redis-backed queue
  - Later: SQS

- **GitProvider**
  - fetch repo files, file-at-commit, commit diffs, releases
  - Now: GitHub API/GitHub App
  - Later: same, or support GitLab, etc.

When it is time to migrate, swap implementations and change environment variables rather than rewrite business logic.

---

## Data Model (Monetization-ready)
Even if there is only one tenant at first, use tenant-aware tables so turning this into a SaaS is not a painful refactor.

### Minimum tables
- **tenants**: account/entity boundary for future SaaS
- **users**: admin users
- **projects**: curated catalog entries (repo URL, tags, visibility)
- **sources**: repo/ref/file path/commit metadata
- **chunks**: chunk text + embedding reference + source linkage
- **ingest_jobs**: indexing job status and error tracking
- **chat_sessions**: per visitor session
- **chat_messages**: conversation history with citations
- **usage_events**: tokens/cost/time per request for metering
- **api_keys**: future tenant keys

### Visitor sessions
Public visitors can use anonymous sessions with strict rate limits and reduced capability compared to admin.

---

## Ingestion and Indexing Pipeline
The worker ingests GitHub content and builds searchable representations.

### What to ingest
- README and docs
- Design docs and markdown
- Releases/tags
- Commit metadata and diffs (for commit-aware questions)
- Optional later: issues/PRs/discussions

### Chunking strategy
- Markdown: split by headings/sections
- Code: split by file and optionally by function/class boundaries
- Diffs: store commit diffs as separate “diff documents,” chunked by file section

### Stored metadata per chunk
- repo/owner
- ref type (branch/tag/release/commit)
- file path
- commit SHA (if applicable)
- canonical GitHub URL for citations
- hash for dedupe

---

## Chat Answering Flow
When a visitor asks a question:

1) **Intent detection**
- overview vs design detail vs code vs commit-specific

2) **Retrieval**
- semantic search (vectors)
- keyword search (paths, symbols, commit SHAs)
- optional reranking later

3) **Tool-augmented deep dive**
For commit-level accuracy, the model can call tools implemented by the API:
- get_commit(sha)
- get_commit_diff(sha)
- get_file_at_commit(path, sha)
- compare_commits(base, head)

These tools primarily read from cached data in MinIO/Postgres, and fall back to GitHub API when needed.

4) **Answer with citations**
Always include GitHub links back to the exact file/commit/release referenced.

5) **Safety and controls**
Restrict tools to allowlisted repos and enforce per-session limits.

---

## Cost Controls and Abuse Prevention
Public chat widgets need guardrails.

- Rate limit by IP/session (Redis)
- Token limits per request
- Daily spend caps (by tenant)
- Cache common Q&A responses
- Optional lightweight anti-bot mechanism (later)

---

## Deployment Plan (Lightsail)
- Single Lightsail instance running Docker Compose
- Nightly backups:
  - pg_dump for Postgres
  - MinIO bucket sync to a backup location
- Monitoring:
  - container health checks
  - log shipping optional later

---

## Migration Plan: Lightsail to AWS Managed Services (Stepwise)
Migrate in low-risk increments. Each step preserves API contracts and core logic.

### Step 0: Compose on Lightsail
Everything self-hosted.

### Step 1: MinIO -> S3
Low risk, high value.

### Step 2: Postgres -> RDS Postgres
Minimal changes if SQL stays compatible.

### Step 3: Redis -> ElastiCache Redis
Improves reliability and scaling.

### Step 4: Redis Queue -> SQS
Decouple background jobs from cache.

### Step 5: Compute -> App Runner or ECS
- api becomes App Runner/ECS service
- worker becomes ECS service or Lambda (if jobs are small)

### Step 6: Vector Search upgrade if needed
- pgvector -> OpenSearch vector or managed pgvector

---

## MVP Roadmap

### MVP v1: Project-aware Chat
- Curated project list
- Index READMEs and docs
- Vector retrieval with citations
- Manual or scheduled reindex

### MVP v2: Commit-aware Chat
- Ingest recent commit metadata + diffs (rolling window)
- Tools for commit diff and file-at-commit
- Better citations at commit/file granularity

### MVP v3: Full GitHub Brain
- Releases, tags, PRs, issues
- Webhook-driven incremental indexing
- Reranking
- Per-repo scoping in chat

---

## Recommended Starting Choices
To keep complexity low while maintaining a clean scale path:
- Vector store: **Postgres + pgvector** (initial)
- Object store: **MinIO** with S3-style key layout
- Queue: **Redis queue** initially, with a future swap to SQS
- Code: single repo with shared core and two entrypoints (api + worker)

---

## Next Implementation Deliverables
- Repo scaffold (web/api/worker/infra)
- Dockerfiles + docker-compose.yml
- Core interfaces (ObjectStore, VectorIndex, Queue, GitProvider)
- Minimal ingestion job (README + docs)
- Working /chat endpoint with SSE streaming
- Basic citations linking back to GitHub

