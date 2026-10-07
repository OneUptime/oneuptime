import logComponentError, {
  describeRefusal,
} from "../../../../../Server/Types/Workflow/Components/BaseModel/LogComponentError";
import ColumnPermissions from "../../../../../Server/Types/Database/Permissions/ColumnPermission";
import ColumnWriteRefusedException from "../../../../../Server/Types/Database/Permissions/ColumnWriteRefusedException";
import DatabaseRequestType from "../../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import CallerPlan from "../../../../../Server/Utils/Billing/CallerPlan";
import WorkflowPrincipal from "../../../../../Server/Utils/Workflow/WorkflowPrincipal";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import Team from "../../../../../Models/DatabaseModels/Team";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import NotAuthenticatedException from "../../../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../../../Types/Exception/PaymentRequiredException";
import ObjectID from "../../../../../Types/ObjectID";
import { describe, expect, jest, test } from "@jest/globals";

jest.mock("../../../../../Server/Utils/Logger");

/*
 * WHAT A REFUSED STEP SAYS.
 *
 * A step acts as a Project Admin of its project, on its plan
 * (WorkflowPrincipal). When the checks refuse it, the run log says so in
 * plain words - naming the step, saying why in terms a workflow author can
 * act on - before the reason the check itself gave. A refusal is told by its
 * type, never by its words. Any other failure is logged as it always was.
 */

const STEP: string = "Update One Project";
const REFUSED: string = `"${STEP}" was refused. Workflow steps can do only what a Project Admin of this project can do: `;

// What ColumnPermissions throws when a step writes `column` of a Team.
function teamColumnRefusal(column: string): unknown {
  const team: Team = new Team();
  (team as unknown as Record<string, unknown>)[column] = false;

  try {
    ColumnPermissions.checkDataColumnPermissions(
      Team,
      team,
      WorkflowPrincipal.getPropsWithoutPlan({
        projectId: ObjectID.generate(),
        workflowId: ObjectID.generate(),
      }),
      DatabaseRequestType.Update,
    );
  } catch (error) {
    return error;
  }

  return null;
}

describe("describeRefusal", () => {
  test("a plan OneUptime could not confirm: the step did not run", () => {
    expect(
      describeRefusal({
        error: new NotAuthorizedException(CallerPlan.PLAN_UNKNOWN_MESSAGE),
        message: CallerPlan.PLAN_UNKNOWN_MESSAGE,
        stepTitle: STEP,
      }),
    ).toBe(`"${STEP}" did not run: ${CallerPlan.PLAN_UNKNOWN_MESSAGE}`);
  });

  test("a plan that does not include it: refused because of the plan, with the plan's name", () => {
    const message: string =
      "Please upgrade your plan to Scale to access this feature";

    expect(
      describeRefusal({
        error: new PaymentRequiredException(message),
        message,
        stepTitle: STEP,
      }),
    ).toBe(`"${STEP}" was refused because of this project's plan: ${message}`);
  });

  test.each([
    [
      "a permission it lacks",
      new NotAuthorizedException("You do not have permission to update Team"),
    ],
    ["no sign-in at all", new NotAuthenticatedException("Not signed in")],
  ])(
    "%s: refused, as a Project Admin would be",
    (_label: string, error: Error) => {
      expect(
        describeRefusal({ error, message: error.message, stepTitle: STEP }),
      ).toBe(REFUSED + error.message);
    },
  );

  test("a column nobody but OneUptime may write, as the column check refuses it", () => {
    const error: unknown = teamColumnRefusal("isTeamEditable");

    expect(error).toBeInstanceOf(ColumnWriteRefusedException);
    expect(
      describeRefusal({
        error,
        message: (error as Error).message,
        stepTitle: STEP,
      }),
    ).toBe(
      REFUSED +
        "User is not allowed to update on isTeamEditable column of Team",
    );
  });

  test("bad data in the same words is no refusal: the type decides, not the words", () => {
    const message: string =
      "User is not allowed to update on isTeamEditable column of Team";

    expect(
      describeRefusal({
        error: new BadDataException(message),
        message,
        stepTitle: STEP,
      }),
    ).toBeNull();
  });

  test("any other failure is no refusal", () => {
    expect(
      describeRefusal({
        error: new BadDataException("Name is required"),
        message: "Name is required",
        stepTitle: STEP,
      }),
    ).toBeNull();
    expect(
      describeRefusal({
        error: new Error("connection reset"),
        message: "connection reset",
        stepTitle: STEP,
      }),
    ).toBeNull();
  });
});

describe("logComponentError", () => {
  test("a refused step's log line names the step and says why", () => {
    const lines: Array<unknown> = [];
    const error: NotAuthorizedException = new NotAuthorizedException(
      "You do not have permission to update Team",
    );

    logComponentError({
      error,
      model: new Monitor(),
      log: (line: unknown): void => {
        lines.push(line);
      },
      stepTitle: STEP,
    });

    expect(lines).toEqual([
      "Error running component",
      REFUSED + "You do not have permission to update Team",
    ]);
  });

  test("without the step's title, the reason is logged as it always was", () => {
    const lines: Array<unknown> = [];

    logComponentError({
      error: new NotAuthorizedException("You do not have permission"),
      model: null,
      log: (line: unknown): void => {
        lines.push(line);
      },
    });

    expect(lines).toEqual([
      "Error running component",
      "You do not have permission",
    ]);
  });
});
