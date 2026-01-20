# Product Requirements Document: Feedback Triager

## Problem Statement

Product Managers at growing companies receive feedback from multiple channels:
- Discord community servers
- GitHub issues and discussions
- Twitter/X mentions
- Support ticket systems
- Community forums

This fragmentation creates several problems:

1. **Volume overwhelm**: A PM might receive 50+ pieces of feedback daily across 5 platforms. Reading each one is time-consuming.

2. **Pattern blindness**: When feedback is scattered, it's hard to see patterns. Five users complaining about "slow loading" on Discord, three GitHub issues about "performance," and two support tickets about "timeouts" are actually the same problem—but a PM might not connect them.

3. **Prioritization difficulty**: Without aggregated data, PMs rely on intuition or whoever shouts loudest. Critical issues can be missed while minor complaints get attention.

4. **No triage workflow**: Most feedback sits in its original platform with no status tracking. Did someone look at this? Is it being worked on? Who's responsible?

## Solution Hypothesis

A tool that:
1. Aggregates feedback from multiple sources into one view
2. Uses AI to classify each item (category, sentiment, urgency)
3. Groups similar feedback to reveal patterns
4. Provides a triage workflow (acknowledge, escalate, resolve)
5. Enables semantic search to find related feedback

## User Persona

**Primary User: Product Manager**

- Responsible for a product with active user base
- Receives feedback from 3-5 different channels
- Needs to identify what's urgent vs what can wait
- Reports to leadership on user sentiment trends
- Works with Engineering, Support, and other teams

**Goals:**
- Spend less time reading individual messages
- Quickly identify critical issues
- See patterns across feedback sources
- Track what's been addressed vs what's pending

## Ideation: Solution Approaches Considered

### Approach 1: AI Agent that Summarizes Daily

**Concept**: An AI agent reads all feedback daily and sends a summary email/Slack message.

**Pros**:
- Passive—PM doesn't need to open a dashboard
- Good for high-level awareness

**Cons**:
- No drill-down capability
- Can't take action from a summary
- Loses individual item context
- No triage workflow

**Verdict**: Good for awareness, not sufficient for action.

### Approach 2: Slack/Discord Bot Integration

**Concept**: A bot posts feedback summaries directly into Slack channels, team members react to triage.

**Pros**:
- Lives where teams already work
- Quick reactions for triage
- Real-time notifications

**Cons**:
- Slack threads get noisy
- Hard to see historical patterns
- Limited filtering/search
- Reactions aren't a real workflow

**Verdict**: Good for notifications, not for analysis.

### Approach 3: Dashboard with Aggregation and Triage

**Concept**: A web dashboard that aggregates feedback, groups by category, shows urgency, and provides triage actions.

**Pros**:
- Full context in one place
- Can drill down from summary to individual items
- Proper workflow (acknowledge → escalate → resolve)
- Search and filter capabilities
- Historical view

**Cons**:
- Requires PM to actively check it
- Another tool in the stack

**Verdict**: Best for comprehensive triage workflow.

### Chosen Approach: Dashboard + Notifications

Combine Approach 3 (dashboard) with elements of Approach 2 (notifications for escalations). The dashboard is the source of truth; Slack notifications alert teams when items are escalated to them.

## Feature Requirements

### P0: Must Have

1. **Multi-source aggregation**
   - Ingest feedback from Discord, GitHub, Twitter, Support, Forum
   - Deduplicate based on source + source_id
   - Store original text and metadata

2. **AI classification**
   - Category: Bug, Performance, Security, UX, Feature Request, Billing, Praise, Other
   - Sentiment: Positive, Negative, Neutral
   - Urgency: 1-10 scale with clear definitions
   - Suggested team: Engineering, Security, Support, Product, Billing

3. **Aggregated dashboard**
   - Summary stats: total, new, escalated, resolved
   - Category breakdown with counts and average urgency
   - Sentiment visualization per category
   - Source distribution

4. **Triage workflow**
   - View items within a category
   - Acknowledge (mark as seen)
   - Escalate to team (with notes)
   - Resolve (mark as handled)
   - Reopen if needed

5. **Bulk actions**
   - Acknowledge all in category
   - Resolve all in category

### P1: Should Have

6. **Semantic search**
   - Natural language queries ("performance issues", "login problems")
   - Find related feedback across categories
   - Similarity scoring

7. **Team escalation with notifications**
   - Assign to specific team
   - Send Slack notification to team channel
   - Include context (ticket ID, source, feedback text)

8. **PM notes**
   - Add notes to individual items
   - Persist across sessions

### P2: Nice to Have

9. **Trend analysis**
   - Compare this week vs last week
   - Identify emerging issues

10. **Export capabilities**
    - Export filtered data as CSV
    - Share reports with stakeholders

11. **Scheduled digests**
    - Daily/weekly summary emails
    - Configurable recipients

## Technical Approach

### Why Cloudflare

The assignment requires using Cloudflare products. Beyond that, Cloudflare's stack is well-suited for this:

- **Workers**: Serverless runtime, no infrastructure to manage, fast global deployment
- **D1**: SQL database with familiar syntax, good for structured feedback data
- **Workers AI**: Built-in AI inference, no external API keys needed
- **Vectorize**: Vector database for semantic search

### Architecture Decision: Single Worker

For a prototype/MVP, putting all logic in a single Worker file simplifies:
- Deployment (one artifact)
- Debugging (one place to look)
- Configuration (one wrangler.jsonc)


