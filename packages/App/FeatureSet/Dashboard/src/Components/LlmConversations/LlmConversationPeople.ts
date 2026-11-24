import { isLlmCallNameHidden } from "Common/Utils/Telemetry/LlmCallIdentity";

/*
 * WHO A CONVERSATION WAS WITH, AS ITS PAGES SAY IT (#10631).
 *
 * The server reads each call's person past what a scrub rule left
 * (LlmCallIdentity): an email, else an id, or the hidden key when a rule
 * hid every name the call has. A conversation's people are those, each
 * once. Here is what the list's row, the conversation's header and its
 * transcript make of them: a name is a name, and anyone a rule hid is
 * "Hidden by a scrub rule" (LlmHiddenByScrubRule), never "[REDACTED]", a
 * mask or a token as if it were somebody.
 */

export interface LlmConversationPeople {
  // The people named, in the order the server gave them, each once.
  names: Array<string>;
  // Whether a scrub rule hid anyone in it.
  hasHidden: boolean;
}

export function getLlmConversationPeople(
  people: ReadonlyArray<string>,
): LlmConversationPeople {
  const names: Array<string> = [];
  let hasHidden: boolean = false;

  for (const person of people) {
    const name: string = (person || "").trim();

    if (!name) {
      continue;
    }

    if (isLlmCallNameHidden(name)) {
      hasHidden = true;
      continue;
    }

    if (!names.includes(name)) {
      names.push(name);
    }
  }

  return { names, hasHidden };
}

/*
 * The one person a list row names: someone named when there is anyone,
 * else whether a scrub rule hid who it was (the row says so), else nobody.
 * The list's people come in no order, so a named person is shown first.
 */
export function getLlmConversationRowPerson(people: ReadonlyArray<string>): {
  name: string;
  isHidden: boolean;
} {
  const found: LlmConversationPeople = getLlmConversationPeople(people);

  return {
    name: found.names[0] || "",
    isHidden: !found.names[0] && found.hasHidden,
  };
}

/*
 * Who speaks the person's messages in the transcript: the conversation's
 * person, or "" - the transcript then says "User". A message is not tied
 * to the call that sent it, so when a scrub rule hid anyone in the
 * conversation, any message could be theirs: none is put to a name, and
 * none ever to what the rule left.
 */
export function getLlmConversationSpeaker(
  people: ReadonlyArray<string>,
): string {
  const found: LlmConversationPeople = getLlmConversationPeople(people);

  return found.hasHidden ? "" : found.names[0] || "";
}
