import ProjectService from "../../../Server/Services/ProjectService";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import SecurityCaseAiHold from "../../../Server/Utils/SecurityCase/SecurityCaseAiHold";
import SsoRequirementChanges from "../../../Server/Utils/SsoRequirementChanges";
import Project from "../../../Models/DatabaseModels/Project";
import SecurityCasePriority from "../../../Models/DatabaseModels/SecurityCasePriority";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import {
  SECURITY_CASE_AI_HOLD_MINUTES_MAX,
  SECURITY_CASE_AI_HOLD_MINUTES_MIN,
} from "../../../Types/SecurityCase/SecurityCaseAiHold";
import SecurityCasePriorityLevel from "../../../Types/SecurityCase/SecurityCasePriorityLevel";
import {
  TEST_PRIORITY_IDS,
  buildDefaultTestPriorities,
  buildTestPriority,
} from "../../Helpers/SecurityCaseValues";
import { stubSecurityCaseValues } from "../../Helpers/SecurityCaseValuesStub";
import { getJestSpyOn } from "../../Spy";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("../../../Server/Utils/Logger");

/*
 * A PROJECT'S "LET ONEUPTIME AI RESPOND FIRST" SETTING (#10353), as the
 * project's own update hooks hold it: how long a case may be held is a
 * whole number of minutes in its bounds, the priority cases are held below
 * is one of the project's own and still offered, and turning off what the
 * hold depends on hands every held case to people at once.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

interface HoldRules {
  applySecurityCaseAiHoldRules: (
    data: Record<string, unknown>,
    options: { isCreate: boolean },
  ) => void;
  checkSecurityCaseAiHoldPriority: (
    updateBy: UpdateBy<Project>,
  ) => Promise<void>;
  findRowsAndHoldUpdateToThem: (...args: Array<unknown>) => Promise<unknown>;
  onUpdateSuccess: (
    onUpdate: { updateBy: UpdateBy<Project>; carryForward?: unknown },
    updatedItemIds: Array<ObjectID>,
  ) => Promise<unknown>;
}

const service: HoldRules = ProjectService as unknown as HoldRules;

function updateWith(data: Record<string, unknown>): UpdateBy<Project> {
  return {
    query: { _id: PROJECT_ID.toString() },
    data: data,
    props: { isRoot: true },
  } as unknown as UpdateBy<Project>;
}

function refusal(run: () => void): string | null {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(BadDataException);
    return (error as Error).message;
  }

  return null;
}

async function asyncRefusal(run: () => Promise<void>): Promise<string | null> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(BadDataException);
    return (error as Error).message;
  }

  return null;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("how long a case may be held", () => {
  const BOUNDS_MESSAGE: string = `OneUptime AI holds a case's alerts for a whole number of minutes from ${SECURITY_CASE_AI_HOLD_MINUTES_MIN} to ${SECURITY_CASE_AI_HOLD_MINUTES_MAX}.`;

  test("a whole number of minutes within the bounds is kept, as a number", () => {
    for (const [given, kept] of [
      [SECURITY_CASE_AI_HOLD_MINUTES_MIN, SECURITY_CASE_AI_HOLD_MINUTES_MIN],
      [10, 10],
      [SECURITY_CASE_AI_HOLD_MINUTES_MAX, SECURITY_CASE_AI_HOLD_MINUTES_MAX],
      ["15", 15],
    ] as Array<[unknown, number]>) {
      const data: Record<string, unknown> = {
        securityCaseAiHoldMinutes: given,
      };

      service.applySecurityCaseAiHoldRules(data, { isCreate: false });

      expect({ given, kept: data["securityCaseAiHoldMinutes"] }).toEqual({
        given,
        kept,
      });
    }
  });

  test("anything else is refused with the bounds, never stored", () => {
    for (const given of [
      0,
      SECURITY_CASE_AI_HOLD_MINUTES_MAX + 1,
      -5,
      2.5,
      "ten",
      null,
      Number.NaN,
    ]) {
      expect({
        given,
        refused: refusal(() => {
          service.applySecurityCaseAiHoldRules(
            { securityCaseAiHoldMinutes: given },
            { isCreate: false },
          );
        }),
      }).toEqual({ given, refused: BOUNDS_MESSAGE });
    }
  });

  test("a write that does not name it leaves it alone", () => {
    const data: Record<string, unknown> = { name: "Acme" };

    service.applySecurityCaseAiHoldRules(data, { isCreate: false });

    expect(data).toEqual({ name: "Acme" });
  });

  test("a new project cannot name the priority it holds below: it has no priorities yet", () => {
    expect(
      refusal(() => {
        service.applySecurityCaseAiHoldRules(
          {
            securityCaseAiHoldBelowPriorityId: ObjectID.generate().toString(),
          },
          { isCreate: true },
        );
      }),
    ).toBe(
      "Pick the priority OneUptime AI responds first below once the project has its case priorities.",
    );

    // Turning it on, and a hold time, are fine on a new project.
    expect(
      refusal(() => {
        service.applySecurityCaseAiHoldRules(
          {
            enableSecurityCaseAiRespondsFirst: true,
            securityCaseAiHoldMinutes: 20,
            securityCaseAiHoldBelowPriorityId: null,
          },
          { isCreate: true },
        );
      }),
    ).toBeNull();
  });
});

describe("the priority cases are held below", () => {
  const PICK_MESSAGE: string =
    "Pick one of this project's case priorities for OneUptime AI to respond first below.";

  function holdTheRows(): jest.Mock {
    return getJestSpyOn(
      ProjectService,
      "findRowsAndHoldUpdateToThem",
    ).mockResolvedValue([new Project(PROJECT_ID)]) as unknown as jest.Mock;
  }

  test("one of the project's own priorities, still offered, is kept", async () => {
    stubSecurityCaseValues();
    holdTheRows();

    expect(
      await asyncRefusal(() => {
        return service.checkSecurityCaseAiHoldPriority(
          updateWith({
            securityCaseAiHoldBelowPriorityId:
              TEST_PRIORITY_IDS[SecurityCasePriorityLevel.Critical],
          }),
        );
      }),
    ).toBeNull();
  });

  test("a priority that is not the project's - another project's, or none at all - is refused", async () => {
    stubSecurityCaseValues();
    holdTheRows();

    for (const picked of [
      ObjectID.generate().toString(),
      "not-an-id",
    ]) {
      expect({
        picked,
        refused: await asyncRefusal(() => {
          return service.checkSecurityCaseAiHoldPriority(
            updateWith({ securityCaseAiHoldBelowPriorityId: picked }),
          );
        }),
      }).toEqual({ picked, refused: PICK_MESSAGE });
    }
  });

  test("an archived priority is refused, by its name", async () => {
    const archivedId: string = "99999999-9999-4999-8999-999999999999";

    stubSecurityCaseValues({
      priorities: [
        ...buildDefaultTestPriorities(),
        buildTestPriority({
          id: archivedId,
          name: "Urgent",
          order: 9,
          isArchived: true,
        }),
      ],
    });
    holdTheRows();

    expect(
      await asyncRefusal(() => {
        return service.checkSecurityCaseAiHoldPriority(
          updateWith({ securityCaseAiHoldBelowPriorityId: archivedId }),
        );
      }),
    ).toBe(
      "Urgent is archived. Pick a priority your cases still use for OneUptime AI to respond first below.",
    );
  });

  test("going back to the built-in High - no priority - reads nothing", async () => {
    const priorities: jest.Mock = jest.fn();
    const rows: jest.Mock = holdTheRows();

    stubSecurityCaseValues();

    for (const picked of [null, undefined]) {
      await service.checkSecurityCaseAiHoldPriority(
        updateWith({ securityCaseAiHoldBelowPriorityId: picked }),
      );
    }

    expect(rows).not.toHaveBeenCalled();
    expect(priorities).not.toHaveBeenCalled();
  });

  test("every project the write reaches is checked against its own priorities", async () => {
    const otherProjectId: ObjectID = ObjectID.generate();
    const ownPriority: SecurityCasePriority = buildTestPriority({
      id: "88888888-8888-4888-8888-888888888888",
      name: "Own",
      order: 1,
    });

    getJestSpyOn(ProjectService, "findRowsAndHoldUpdateToThem").mockResolvedValue([
      new Project(PROJECT_ID),
      new Project(otherProjectId),
    ]);

    const reads: Array<string> = [];
    const values: typeof import("../../../Server/Utils/SecurityCase/SecurityCaseValues").default =
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      require("../../../Server/Utils/SecurityCase/SecurityCaseValues").default;

    getJestSpyOn(values, "getForProject").mockImplementation(
      async (projectId: ObjectID) => {
        reads.push(projectId.toString());
        return {
          priorities:
            projectId.toString() === PROJECT_ID.toString() ? [ownPriority] : [],
          statuses: [],
        };
      },
    );

    expect(
      await asyncRefusal(() => {
        return service.checkSecurityCaseAiHoldPriority(
          updateWith({
            securityCaseAiHoldBelowPriorityId: ownPriority._id as string,
          }),
        );
      }),
    ).toBe(PICK_MESSAGE);
    expect(reads).toEqual([PROJECT_ID.toString(), otherProjectId.toString()]);
  });
});

describe("turning off what a hold depends on", () => {
  function release(): jest.Mock {
    getJestSpyOn(SsoRequirementChanges, "afterUpdate").mockResolvedValue(
      undefined as never,
    );

    return getJestSpyOn(
      SecurityCaseAiHold,
      "onProjectSettingsChanged",
    ).mockResolvedValue(undefined as never) as unknown as jest.Mock;
  }

  test("hands every held case of each project to people: the setting, working cases, or AI itself", async () => {
    const otherProjectId: ObjectID = ObjectID.generate();

    for (const data of [
      { enableSecurityCaseAiRespondsFirst: false },
      { enableAutomaticSecurityCaseResponse: false },
      { enableAi: false },
    ]) {
      const released: jest.Mock = release();

      await service.onUpdateSuccess({ updateBy: updateWith(data) }, [
        PROJECT_ID,
        otherProjectId,
      ]);

      expect({
        data,
        released: released.mock.calls.map((call: Array<unknown>): string => {
          return (call[0] as { projectId: ObjectID }).projectId.toString();
        }),
      }).toEqual({
        data,
        released: [PROJECT_ID.toString(), otherProjectId.toString()],
      });

      jest.restoreAllMocks();
    }
  });

  test("turning them on, or changing only the hold time, releases nothing", async () => {
    for (const data of [
      { enableSecurityCaseAiRespondsFirst: true },
      { enableAutomaticSecurityCaseResponse: true },
      { securityCaseAiHoldMinutes: 20 },
    ]) {
      const released: jest.Mock = release();

      await service.onUpdateSuccess({ updateBy: updateWith(data) }, [
        PROJECT_ID,
      ]);

      expect({ data, released: released.mock.calls.length }).toEqual({
        data,
        released: 0,
      });

      jest.restoreAllMocks();
    }
  });
});
