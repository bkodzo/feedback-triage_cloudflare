# Feedback Triager

A tool for Product Managers to aggregate, analyze, and triage user feedback from multiple sources.

**Live Demo:** https://semantic-triager.triage.workers.dev

## What It Does

- Aggregates feedback from Discord, GitHub, Twitter, Support tickets, and Forums
- Uses AI to classify each item (category, sentiment, urgency 1-10)
- Groups feedback by category to reveal patterns
- Provides triage workflow: acknowledge, escalate to team, resolve
- Semantic search to find related feedback

## Cloudflare Products Used

| Product | Purpose |
|---------|---------|
| **Workers** | Serverless application runtime |
| **D1** | SQLite database for feedback storage |
| **Workers AI** | Llama 3 for classification, BGE for embeddings |
| **Vectorize** | Vector database for semantic search |

## Quick Start

```bash
# Install
npm install

# Run locally
npm run dev

# Deploy
npm run deploy
```

## Usage

1. Open the dashboard
2. Click **Load Feedback** to ingest mock data
3. View aggregated insights by category
4. Click a category to see individual items
5. Take action: Acknowledge, Escalate, or Resolve
6. Use semantic search to find related feedback

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Dashboard |
| POST | `/ingest` | Load and analyze feedback |
| GET | `/search?q=...` | Semantic search |
| POST | `/action/:id` | Update status |
| POST | `/escalate/:id` | Escalate to team |
| GET | `/api/category/:name` | Items in category |

## Project Structure

```
semantic-triager/
├── src/
│   ├── index.ts        # Main application
│   └── mock-data.ts    # Mock feedback data
├── wrangler.jsonc      # Cloudflare config
├── ARCHITECTURE.md     # Technical documentation
├── PRD.md              # Product requirements
└── README.md
```

## Team Routing

Escalations are routed to the appropriate team:

- **Engineering** - Bugs, crashes, technical issues
- **Security** - Vulnerabilities, auth issues
- **Support** - Account access, how-to questions
- **Product** - Feature requests, UX feedback
- **Billing** - Payment, subscription issues
