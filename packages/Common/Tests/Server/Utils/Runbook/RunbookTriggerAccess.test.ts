import RunbookService from "../../../../Server/Services/RunbookService";
import logger from "../../../../Server/Utils/Logger";
import RunbookTriggerAccess, {
  RUNBOOK_TRIGGER_COLUMNS,
  RUNBOOK_TRIGGER_REFUSED_MESSAGE,
  RUNBOOK_TRIGGER_SWITCH_COLUMNS,
  RUNBOOK_WEBHOOK_URL_REFUSED_MESSAGE,
} from "../../../../Server/Utils/Runbook/RunbookTriggerAccess";
import Runbook from "../../../../Models/DatabaseModels/Runbook";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../../Types/Exception/NotFoundException";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import { RUNBOOK_RUN_PERMISSIONS } from "../../../../Types/Runbook/RunbookRunPermissions";
import { customDomainCaller } from "../../API/CustomDomainCallers";
import { useInMemoryTable } from "../../TestingUtils/InMemoryRepository";
import { ON_HIGHEST_PLAN } from "../../TestingUtils/RequestPlan";
import { stubProjectDirectory } from "../../TestingUtils/ProjectDirectory";
import { getJestSpyOn } from "../../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * WHO MAY SET UP A RUNBOOK'S TRIGGERS AND SEE ITS WEBHOOK URL: whoever may
 * change the trigger columns of the runbook and start runs of it. The
 * column lists, the runbook's labels and the run permissions are the real
 * ones; the runbook is in an in-memory table.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-1111111111cc",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-1111111111dd",
);
const RUNBOOK_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-2222222222ee",
);

function member(
  permissions: Array<Permission>,
  projectId: ObjectID = PROJECT_ID,
): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({ permissions: permissions, projectId: projectId }),
    ...ON_HIGHEST_PLAN,
  };
}

async function refusalOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  return undefined;
}

beforeEach(() => {
  for (const silenced of ["debug", "info", "warn", "error"]) {
    getJestSpyOn(logger, silenced).mockImplementation((): void => {
      return undefined;
    });
  }

  stubProjectDirectory({});

  useInMemoryTable(RunbookService, [
    {
      _id: RUNBOOK_ID.toString(),
      projectId: PROJECT_ID.toString(),
      name: "Restart the web tier",
      slug: "restart-the-web-tier",
      isEnabled: true,
      steps: [],
      version: 1,
    },
  ]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("which writes are about the triggers", () => {
  test("the trigger columns are the schedule's and the webhook's settings, not the scheduler's own", () => {
    expect([...RUNBOOK_TRIGGER_COLUMNS].sort()).toEqual(
      [
        "isScheduleEnabled",
        "isWebhookEnabled",
        "scheduleCron",
        "scheduleMissedRunPolicy",
        "scheduleOverlapPolicy",
        "scheduleTimezone",
      ].sort(),
    );
    expect(RUNBOOK_TRIGGER_COLUMNS).not.toContain("scheduleNextRunAt");
    expect(RUNBOOK_TRIGGER_COLUMNS).not.toContain("webhookSecretKey");
    expect(RUNBOOK_TRIGGER_SWITCH_COLUMNS).toEqual([
      "isScheduleEnabled",
      "isWebhookEnabled",
    ]);

    // Every one of them is a Runbook column whose update list is the editors'.
    const runbook: Runbook = new Runbook();

    for (const column of RUNBOOK_TRIGGER_COLUMNS) {
      expect(
        runbook.getColumnAccessControlForAllColumns()[column]?.update,
      ).toEqual([
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.EditRunbook,
        Permission.RunbookAdmin,
      ]);
    }
  });

  test("names the trigger columns a write sends, and nothing else", () => {
    expect(
      RunbookTriggerAccess.getTriggerColumnsWritten({
        name: "x",
        scheduleCron: "0 9 * * *",
        isWebhookEnabled: false,
        scheduleTimezone: undefined,
      }),
    ).toEqual(["scheduleCron", "isWebhookEnabled"]);
    expect(
      RunbookTriggerAccess.getTriggerColumnsWritten({ name: "x" }),
    ).toEqual([]);
    expect(RunbookTriggerAccess.getTriggerColumnsWritten(null)).toEqual([]);
  });

  test("a write that only turns triggers off starts nothing", () => {
    expect(
      RunbookTriggerAccess.onlyTurnsTriggersOff({ isScheduleEnabled: false }),
    ).toBe(true);
    expect(
      RunbookTriggerAccess.onlyTurnsTriggersOff({
        isScheduleEnabled: false,
        isWebhookEnabled: false,
        name: "renamed too",
      }),
    ).toBe(true);
    expect(
      RunbookTriggerAccess.onlyTurnsTriggersOff({
        isScheduleEnabled: false,
        scheduleCron: "* * * * *",
      }),
    ).toBe(false);
    expect(
      RunbookTriggerAccess.onlyTurnsTriggersOff({ isWebhookEnabled: true }),
    ).toBe(false);
    expect(RunbookTriggerAccess.onlyTurnsTriggersOff({ name: "x" })).toBe(
      false,
    );
  });

  test("a create turns a trigger on only with a switch set to true", () => {
    expect(
      RunbookTriggerAccess.turnsATriggerOn({ isScheduleEnabled: true }),
    ).toBe(true);
    expect(
      RunbookTriggerAccess.turnsATriggerOn({ isWebhookEnabled: true }),
    ).toBe(true);
    expect(
      RunbookTriggerAccess.turnsATriggerOn({
        isScheduleEnabled: false,
        scheduleCron: "0 9 * * *",
      }),
    ).toBe(false);
    expect(RunbookTriggerAccess.turnsATriggerOn(undefined)).toBe(false);
  });
});

describe("starting runs, as a trigger would", () => {
  test.each(
    RUNBOOK_RUN_PERMISSIONS.map((permission: Permission) => {
      return [permission];
    }),
  )("%s may", async (permission: Permission) => {
    expect(
      await refusalOf(
        RunbookTriggerAccess.assertMayRunTriggersOf({
          props: member([permission]),
          projectId: PROJECT_ID,
          runbookId: RUNBOOK_ID,
        }),
      ),
    ).toBeUndefined();
  });

  test.each([
    [Permission.EditRunbook],
    [Permission.Viewer],
    [Permission.RunbookViewer],
    [Permission.ReadRunbook],
    [Permission.EditRunbookExecution],
  ])(
    "%s may not, in the trigger's own words",
    async (permission: Permission) => {
      const error: unknown = await refusalOf(
        RunbookTriggerAccess.assertMayRunTriggersOf({
          props: member([permission, Permission.ReadRunbook]),
          projectId: PROJECT_ID,
          runbookId: RUNBOOK_ID,
        }),
      );

      expect(error).toBeInstanceOf(NotAuthorizedException);
      expect((error as Error).message).toBe(RUNBOOK_TRIGGER_REFUSED_MESSAGE);
    },
  );

  test("OneUptime and a master admin may", async () => {
    for (const props of [
      { isRoot: true },
      { isMasterAdmin: true },
    ] as Array<DatabaseCommonInteractionProps>) {
      expect(
        await refusalOf(
          RunbookTriggerAccess.assertMayRunTriggersOf({
            props,
            projectId: PROJECT_ID,
            runbookId: RUNBOOK_ID,
          }),
        ),
      ).toBeUndefined();
    }
  });

  test("before a runbook exists, the run permissions are asked in the project", () => {
    expect(() => {
      RunbookTriggerAccess.assertMayRunTriggersIn({
        props: member([Permission.RunbookAdmin]),
        projectId: PROJECT_ID,
      });
    }).not.toThrow();
    expect(() => {
      RunbookTriggerAccess.assertMayRunTriggersIn({
        props: member([Permission.CreateRunbook]),
        projectId: PROJECT_ID,
      });
    }).toThrow(RUNBOOK_TRIGGER_REFUSED_MESSAGE);
    expect(() => {
      RunbookTriggerAccess.assertMayRunTriggersIn({
        props: member([Permission.RunbookAdmin]),
        projectId: undefined,
      });
    }).toThrow(RUNBOOK_TRIGGER_REFUSED_MESSAGE);
  });
});

describe("seeing and resetting the webhook URL", () => {
  async function manage(
    props: DatabaseCommonInteractionProps,
    projectId: ObjectID = PROJECT_ID,
  ): Promise<unknown> {
    return await refusalOf(
      RunbookTriggerAccess.assertMayManageWebhook({
        props,
        projectId,
        runbookId: RUNBOOK_ID,
      }),
    );
  }

  test.each([
    ["a project owner", [Permission.ProjectOwner]],
    ["a project admin", [Permission.ProjectAdmin]],
    ["a runbook admin", [Permission.RunbookAdmin]],
    [
      "someone who may edit runbooks and start runs",
      [
        Permission.EditRunbook,
        Permission.ReadRunbook,
        Permission.CreateRunbookExecution,
      ],
    ],
  ])("%s may", async (_who: string, permissions: Array<Permission>) => {
    expect(await manage(member(permissions))).toBeUndefined();
  });

  test.each([
    [
      "someone who may edit runbooks but not run them",
      [Permission.EditRunbook, Permission.ReadRunbook],
    ],
    [
      "a runbook member, who runs runbooks but does not edit them",
      [Permission.RunbookMember],
    ],
    ["a project member", [Permission.ProjectMember]],
    ["a viewer", [Permission.Viewer]],
    ["a runbook viewer", [Permission.RunbookViewer]],
  ])("%s may not", async (_who: string, permissions: Array<Permission>) => {
    const error: unknown = await manage(member(permissions));

    expect(error).toBeInstanceOf(NotAuthorizedException);
    expect((error as Error).message).toBe(RUNBOOK_WEBHOOK_URL_REFUSED_MESSAGE);
  });

  test("a runbook of another project is answered as one that does not exist", async () => {
    const error: unknown = await manage(
      member([Permission.ProjectOwner], OTHER_PROJECT_ID),
      OTHER_PROJECT_ID,
    );

    expect(error).toBeInstanceOf(NotFoundException);
  });

  test("OneUptime and a master admin may", async () => {
    expect(await manage({ isRoot: true })).toBeUndefined();
    expect(await manage({ isMasterAdmin: true })).toBeUndefined();
  });
});
