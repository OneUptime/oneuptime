import { RunbookStep } from "../../Types/Runbook/RunbookStep";
import stableStringify from "../StableStringify";

/*
 * A runbook's steps as Save Steps writes them, in one string: in the order
 * they run, each numbered by its place (Save Steps writes order 0, 1, 2...),
 * with every object's keys sorted and a key left undefined left out, as
 * JSON leaves it out.
 *
 * The same steps give the same string however their objects were built - a
 * step handed back by an editor unchanged, a config spread into a copy in
 * another order. Any change Save Steps would write gives another: a step
 * added, removed, moved or edited, a switch flipped.
 *
 * The Steps page compares its steps with the ones last loaded or saved: a
 * change undone - a step moved and moved back, a switch flipped twice -
 * leaves nothing unsaved, so Save Steps rests, no "Unsaved changes" shows,
 * and leaving asks nothing.
 */
export const getRunbookStepsSignature: (
  steps: ReadonlyArray<RunbookStep>,
) => string = (steps: ReadonlyArray<RunbookStep>): string => {
  return stableStringify(
    steps.map((step: RunbookStep, index: number): RunbookStep => {
      return { ...step, order: index };
    }),
  );
};

export default getRunbookStepsSignature;
