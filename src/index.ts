/**
 * Semantic Triager - Feedback Aggregation & Analysis Tool
 * Cloudflare Workers + D1 + Workers AI + Vectorize
 */

import { MOCK_FEEDBACK, TEAMS, type TeamId } from './mock-data';

export interface Env {
	DB: D1Database;
	AI: Ai;
	VECTORIZE: Vectorize;
	SLACK_WEBHOOK_URL?: string;
}


interface FeedbackAnalysis {
	category: string;
	sentiment: 'Positive' | 'Negative' | 'Neutral';
	urgency: number;
	suggestedTeam: TeamId;
	keywords: string[];
}

interface AggregatedInsight {
	category: string;
	total: number;
	newCount: number;
	avgUrgency: number;
	sentimentBreakdown: { positive: number; negative: number; neutral: number };
	topSources: string[];
}

interface VectorSearchResult {
	id: string;
	score: number;
	metadata?: Record<string, any>;
}



const ANALYSIS_PROMPT = `You are an expert Product Manager assistant specializing in feedback triage. Your job is to analyze user feedback and classify it accurately.

CLASSIFICATION RULES:

**Category** (choose the MOST specific match):
- "Bug" → Something is broken, crashing, not working as expected, error messages
- "Performance" → Slow, laggy, high memory/CPU, timeouts, loading issues
- "Security" → Vulnerabilities, data exposure, authentication issues, XSS, injection
- "UX" → Confusing interface, hard to find features, poor onboarding, accessibility
- "Feature Request" → Asking for new functionality, integrations, enhancements
- "Billing" → Payment issues, subscription problems, pricing confusion, refunds
- "Praise" → Positive feedback, compliments, appreciation (no action needed)
- "Other" → Does not fit any category above

**Sentiment**:
- "Negative" → Frustrated, angry, disappointed, complaining
- "Positive" → Happy, satisfied, grateful, excited
- "Neutral" → Factual, informational, no strong emotion

**Urgency** (1-10 scale):
- 9-10: System down, security breach, data loss, many users affected
- 7-8: Major feature broken, significant user impact, repeated complaints
- 5-6: Notable issue, some users affected, workarounds exist
- 3-4: Minor annoyance, edge case, low impact
- 1-2: Nice-to-have, no real impact, cosmetic issues

**Team Assignment**:
- "security" → Any security-related issue, vulnerabilities, auth problems
- "engineering" → Bugs, crashes, technical errors, performance issues
- "billing" → Payment, subscription, pricing, refund issues
- "product" → Feature requests, UX feedback, design suggestions
- "support" → How-to questions, account access, general help requests

**Keywords**: Extract 2-4 key terms that describe the core issue.

RESPOND WITH ONLY THIS JSON (no other text):
{"category":"...","sentiment":"...","urgency":N,"suggestedTeam":"...","keywords":["...","..."]}`;


async function analyzeFeedback(text: string, env: Env): Promise<FeedbackAnalysis> {
	try {
		const response = await env.AI.run('@cf/meta/llama-3-8b-instruct', {
			messages: [
				{ role: 'system', content: ANALYSIS_PROMPT },
				{ role: 'user', content: `Analyze this feedback:\n\n"${text}"` },
			],
		});

		const raw = typeof response === 'string' ? response : (response as any).response || '';
		
		// Extract JSON from response
		let jsonStr = raw.trim();
		const codeMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
		if (codeMatch) jsonStr = codeMatch[1];
		
		const start = jsonStr.indexOf('{');
		const end = jsonStr.lastIndexOf('}');
		if (start !== -1 && end !== -1) {
			jsonStr = jsonStr.slice(start, end + 1);
		}

		const parsed = JSON.parse(jsonStr);
		return {
			category: String(parsed.category || 'Other'),
			sentiment: parsed.sentiment || 'Neutral',
			urgency: Math.min(10, Math.max(1, Number(parsed.urgency) || 5)),
			suggestedTeam: parsed.suggestedTeam || 'product',
			keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
		};
	} catch (error) {
		console.error('AI analysis failed:', error);
		return { category: 'Other', sentiment: 'Neutral', urgency: 5, suggestedTeam: 'product', keywords: [] };
	}
}



const MIN_SIMILARITY_THRESHOLD = 0.5; // Only return results above 50% similarity

async function generateEmbedding(text: string, env: Env): Promise<number[]> {
	const response = await env.AI.run('@cf/baai/bge-base-en-v1.5', {
		text: [text],
	});
	return response.data[0] as number[];
}

async function indexFeedback(
	id: number, 
	text: string, 
	category: string, 
	sentiment: string,
	urgency: number,
	env: Env
): Promise<void> {
	try {
		// Use just the raw text for embedding - keeps it simple and matches search queries better
		const embedding = await generateEmbedding(text, env);
		await env.VECTORIZE.upsert([
			{
				id: String(id),
				values: embedding,
				metadata: { 
					category, 
					sentiment,
					urgency,
					text: text.substring(0, 300) 
				},
			},
		]);
	} catch (error) {
		console.error('Failed to index feedback:', error);
	}
}

async function searchSimilarFeedback(query: string, env: Env, topK = 20): Promise<VectorSearchResult[]> {
	try {
		const queryEmbedding = await generateEmbedding(query, env);
		const results = await env.VECTORIZE.query(queryEmbedding, {
			topK,
			returnMetadata: 'all',
		});
		
		// Filter by minimum similarity threshold
		const filtered = (results.matches || [])
			.filter(m => m.score >= MIN_SIMILARITY_THRESHOLD)
			.map(m => ({
				id: m.id,
				score: m.score,
				metadata: m.metadata,
			}));
		
		return filtered;
	} catch (error) {
		console.error('Vector search failed:', error);
		return [];
	}
}


async function sendSlackNotification(
	env: Env,
	teamId: TeamId,
	feedbackId: number,
	feedbackText: string,
	category: string,
	source: string,
	author: string
): Promise<boolean> {
	if (!env.SLACK_WEBHOOK_URL) {
		return false; // Silently skip if not configured
	}

	const team = TEAMS.find(t => t.id === teamId);
	if (!team) return false;

	const payload = {
		channel: team.slackChannel,
		username: 'Feedback Triager',
		blocks: [
			{
				type: 'header',
				text: { type: 'plain_text', text: `Escalation: ${category}`, emoji: false }
			},
			{
				type: 'section',
				fields: [
					{ type: 'mrkdwn', text: `*Team:*\n${team.name}` },
					{ type: 'mrkdwn', text: `*Source:*\n${source}` },
					{ type: 'mrkdwn', text: `*Author:*\n${author}` },
					{ type: 'mrkdwn', text: `*Ticket ID:*\n#${feedbackId}` },
				]
			},
			{
				type: 'section',
				text: { type: 'mrkdwn', text: `*Feedback:*\n>${feedbackText.substring(0, 500)}` }
			},
		]
	};

	try {
		const res = await fetch(env.SLACK_WEBHOOK_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload),
		});
		return res.ok;
	} catch (error) {
		console.error('Slack notification failed:', error);
		return false;
	}
}



async function getAggregatedInsights(env: Env): Promise<AggregatedInsight[]> {
	const results = await env.DB.prepare(`
		SELECT 
			category,
			COUNT(*) as total,
			COUNT(CASE WHEN status = 'new' THEN 1 END) as new_count,
			ROUND(AVG(urgency_score), 1) as avg_urgency,
			COUNT(CASE WHEN sentiment = 'Positive' THEN 1 END) as positive,
			COUNT(CASE WHEN sentiment = 'Negative' THEN 1 END) as negative,
			COUNT(CASE WHEN sentiment = 'Neutral' THEN 1 END) as neutral,
			GROUP_CONCAT(DISTINCT source) as sources
		FROM feedback
		GROUP BY category
		ORDER BY new_count DESC, avg_urgency DESC
	`).all();

	return (results.results as any[]).map(r => ({
		category: r.category,
		total: r.total,
		newCount: r.new_count,
		avgUrgency: r.avg_urgency || 0,
		sentimentBreakdown: {
			positive: r.positive || 0,
			negative: r.negative || 0,
			neutral: r.neutral || 0,
		},
		topSources: r.sources ? r.sources.split(',') : [],
	}));
}



function escapeHtml(str: string): string {
	return str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}


export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;

		// -------------------------------------------------------------------------
		// POST /clear - Clear all data and re-index
		// -------------------------------------------------------------------------
		if (request.method === 'POST' && path === '/clear') {
			await env.DB.prepare('DELETE FROM feedback').run();
			// Note: Vectorize doesn't have a clear-all, but upserts will overwrite
			return json({ success: true, message: 'All data cleared' });
		}

		// -------------------------------------------------------------------------
		// POST /ingest - Load and analyze mock feedback
		// -------------------------------------------------------------------------
		if (request.method === 'POST' && path === '/ingest') {
			let processed = 0;
			
			for (const item of MOCK_FEEDBACK) {
				const existing = await env.DB
					.prepare('SELECT id FROM feedback WHERE source = ? AND source_id = ?')
					.bind(item.source, item.id)
					.first();
				
				if (existing) continue;

				const analysis = await analyzeFeedback(item.text, env);

				const result = await env.DB
					.prepare(`INSERT INTO feedback 
						(raw_text, category, sentiment, urgency_score, source, source_id, author, status, assigned_team)
						VALUES (?, ?, ?, ?, ?, ?, ?, 'new', ?)`)
					.bind(
						item.text,
						analysis.category,
						analysis.sentiment,
						analysis.urgency,
						item.source,
						item.id,
						item.author,
						analysis.suggestedTeam
					)
					.run();

				// Index in Vectorize for semantic search
				if (result.meta.last_row_id) {
					await indexFeedback(
						result.meta.last_row_id, 
						item.text, 
						analysis.category, 
						analysis.sentiment,
						analysis.urgency,
						env
					);
				}

				processed++;
			}

			return json({ success: true, processed });
		}

		
		if (request.method === 'GET' && path === '/search') {
			const query = url.searchParams.get('q');
			if (!query) {
				return json({ error: 'Query parameter "q" required' }, 400);
			}

			const vectorResults = await searchSimilarFeedback(query, env, 20);
			
			if (vectorResults.length === 0) {
				return json({ 
					results: [], 
					message: 'No matching feedback found. Try different keywords or a more specific query.',
					threshold: MIN_SIMILARITY_THRESHOLD * 100
				});
			}

			// Get full feedback items from D1
			const ids = vectorResults.map(r => r.id);
			const placeholders = ids.map(() => '?').join(',');
			const items = await env.DB
				.prepare(`SELECT * FROM feedback WHERE id IN (${placeholders})`)
				.bind(...ids)
				.all();

			// Merge with similarity scores and sort by similarity
			const resultsWithScore = items.results
				.map((item: any) => {
					const vectorMatch = vectorResults.find(v => v.id === String(item.id));
					return {
						...item,
						similarity: vectorMatch ? Math.round(vectorMatch.score * 100) : 0,
					};
				})
				.sort((a: any, b: any) => b.similarity - a.similarity);

			return json({ results: resultsWithScore });
		}


		if (request.method === 'POST' && path.startsWith('/escalate/')) {
			const id = parseInt(path.split('/escalate/')[1]);
			const body = await request.json() as { team: TeamId; notes?: string };
			
			const feedback = await env.DB
				.prepare('SELECT * FROM feedback WHERE id = ?')
				.bind(id)
				.first() as any;
			
			if (!feedback) {
				return json({ error: 'Feedback not found' }, 404);
			}

			await env.DB
				.prepare(`UPDATE feedback SET status = 'escalated', assigned_team = ?, urgency_score = 10, notes = ? WHERE id = ?`)
				.bind(body.team, body.notes || null, id)
				.run();

			// Send Slack notification (silently fails if not configured)
			await sendSlackNotification(
				env,
				body.team,
				id,
				feedback.raw_text,
				feedback.category,
				feedback.source,
				feedback.author
			);

			return json({ success: true });
		}

		if (request.method === 'POST' && path.startsWith('/action/')) {
			const id = path.split('/action/')[1];
			const body = await request.json() as any;
			const { action, notes } = body;

			const updates: Record<string, string> = {
				acknowledge: "UPDATE feedback SET status = 'acknowledged' WHERE id = ?",
				resolve: "UPDATE feedback SET status = 'resolved' WHERE id = ?",
				reopen: "UPDATE feedback SET status = 'new' WHERE id = ?",
			};

			if (updates[action]) {
				await env.DB.prepare(updates[action]).bind(id).run();
			} else if (action === 'add_note') {
				await env.DB.prepare('UPDATE feedback SET notes = ? WHERE id = ?').bind(notes, id).run();
			}

			return json({ success: true });
		}

		
		if (request.method === 'POST' && path === '/bulk') {
			const body = await request.json() as { action: string; category: string };
			
			if (body.action === 'acknowledge') {
				await env.DB
					.prepare("UPDATE feedback SET status = 'acknowledged' WHERE category = ? AND status = 'new'")
					.bind(body.category)
					.run();
			} else if (body.action === 'resolve') {
				await env.DB
					.prepare("UPDATE feedback SET status = 'resolved' WHERE category = ?")
					.bind(body.category)
					.run();
			}

			return json({ success: true });
		}

	
		if (request.method === 'GET' && path === '/api/insights') {
			const insights = await getAggregatedInsights(env);
			return json({ insights });
		}

		
		if (request.method === 'GET' && path.startsWith('/api/category/')) {
			const category = decodeURIComponent(path.split('/api/category/')[1]);
			const status = url.searchParams.get('status');
			
			let query = 'SELECT * FROM feedback WHERE category = ?';
			const params: any[] = [category];
			
			if (status && status !== 'all') {
				query += ' AND status = ?';
				params.push(status);
			}
			
			query += ' ORDER BY urgency_score DESC, created_at DESC';
			
			const items = await env.DB.prepare(query).bind(...params).all();
			return json({ items: items.results });
		}

		
		if (request.method === 'GET' && path === '/') {
			const filter = url.searchParams.get('status') || 'all';

			// Get stats
			const stats = await env.DB.prepare(`
				SELECT 
					COUNT(*) as total,
					COUNT(CASE WHEN status = 'new' THEN 1 END) as new_count,
					COUNT(CASE WHEN status = 'escalated' THEN 1 END) as escalated,
					COUNT(CASE WHEN status = 'resolved' THEN 1 END) as resolved,
					ROUND(AVG(urgency_score), 1) as avg_urgency
				FROM feedback
			`).first() as any || {};

			// Get insights
			const insights = await getAggregatedInsights(env);

			// Build category rows
			let insightRows = '';
			for (const insight of insights) {
				const urgencyClass = insight.avgUrgency >= 7 ? 'urgent' : insight.avgUrgency >= 4 ? 'moderate' : 'low';
				const sentimentBar = `
					<div class="sentiment-bar">
						<div class="positive" style="width: ${(insight.sentimentBreakdown.positive / insight.total) * 100}%"></div>
						<div class="neutral" style="width: ${(insight.sentimentBreakdown.neutral / insight.total) * 100}%"></div>
						<div class="negative" style="width: ${(insight.sentimentBreakdown.negative / insight.total) * 100}%"></div>
					</div>
				`;

				insightRows += `
					<tr class="category-row" data-category="${escapeHtml(insight.category)}">
						<td class="category-cell">
							<span class="category-name">${escapeHtml(insight.category)}</span>
							${insight.newCount > 0 ? `<span class="new-indicator">${insight.newCount} new</span>` : ''}
						</td>
						<td class="count-cell">${insight.total}</td>
						<td class="urgency-cell ${urgencyClass}">${insight.avgUrgency}</td>
						<td class="sentiment-cell">${sentimentBar}</td>
						<td class="sources-cell">${insight.topSources.join(', ')}</td>
						<td class="actions-cell">
							<button class="btn-text" onclick="viewCategory('${escapeHtml(insight.category)}')">View</button>
							<button class="btn-text" onclick="bulkAcknowledge('${escapeHtml(insight.category)}')">Acknowledge All</button>
						</td>
					</tr>
				`;
			}

			// Teams dropdown for escalation modal
			const teamsOptions = TEAMS.map(t => 
				`<option value="${t.id}">${t.name} (${t.slackChannel})</option>`
			).join('');

			const html = `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>Feedback Triager</title>
	<link rel="preconnect" href="https://fonts.googleapis.com">
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
	<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono&display=swap" rel="stylesheet">
	<style>
		:root {
			--bg: #fafafa;
			--surface: #ffffff;
			--border: #e5e5e5;
			--text: #171717;
			--text-secondary: #737373;
			--accent: #2563eb;
			--urgent: #dc2626;
			--moderate: #d97706;
			--low: #16a34a;
			--positive: #22c55e;
			--neutral: #a3a3a3;
			--negative: #ef4444;
		}

		* { box-sizing: border-box; margin: 0; padding: 0; }
		
		body {
			font-family: 'IBM Plex Sans', -apple-system, sans-serif;
			background: var(--bg);
			color: var(--text);
			line-height: 1.6;
			font-size: 14px;
		}

		.container {
			max-width: 1200px;
			margin: 0 auto;
			padding: 32px 24px;
		}

		header {
			display: flex;
			justify-content: space-between;
			align-items: baseline;
			margin-bottom: 32px;
			padding-bottom: 16px;
			border-bottom: 1px solid var(--border);
		}

		h1 {
			font-size: 20px;
			font-weight: 600;
			letter-spacing: -0.02em;
		}

		.header-actions {
			display: flex;
			gap: 16px;
			align-items: center;
		}

		.btn {
			font-family: inherit;
			font-size: 13px;
			font-weight: 500;
			padding: 8px 16px;
			border: 1px solid var(--border);
			background: var(--surface);
			color: var(--text);
			cursor: pointer;
		}

		.btn-primary {
			background: var(--text);
			color: var(--surface);
			border-color: var(--text);
		}

		.btn-text {
			background: none;
			border: none;
			color: var(--accent);
			font-family: inherit;
			font-size: 13px;
			font-weight: 500;
			cursor: pointer;
			padding: 4px 8px;
		}

		.btn-small {
			font-size: 12px;
			padding: 6px 12px;
		}

		/* Search */
		.search-section {
			margin-bottom: 24px;
		}

		.search-box {
			display: flex;
			gap: 8px;
		}

		.search-input {
			flex: 1;
			padding: 10px 14px;
			border: 1px solid var(--border);
			font-family: inherit;
			font-size: 14px;
			background: var(--surface);
		}

		.search-results {
			margin-top: 16px;
			display: none;
		}

		.search-results.show {
			display: block;
		}

		.search-result-item {
			padding: 12px 16px;
			border: 1px solid var(--border);
			background: var(--surface);
			margin-bottom: 8px;
		}

		.search-result-meta {
			font-size: 12px;
			color: var(--text-secondary);
			margin-bottom: 4px;
			display: flex;
			gap: 12px;
		}

		.similarity-badge {
			font-family: 'IBM Plex Mono', monospace;
			font-size: 11px;
			color: var(--accent);
		}

		/* Stats */
		.stats {
			display: flex;
			gap: 1px;
			background: var(--border);
			margin-bottom: 32px;
		}

		.stat {
			flex: 1;
			background: var(--surface);
			padding: 20px 24px;
			cursor: pointer;
		}

		.stat.active {
			background: var(--text);
			color: var(--surface);
		}

		.stat.active .stat-label {
			color: rgba(255,255,255,0.7);
		}

		.stat-value {
			font-size: 28px;
			font-weight: 600;
			font-family: 'IBM Plex Mono', monospace;
			letter-spacing: -0.02em;
		}

		.stat-label {
			font-size: 12px;
			color: var(--text-secondary);
			text-transform: uppercase;
			letter-spacing: 0.05em;
			margin-top: 4px;
		}

		/* Table */
		.table-container {
			background: var(--surface);
			border: 1px solid var(--border);
		}

		.table-header {
			padding: 16px 20px;
			border-bottom: 1px solid var(--border);
			display: flex;
			justify-content: space-between;
			align-items: center;
		}

		.table-title {
			font-weight: 600;
			font-size: 14px;
		}

		table {
			width: 100%;
			border-collapse: collapse;
		}

		th {
			text-align: left;
			padding: 12px 20px;
			font-size: 11px;
			font-weight: 500;
			text-transform: uppercase;
			letter-spacing: 0.05em;
			color: var(--text-secondary);
			border-bottom: 1px solid var(--border);
		}

		td {
			padding: 16px 20px;
			border-bottom: 1px solid var(--border);
			vertical-align: middle;
		}

		.category-row:last-child td {
			border-bottom: none;
		}

		.category-cell {
			display: flex;
			align-items: center;
			gap: 12px;
		}

		.category-name {
			font-weight: 500;
		}

		.new-indicator {
			font-size: 11px;
			font-weight: 500;
			color: var(--accent);
			background: rgba(37, 99, 235, 0.1);
			padding: 2px 8px;
		}

		.count-cell {
			font-family: 'IBM Plex Mono', monospace;
		}

		.urgency-cell {
			font-family: 'IBM Plex Mono', monospace;
			font-weight: 500;
		}

		.urgency-cell.urgent { color: var(--urgent); }
		.urgency-cell.moderate { color: var(--moderate); }
		.urgency-cell.low { color: var(--low); }

		.sentiment-bar {
			display: flex;
			height: 6px;
			width: 100px;
			background: var(--bg);
		}

		.sentiment-bar .positive { background: var(--positive); }
		.sentiment-bar .neutral { background: var(--neutral); }
		.sentiment-bar .negative { background: var(--negative); }

		.sources-cell {
			font-size: 12px;
			color: var(--text-secondary);
		}

		.actions-cell {
			text-align: right;
		}

		.empty {
			text-align: center;
			padding: 64px 24px;
			color: var(--text-secondary);
		}

		.empty-title {
			font-size: 16px;
			font-weight: 500;
			color: var(--text);
			margin-bottom: 8px;
		}

		/* Modal */
		.modal-overlay {
			display: none;
			position: fixed;
			top: 0;
			left: 0;
			right: 0;
			bottom: 0;
			background: rgba(0, 0, 0, 0.4);
			z-index: 100;
		}

		.modal-overlay.open {
			display: flex;
			align-items: flex-start;
			justify-content: center;
			padding: 48px 24px;
			overflow-y: auto;
		}

		.modal {
			background: var(--surface);
			width: 100%;
			max-width: 700px;
			border: 1px solid var(--border);
		}

		.modal-header {
			padding: 20px 24px;
			border-bottom: 1px solid var(--border);
			display: flex;
			justify-content: space-between;
			align-items: center;
		}

		.modal-title {
			font-weight: 600;
			font-size: 16px;
		}

		.modal-close {
			background: none;
			border: none;
			font-size: 20px;
			cursor: pointer;
			color: var(--text-secondary);
			padding: 4px;
		}

		.modal-toolbar {
			padding: 12px 24px;
			border-bottom: 1px solid var(--border);
			display: flex;
			gap: 12px;
			align-items: center;
		}

		.modal-body {
			padding: 24px;
			max-height: 60vh;
			overflow-y: auto;
		}

		/* Feedback items */
		.feedback-item {
			padding: 16px;
			border: 1px solid var(--border);
			margin-bottom: 12px;
		}

		.feedback-item.escalated {
			border-left: 3px solid var(--urgent);
		}

		.feedback-item.resolved {
			opacity: 0.5;
		}

		.feedback-meta {
			display: flex;
			gap: 16px;
			font-size: 12px;
			color: var(--text-secondary);
			margin-bottom: 8px;
		}

		.feedback-text {
			margin-bottom: 12px;
			line-height: 1.7;
		}

		.feedback-notes {
			font-size: 13px;
			padding: 8px 12px;
			background: #fef9c3;
			margin-bottom: 12px;
		}

		.feedback-actions {
			display: flex;
			gap: 8px;
		}

		.status-tag {
			font-size: 11px;
			font-weight: 500;
			padding: 2px 8px;
			text-transform: uppercase;
			letter-spacing: 0.03em;
		}

		.status-new { background: rgba(37, 99, 235, 0.1); color: var(--accent); }
		.status-acknowledged { background: rgba(217, 119, 6, 0.1); color: var(--moderate); }
		.status-escalated { background: rgba(220, 38, 38, 0.1); color: var(--urgent); }
		.status-resolved { background: rgba(22, 197, 106, 0.1); color: var(--low); }

		.urgency-tag {
			font-size: 11px;
			font-family: 'IBM Plex Mono', monospace;
		}

		.urgency-tag.high { color: var(--urgent); }
		.urgency-tag.med { color: var(--moderate); }
		.urgency-tag.low { color: var(--low); }

		.escalate-form {
			display: flex;
			flex-direction: column;
			gap: 16px;
		}

		.form-group label {
			display: block;
			font-size: 12px;
			font-weight: 500;
			text-transform: uppercase;
			letter-spacing: 0.05em;
			color: var(--text-secondary);
			margin-bottom: 6px;
		}

		.form-group select,
		.form-group textarea {
			width: 100%;
			padding: 10px 12px;
			border: 1px solid var(--border);
			font-family: inherit;
			font-size: 14px;
			background: var(--surface);
		}

		.form-group textarea {
			resize: vertical;
			min-height: 80px;
		}

		.note-input {
			width: 100%;
			padding: 8px 12px;
			border: 1px solid var(--border);
			font-family: inherit;
			font-size: 13px;
			margin-top: 8px;
			display: none;
		}

		.status-msg {
			position: fixed;
			bottom: 24px;
			left: 50%;
			transform: translateX(-50%);
			padding: 12px 24px;
			background: var(--text);
			color: var(--surface);
			font-size: 13px;
			display: none;
			z-index: 200;
		}

		.status-msg.show { display: block; }
		.status-msg.error { background: var(--urgent); }
	</style>
</head>
<body>
	<div class="container">
		<header>
			<h1>Feedback Triager</h1>
			<div class="header-actions">
				<span style="font-size: 12px; color: var(--text-secondary);">
					${stats.total || 0} items across ${insights.length} categories
				</span>
				<button class="btn btn-primary" onclick="ingestFeedback()">Load Feedback</button>
			</div>
		</header>

		<div class="search-section">
			<div class="search-box">
				<input type="text" class="search-input" id="searchInput" placeholder="Search feedback semantically (e.g., 'performance issues', 'login problems')...">
				<button class="btn" onclick="performSearch()">Search</button>
				<button class="btn" onclick="clearSearch()">Clear</button>
			</div>
			<div class="search-results" id="searchResults"></div>
		</div>

		<div class="stats">
			<div class="stat ${filter === 'all' ? 'active' : ''}" onclick="setFilter('all')">
				<div class="stat-value">${stats.total || 0}</div>
				<div class="stat-label">Total</div>
			</div>
			<div class="stat ${filter === 'new' ? 'active' : ''}" onclick="setFilter('new')">
				<div class="stat-value">${stats.new_count || 0}</div>
				<div class="stat-label">New</div>
			</div>
			<div class="stat ${filter === 'escalated' ? 'active' : ''}" onclick="setFilter('escalated')">
				<div class="stat-value">${stats.escalated || 0}</div>
				<div class="stat-label">Escalated</div>
			</div>
			<div class="stat ${filter === 'resolved' ? 'active' : ''}" onclick="setFilter('resolved')">
				<div class="stat-value">${stats.resolved || 0}</div>
				<div class="stat-label">Resolved</div>
			</div>
		</div>

		${stats.total > 0 ? `
		<div class="table-container">
			<div class="table-header">
				<span class="table-title">Aggregated Insights by Category</span>
			</div>
			<table>
				<thead>
					<tr>
						<th>Category</th>
						<th>Count</th>
						<th>Avg Urgency</th>
						<th>Sentiment</th>
						<th>Sources</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					${insightRows}
				</tbody>
			</table>
		</div>
		` : `
		<div class="table-container">
			<div class="empty">
				<div class="empty-title">No feedback loaded</div>
				<p>Click "Load Feedback" to ingest data from Discord, GitHub, Twitter, Support tickets, and Forums</p>
			</div>
		</div>
		`}
	</div>

	<!-- Category Detail Modal -->
	<div class="modal-overlay" id="categoryModal">
		<div class="modal">
			<div class="modal-header">
				<span class="modal-title" id="modalTitle">Category</span>
				<button class="modal-close" onclick="closeModal()">&times;</button>
			</div>
			<div class="modal-toolbar">
				<select id="statusFilter" onchange="filterByStatus(this.value)">
					<option value="all">All items</option>
					<option value="new">New only</option>
					<option value="escalated">Escalated</option>
					<option value="resolved">Resolved</option>
				</select>
				<button class="btn btn-small" onclick="bulkResolve()">Resolve All</button>
			</div>
			<div class="modal-body" id="modalBody"></div>
		</div>
	</div>

	<!-- Escalation Modal -->
	<div class="modal-overlay" id="escalateModal">
		<div class="modal" style="max-width: 500px;">
			<div class="modal-header">
				<span class="modal-title">Escalate to Team</span>
				<button class="modal-close" onclick="closeEscalateModal()">&times;</button>
			</div>
			<div class="modal-body">
				<form class="escalate-form" onsubmit="submitEscalation(event)">
					<input type="hidden" id="escalateFeedbackId">
					<div class="form-group">
						<label>Assign to Team</label>
						<select id="escalateTeam" required>
							${teamsOptions}
						</select>
					</div>
					<div class="form-group">
						<label>Notes (optional)</label>
						<textarea id="escalateNotes" placeholder="Add context for the team..."></textarea>
					</div>
					<div style="display: flex; gap: 12px; justify-content: flex-end;">
						<button type="button" class="btn" onclick="closeEscalateModal()">Cancel</button>
						<button type="submit" class="btn btn-primary">Escalate</button>
					</div>
				</form>
			</div>
		</div>
	</div>

	<div class="status-msg" id="statusMsg"></div>

	<script>
		let currentCategory = '';
		let currentStatus = 'all';

		function showStatus(msg, isError = false) {
			const el = document.getElementById('statusMsg');
			el.textContent = msg;
			el.className = 'status-msg show' + (isError ? ' error' : '');
			setTimeout(() => el.className = 'status-msg', 3000);
		}

		function setFilter(status) {
			window.location.href = '/?status=' + status;
		}

		async function ingestFeedback() {
			showStatus('Loading feedback...');
			try {
				const res = await fetch('/ingest', { method: 'POST' });
				const data = await res.json();
				showStatus('Loaded ' + data.processed + ' items');
				setTimeout(() => location.reload(), 1000);
			} catch (e) {
				showStatus('Failed to load', true);
			}
		}

		async function performSearch() {
			const query = document.getElementById('searchInput').value.trim();
			if (!query) return;

			showStatus('Searching...');
			try {
				const res = await fetch('/search?q=' + encodeURIComponent(query));
				const data = await res.json();
				
				const resultsDiv = document.getElementById('searchResults');
				if (data.results.length === 0) {
					resultsDiv.innerHTML = '<p style="color: var(--text-secondary); padding: 16px 0;">' + (data.message || 'No matching feedback found') + '</p>';
				} else {
					let html = '<p style="font-size: 12px; color: var(--text-secondary); margin-bottom: 12px;">' + data.results.length + ' matching results</p>';
					for (const item of data.results) {
						const urgencyClass = item.urgency_score >= 7 ? 'high' : item.urgency_score >= 4 ? 'med' : 'low';
						html += \`
							<div class="search-result-item">
								<div class="search-result-meta">
									<span>\${item.source}</span>
									<span>\${item.category}</span>
									<span class="urgency-tag \${urgencyClass}">Urgency: \${item.urgency_score}/10</span>
									<span class="similarity-badge">\${item.similarity}% match</span>
								</div>
								<div style="margin-top: 8px;">\${escapeHtml(item.raw_text)}</div>
							</div>
						\`;
					}
					resultsDiv.innerHTML = html;
				}
				resultsDiv.classList.add('show');
				showStatus('Search complete');
			} catch (e) {
				showStatus('Search failed', true);
			}
		}

		function clearSearch() {
			document.getElementById('searchInput').value = '';
			document.getElementById('searchResults').classList.remove('show');
		}

		document.getElementById('searchInput').addEventListener('keypress', e => {
			if (e.key === 'Enter') performSearch();
		});

		async function viewCategory(category) {
			currentCategory = category;
			currentStatus = 'all';
			document.getElementById('modalTitle').textContent = category;
			document.getElementById('statusFilter').value = 'all';
			document.getElementById('categoryModal').classList.add('open');
			await loadCategoryItems();
		}

		async function loadCategoryItems() {
			document.getElementById('modalBody').innerHTML = '<p style="color: var(--text-secondary); text-align: center;">Loading...</p>';
			
			try {
				const url = '/api/category/' + encodeURIComponent(currentCategory) + '?status=' + currentStatus;
				const res = await fetch(url);
				const data = await res.json();
				
				if (!data.items.length) {
					document.getElementById('modalBody').innerHTML = '<p style="color: var(--text-secondary); text-align: center;">No items found</p>';
					return;
				}

				let html = '';
				for (const item of data.items) {
					const urgencyClass = item.urgency_score >= 7 ? 'high' : item.urgency_score >= 4 ? 'med' : 'low';
					const itemClass = item.status === 'resolved' ? 'resolved' : item.status === 'escalated' ? 'escalated' : '';
					
					html += \`
						<div class="feedback-item \${itemClass}" id="item-\${item.id}">
							<div class="feedback-meta">
								<span>\${item.source}</span>
								<span>\${item.author}</span>
								<span class="urgency-tag \${urgencyClass}">Urgency: \${item.urgency_score}/10</span>
								<span class="status-tag status-\${item.status}">\${item.status}</span>
							</div>
							<div class="feedback-text">\${escapeHtml(item.raw_text)}</div>
							\${item.notes ? \`<div class="feedback-notes">\${escapeHtml(item.notes)}</div>\` : ''}
							<div class="feedback-actions">
								\${item.status === 'new' ? \`
									<button class="btn btn-small" onclick="takeAction(\${item.id}, 'acknowledge')">Acknowledge</button>
									<button class="btn btn-small" onclick="openEscalateModal(\${item.id})">Escalate to Team</button>
								\` : ''}
								\${item.status !== 'resolved' ? \`
									<button class="btn btn-small" onclick="takeAction(\${item.id}, 'resolve')">Resolve</button>
								\` : \`
									<button class="btn btn-small" onclick="takeAction(\${item.id}, 'reopen')">Reopen</button>
								\`}
								<button class="btn btn-small" onclick="toggleNote(\${item.id})">Add Note</button>
							</div>
							<input type="text" class="note-input" id="note-\${item.id}" placeholder="Add a note and press Enter" onkeypress="if(event.key==='Enter')saveNote(\${item.id})">
						</div>
					\`;
				}
				document.getElementById('modalBody').innerHTML = html;
			} catch (e) {
				document.getElementById('modalBody').innerHTML = '<p style="color: var(--urgent);">Error loading data</p>';
			}
		}

		function filterByStatus(status) {
			currentStatus = status;
			loadCategoryItems();
		}

		async function takeAction(id, action) {
			try {
				await fetch('/action/' + id, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ action })
				});
				showStatus('Done');
				loadCategoryItems();
			} catch (e) {
				showStatus('Failed', true);
			}
		}

		function toggleNote(id) {
			const input = document.getElementById('note-' + id);
			input.style.display = input.style.display === 'none' ? 'block' : 'none';
			if (input.style.display === 'block') input.focus();
		}

		async function saveNote(id) {
			const input = document.getElementById('note-' + id);
			const notes = input.value.trim();
			if (!notes) return;
			
			try {
				await fetch('/action/' + id, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ action: 'add_note', notes })
				});
				showStatus('Note saved');
				loadCategoryItems();
			} catch (e) {
				showStatus('Failed', true);
			}
		}

		async function bulkAcknowledge(category) {
			try {
				await fetch('/bulk', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ action: 'acknowledge', category })
				});
				showStatus('All acknowledged');
				setTimeout(() => location.reload(), 1000);
			} catch (e) {
				showStatus('Failed', true);
			}
		}

		async function bulkResolve() {
			try {
				await fetch('/bulk', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ action: 'resolve', category: currentCategory })
				});
				showStatus('All resolved');
				loadCategoryItems();
			} catch (e) {
				showStatus('Failed', true);
			}
		}

		function openEscalateModal(feedbackId) {
			document.getElementById('escalateFeedbackId').value = feedbackId;
			document.getElementById('escalateNotes').value = '';
			document.getElementById('escalateModal').classList.add('open');
		}

		function closeEscalateModal() {
			document.getElementById('escalateModal').classList.remove('open');
		}

		async function submitEscalation(event) {
			event.preventDefault();
			const feedbackId = document.getElementById('escalateFeedbackId').value;
			const team = document.getElementById('escalateTeam').value;
			const notes = document.getElementById('escalateNotes').value;

			try {
				await fetch('/escalate/' + feedbackId, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ team, notes })
				});
				showStatus('Escalated');
				closeEscalateModal();
				loadCategoryItems();
			} catch (e) {
				showStatus('Failed', true);
			}
		}

		function closeModal() {
			document.getElementById('categoryModal').classList.remove('open');
			location.reload();
		}

		function escapeHtml(str) {
			const div = document.createElement('div');
			div.textContent = str;
			return div.innerHTML;
		}

		document.addEventListener('keydown', e => {
			if (e.key === 'Escape') {
				closeModal();
				closeEscalateModal();
			}
		});
	</script>
</body>
</html>`;

			return new Response(html, {
				headers: { 'Content-Type': 'text/html; charset=utf-8' },
			});
		}

		return new Response('Not Found', { status: 404 });
	},
} satisfies ExportedHandler<Env>;
