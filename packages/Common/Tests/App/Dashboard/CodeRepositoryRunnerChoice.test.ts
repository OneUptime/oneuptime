import {
  CODE_REPOSITORY_RUNNER_CHOICE_FIELD_KEY,
  CodeRepositoryRunnerColumns,
  getCodeRepositoryRunnerChoice,
  getCodeRepositoryRunnerColumns,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeRepositoryRunnerChoice";
import {
  GLOBAL_RUNNER_CHOICE_VALUE,
  GLOBAL_RUNNER_PICK_VALUE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Runner/RunnerPickerModel";
import ObjectID from "../../../Types/ObjectID";
import { GLOBAL_RUNNER_CHOICE_ID } from "../../../Types/Runner/RunnerChoice";
import { describe, expect, test } from "@jest/globals";

/*
 * A code repository's Runner setting as ONE choice - what its Runner picker
 * holds - and the two columns it is stored in (CodeRepository.runnerId and
 * isGlobalRunnerPicked; Common/Types/Runner/CodeRepositoryRunner):
 *
 *   - a Runner's id: it picked that Runner;
 *   - the Global Runner's own pick: it picked the Global Runner, which never
 *     follows the project's default Runner;
 *   - none: it follows the project's default Runner, and the Global Runner
 *     while there is none.
 *
 * Read one way and written the other, a choice must come back as itself.
 */

const RUNNER_ID: string = "aaaaaaaa-0000-4000-8000-0000000000a1";

describe("the choice a repository stores", () => {
  test("a Runner it picked: that Runner's id, as the rule reads it", () => {
    expect(
      getCodeRepositoryRunnerChoice({ runnerId: new ObjectID(RUNNER_ID) }),
    ).toBe(RUNNER_ID);
    expect(
      getCodeRepositoryRunnerChoice({
        runnerId: `  ${RUNNER_ID.toUpperCase()}  `,
      }),
    ).toBe(RUNNER_ID);
  });

  test("a pick wins over a Global Runner pick the repository still holds", () => {
    expect(
      getCodeRepositoryRunnerChoice({
        runnerId: RUNNER_ID,
        isGlobalRunnerPicked: true,
      }),
    ).toBe(RUNNER_ID);
  });

  test("the Global Runner picked itself: its own pick", () => {
    expect(
      getCodeRepositoryRunnerChoice({
        runnerId: null,
        isGlobalRunnerPicked: true,
      }),
    ).toBe(GLOBAL_RUNNER_PICK_VALUE);
    expect(GLOBAL_RUNNER_PICK_VALUE).toBe(GLOBAL_RUNNER_CHOICE_ID);
  });

  test("none, unset or false: none - it follows the project's default", () => {
    for (const stored of [
      {},
      { runnerId: null },
      { runnerId: "", isGlobalRunnerPicked: false },
      { runnerId: undefined, isGlobalRunnerPicked: null },
      // Only a stored true is a pick of the Global Runner.
      { isGlobalRunnerPicked: "true" },
      { isGlobalRunnerPicked: 1 },
    ]) {
      expect(getCodeRepositoryRunnerChoice(stored)).toBe(
        GLOBAL_RUNNER_CHOICE_VALUE,
      );
    }
    expect(GLOBAL_RUNNER_CHOICE_VALUE).toBe("");
  });
});

describe("the columns a choice is stored in", () => {
  test("a Runner's id: that Runner, and not the Global Runner", () => {
    const columns: CodeRepositoryRunnerColumns = getCodeRepositoryRunnerColumns(
      RUNNER_ID.toUpperCase(),
    );

    expect(columns.runnerId).toBeInstanceOf(ObjectID);
    expect(columns.runnerId?.toString()).toBe(RUNNER_ID);
    expect(columns.isGlobalRunnerPicked).toBe(false);
  });

  test("the Global Runner's own pick: no Runner, and the Global Runner picked", () => {
    expect(getCodeRepositoryRunnerColumns(GLOBAL_RUNNER_PICK_VALUE)).toEqual({
      runnerId: null,
      isGlobalRunnerPicked: true,
    });
    expect(
      getCodeRepositoryRunnerColumns(
        ` ${GLOBAL_RUNNER_PICK_VALUE.toUpperCase()} `,
      ),
    ).toEqual({ runnerId: null, isGlobalRunnerPicked: true });
  });

  test("none - or anything that is not a choice - follows the default", () => {
    for (const choice of ["", "   ", null, undefined, 42, {}, "not-an-id"]) {
      expect(getCodeRepositoryRunnerColumns(choice)).toEqual({
        runnerId: null,
        isGlobalRunnerPicked: false,
      });
    }
  });

  test("every choice comes back as itself", () => {
    for (const choice of [RUNNER_ID, GLOBAL_RUNNER_PICK_VALUE, ""]) {
      const columns: CodeRepositoryRunnerColumns =
        getCodeRepositoryRunnerColumns(choice);

      expect(
        getCodeRepositoryRunnerChoice({
          runnerId: columns.runnerId,
          isGlobalRunnerPicked: columns.isGlobalRunnerPicked,
        }),
      ).toBe(choice);
    }
  });

  test("the form keeps the choice under its own key, never a column's", () => {
    expect(CODE_REPOSITORY_RUNNER_CHOICE_FIELD_KEY).toBe("runnerChoice");
    expect(["runnerId", "isGlobalRunnerPicked"]).not.toContain(
      CODE_REPOSITORY_RUNNER_CHOICE_FIELD_KEY,
    );
  });
});
