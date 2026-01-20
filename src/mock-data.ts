/**
 * Mock feedback data simulating real sources
 * In production, this would be replaced with actual API integrations
 */

export type MockFeedbackItem = {
	source: 'discord' | 'github' | 'twitter' | 'support' | 'forum';
	id: string;
	author: string;
	text: string;
	timestamp?: string;
};

// Discord - casual, community feedback
const discordFeedback: MockFeedbackItem[] = [
	{ source: 'discord', id: 'd001', author: 'user123', text: 'App keeps crashing when I try to upload photos. Happens every time now.' },
	{ source: 'discord', id: 'd002', author: 'gamer42', text: 'Dark mode is great, finally I can use this at night' },
	{ source: 'discord', id: 'd003', author: 'newbie', text: 'How do I export my project? Cant find the button anywhere' },
	{ source: 'discord', id: 'd004', author: 'poweruser', text: 'The upload feature has been broken for 3 days now. Anyone else?' },
	{ source: 'discord', id: 'd005', author: 'artist', text: 'Upload keeps failing with large files. 50MB limit is too low' },
	{ source: 'discord', id: 'd006', author: 'dev_mike', text: 'API rate limits are way too aggressive. Getting 429s constantly' },
	{ source: 'discord', id: 'd007', author: 'casual_user', text: 'Love the new dashboard redesign!' },
];

// GitHub - technical issues and feature requests
const githubFeedback: MockFeedbackItem[] = [
	{ source: 'github', id: 'g001', author: 'dev-jane', text: 'TypeError in ImageUpload component when handling PNG files larger than 10MB. Stack trace attached.' },
	{ source: 'github', id: 'g002', author: 'security-bob', text: 'XSS vulnerability in profile page via unsanitized user bio field. Needs immediate patching.' },
	{ source: 'github', id: 'g003', author: 'a11y-expert', text: 'Missing ARIA labels on main navigation. Screen readers cannot parse the menu structure.' },
	{ source: 'github', id: 'g004', author: 'mobile-dev', text: 'iOS app crashes on launch for users on iOS 15.x. Crash logs show memory allocation failure.' },
	{ source: 'github', id: 'g005', author: 'contributor', text: 'Feature request: Add webhook support for real-time notifications' },
	{ source: 'github', id: 'g006', author: 'enterprise-user', text: 'SSO integration broken after latest update. All our users locked out.' },
];

// Twitter - public sentiment, often emotional
const twitterFeedback: MockFeedbackItem[] = [
	{ source: 'twitter', id: 't001', author: '@techfan', text: 'This app is painfully slow. Takes 10 seconds to load a simple page.' },
	{ source: 'twitter', id: 't002', author: '@happyuser', text: 'Best update yet! The new features are exactly what I needed' },
	{ source: 'twitter', id: 't003', author: '@frustrated', text: 'Lost all my work when the app crashed. No autosave? Its 2024!' },
	{ source: 'twitter', id: 't004', author: '@devlife', text: 'Memory usage is insane. 2GB RAM for a simple text editor?' },
	{ source: 'twitter', id: 't005', author: '@designer', text: 'The UI feels dated. Competitors have moved way ahead.' },
	{ source: 'twitter', id: 't006', author: '@startup_ceo', text: 'Our whole team relies on this tool. Please fix the sync issues!' },
];

// Support tickets - formal, often urgent
const supportFeedback: MockFeedbackItem[] = [
	{ source: 'support', id: 's001', author: 'enterprise_corp', text: '50 users unable to access platform. Dashboard shows subscription active but getting access denied. This is blocking our entire team.' },
	{ source: 'support', id: 's002', author: 'small_business', text: 'Export functionality not working. Need to download our data for compliance audit due Friday.' },
	{ source: 'support', id: 's003', author: 'new_customer', text: 'Pricing page is confusing. What exactly is included in the Pro plan? Limits are unclear.' },
	{ source: 'support', id: 's004', author: 'agency_client', text: 'Billing charged twice this month. Need immediate refund and explanation.' },
	{ source: 'support', id: 's005', author: 'edu_institution', text: 'Cannot add more than 100 users to our organization. Is this a bug or a limit?' },
];

// Forum - detailed, often feature discussions
const forumFeedback: MockFeedbackItem[] = [
	{ source: 'forum', id: 'f001', author: 'veteran_user', text: 'Been using this for 2 years. The one feature thats always missing is proper mobile sync. Desktop changes dont appear on mobile for hours.' },
	{ source: 'forum', id: 'f002', author: 'newcomer', text: 'Onboarding is overwhelming. First screen has 15 options. Needs a guided tour for new users.' },
	{ source: 'forum', id: 'f003', author: 'developer', text: 'Would love to see a plugin API. Could build custom integrations for our workflow.' },
	{ source: 'forum', id: 'f004', author: 'power_user', text: 'Keyboard shortcuts are inconsistent. Ctrl+S saves in editor but not in settings.' },
	{ source: 'forum', id: 'f005', author: 'team_lead', text: 'Need better permission controls. Currently its all-or-nothing for team members.' },
];

export const MOCK_FEEDBACK: MockFeedbackItem[] = [
	...discordFeedback,
	...githubFeedback,
	...twitterFeedback,
	...supportFeedback,
	...forumFeedback,
];

// Teams that can receive escalations
export const TEAMS = [
	{ id: 'engineering', name: 'Engineering', slackChannel: '#eng-escalations' },
	{ id: 'security', name: 'Security', slackChannel: '#security-alerts' },
	{ id: 'support', name: 'Customer Support', slackChannel: '#support-escalations' },
	{ id: 'product', name: 'Product', slackChannel: '#product-feedback' },
	{ id: 'billing', name: 'Billing', slackChannel: '#billing-issues' },
] as const;

export type TeamId = typeof TEAMS[number]['id'];

