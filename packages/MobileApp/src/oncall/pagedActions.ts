import type { ResponseAction } from "../components/ResponseDetailLayout";

/*
 * THE BUTTONS ON AN INCIDENT, AN ALERT OR AN EPISODE, FOR THE PERSON PAGED.
 *
 * Every one of the four detail screens draws the same buttons by the same
 * rule, in this order:
 *
 *   - Acknowledge again: a page again is open for the reader (the policy's
 *     acknowledgement timeout ran out with the record still acknowledged and
 *     not resolved), or a page somebody asked for by hand - sent from a
 *     chat, or a policy started by hand - about a record somebody else
 *     acknowledged. The record's own Acknowledge is gone, since it is
 *     acknowledged, so this answers the reader's page instead. First and
 *     filled, as the record's own Acknowledge is on a record nobody took.
 *   - Acknowledge: the record is not acknowledged yet. Filled.
 *   - Resolve: until the record is resolved. Filled only when nothing above
 *     it is: one filled button at a time.
 *   - I've seen it: the reader's page as an observer is open, beside a page
 *     of their own as a responder about the same record.
 *   - Escalate: the reader is being paged about it - a first page, or a page
 *     again - and cannot take it.
 *
 * A reader paged about it ONLY as an observer (oncall/observerPage.ts) is
 * kept informed while others respond: their screen offers "I've seen it",
 * first and filled, and Resolve, and never the record's Acknowledge - which
 * would take the record on, stop everybody else's page and make them its
 * Incident Commander. Once they have said they have seen it, the screen is
 * as it is for anybody.
 *
 * Nothing at all once the record is resolved.
 */

export interface PagedActionsInput {
  isResolved: boolean;
  isAcknowledged: boolean;
  // The record's own Acknowledge, or null where the project has no acknowledged state.
  acknowledge: ResponseAction | null;
  // Resolve, or null where the project has no resolved state.
  resolve: ResponseAction | null;
  // Escalate, or null where the reader is not being paged about the record.
  escalate: ResponseAction | null;
  // Acknowledge again, or null where no page again is open for the reader.
  acknowledgeAgain: ResponseAction | null;
  // I've seen it, or null where no page as an observer is open for the reader.
  seen?: ResponseAction | null | undefined;
}

/** Whether the reader is paged again about an acknowledged record that is still open. */
export function isPagedAgain(input: PagedActionsInput): boolean {
  return (
    !input.isResolved && input.isAcknowledged && input.acknowledgeAgain !== null
  );
}

/*
 * Whether the reader's only open page about the record is as an observer:
 * they are kept informed, and have no page of their own as a responder.
 */
export function isObserverOnly(input: PagedActionsInput): boolean {
  return (
    !input.isResolved &&
    Boolean(input.seen) &&
    input.escalate === null &&
    input.acknowledgeAgain === null
  );
}

export function getPagedResponseActions(
  input: PagedActionsInput,
): ResponseAction[] {
  if (input.isResolved) {
    return [];
  }

  if (isObserverOnly(input) && input.seen) {
    const actions: ResponseAction[] = [{ ...input.seen, primary: true }];

    if (input.resolve) {
      actions.push({ ...input.resolve, primary: false });
    }

    return actions;
  }

  const pagedAgain: boolean = isPagedAgain(input);
  const acknowledge: ResponseAction | null = input.isAcknowledged
    ? null
    : input.acknowledge;
  const actions: ResponseAction[] = [];

  if (pagedAgain && input.acknowledgeAgain) {
    actions.push({ ...input.acknowledgeAgain, primary: true });
  }

  if (acknowledge) {
    actions.push({ ...acknowledge, primary: true });
  }

  if (input.resolve) {
    actions.push({
      ...input.resolve,
      primary: !pagedAgain && !acknowledge,
    });
  }

  if (input.seen) {
    actions.push({ ...input.seen, primary: false });
  }

  if (input.escalate && (!input.isAcknowledged || pagedAgain)) {
    actions.push({ ...input.escalate, primary: false });
  }

  return actions;
}
