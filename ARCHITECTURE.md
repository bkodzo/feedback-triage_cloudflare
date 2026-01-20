# Architecture

## Overview

A Cloudflare Worker that aggregates user feedback, analyzes it with AI, and provides a triage dashboard.

## Tech Stack

- **Workers** - Application runtime
- **D1** - SQLite database
- **Workers AI** - Llama 3 (classification) + BGE (embeddings)
- **Vectorize** - Semantic search

## Database Schema

```sql
feedback (
  id, raw_text, category, sentiment, urgency_score,
  source, source_id, author, status, assigned_team, notes, created_at
)
```

## Data Flow

```
POST /ingest
  → Check for duplicates (source + source_id)
  → Analyze with Workers AI (category, sentiment, urgency, team)
  → Insert into D1
  → Generate embedding and store in Vectorize

GET /
  → Query D1 for stats and category aggregations
  → Render HTML dashboard

GET /search?q=...
  → Generate query embedding
  → Query Vectorize for similar vectors
  → Fetch full records from D1

POST /escalate/:id
  → Update status to escalated
  → Set assigned team
  → Send Slack notification (if configured)
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Dashboard |
| POST | `/ingest` | Analyze and store feedback |
| POST | `/clear` | Delete all data |
| GET | `/search?q=...` | Semantic search |
| GET | `/api/category/:name` | Items in category |
| POST | `/action/:id` | Update status |
| POST | `/escalate/:id` | Escalate to team |
| POST | `/bulk` | Bulk actions |

## Configuration

```jsonc
// wrangler.jsonc
{
  "d1_databases": [{ "binding": "DB", "database_name": "triager-db" }],
  "ai": { "binding": "AI" },
  "vectorize": [{ "binding": "VECTORIZE", "index_name": "feedback-search" }]
}
```

## Design Decisions

- **Aggregate by category**: Reduces noise, helps PMs see patterns
- **Semantic search**: Finds related feedback regardless of wording
- **Server-rendered HTML**: No build step, simple deployment
- **Mock data**: Demonstrates architecture without OAuth complexity
