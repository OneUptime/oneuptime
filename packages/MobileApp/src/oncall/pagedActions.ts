import type { ResponseAction } from "../components/ResponseDetailLayout";

/*
 * THE BUTTONS ON AN INCIDENT, AN ALERT OR AN EPISODE, FOR THE PERSON PAGED.
 *
 * Every one of the four detail screens draws the same buttons by the same
 * rule, in this order:
 *
 *   - Acknowledge again: a page again is open for the reader (the policy's
 *     acknowledgement timeout ran out with the record still acknowledged and
 *     not resolved). The record's own Acknowledge is gone, since it is
 *     acknowledged, so this answers the reader's page instead. First and
 *     filled, as the record's own Acknowledge is on a record nobody took.
 *   - Acknowledge: the record is not acknowledged yet. Filled.
 *   - Resolve: until the record is resolved. Filled only when nothing above
 *     it is: one filled button at a time.
 *   - Escalate: the reader is being paged about it - a first page, or a page
 *     again - and cannot take it.
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
}

/** Whether the reader is paged again about an acknowledged record that is still open. */
export function isPagedAgain(input: PagedActionsInput): boolean {
  return (
    !input.isResolved && input.isAcknowledged && input.acknowledgeAgain !== null
  );
}

export function getPagedResponseActions(
  input: PagedActionsInput,
): ResponseAction[] {
  if (input.isResolved) {
    return [];
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

  if (input.escalate && (!input.isAcknowledged || pagedAgain)) {
    actions.push({ ...input.escalate, primary: false });
  }

  return actions;
}
