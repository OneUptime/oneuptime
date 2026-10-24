/*
 * AI CONTEXT: WHAT A PROJECT TELLS ONEUPTIME AI ABOUT ITS OWN SYSTEMS
 * (issue #5198) - the one reading, for the server's runs, the Dashboard's
 * settings card and rule form, and the docs tests alike.
 *
 * OneUptime AI knows OneUptime's data - monitors, telemetry, linked hosts,
 * recent changes, past incidents - but nothing of the architecture behind
 * it: which service owns which symptom, which containers depend on which
 * database, that "page X failing" usually means "VM Y is overloaded". Teams
 * have that written down for their own people. The AI context is where they
 * write it for OneUptime AI:
 *
 *   - the project's own, set by a Project Owner or Project Admin in Project
 *     Settings → AI → AI Features (Project.aiContext), read by everything
 *     OneUptime AI does for the team: investigations, fixes, postmortem
 *     drafts, security case triage and Ask AI;
 *   - an AI rule's, under its More fields (AutoRemediationRule.aiContext),
 *     read after the project's by the work the rule starts: the
 *     investigation of an incident or alert it matches, and its fix.
 *
 * A run reads it as reference material at the very start of its system
 * prompt (Server/Utils/AI/AiContext/AiContextPrompt) - inside the prefix
 * every provider caches - and records exactly what it read in its activity
 * (AiContextActivity), so people can see what OneUptime AI was given.
 *
 * It is held to a size (the limits below), and the Dashboard shows a token
 * estimate as it is written (estimateAiContextTokens).
 *
 * Shared by the server and the Dashboard, so it imports nothing.
 */

// The column that holds a project's (and an AI rule's) AI context.
export type AiContextColumn = "aiContext";

export const AI_CONTEXT_COLUMN: AiContextColumn = "aiContext";

// The most a project's AI context may hold, in characters.
export const PROJECT_AI_CONTEXT_MAX_CHARACTERS: number = 20_000;

/*
 * The most an AI rule's AI context may hold: notes about the incidents (or
 * alerts) one rule matches, added to the project's.
 */
export const AI_RULE_AI_CONTEXT_MAX_CHARACTERS: number = 5_000;

/*
 * The most one run reads, the project's AI context and its rules' together:
 * the project's in full, then each rule's that still fits, in the order
 * below. A run whose incident matches more rules than that leaves the rest
 * out, whole, and says which (AiContextActivity.leftOutRuleNames) - a cut
 * in the middle of someone's notes would read as something they never
 * wrote.
 */
export const AI_CONTEXT_RUN_MAX_CHARACTERS: number = 30_000;

/*
 * The token estimate: one token for every four bytes of the text as UTF-8.
 * Four letters of English make a token on every provider's tokenizer, give
 * or take; a letter of Cyrillic, Greek or Arabic takes two bytes and comes
 * to about half a token, and a Chinese, Japanese or Korean character takes
 * three and comes to about one. Counting characters instead would put a
 * Japanese team's context at a quarter of what it costs.
 */
export const AI_CONTEXT_BYTES_PER_TOKEN: number = 4;

// Who an AI context belongs to: what a size problem is worded for.
export enum AiContextOwner {
  Project = "Project",
  AiRule = "AiRule",
}

// Where a part of what a run read came from.
export enum AiContextSource {
  // The project's own AI context (Project.aiContext).
  Project = "Project",
  // An AI rule's (AutoRemediationRule.aiContext).
  AiRule = "AiRule",
}

// One part of what a run read, as it read it.
export interface AiContextPart {
  source: AiContextSource;
  // A rule's part: which rule, by id and by its name when the run read it.
  ruleId?: string | undefined;
  ruleName?: string | undefined;
  // The text the run was given, exactly.
  text: string;
}

/*
 * What a run read: recorded on its activity (a ProgressLog event's
 * resultSummary.aiContext) when it read any, and drawn there as a line that
 * opens to show the text.
 */
export interface AiContextActivity {
  // In the order the run read them: the project's first, then its rules'.
  parts: Array<AiContextPart>;
  // Every part together, in characters (countAiContextCharacters).
  characterCount: number;
  // Every part together, as the token estimate counts it.
  estimatedTokenCount: number;
  /*
   * The rules whose AI context matched but did not fit in what one run
   * reads (AI_CONTEXT_RUN_MAX_CHARACTERS), by name, in the order they
   * would have been read.
   */
  leftOutRuleNames?: Array<string> | undefined;
}

// An AI rule as the composition reads it.
export interface AiContextRule {
  id?: string | undefined;
  name?: string | undefined;
  aiContext?: unknown;
}

/*
 * A stored AI context as text a run can read: trimmed, and "" for anything
 * that is not a string (a column that was not read, null, a value of the
 * wrong type).
 */
export function readAiContext(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/*
 * How many characters the text holds, as a person counts them: code
 * points, so an emoji or a character outside the Basic Multilingual Plane
 * is one, as it is on screen. The limits above count the same way, in the
 * browser and on the server alike.
 */
export function countAiContextCharacters(text: string): number {
  let count: number = 0;

  for (let index: number = 0; index < text.length; index++) {
    const code: number = text.charCodeAt(index);

    // A high surrogate followed by a low one is one character.
    if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      const next: number = text.charCodeAt(index + 1);

      if (next >= 0xdc00 && next <= 0xdfff) {
        index++;
      }
    }

    count++;
  }

  return count;
}

// How many bytes the text takes as UTF-8, counted without an encoder.
export function countAiContextUtf8Bytes(text: string): number {
  let bytes: number = 0;

  for (let index: number = 0; index < text.length; index++) {
    const code: number = text.charCodeAt(index);

    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      const next: number = text.charCodeAt(index + 1);

      // A surrogate pair is one character of four bytes.
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index++;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }

  return bytes;
}

/*
 * About how many tokens the text costs a model to read: see
 * AI_CONTEXT_BYTES_PER_TOKEN. An estimate - each provider's tokenizer
 * counts its own way - but close enough to tell a few hundred tokens from
 * several thousand. Empty text costs nothing.
 */
export function estimateAiContextTokens(text: string): number {
  const bytes: number = countAiContextUtf8Bytes(text.trim());

  if (bytes === 0) {
    return 0;
  }

  return Math.ceil(bytes / AI_CONTEXT_BYTES_PER_TOKEN);
}

// The most an AI context of this owner may hold.
export function getAiContextMaxCharacters(owner: AiContextOwner): number {
  return owner === AiContextOwner.AiRule
    ? AI_RULE_AI_CONTEXT_MAX_CHARACTERS
    : PROJECT_AI_CONTEXT_MAX_CHARACTERS;
}

// 20000 as "20,000": the limits are named the same way everywhere.
export function formatAiContextCount(count: number): string {
  return Math.max(0, Math.round(count)).toLocaleString("en-US");
}

/*
 * Why an AI context cannot be saved, or null when it can: it is text (or
 * nothing - empty clears it), and it holds no more than its owner's limit,
 * counted as the person sees it, without the white space at its ends.
 * Worded for the API and the form alike.
 */
export function getAiContextProblem(data: {
  value: unknown;
  owner: AiContextOwner;
}): string | null {
  if (data.value === undefined || data.value === null) {
    return null;
  }

  if (typeof data.value !== "string") {
    return "The AI context must be text.";
  }

  const maxCharacters: number = getAiContextMaxCharacters(data.owner);
  const characters: number = countAiContextCharacters(data.value.trim());

  if (characters <= maxCharacters) {
    return null;
  }

  const whose: string =
    data.owner === AiContextOwner.AiRule
      ? "An AI rule's AI context"
      : "The project's AI context";

  return `${whose} can hold at most ${formatAiContextCount(maxCharacters)} characters. This one has ${formatAiContextCount(characters)}.`;
}

/*
 * The text, held to a number of characters: a stored value past its limit
 * - one written before the limit, or around the API - is read only up to
 * it, never more.
 */
export function holdAiContextTo(text: string, maxCharacters: number): string {
  if (countAiContextCharacters(text) <= maxCharacters) {
    return text;
  }

  let count: number = 0;
  let end: number = 0;

  while (end < text.length && count < maxCharacters) {
    const code: number = text.charCodeAt(end);

    if (code >= 0xd800 && code <= 0xdbff && end + 1 < text.length) {
      const next: number = text.charCodeAt(end + 1);
      end += next >= 0xdc00 && next <= 0xdfff ? 2 : 1;
    } else {
      end += 1;
    }

    count++;
  }

  return text.substring(0, end).trim();
}

// Rules in the order a run reads them: by name, then by id, as typed.
function compareRules(a: AiContextRule, b: AiContextRule): number {
  const nameA: string = (a.name || "").toLowerCase();
  const nameB: string = (b.name || "").toLowerCase();

  if (nameA !== nameB) {
    return nameA < nameB ? -1 : 1;
  }

  const idA: string = (a.id || "").toLowerCase();
  const idB: string = (b.id || "").toLowerCase();

  if (idA === idB) {
    return 0;
  }

  return idA < idB ? -1 : 1;
}

/*
 * WHAT A RUN READS: the project's AI context, then the AI context of each
 * of the given rules - by name, the order every rule decision reads them in
 * (Types/AI/LlmProviderChoice) - that still fits in
 * AI_CONTEXT_RUN_MAX_CHARACTERS. A rule named twice is read once, and a
 * rule with no AI context adds nothing. Each part is held to its own limit
 * first. Null when there is nothing to read: a run with no AI context
 * reads, and records, nothing more than it always did.
 */
export function composeAiContext(data: {
  projectContext: unknown;
  rules?: ReadonlyArray<AiContextRule> | undefined;
}): AiContextActivity | null {
  const parts: Array<AiContextPart> = [];
  const leftOutRuleNames: Array<string> = [];
  let characterCount: number = 0;

  const projectText: string = holdAiContextTo(
    readAiContext(data.projectContext),
    PROJECT_AI_CONTEXT_MAX_CHARACTERS,
  );

  if (projectText) {
    parts.push({ source: AiContextSource.Project, text: projectText });
    characterCount += countAiContextCharacters(projectText);
  }

  const seenRuleIds: Set<string> = new Set<string>();
  const rules: Array<AiContextRule> = [...(data.rules || [])].sort(
    compareRules,
  );

  for (const rule of rules) {
    const ruleId: string = (rule.id || "").toLowerCase();

    if (ruleId && seenRuleIds.has(ruleId)) {
      continue;
    }

    if (ruleId) {
      seenRuleIds.add(ruleId);
    }

    const ruleText: string = holdAiContextTo(
      readAiContext(rule.aiContext),
      AI_RULE_AI_CONTEXT_MAX_CHARACTERS,
    );

    if (!ruleText) {
      continue;
    }

    const ruleCharacters: number = countAiContextCharacters(ruleText);

    if (characterCount + ruleCharacters > AI_CONTEXT_RUN_MAX_CHARACTERS) {
      leftOutRuleNames.push(rule.name || "");
      continue;
    }

    parts.push({
      source: AiContextSource.AiRule,
      ...(rule.id ? { ruleId: rule.id } : {}),
      ruleName: rule.name || "",
      text: ruleText,
    });
    characterCount += ruleCharacters;
  }

  if (parts.length === 0) {
    return null;
  }

  return {
    parts,
    characterCount,
    estimatedTokenCount: parts.reduce(
      (total: number, part: AiContextPart): number => {
        return total + estimateAiContextTokens(part.text);
      },
      0,
    ),
    ...(leftOutRuleNames.length > 0 ? { leftOutRuleNames } : {}),
  };
}

// The rules' parts of what a run read.
export function getAiContextRuleParts(
  activity: AiContextActivity,
): Array<AiContextPart> {
  return activity.parts.filter((part: AiContextPart): boolean => {
    return part.source === AiContextSource.AiRule;
  });
}

// Whether the run read the project's own AI context.
export function hasProjectAiContext(activity: AiContextActivity): boolean {
  return activity.parts.some((part: AiContextPart): boolean => {
    return part.source === AiContextSource.Project;
  });
}

/*
 * Whether a value from an event is an AiContextActivity the activity can
 * draw: the server writes it, but a row is read back as JSON, so it is
 * checked before anything reads its parts.
 */
export function isAiContextActivity(
  value: unknown,
): value is AiContextActivity {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const parts: unknown = (value as { parts?: unknown }).parts;

  if (!Array.isArray(parts) || parts.length === 0) {
    return false;
  }

  return parts.every((part: unknown): boolean => {
    if (!part || typeof part !== "object") {
      return false;
    }

    const typed: { source?: unknown; text?: unknown } = part as {
      source?: unknown;
      text?: unknown;
    };

    return (
      (typed.source === AiContextSource.Project ||
        typed.source === AiContextSource.AiRule) &&
      typeof typed.text === "string"
    );
  });
}

// "rule Checkout", "rules Checkout and Payments", "rules A, B and C".
function describeRuleNamesInEnglish(names: Array<string>): string {
  const quoted: Array<string> = names.map((name: string): string => {
    return name ? `"${name}"` : "(unnamed)";
  });

  const list: string =
    quoted.length <= 1
      ? quoted.join("")
      : `${quoted.slice(0, -1).join(", ")} and ${quoted[quoted.length - 1]}`;

  return `${names.length === 1 ? "AI rule" : "AI rules"} ${list}`;
}

/*
 * What a run read, as one line of English: the event's `message`, read by
 * whatever does not draw the structured activity (logs, older clients).
 * The Dashboard words it in the reader's language from the data.
 */
export function describeAiContextActivityInEnglish(
  activity: AiContextActivity,
): string {
  const ruleNames: Array<string> = getAiContextRuleParts(activity).map(
    (part: AiContextPart): string => {
      return part.ruleName || "";
    },
  );

  const what: string = hasProjectAiContext(activity)
    ? ruleNames.length > 0
      ? `the project's AI context and the AI context of ${describeRuleNamesInEnglish(ruleNames)}`
      : "the project's AI context"
    : `the AI context of ${describeRuleNamesInEnglish(ruleNames)}`;

  const tokens: string = `about ${formatAiContextCount(activity.estimatedTokenCount)} ${
    activity.estimatedTokenCount === 1 ? "token" : "tokens"
  }`;

  const leftOut: Array<string> = activity.leftOutRuleNames || [];

  const leftOutSentence: string =
    leftOut.length > 0
      ? ` Left out the AI context of ${describeRuleNamesInEnglish(leftOut)}: a run reads at most ${formatAiContextCount(AI_CONTEXT_RUN_MAX_CHARACTERS)} characters of AI context.`
      : "";

  return `Read ${what} (${tokens}).${leftOutSentence}`;
}
