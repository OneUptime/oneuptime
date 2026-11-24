import {
  LLM_USAGE_HIDDEN_GROUP_KEY,
  isLlmUsageHiddenGroup,
} from "../../Types/Telemetry/LlmUsageApi";
import { isScrubPlaceholder } from "../../Types/Telemetry/ScrubRule";

/*
 * WHO MADE AN AI CALL, AND WHICH TEAM IT IS CHARGED TO, PAST WHAT A SCRUB
 * RULE LEFT OF THEM (#10435, #10631).
 *
 * A call names its person by an email and an id (emitters send one or the
 * other) and its team by a name, each stored after the project's scrub
 * rules: what is stored may be what a rule left - Redact's "[REDACTED]", a
 * mask's stars, a Hash rule's token, whole or inside the value - and none
 * of those is anybody. Every view reads a call's person the same way, so
 * the Usage tab, Conversations and Calls always agree:
 *
 *   - its email, when no rule touched it;
 *   - else its id, when no rule touched it;
 *   - else LLM_USAGE_HIDDEN_GROUP_KEY, when a rule hid either: the call
 *     named someone, and every name it has was hidden. Drawn as "Hidden by
 *     a scrub rule", never as a person - a token too, since no token names
 *     anybody;
 *   - else "": the call named nobody. Unknown is not hidden, and the views
 *     draw the two apart.
 *
 * Its team is its name, LLM_USAGE_HIDDEN_GROUP_KEY when a rule hid it, or
 * "" when it has none.
 *
 * The reads that group calls where they are stored ask the same in
 * ClickHouse (Server/Utils/Telemetry/LlmCallIdentitySql): the Usage tab's
 * breakdowns and the people of the conversation list. A conversation's
 * calls (LlmConversationService.toCall) and the Calls table ask this.
 * Ingest stores a name trimmed (LlmSpan.getString), so the two read stored
 * values the same; this trims a value read from anywhere else, where
 * whitespace alone names nobody.
 *
 * Pure, and read in the browser too.
 */

// A stored name, trimmed; "" for one that is missing or no text.
function readName(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/*
 * A call's person: its email, else its id, past what a scrub rule left of
 * either; LLM_USAGE_HIDDEN_GROUP_KEY when a rule hid every name it has; ""
 * when it has none.
 */
export function readLlmCallPerson(data: {
  email: unknown;
  id: unknown;
}): string {
  const email: string = readName(data.email);
  const id: string = readName(data.id);

  if (email && !isScrubPlaceholder(email)) {
    return email;
  }

  if (id && !isScrubPlaceholder(id)) {
    return id;
  }

  // What is left is a placeholder or nothing: hidden if either holds one.
  if (email || id) {
    return LLM_USAGE_HIDDEN_GROUP_KEY;
  }

  return "";
}

/*
 * A call's team: its name; LLM_USAGE_HIDDEN_GROUP_KEY when a scrub rule
 * hid it; "" when it has none.
 */
export function readLlmCallTeam(team: unknown): string {
  const name: string = readName(team);

  return name && isScrubPlaceholder(name) ? LLM_USAGE_HIDDEN_GROUP_KEY : name;
}

/*
 * Whether a person or a team, as read above, is one a scrub rule hid - or,
 * from a server that read it before #10631, is what the rule left: either
 * way it is drawn as "Hidden by a scrub rule", never as a name.
 */
export function isLlmCallNameHidden(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }

  return isLlmUsageHiddenGroup(value.trim()) || isScrubPlaceholder(value);
}
