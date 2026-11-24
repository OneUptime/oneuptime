import { translationKey } from "Common/UI/Utils/TranslateTemplate";

export * from "Common/Utils/SecurityCase/ResponsePlan/ResponsePlanWords";
export * from "Common/Utils/SecurityCase/ResponsePlan/StepCheckWords";

// ---------- Blocking an address from the plan (#10342) ----------

// The menu beside Block for 24 Hours, and its choices.
export const BLOCK_MORE_LABEL: string = translationKey(
  "More ways to block {{value}}",
);
export const BLOCK_CHALLENGE_INSTEAD: string =
  translationKey("Challenge Instead");
export const BLOCK_CHALLENGE_TOOLTIP: string = translationKey(
  "People pass a challenge, scripts and API clients do not.",
);
export const BLOCK_FOR_SEVEN_DAYS: string = translationKey("Block for 7 Days");
export const BLOCK_UNTIL_LIFTED: string = translationKey("Block Until Lifted");

// Block... on one of the case's addresses: the menu's entry and its dialog.
export const BLOCK_FROM_CASE_MENU_ITEM: string = translationKey("Block…");
export const BLOCK_FROM_CASE_TITLE: string = translationKey("Block {{value}}");
export const BLOCK_FROM_CASE_DESCRIPTION: string = translationKey(
  "Blocks the address at every destination that enforces your blocklist, through the case: as your playbooks' blocks are, approval included.",
);
export const ENTITY_ACTIONS_LABEL: string = translationKey(
  "Actions for {{value}}",
);

// What a block from the plan says once it is asked for.
export const BLOCK_STARTED_TOAST: string = translationKey(
  "Blocking {{value}}.",
);
export const BLOCK_ASKED_TOAST: string = translationKey(
  "{{value}} is blocked once someone else approves it on the case's Playbooks page.",
);

/*
 * The block that holds the step's address: where it is enforced, since
 * when, by whom, and until when - "Blocked at Cloudflare 10:42 by Jane
 * Doe, until 22 Nov 10:42."
 */
export const BLOCK_LINE_BLOCKED_BY: string = translationKey(
  "Blocked at {{destinations}} {{time}} by {{name}}, until {{until}}.",
);
export const BLOCK_LINE_BLOCKED: string = translationKey(
  "Blocked at {{destinations}} {{time}}, until {{until}}.",
);
export const BLOCK_LINE_BLOCKED_BY_UNTIL_LIFTED: string = translationKey(
  "Blocked at {{destinations}} {{time}} by {{name}}, until someone lifts it.",
);
export const BLOCK_LINE_BLOCKED_UNTIL_LIFTED: string = translationKey(
  "Blocked at {{destinations}} {{time}}, until someone lifts it.",
);
export const BLOCK_LINE_CHALLENGED_BY: string = translationKey(
  "Challenged at {{destinations}} {{time}} by {{name}}, until {{until}}.",
);
export const BLOCK_LINE_CHALLENGED: string = translationKey(
  "Challenged at {{destinations}} {{time}}, until {{until}}.",
);
export const BLOCK_LINE_CHALLENGED_BY_UNTIL_LIFTED: string = translationKey(
  "Challenged at {{destinations}} {{time}} by {{name}}, until someone lifts it.",
);
export const BLOCK_LINE_CHALLENGED_UNTIL_LIFTED: string = translationKey(
  "Challenged at {{destinations}} {{time}}, until someone lifts it.",
);
/*
 * A block an automatic response policy made (#10350): "Challenged at
 * Cloudflare 10:42 by the Scanners policy, 41s after its first request,
 * until 11:42."
 */
export const BLOCK_LINE_CHALLENGED_BY_POLICY_AFTER: string = translationKey(
  "Challenged at {{destinations}} {{time}} by the {{policy}} policy, {{after}} after its first request, until {{until}}.",
);
export const BLOCK_LINE_BLOCKED_BY_POLICY_AFTER: string = translationKey(
  "Blocked at {{destinations}} {{time}} by the {{policy}} policy, {{after}} after its first request, until {{until}}.",
);
export const BLOCK_LINE_CHALLENGED_BY_POLICY: string = translationKey(
  "Challenged at {{destinations}} {{time}} by the {{policy}} policy, until {{until}}.",
);
export const BLOCK_LINE_BLOCKED_BY_POLICY: string = translationKey(
  "Blocked at {{destinations}} {{time}} by the {{policy}} policy, until {{until}}.",
);
// A block a destination is still applying: not done yet.
export const BLOCK_LINE_PENDING: string = translationKey(
  "Asked {{time}}: waiting for {{destinations}} to apply the block.",
);
// A block nothing holds: never read as the address blocked.
export const BLOCK_LINE_NOT_ENFORCED: string = translationKey(
  "On your Blocklist since {{time}}, but no destination enforces it, so the address is not blocked anywhere.",
);
export const LIFT_BLOCK_LABEL: string = translationKey(
  "Lift the block on {{value}}",
);
export const LIFTED_FROM_PLAN_REASON: string = translationKey(
  "Lifted from the case's Response Plan.",
);

// Nothing enforces the blocklist: how to let OneUptime block it, and how to block it by hand.
export const BLOCK_HELP_CONNECT: string = translationKey(
  "Block it from here: connect {{cloudflare}}, {{awsWaf}} or {{firewall}}.",
);
export const BLOCK_HELP_FIREWALL: string = translationKey("your firewall");
export const BLOCK_HELP_SHOW: string = translationKey("How to Block It");
export const BLOCK_HELP_HIDE: string = translationKey("Hide How to Block It");
export const BLOCK_HELP_CLOUDFLARE: string = translationKey(
  "In the Cloudflare dashboard, add an IP Access Rule that blocks {{address}}, under Security > WAF > Tools.",
);
export const BLOCK_HELP_AWS_WAF: string = translationKey(
  "With the AWS CLI, add it to an IP set your web ACL blocks. update-ip-set replaces the set's addresses, so list the ones it holds (get-ip-set) beside it:",
);
export const BLOCK_HELP_NGINX: string = translationKey(
  "In nginx, in the server block that serves your app:",
);
export const BLOCK_HELP_NFTABLES: string = translationKey(
  "With nftables, into a set your rules drop:",
);

/*
 * The words of a case's Response Plan: what to do about the case now -
 * confirm it, contain it, fix what let it happen, close it (#9557). The
 * words are shared with every reader of the plan - the server, OneUptime AI,
 * the mobile app - and kept beside it (Common/Utils/SecurityCase/
 * ResponsePlan/ResponsePlanWords, #10340), each an en.json key looked up
 * where it is drawn. The card's test ids are its own.
 */

export const SECURITY_CASE_RESPONSE_TEST_IDS: {
  card: string;
  progress: string;
  phase: string;
  step: string;
  stepText: string;
  checkbox: string;
  byHand: string;
  action: string;
  doneLine: string;
  readyToContain: string;
  aiVerdict: string;
  aiToggle: string;
  falsePositives: string;
  error: string;
  checkChip: string;
  checkLine: string;
  howWeKnow: string;
  howWeKnowPanel: string;
  checkFacts: string;
  checkLink: string;
  docsLink: string;
  confirm: string;
  regressed: string;
  checksNotRead: string;
  block: string;
  blockMore: string;
  blockLine: string;
  lift: string;
  blockHelp: string;
  blockHelpToggle: string;
  blockHelpPanel: string;
} = {
  card: "security-case-response-plan",
  progress: "security-case-response-progress",
  phase: "security-case-response-phase",
  step: "security-case-response-step",
  stepText: "security-case-response-step-text",
  checkbox: "security-case-response-step-done",
  byHand: "security-case-response-step-by-hand",
  action: "security-case-response-step-action",
  doneLine: "security-case-response-step-done-line",
  readyToContain: "security-case-response-ready-to-contain",
  aiVerdict: "security-case-response-ai-verdict",
  aiToggle: "security-case-response-ai-toggle",
  falsePositives: "security-case-response-false-positives",
  error: "security-case-response-error",
  checkChip: "security-case-response-step-check",
  checkLine: "security-case-response-step-check-line",
  howWeKnow: "security-case-response-step-how-we-know",
  howWeKnowPanel: "security-case-response-step-how-we-know-panel",
  checkFacts: "security-case-response-step-check-facts",
  checkLink: "security-case-response-step-check-link",
  docsLink: "security-case-response-step-check-docs",
  confirm: "security-case-response-step-confirm",
  regressed: "security-case-response-regressed",
  checksNotRead: "security-case-response-checks-not-read",
  block: "security-case-response-step-block",
  blockMore: "security-case-response-step-block-more",
  blockLine: "security-case-response-step-block-line",
  lift: "security-case-response-step-lift",
  blockHelp: "security-case-response-step-block-help",
  blockHelpToggle: "security-case-response-step-block-help-toggle",
  blockHelpPanel: "security-case-response-step-block-help-panel",
};
