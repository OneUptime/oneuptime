/*
 * Toolbox/Index first: the toolbox sits in an import cycle (tool -> service
 * -> ... -> AIToolbox), and production always enters through Index.
 */
import AIToolbox, {
  ToolCallOutcome,
} from "../../../../Server/Utils/AI/Toolbox/Index";
import { CreateAlertTool } from "../../../../Server/Utils/AI/Toolbox/AlertWriteTools";
import { ToolContext } from "../../../../Server/Utils/AI/Toolbox/ToolTypes";
import AlertService from "../../../../Server/Services/AlertService";
import AlertSeverityService from "../../../../Server/Services/AlertSeverityService";
import Alert from "../../../../Models/DatabaseModels/Alert";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../../Types/Exception/PaymentRequiredException";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import { customDomainCaller } from "../../API/CustomDomainCallers";
import {
  InMemoryTable,
  useInMemoryTable,
} from "../../TestingUtils/InMemoryRepository";
import { ON_HIGHEST_PLAN } from "../../TestingUtils/RequestPlan";
import logger from "../../../../Server/Utils/Logger";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * create_alert, AS THE MEMBER WHO ASKED (#5301).
 *
 * Through the toolbox's own gate (AIToolbox.executeTool) and the permission
 * layer for real - the severities and the alerts are tables held in memory:
 *
 *   - who may raise an alert from Ask AI is who may create one on the
 *     Create Alert form: project owners, admins and members, the Alert
 *     Admin and Alert Member roles, and a custom role with Create Alert;
 *   - a member who may not create alerts - a viewer, an Alert Viewer,
 *     someone who may only read alerts or change their state, an Incident
 *     Member - is refused before anything is read or written, and told
 *     which permission it needs;
 *   - a team's block on Create Alert refuses it though the role grants it,
 *     and says so; so is a run with no person to act as, and a request for
 *     another project;
 *   - past the gate, AlertService itself refuses a person who may not
 *     create alerts, so nothing is stored: the write is theirs;
 *   - the severity is read as the member, in the project, archived ones
 *     left out.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const ARCHIVED_ID: string = "33333333-3333-4333-8333-333333333333";
const HIGH_ID: string = "44444444-4444-4444-8444-444444444444";
const LOW_ID: string = "55555555-5555-4555-8555-555555555555";
const OTHER_PROJECT_SEVERITY_ID: string =
  "66666666-6666-4666-8666-666666666666";
const ALERT_ID: string = "77777777-7777-4777-8777-777777777777";

function member(
  permissions: Array<Permission>,
  blocks?: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({
      permissions,
      projectId: PROJECT_ID,
      ...(blocks ? { blocks } : {}),
    }),
    ...ON_HIGHEST_PLAN,
  };
}

function contextFor(props: DatabaseCommonInteractionProps): ToolContext {
  return { projectId: PROJECT_ID, props };
}

let alerts: InMemoryTable;
let severityRead: SpyInstance<typeof AlertSeverityService.findBy>;

beforeEach(() => {
  jest.spyOn(logger, "debug").mockImplementation((): void => {});
  jest.spyOn(logger, "error").mockImplementation((): void => {});

  // As the database stores them: one archived, one of another project.
  useInMemoryTable(AlertSeverityService, [
    {
      _id: ARCHIVED_ID,
      projectId: PROJECT_ID.toString(),
      name: "Critical",
      order: 0,
      isArchived: true,
    },
    {
      _id: HIGH_ID,
      projectId: PROJECT_ID.toString(),
      name: "High",
      order: 1,
      isArchived: false,
    },
    {
      _id: LOW_ID,
      projectId: PROJECT_ID.toString(),
      name: "Low",
      order: 2,
      isArchived: false,
    },
    {
      _id: OTHER_PROJECT_SEVERITY_ID,
      projectId: OTHER_PROJECT_ID.toString(),
      name: "Somebody else's severity",
      order: -1,
      isArchived: false,
    },
  ]);
  alerts = useInMemoryTable(AlertService, []);

  severityRead = jest.spyOn(AlertSeverityService, "findBy");
});

afterEach(() => {
  jest.restoreAllMocks();
});

/*
 * AlertService.create past the permission check it makes before its hooks
 * (DatabaseService.checkCallerBeforeHooks): the number it gives, as the
 * service does. Its hooks are AlertService's own suites' to hold.
 */
function stubCreateAfterTheTableCheck(): SpyInstance<
  typeof AlertService.create
> {
  return jest
    .spyOn(AlertService, "create")
    .mockImplementation(
      async (createBy: { data: Alert }): Promise<Alert> => {
        const created: Alert = createBy.data;
        created._id = ALERT_ID;
        created.alertNumber = 3;
        created.alertNumberWithPrefix = "ALT-3";
        return created;
      },
    );
}

async function raise(
  props: DatabaseCommonInteractionProps,
  args: Record<string, unknown> = { title: "High memory usage on test01" },
): Promise<ToolCallOutcome> {
  return await AIToolbox.executeTool({
    name: "create_alert",
    args: args as never,
    ctx: contextFor(props),
  });
}

describe("who may raise an alert from Ask AI is who may create one on the Create Alert form", () => {
  test.each([
    ["a project owner", [Permission.ProjectOwner]],
    ["a project admin", [Permission.ProjectAdmin]],
    ["a project member", [Permission.ProjectMember]],
    ["an Alert Admin", [Permission.AlertAdmin]],
    ["an Alert Member", [Permission.AlertMember]],
    [
      "a custom role with Create Alert (and Read Alert Severity, as the form's severity picker needs)",
      [Permission.CreateAlert, Permission.ReadAlertSeverity],
    ],
  ])(
    "%s raises it, as themselves",
    async (_who: string, permissions: Array<Permission>) => {
      const create: SpyInstance<typeof AlertService.create> =
        stubCreateAfterTheTableCheck();
      const props: DatabaseCommonInteractionProps = member(permissions);

      const outcome: ToolCallOutcome = await raise(props);

      expect(outcome.success).toBe(true);
      expect(outcome.textForLlm).toContain(
        'Successfully created alert ALT-3 ("High memory usage on test01", severity High).',
      );
      expect(create).toHaveBeenCalledTimes(1);

      const createdWith: { data: Alert; props: unknown } = create.mock
        .calls[0]![0] as unknown as { data: Alert; props: unknown };
      expect(createdWith.props).toBe(props);
      expect(createdWith.data.alertSeverityId?.toString()).toBe(HIGH_ID);
    },
  );

  test.each([
    ["a viewer", [Permission.Viewer]],
    ["an Alert Viewer", [Permission.AlertViewer]],
    ["someone who may only read alerts", [Permission.ReadAlert]],
    [
      "someone who may change an alert's state but not create one",
      [Permission.CreateAlertStateTimeline],
    ],
    [
      "an Incident Member, who may declare incidents but not raise alerts",
      [Permission.IncidentMember],
    ],
    ["someone with no permission at all", []],
  ])(
    "%s is refused before anything is read or written, and told which permission it needs",
    async (_who: string, permissions: Array<Permission>) => {
      const create: SpyInstance<typeof AlertService.create> = jest.spyOn(
        AlertService,
        "create",
      );

      const outcome: ToolCallOutcome = await raise(member(permissions));

      expect(outcome.success).toBe(false);
      expect(outcome.errorMessage).toBe(
        "Permission denied for tool: create_alert",
      );
      expect(outcome.textForLlm).toContain(
        "Error: the current user does not have permission to use create_alert.",
      );
      expect(outcome.textForLlm).toContain(
        "It needs one of these permissions:",
      );
      expect(outcome.textForLlm).toContain("Create Alert");
      expect(severityRead).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
      expect(alerts.inserts).toHaveLength(0);
    },
  );

  test("a team's block on Create Alert refuses it though the role grants it, and says so", async () => {
    const create: SpyInstance<typeof AlertService.create> = jest.spyOn(
      AlertService,
      "create",
    );

    const outcome: ToolCallOutcome = await raise(
      member([Permission.ProjectMember], [Permission.CreateAlert]),
    );

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toContain(
      "they hold a permission it needs, but a team they belong to blocks Create Alert",
    );
    expect(create).not.toHaveBeenCalled();
  });

  test("a run with no person to act as - OneUptime itself - changes nothing", async () => {
    const create: SpyInstance<typeof AlertService.create> = jest.spyOn(
      AlertService,
      "create",
    );

    const outcome: ToolCallOutcome = await AIToolbox.executeTool({
      name: "create_alert",
      args: { title: "High memory usage" },
      ctx: { projectId: PROJECT_ID, props: { isRoot: true } },
    });

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toContain(
      "create_alert changes the project, and only runs for a signed-in person who asked for it.",
    );
    expect(create).not.toHaveBeenCalled();
  });

  test("a request for another project than the person's is refused", async () => {
    const create: SpyInstance<typeof AlertService.create> = jest.spyOn(
      AlertService,
      "create",
    );

    const outcome: ToolCallOutcome = await AIToolbox.executeTool({
      name: "create_alert",
      args: { title: "High memory usage" },
      ctx: {
        projectId: OTHER_PROJECT_ID,
        props: member([Permission.ProjectOwner]),
      },
    });

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toContain(
      "create_alert can only run inside the single project this request is authorized for.",
    );
    expect(create).not.toHaveBeenCalled();
  });

  test.each([
    [
      "the person's labels do not reach it",
      new NotAuthorizedException(
        "You do not have permissions to create this Alert.",
      ),
    ],
    [
      "the project's plan does not include it",
      new PaymentRequiredException("Please upgrade your plan."),
    ],
  ])(
    "a refusal past the gate - %s - is told plainly, and the model is told not to retry",
    async (_why: string, refusal: Error) => {
      jest.spyOn(AlertService, "create").mockRejectedValue(refusal);

      const outcome: ToolCallOutcome = await raise(
        member([Permission.ProjectMember]),
      );

      expect(outcome.success).toBe(false);
      expect(outcome.textForLlm).toContain(
        "Refused: create_alert was not allowed for the current user.",
      );
      expect(outcome.textForLlm).toContain(refusal.message);
      expect(outcome.textForLlm).toContain("Do not retry it.");
    },
  );
});

describe("the severity is read as the member, in the project", () => {
  test("archived severities and another project's are left out: the first is the project's first live one", async () => {
    const create: SpyInstance<typeof AlertService.create> =
      stubCreateAfterTheTableCheck();

    const outcome: ToolCallOutcome = await raise(
      member([Permission.ProjectMember]),
      { title: "High memory usage", severityName: "Critical" },
    );

    expect(outcome.success).toBe(true);
    const createdWith: { data: Alert } = create.mock.calls[0]![0] as unknown as {
      data: Alert;
    };
    expect(createdWith.data.alertSeverityId?.toString()).toBe(HIGH_ID);
    // An archived severity is not one a new alert may take, so it is not named.
    expect(outcome.textForLlm).toContain(
      "The project's alert severities: High, Low.",
    );
  });

  test("a severity named in another case is the project's", async () => {
    const create: SpyInstance<typeof AlertService.create> =
      stubCreateAfterTheTableCheck();

    await raise(member([Permission.AlertMember]), {
      title: "High memory usage",
      severityName: "low",
    });

    const createdWith: { data: Alert } = create.mock.calls[0]![0] as unknown as {
      data: Alert;
    };
    expect(createdWith.data.alertSeverityId?.toString()).toBe(LOW_ID);
  });

  test("a custom role with Create Alert alone may not read the severities: refused with that reason, as the form's severity picker is, and nothing is stored", async () => {
    const create: SpyInstance<typeof AlertService.create> = jest.spyOn(
      AlertService,
      "create",
    );

    const outcome: ToolCallOutcome = await raise(
      member([Permission.CreateAlert]),
    );

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toContain(
      "Refused: create_alert was not allowed for the current user. You do not have permissions to read Alert Severity.",
    );
    expect(outcome.textForLlm).toContain("Read Alert Severity");
    expect(create).not.toHaveBeenCalled();
    expect(alerts.inserts).toHaveLength(0);
  });

  test("the approval card's arguments carry the severity as the member reads it", async () => {
    const prepared: { arguments: Record<string, unknown> } =
      await CreateAlertTool.prepareMutation!(
        { title: "High memory usage" },
        contextFor(member([Permission.ProjectMember])),
      );

    expect(prepared.arguments["severityName"]).toBe("High");
  });
});

describe("past the gate, AlertService itself holds the write to the person", () => {
  test("a viewer's create reaches AlertService and is refused there: nothing is stored", async () => {
    const attempt: Promise<unknown> = CreateAlertTool.execute(
      { title: "High memory usage on test01" },
      contextFor(member([Permission.Viewer])),
    );

    await expect(attempt).rejects.toBeInstanceOf(NotAuthorizedException);
    // The alert table's own check - a viewer reads the severities fine.
    await expect(attempt).rejects.toThrow(
      "You do not have permissions to create Alert.",
    );
    expect(severityRead).toHaveBeenCalledTimes(1);
    expect(alerts.inserts).toHaveLength(0);
  });
});
