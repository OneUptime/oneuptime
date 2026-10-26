import {
  GLOBAL_RUNNER_CHOICE_VALUE,
  GLOBAL_RUNNER_PICK_VALUE,
} from "../Runner/RunnerPickerModel";
import ObjectID from "Common/Types/ObjectID";
import { getRepositoryRunnerId } from "Common/Types/Runner/CodeRepositoryRunner";
import { isGlobalRunnerChoice } from "Common/Types/Runner/RunnerChoice";

/*
 * A code repository's Runner setting as ONE choice - what the Runner
 * picker holds - and the two columns it is stored in
 * (Common/Types/Runner/CodeRepositoryRunner):
 *
 *   - a Runner's id: the repository picked that Runner (runnerId);
 *   - GLOBAL_RUNNER_PICK_VALUE: it picked the Global Runner itself, which
 *     never follows the project's default Runner (no runnerId,
 *     isGlobalRunnerPicked true);
 *   - "": it picked none, and follows the project's default Runner - the
 *     Global Runner while there is none (no runnerId, isGlobalRunnerPicked
 *     false).
 *
 * React-free, so the Settings page, its card and App's tests read one
 * rule.
 */

// The Runner card's form keeps the choice under this key; never sent.
export const CODE_REPOSITORY_RUNNER_CHOICE_FIELD_KEY: string = "runnerChoice";

// What the repository stores, read as the picker's choice.
export function getCodeRepositoryRunnerChoice(stored: {
  runnerId?: unknown;
  isGlobalRunnerPicked?: unknown;
}): string {
  const runnerId: string = getRepositoryRunnerId(stored.runnerId);

  if (runnerId) {
    return runnerId;
  }

  return stored.isGlobalRunnerPicked === true
    ? GLOBAL_RUNNER_PICK_VALUE
    : GLOBAL_RUNNER_CHOICE_VALUE;
}

export interface CodeRepositoryRunnerColumns {
  runnerId: ObjectID | null;
  isGlobalRunnerPicked: boolean;
}

// The columns a choice is stored in.
export function getCodeRepositoryRunnerColumns(
  choice: unknown,
): CodeRepositoryRunnerColumns {
  const value: string = typeof choice === "string" ? choice.trim() : "";

  if (isGlobalRunnerChoice(value)) {
    return { runnerId: null, isGlobalRunnerPicked: true };
  }

  const runnerId: string = getRepositoryRunnerId(value);

  if (runnerId && ObjectID.isValidUUID(runnerId)) {
    return {
      runnerId: new ObjectID(runnerId),
      isGlobalRunnerPicked: false,
    };
  }

  return { runnerId: null, isGlobalRunnerPicked: false };
}
