/*
 * THE FOUR PAGE STEPS, RUN AS THE WORKFLOW RUNNER RUNS THEM.
 *
 * Page Users, Page a Team, Page Whoever Is On Call and Page an On-Call
 * Policy are one class (Components/OnCall/Page) that reads the step's
 * settings and makes the one paging call (OnCallPageService.page), as the
 * step - a Project Admin of the workflow's project, never OneUptime itself.
 * The paging call has its own suite; it is stood in for here, so this one
 * holds what the step does around it:
 *
 *   - what it asks for, from settings in every shape the runner hands over;
 *   - which output it takes, and what it returns on each: Success when
 *     somebody was paged or a policy started, Error - with why, and the
 *     record's id when there is one - when nobody was;
 *   - that a step never set up stops the run with a sentence that names the
 *     setting, judged on the settings as they are saved;
 *   - how long it lets the page wait, inside the workflow's own time;
 *   - that all four are in the runner's registry.
 *
 * The runtime component registry reaches the native isolated-vm addon
 * through the JavaScript component's sandbox, which nothing here runs: it
 * is stubbed out before anything imports it.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import OnCallPageService, {
  ON_CALL_PAGE_DEFAULT_MAX_WAIT_FOR_RECORD_IN_MS,
  OnCallPageRecordType,
  OnCallPageRequest,
  OnCallPageResult,
} from "../../../../../Server/Services/OnCallPageService";
import ComponentCode, {
  RunOptions,
  RunReturnType,
} from "../../../../../Server/Types/Workflow/ComponentCode";
import RuntimeComponents from "../../../../../Server/Types/Workflow/Components/Index";
import Page from "../../../../../Server/Types/Workflow/Components/OnCall/Page";
import CallerPlan from "../../../../../Server/Utils/Billing/CallerPlan";
import VMUtil from "../../../../../Server/Utils/VM/VMAPI";
import WorkflowPrincipal from "../../../../../Server/Utils/Workflow/WorkflowPrincipal";
import URL from "../../../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ColumnLength from "../../../../../Types/Database/ColumnLength";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import Exception from "../../../../../Types/Exception/Exception";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import { JSONObject, JSONValue } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../../../Types/Permission";
import UserType from "../../../../../Types/UserType";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import OnCallComponents from "../../../../../Types/Workflow/Components/OnCall";
import { PageAbout } from "../../../../../Types/Workflow/Components/OnCallPageSettings";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock, SpyInstance } from "jest-mock";

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0000-4000-8000-000000000001",
);
const WORKFLOW_ID: ObjectID = new ObjectID(
  "f1f1f1f1-0000-4000-8000-000000000001",
);
const JANE: string = "10000000-0000-4000-8000-000000000001";
const JOHN: string = "20000000-0000-4000-8000-000000000002";
const TEAM: string = "7eae0000-0000-4000-8000-000000000001";
const SCHEDULE: string = "5c4e0000-0000-4000-8000-000000000001";
const POLICY: string = "dddddddd-0000-4000-8000-000000000001";
const INCIDENT: string = "bbbbbbbb-0000-4000-8000-000000000001";
const ALERT: string = "cccccccc-0000-4000-8000-000000000001";
const SEVERITY: string = "5e5e0000-0000-4000-8000-000000000001";
const RUN_ID: ObjectID = new ObjectID("eeeeeeee-0000-4000-8000-000000000001");

interface StepKind {
  id: ComponentID;
  // The step's title, for the test's own name.
  title: string;
  // The stored id of its who-to-page setting, and the setting's name.
  argumentId: string;
  argumentName: string;
  // One record of the kind it pages.
  targetId: string;
  // Where its ids go in the paging request.
  requestKey:
    | "userIds"
    | "teamIds"
    | "onCallScheduleIds"
    | "onCallDutyPolicyIds";
  returnsPagedUsers: boolean;
}

const STEPS: Array<StepKind> = [
  {
    id: ComponentID.PageUsers,
    title: "Page Users",
    argumentId: "users",
    argumentName: "Users",
    targetId: JANE,
    requestKey: "userIds",
    returnsPagedUsers: true,
  },
  {
    id: ComponentID.PageTeam,
    title: "Page a Team",
    argumentId: "teams",
    argumentName: "Teams",
    targetId: TEAM,
    requestKey: "teamIds",
    returnsPagedUsers: true,
  },
  {
    id: ComponentID.PageOnCall,
    title: "Page Whoever Is On Call",
    argumentId: "on-call-schedules",
    argumentName: "On-Call Schedules",
    targetId: SCHEDULE,
    requestKey: "onCallScheduleIds",
    returnsPagedUsers: true,
  },
  {
    id: ComponentID.PageOnCallPolicy,
    title: "Page an On-Call Policy",
    argumentId: "on-call-policies",
    argumentName: "On-Call Policies",
    targetId: POLICY,
    requestKey: "onCallDutyPolicyIds",
    returnsPagedUsers: false,
  },
];

const USERS: StepKind = STEPS[0]!;
const TEAMS: StepKind = STEPS[1]!;
const POLICIES: StepKind = STEPS[3]!;

interface OptionsFixture {
  options: RunOptions;
  log: Mock<(item: unknown) => void>;
  onError: Mock<(exception: Exception) => Exception>;
}

function makeOptions(data?: {
  configuredArguments?: JSONObject | undefined;
  remainingInMs?: number | undefined;
  workflowName?: string | undefined;
}): OptionsFixture {
  const log: Mock<(item: unknown) => void> = jest.fn(
    (_item: unknown): void => {},
  );
  const onError: Mock<(exception: Exception) => Exception> = jest.fn(
    (exception: Exception): Exception => {
      return exception;
    },
  );

  const options: RunOptions = {
    log: log as unknown as RunOptions["log"],
    workflowLogId: ObjectID.generate(),
    workflowId: WORKFLOW_ID,
    workflowName:
      data && "workflowName" in data
        ? data.workflowName
        : "Page the on-call engineer",
    projectId: PROJECT_ID,
    onError: onError as unknown as RunOptions["onError"],
    executeWorkflow: async (): Promise<void> => {},
  };

  if (data?.configuredArguments) {
    options.configuredArguments = data.configuredArguments;
  }

  if (data?.remainingInMs !== undefined) {
    const remainingInMs: number = data.remainingInMs;

    options.getRemainingExecutionTimeInMs = (): number => {
      return remainingInMs;
    };
  }

  return { log: log, onError: onError, options: options };
}

// A step's settings for a page about something new, with who to page.
function settings(step: StepKind, overrides?: JSONObject): JSONObject {
  return {
    [step.argumentId]: [step.targetId],
    about: PageAbout.NewAlert,
    title: "Payments are failing",
    ...(overrides || {}),
  };
}

function result(overrides?: Partial<OnCallPageResult>): OnCallPageResult {
  return {
    record: {
      type: OnCallPageRecordType.Alert,
      id: new ObjectID(ALERT),
      label: "Alert #13",
      title: "Payments are failing",
      url: URL.fromString("https://oneuptime.test/dashboard/p/alerts/13"),
      isNew: true,
    },
    paged: [
      {
        userId: new ObjectID(JANE),
        name: "Jane Doe",
        email: "jane@example.com",
        teamName: null,
        scheduleName: null,
        coveringForName: null,
      },
    ],
    startedPolicies: [],
    notPaged: [],
    isAnyonePaged: true,
    directPageExecutionLogId: RUN_ID,
    summary: "Paged Jane Doe about Alert #13.",
    ...(overrides || {}),
  };
}

describe("the Page steps", () => {
  let pageCall: SpyInstance<typeof OnCallPageService.page>;
  let paged: OnCallPageResult;
  let pagingError: unknown;

  async function run(
    step: StepKind,
    args: JSONObject,
    fixture?: OptionsFixture | undefined,
  ): Promise<RunReturnType> {
    const options: OptionsFixture =
      fixture || makeOptions({ configuredArguments: args });

    return await new Page(step.id).run(args, options.options);
  }

  // What the paging call was asked for.
  function asked(): OnCallPageRequest {
    expect(pageCall).toHaveBeenCalledTimes(1);
    return pageCall.mock.calls[0]![0];
  }

  function idsOf(list: Array<ObjectID> | undefined): Array<string> {
    return (list || []).map((id: ObjectID): string => {
      return id.toString();
    });
  }

  beforeEach(() => {
    paged = result();
    pagingError = null;

    pageCall = jest
      .spyOn(OnCallPageService, "page")
      .mockImplementation(async (): Promise<OnCallPageResult> => {
        if (pagingError) {
          throw pagingError;
        }

        return paged;
      });

    // The project's plan, read from the database on a server with billing.
    jest
      .spyOn(CallerPlan, "withPlan")
      .mockImplementation(
        async (
          props: DatabaseCommonInteractionProps,
        ): Promise<DatabaseCommonInteractionProps> => {
          return props;
        },
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe.each(STEPS)("$title", (step: StepKind) => {
    test("asks for the records its setting names to be paged, in the workflow's project", async () => {
      await run(step, settings(step));

      const request: OnCallPageRequest = asked();

      expect(request.projectId.toString()).toBe(PROJECT_ID.toString());
      expect(idsOf(request.targets[step.requestKey])).toEqual([step.targetId]);

      // And nothing of any other kind.
      for (const other of STEPS) {
        if (other.requestKey !== step.requestKey) {
          expect(request.targets[other.requestKey]).toBeUndefined();
        }
      }
    });

    test("pages as the step: a Project Admin of the workflow's project, and never OneUptime itself", async () => {
      await run(step, settings(step));

      const props: DatabaseCommonInteractionProps = asked().props;

      expect(props.isRoot).toBeUndefined();
      expect(props.isMasterAdmin).toBeUndefined();
      expect(props.userType).toBe(UserType.Workflow);
      expect(props.userId).toBeUndefined();
      expect(props.tenantId!.toString()).toBe(PROJECT_ID.toString());
      expect(props.workflowId!.toString()).toBe(WORKFLOW_ID.toString());
      expect(props.workflowName).toBe("Page the on-call engineer");
      expect(props).toEqual(
        WorkflowPrincipal.getPropsWithoutPlan({
          projectId: PROJECT_ID,
          workflowId: WORKFLOW_ID,
          workflowName: "Page the on-call engineer",
        }),
      );

      const held: Array<Permission> = props.userTenantAccessPermission![
        PROJECT_ID.toString()
      ]!.permissions.map((permission: UserPermission): Permission => {
        return permission.permission;
      });

      expect(held).toContain(Permission.ProjectAdmin);
      expect(held).not.toContain(Permission.ProjectOwner);
    });

    test("takes Success when somebody was paged, and says who in a sentence", async () => {
      const fixture: OptionsFixture = makeOptions({
        configuredArguments: settings(step),
      });

      const ran: RunReturnType = await run(step, settings(step), fixture);

      expect(ran.executePort?.id).toBe("success");
      expect(ran.executePortReason).toBe("Paged Jane Doe about Alert #13.");
      expect(ran.returnValues["summary"]).toBe(
        "Paged Jane Doe about Alert #13.",
      );
      expect(ran.returnValues["alert-id"]).toBe(ALERT);
      expect(ran.returnValues["incident-id"]).toBeUndefined();
      expect(ran.returnValues["error"]).toBeUndefined();
      expect(fixture.log).toHaveBeenCalledWith(
        "Paged Jane Doe about Alert #13.",
      );
      expect(fixture.onError).not.toHaveBeenCalled();
    });

    test(
      step.returnsPagedUsers
        ? "returns everybody it paged, each with their id, name and email"
        : "returns no list of people: the policy's escalation rules decide who is paged, and when",
      async () => {
        paged = result({
          paged: [
            ...result().paged,
            {
              userId: new ObjectID(JOHN),
              name: "john@example.com",
              email: null,
              teamName: "Platform",
              scheduleName: null,
              coveringForName: null,
            },
          ],
        });

        const ran: RunReturnType = await run(step, settings(step));

        if (!step.returnsPagedUsers) {
          expect("paged-users" in ran.returnValues).toBe(false);
          return;
        }

        expect(ran.returnValues["paged-users"]).toEqual([
          { id: JANE, name: "Jane Doe", email: "jane@example.com" },
          // Somebody with no email on record gets an empty one, not a null.
          { id: JOHN, name: "john@example.com", email: "" },
        ]);
      },
    );

    test("returns only what it says it returns", async () => {
      const ran: RunReturnType = await run(step, settings(step));

      const declared: Array<string> = OnCallComponents.find(
        (metadata: { id: string }): boolean => {
          return metadata.id === step.id;
        },
      )!.returnValues.map((returnValue: { id: string }): string => {
        return returnValue.id;
      });

      for (const key of Object.keys(ran.returnValues)) {
        expect(declared).toContain(key);
      }
    });

    test("takes Error when nobody was paged, with why - and the record, so the Error path can page somebody else about it", async () => {
      paged = result({
        paged: [],
        isAnyonePaged: false,
        summary:
          "Nobody was paged about Alert #13. Nobody is on call in schedule Primary right now.",
      });

      const fixture: OptionsFixture = makeOptions({
        configuredArguments: settings(step),
      });

      const ran: RunReturnType = await run(step, settings(step), fixture);

      expect(ran.executePort?.id).toBe("error");
      expect(ran.returnValues).toEqual({
        "alert-id": ALERT,
        error:
          "Nobody was paged about Alert #13. Nobody is on call in schedule Primary right now.",
      });
      expect(ran.executePortReason).toBe(
        "Nobody was paged about Alert #13. Nobody is on call in schedule Primary right now.",
      );
      expect(fixture.log).toHaveBeenCalledWith(
        "Nobody was paged about Alert #13. Nobody is on call in schedule Primary right now.",
      );
      // The run goes on down Error: it is not stopped.
      expect(fixture.onError).not.toHaveBeenCalled();
    });

    test("takes Error with the paging call's own words when it refuses", async () => {
      pagingError = new BadDataException(
        "Nobody was paged. No incident has the ID 123.",
      );

      const ran: RunReturnType = await run(step, settings(step));

      expect(ran.executePort?.id).toBe("error");
      expect(ran.returnValues).toEqual({
        error: "Nobody was paged. No incident has the ID 123.",
      });
    });

    test("stops the run when its who-to-page setting was never filled in, naming the setting", async () => {
      for (const empty of [undefined, null, "", "   ", [], ["", "  "]]) {
        const args: JSONObject = settings(step);

        if (empty === undefined) {
          delete args[step.argumentId];
        } else {
          args[step.argumentId] = empty as JSONValue;
        }

        const fixture: OptionsFixture = makeOptions({
          configuredArguments: args,
        });

        await expect(run(step, args, fixture)).rejects.toThrow(
          `${step.argumentName} is empty, so this step has nobody to page. Open the step and choose who to page.`,
        );
        expect(fixture.onError).toHaveBeenCalledTimes(1);
        expect(fixture.onError.mock.calls[0]![0]).toBeInstanceOf(
          BadDataException,
        );
        expect(fixture.log).toHaveBeenCalledWith(
          `${step.argumentName} is empty, so this step has nobody to page. Open the step and choose who to page.`,
        );
      }

      expect(pageCall).not.toHaveBeenCalled();
    });
  });

  describe("what the page is about", () => {
    test("something new, by default: Title and Message become the new alert", async () => {
      for (const about of [PageAbout.NewAlert, "", "   ", undefined, null]) {
        pageCall.mockClear();

        const args: JSONObject = settings(USERS, {
          title: "  Payments are failing  ",
          message: "  Card payments **fail** at checkout.  ",
        });

        if (about === undefined) {
          delete args["about"];
        } else {
          args["about"] = about as JSONValue;
        }

        await run(USERS, args);

        expect(asked().about).toEqual({
          newAlert: {
            title: "Payments are failing",
            description: "Card payments **fail** at checkout.",
          },
        });
      }
    });

    test("a message left empty is left off", async () => {
      await run(USERS, settings(USERS, { message: "   " }));

      expect(asked().about).toEqual({
        newAlert: { title: "Payments are failing" },
      });
    });

    test("a severity, when one is chosen", async () => {
      await run(USERS, settings(USERS, { "alert-severity": SEVERITY }));

      expect(asked().about.newAlert!.alertSeverityId!.toString()).toBe(
        SEVERITY,
      );
    });

    test("a severity handed over as a record is read by its id", async () => {
      await run(
        USERS,
        settings(USERS, { "alert-severity": { _id: SEVERITY, name: "High" } }),
      );

      expect(asked().about.newAlert!.alertSeverityId!.toString()).toBe(
        SEVERITY,
      );
    });

    test("a title longer than an alert's title holds is cut, with a mark that it was", async () => {
      const longTitle: string = "Payments are failing. ".repeat(60);

      await run(USERS, settings(USERS, { title: longTitle }));

      const title: string = asked().about.newAlert!.title;

      expect(longTitle.length).toBeGreaterThan(ColumnLength.LongText);
      expect(title.length).toBeLessThanOrEqual(ColumnLength.LongText);
      expect(title.indexOf("Payments are failing. Payments")).toBe(0);
      expect(title.charAt(title.length - 1)).toBe(String.fromCharCode(0x2026));
    });

    test("a title that is a number or a record is read as text", async () => {
      await run(USERS, settings(USERS, { title: 503 }));

      expect(asked().about.newAlert!.title).toBe("503");
    });

    test("an incident: the Incident ID setting names it, and no alert is asked for", async () => {
      await run(
        USERS,
        settings(USERS, { about: PageAbout.Incident, "incident-id": INCIDENT }),
      );

      const about: OnCallPageRequest["about"] = asked().about;

      expect(about.incidentId!.toString()).toBe(INCIDENT);
      expect(about.alertId).toBeUndefined();
      expect(about.newAlert).toBeUndefined();
    });

    test("an alert: the Alert ID setting names it", async () => {
      await run(
        USERS,
        settings(USERS, { about: PageAbout.Alert, "alert-id": ALERT }),
      );

      const about: OnCallPageRequest["about"] = asked().about;

      expect(about.alertId!.toString()).toBe(ALERT);
      expect(about.incidentId).toBeUndefined();
      expect(about.newAlert).toBeUndefined();
    });

    test("the title of a page about an incident or an alert is not sent: the record has its own", async () => {
      await run(
        USERS,
        settings(USERS, {
          about: PageAbout.Incident,
          "incident-id": INCIDENT,
          title: "Left over from before",
          message: "Left over too",
          "alert-severity": SEVERITY,
        }),
      );

      expect(asked().about).toEqual({
        incidentId: expect.objectContaining({ id: INCIDENT }),
      });
    });

    test("a record handed over whole - the incident a trigger started on - is read by its id", async () => {
      for (const value of [
        { _id: INCIDENT, title: "Checkout is down" },
        { id: INCIDENT },
        JSON.stringify({ _id: INCIDENT }),
        { _type: "ObjectID", value: INCIDENT },
        `  ${INCIDENT}  `,
        INCIDENT.toUpperCase(),
      ]) {
        pageCall.mockClear();

        await run(
          USERS,
          settings(USERS, {
            about: PageAbout.Incident,
            "incident-id": value as JSONValue,
          }),
        );

        expect(asked().about.incidentId!.toString().toLowerCase()).toBe(
          INCIDENT,
        );
      }
    });

    test("the success of a page about an incident returns the incident's id", async () => {
      paged = result({
        record: {
          type: OnCallPageRecordType.Incident,
          id: new ObjectID(INCIDENT),
          label: "Incident INC-8",
          title: "Checkout is down",
          url: URL.fromString("https://oneuptime.test/dashboard/p/incidents/8"),
          isNew: false,
        },
        summary: "Paged Jane Doe about Incident INC-8.",
      });

      const ran: RunReturnType = await run(
        USERS,
        settings(USERS, { about: PageAbout.Incident, "incident-id": INCIDENT }),
      );

      expect(ran.returnValues["incident-id"]).toBe(INCIDENT);
      expect(ran.returnValues["alert-id"]).toBeUndefined();
    });
  });

  describe("what a setting can hold when the step runs", () => {
    test("people by id and by email address, in any mix and any of the shapes the runner hands over", async () => {
      for (const value of [
        [JANE, "john@example.com"],
        `${JANE}, john@example.com`,
        `${JANE}\njohn@example.com`,
        JSON.stringify([JANE, "john@example.com"]),
        [{ _id: JANE }, "John@Example.com"],
        [[JANE], ["john@example.com"]],
      ]) {
        pageCall.mockClear();

        await run(USERS, settings(USERS, { users: value as JSONValue }));

        expect(idsOf(asked().targets.userIds)).toEqual([JANE]);
        expect(asked().targets.userEmails).toEqual(["john@example.com"]);
      }
    });

    test("a list a workflow value resolved into, as the runner writes it into a setting", async () => {
      const resolved: JSONValue = VMUtil.replaceValueInPlace(
        {
          local: {
            components: {
              "find-owners": { returnValues: { owners: [JANE, JOHN] } },
            },
          },
        },
        "{{local.components.find-owners.returnValues.owners}}",
        true,
      ) as JSONValue;

      await run(USERS, settings(USERS, { users: [resolved] }));

      expect(idsOf(asked().targets.userIds)).toEqual([JANE, JOHN]);
    });

    test("each record once, however often it is named", async () => {
      await run(
        TEAMS,
        settings(TEAMS, { teams: [TEAM, TEAM, TEAM.toUpperCase()] }),
      );

      expect(idsOf(asked().targets.teamIds)).toEqual([TEAM]);
    });

    test("only people can be named by email address: for a team it is not an id", async () => {
      const ran: RunReturnType = await run(
        TEAMS,
        settings(TEAMS, { teams: ["platform@example.com"] }),
      );

      expect(pageCall).not.toHaveBeenCalled();
      expect(ran.executePort?.id).toBe("error");
      expect(ran.returnValues["error"]).toBe(
        'Nobody was paged. Teams held "platform@example.com", which is not an ID.',
      );
    });

    test("something that names nobody - a name, say - takes Error and says what it was", async () => {
      const ran: RunReturnType = await run(
        USERS,
        settings(USERS, { users: ["Jane Doe"] }),
      );

      expect(pageCall).not.toHaveBeenCalled();
      expect(ran.executePort?.id).toBe("error");
      expect(ran.returnValues["error"]).toBe(
        'Nobody was paged. Users held "Jane", "Doe", which are not an ID or an email address.',
      );
    });

    test("with somebody readable beside it, they are paged - and the summary says what was not read", async () => {
      const ran: RunReturnType = await run(
        USERS,
        settings(USERS, { users: [JANE, "the-on-call-person"] }),
      );

      expect(idsOf(asked().targets.userIds)).toEqual([JANE]);
      expect(ran.executePort?.id).toBe("success");
      expect(ran.returnValues["summary"]).toBe(
        'Paged Jane Doe about Alert #13. Users held "the-on-call-person", which is not an ID or an email address.',
      );
    });

    test("more than three unreadable entries are counted, not all quoted", async () => {
      const ran: RunReturnType = await run(
        USERS,
        settings(USERS, { users: ["a", "b", "c", "d", "e"] }),
      );

      expect(ran.returnValues["error"]).toBe(
        'Nobody was paged. Users held "a", "b", "c" and 2 more, which are not an ID or an email address.',
      );
    });

    test("what was not read is said beside a refusal of the paging call too", async () => {
      pagingError = new BadDataException(
        `Nobody was paged. No member of this project has the ID ${JANE}.`,
      );

      const ran: RunReturnType = await run(
        USERS,
        settings(USERS, { users: [JANE, "ops"] }),
      );

      expect(ran.returnValues["error"]).toBe(
        `Nobody was paged. No member of this project has the ID ${JANE}. Users held "ops", which is not an ID or an email address.`,
      );
    });

    test("and beside a page that reached nobody", async () => {
      paged = result({
        paged: [],
        isAnyonePaged: false,
        summary: "Nobody was paged about Alert #13.",
      });

      const ran: RunReturnType = await run(
        USERS,
        settings(USERS, { users: [JANE, "ops"] }),
      );

      expect(ran.executePort?.id).toBe("error");
      expect(ran.returnValues["error"]).toBe(
        'Nobody was paged about Alert #13. Users held "ops", which is not an ID or an email address.',
      );
    });
  });

  describe("a value from an earlier step that came out empty or wrong", () => {
    /*
     * The step is set up - its settings hold a {{value}} - so this is not a
     * mistake in the workflow: the run goes on down Error.
     */
    function configured(overrides: JSONObject): JSONObject {
      return settings(USERS, overrides);
    }

    async function runResolved(
      configuredOverrides: JSONObject,
      resolvedOverrides: JSONObject,
    ): Promise<{ ran: RunReturnType; fixture: OptionsFixture }> {
      const fixture: OptionsFixture = makeOptions({
        configuredArguments: configured(configuredOverrides),
      });

      const ran: RunReturnType = await run(
        USERS,
        settings(USERS, resolvedOverrides),
        fixture,
      );

      return { ran: ran, fixture: fixture };
    }

    test("who to page came out empty: Error, and nobody is asked to be paged", async () => {
      const { ran, fixture } = await runResolved(
        { users: ["{{local.components.find.returnValues.owners}}"] },
        { users: [""] },
      );

      expect(pageCall).not.toHaveBeenCalled();
      expect(fixture.onError).not.toHaveBeenCalled();
      expect(ran.executePort?.id).toBe("error");
      expect(ran.returnValues["error"]).toBe(
        "Nobody was paged. Users came out empty when the step ran, so there was nobody to page.",
      );
    });

    test("the title came out empty: Error", async () => {
      const { ran, fixture } = await runResolved(
        { title: "{{local.components.trigger.returnValues.subject}}" },
        { title: "  " },
      );

      expect(pageCall).not.toHaveBeenCalled();
      expect(fixture.onError).not.toHaveBeenCalled();
      expect(ran.returnValues["error"]).toBe(
        "Nobody was paged. Title came out empty when the step ran, and a page about a new alert needs a title.",
      );
    });

    /*
     * The runner leaves a value it cannot find exactly as it was written. A
     * webhook that sent no title leaves the Title holding its own reference,
     * and paged as it stands that is an alert named
     * "{{local.components.webhook-1.returnValues.request-body.title}}" and a
     * phone call that reads it out. It came to nothing, so it is read as
     * nothing.
     */
    const TITLE_FROM_WEBHOOK: string =
      "{{local.components.webhook-1.returnValues.request-body.title}}";
    const MESSAGE_FROM_WEBHOOK: string =
      "{{local.components.webhook-1.returnValues.request-body.message}}";

    test("the title's value was not found, and came through as it was written: Error, and nobody is paged with a reference for a title", async () => {
      const { ran, fixture } = await runResolved(
        { title: TITLE_FROM_WEBHOOK },
        { title: TITLE_FROM_WEBHOOK },
      );

      expect(pageCall).not.toHaveBeenCalled();
      expect(fixture.onError).not.toHaveBeenCalled();
      expect(ran.executePort?.id).toBe("error");
      expect(ran.returnValues["error"]).toBe(
        "Nobody was paged. Title came out empty when the step ran, and a page about a new alert needs a title.",
      );
    });

    test("the same with space around it, as a setting may be saved", async () => {
      const { ran } = await runResolved(
        { title: ` ${TITLE_FROM_WEBHOOK} ` },
        { title: TITLE_FROM_WEBHOOK },
      );

      expect(pageCall).not.toHaveBeenCalled();
      expect(ran.executePort?.id).toBe("error");
    });

    test("the message's value was not found: the page goes out without a message", async () => {
      const { ran } = await runResolved(
        { message: MESSAGE_FROM_WEBHOOK },
        { message: MESSAGE_FROM_WEBHOOK },
      );

      expect(ran.executePort?.id).toBe("success");
      expect(asked().about.newAlert).toEqual({ title: "Payments are failing" });
    });

    test("a title that was found is the title, whatever it says - text that looks like a reference too", async () => {
      // Another tool sent this as its title. It is what the setting came to, not what it held.
      const { ran } = await runResolved(
        { title: TITLE_FROM_WEBHOOK },
        { title: "{{local.variables.secret}} is down" },
      );

      expect(ran.executePort?.id).toBe("success");
      expect(asked().about.newAlert?.title).toBe(
        "{{local.variables.secret}} is down",
      );
    });

    test("a title partly filled in is kept: something was found for it", async () => {
      const { ran } = await runResolved(
        {
          title: `Disk full on {{local.variables.host}}: ${TITLE_FROM_WEBHOOK}`,
        },
        { title: `Disk full on db-1: ${TITLE_FROM_WEBHOOK}` },
      );

      expect(ran.executePort?.id).toBe("success");
      expect(asked().about.newAlert?.title).toBe(
        `Disk full on db-1: ${TITLE_FROM_WEBHOOK}`,
      );
    });

    test("a title typed into the step is never mistaken for one that was not found", async () => {
      const { ran } = await runResolved(
        { title: "Payments are failing" },
        { title: "Payments are failing" },
      );

      expect(ran.executePort?.id).toBe("success");
      expect(asked().about.newAlert?.title).toBe("Payments are failing");
    });

    test("a step run with nothing to compare with - no settings as they were saved - pages with what it was handed", async () => {
      const ran: RunReturnType = await run(
        USERS,
        settings(USERS, { title: TITLE_FROM_WEBHOOK }),
        makeOptions(),
      );

      expect(ran.executePort?.id).toBe("success");
      expect(asked().about.newAlert?.title).toBe(TITLE_FROM_WEBHOOK);
    });

    test("only a title and a message are read this way: the settings handed in are not changed", () => {
      const args: JSONObject = {
        users: [JANE],
        title: TITLE_FROM_WEBHOOK,
        message: MESSAGE_FROM_WEBHOOK,
        "incident-id": "{{local.components.trigger.returnValues.model._id}}",
      };
      const before: string = JSON.stringify(args);

      expect(Page.withoutUnresolvedText(args, { ...args })).toEqual({
        users: [JANE],
        "incident-id": "{{local.components.trigger.returnValues.model._id}}",
      });
      expect(JSON.stringify(args)).toBe(before);
      expect(Page.withoutUnresolvedText(args, undefined)).toBe(args);
    });

    test.each<[string, JSONValue, string]>([
      [
        "nothing",
        "",
        "Incident ID is empty, which is not the ID of one incident.",
      ],
      [
        "a name",
        "INC-8",
        'Incident ID is "INC-8", which is not the ID of one incident.',
      ],
      [
        "two ids",
        `${INCIDENT}, ${ALERT}`,
        `Incident ID is "${INCIDENT}, ${ALERT}", which is not the ID of one incident.`,
      ],
    ])(
      "the incident's id came out as %s: Error, in the setting's own name",
      async (_what: string, value: JSONValue, sentence: string) => {
        const { ran, fixture } = await runResolved(
          {
            about: PageAbout.Incident,
            "incident-id":
              "{{local.components.trigger.returnValues.model._id}}",
          },
          { about: PageAbout.Incident, "incident-id": value },
        );

        expect(pageCall).not.toHaveBeenCalled();
        expect(fixture.onError).not.toHaveBeenCalled();
        expect(ran.executePort?.id).toBe("error");
        expect(ran.returnValues["error"]).toBe(`Nobody was paged. ${sentence}`);
      },
    );

    test("the alert's id came out as something else: Error", async () => {
      const { ran } = await runResolved(
        {
          about: PageAbout.Alert,
          "alert-id": "{{local.components.trigger.returnValues.model._id}}",
        },
        { about: PageAbout.Alert, "alert-id": "not-an-alert" },
      );

      expect(ran.returnValues["error"]).toBe(
        'Nobody was paged. Alert ID is "not-an-alert", which is not the ID of one alert.',
      );
    });

    test("a long value is cut short where it is quoted back", async () => {
      const { ran } = await runResolved(
        {
          about: PageAbout.Alert,
          "alert-id": "{{local.components.trigger.returnValues.body}}",
        },
        { about: PageAbout.Alert, "alert-id": "x".repeat(500) },
      );

      const error: string = ran.returnValues["error"] as string;

      expect(error.length).toBeLessThan(200);
      expect(error).toContain(
        `"${"x".repeat(80)}${String.fromCharCode(0x2026)}"`,
      );
    });

    test("the severity came out as something that is no severity: Error, and no alert is created", async () => {
      const { ran } = await runResolved(
        { "alert-severity": "{{local.variables.severity}}" },
        { "alert-severity": "High" },
      );

      expect(pageCall).not.toHaveBeenCalled();
      expect(ran.returnValues["error"]).toBe(
        'Nobody was paged. Severity is "High", which is not the ID of an alert severity.',
      );
    });

    test("what the page is about came out as one of its choices: that is what the page is about", async () => {
      const { ran, fixture } = await runResolved(
        {
          about: "{{local.variables.about}}",
          "incident-id": "{{local.components.trigger.returnValues.model._id}}",
        },
        { about: PageAbout.Incident, "incident-id": INCIDENT },
      );

      expect(fixture.onError).not.toHaveBeenCalled();
      expect(ran.executePort?.id).toBe("success");
      expect(asked().about.incidentId!.toString()).toBe(INCIDENT);
    });

    test("a Page About saved as a value is not judged before the step runs: not it, and not the settings that go with a choice", async () => {
      // No title, no incident, no alert: which of them is needed is not known yet.
      const fixture: OptionsFixture = makeOptions({
        configuredArguments: {
          users: [JANE],
          about: "{{local.variables.about}}",
        },
      });

      const ran: RunReturnType = await run(
        USERS,
        { users: [JANE], about: PageAbout.Alert, "alert-id": "" },
        fixture,
      );

      expect(fixture.onError).not.toHaveBeenCalled();
      expect(ran.executePort?.id).toBe("error");
      expect(ran.returnValues["error"]).toBe(
        "Nobody was paged. Alert ID is empty, which is not the ID of one alert.",
      );
    });

    test("what the page is about came out as none of its choices: Error", async () => {
      const { ran, fixture } = await runResolved(
        { about: "{{local.variables.about}}" },
        { about: "carrier-pigeon" },
      );

      expect(pageCall).not.toHaveBeenCalled();
      // The setting as saved holds a value, so the workflow is not at fault.
      expect(fixture.onError).not.toHaveBeenCalled();
      expect(ran.returnValues["error"]).toBe(
        'Nobody was paged. Page About is "carrier-pigeon", which is not one of its choices.',
      );
    });
  });

  describe("a step that was never set up stops the run", () => {
    async function stopped(
      step: StepKind,
      args: JSONObject,
    ): Promise<{ message: string; fixture: OptionsFixture }> {
      const fixture: OptionsFixture = makeOptions({
        configuredArguments: args,
      });

      let message: string = "";

      try {
        await run(step, args, fixture);
      } catch (error) {
        message = (error as Error).message;
      }

      expect(fixture.onError).toHaveBeenCalledTimes(1);
      expect(pageCall).not.toHaveBeenCalled();

      return { message: message, fixture: fixture };
    }

    test("a page about a new alert with no title", async () => {
      const args: JSONObject = settings(USERS);
      delete args["title"];

      expect((await stopped(USERS, args)).message).toBe(
        "Title is empty. A page about a new alert needs a title: open the step and write one.",
      );
    });

    test("a page about an incident with no incident chosen", async () => {
      expect(
        (await stopped(USERS, settings(USERS, { about: PageAbout.Incident })))
          .message,
      ).toBe(
        "Incident ID is empty. Open the step and choose the incident to page about.",
      );
    });

    test("a page about an alert with no alert chosen", async () => {
      expect(
        (await stopped(USERS, settings(USERS, { about: PageAbout.Alert })))
          .message,
      ).toBe(
        "Alert ID is empty. Open the step and choose the alert to page about.",
      );
    });

    test("a Page About saved as something that is none of its choices", async () => {
      for (const about of ["carrier-pigeon", 7, { a: 1 }, ["incident"]]) {
        expect(
          (await stopped(USERS, settings(USERS, { about: about as JSONValue })))
            .message,
        ).toBe(
          "Page About is set to something this step does not know. Open the step and choose what the page is about.",
        );
      }
    });

    test("who to page is asked first: an empty step is told to choose who to page", async () => {
      expect((await stopped(USERS, {})).message).toBe(
        "Users is empty, so this step has nobody to page. Open the step and choose who to page.",
      );
    });

    test("it is the settings as saved that are judged: a step saved empty stops the run whatever its values came out as", async () => {
      const fixture: OptionsFixture = makeOptions({
        configuredArguments: settings(USERS, { users: [] }),
      });

      await expect(
        run(USERS, settings(USERS, { users: [JANE] }), fixture),
      ).rejects.toThrow("Users is empty, so this step has nobody to page.");
      expect(pageCall).not.toHaveBeenCalled();
    });

    test("with no record of the settings as saved, the values the step was handed are judged", async () => {
      const fixture: OptionsFixture = makeOptions();

      await expect(
        run(USERS, settings(USERS, { users: [] }), fixture),
      ).rejects.toThrow("Users is empty, so this step has nobody to page.");

      // And a step that is set up runs.
      await run(USERS, settings(USERS), makeOptions());

      expect(pageCall).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the paging call fails", () => {
    test.each<[string, unknown, string]>([
      [
        "a refusal for want of permission",
        new NotAuthorizedException(
          "You do not have permissions to create On-Call Duty Execution Log.",
        ),
        "You do not have permissions to create On-Call Duty Execution Log.",
      ],
      [
        "a fault of OneUptime's own",
        new TypeError("Cannot read properties of undefined (reading 'id')"),
        "Nobody was paged: the page could not be sent.",
      ],
      [
        "an error from the database",
        new Error('relation "OnCallDutyPolicyExecutionLog" does not exist'),
        "Nobody was paged: the page could not be sent.",
      ],
      [
        "a refusal with nothing to say",
        new BadDataException(""),
        "Nobody was paged: the page could not be sent.",
      ],
      [
        "something that is no error at all",
        "boom",
        "Nobody was paged: the page could not be sent.",
      ],
    ])(
      "%s takes Error with words for the workflow's author, and none of OneUptime's internals",
      async (_what: string, error: unknown, message: string) => {
        pagingError = error;

        const fixture: OptionsFixture = makeOptions({
          configuredArguments: settings(USERS),
        });

        const ran: RunReturnType = await run(USERS, settings(USERS), fixture);

        expect(ran.executePort?.id).toBe("error");
        expect(ran.returnValues).toEqual({ error: message });
        expect(ran.executePortReason).toBe(message);
        expect(fixture.log).toHaveBeenCalledWith(message);
        expect(fixture.onError).not.toHaveBeenCalled();
        expect(JSON.stringify(ran)).not.toContain("Cannot read properties");
        expect(JSON.stringify(ran)).not.toContain("relation");
      },
    );
  });

  describe("how long the page may wait for a record created a moment ago", () => {
    test("what the paging call takes by default, when the run does not say how long it has", () => {
      expect(Page.getMaxWaitForRecordInMs(makeOptions().options)).toBe(
        ON_CALL_PAGE_DEFAULT_MAX_WAIT_FOR_RECORD_IN_MS,
      );
    });

    test.each<[number, number]>([
      // Plenty of time: the default.
      [10 * 60 * 1000, ON_CALL_PAGE_DEFAULT_MAX_WAIT_FOR_RECORD_IN_MS],
      [45 * 1000, ON_CALL_PAGE_DEFAULT_MAX_WAIT_FOR_RECORD_IN_MS],
      // Half of what is left once five seconds are kept back for the run itself.
      [30 * 1000, 12500],
      [10 * 1000, 2500],
      [5001, 0],
      // No time to spare: the page goes out at once.
      [5000, 0],
      [1000, 0],
      [0, 0],
      [-200, 0],
    ])(
      "with %d ms of the workflow's time left it may wait %d ms",
      (remainingInMs: number, expected: number) => {
        expect(
          Page.getMaxWaitForRecordInMs(
            makeOptions({ remainingInMs: remainingInMs }).options,
          ),
        ).toBe(expected);
      },
    );

    test("the step hands the paging call that wait", async () => {
      await run(
        USERS,
        settings(USERS),
        makeOptions({
          configuredArguments: settings(USERS),
          remainingInMs: 30 * 1000,
        }),
      );

      expect(asked().maxWaitForRecordInMs).toBe(12500);
    });
  });

  describe("the workflow's name", () => {
    test("a workflow with no name pages all the same, and its props carry none", async () => {
      await run(
        USERS,
        settings(USERS),
        makeOptions({
          configuredArguments: settings(USERS),
          workflowName: undefined,
        }),
      );

      expect(asked().props.workflowName).toBeUndefined();
      expect(asked().props.workflowId!.toString()).toBe(WORKFLOW_ID.toString());
    });
  });

  describe("the steps the runner knows", () => {
    test.each(STEPS)(
      "$title is in the runner's registry, as the Page step with its own settings",
      (step: StepKind) => {
        const registered: ComponentCode | undefined =
          RuntimeComponents[step.id];

        expect(registered).toBeInstanceOf(Page);
        expect(registered!.getMetadata().id).toBe(step.id);
        expect(registered!.getMetadata().title).toBe(step.title);
        expect(
          registered!
            .getMetadata()
            .arguments.map((argument: { id: string }) => {
              return argument.id;
            }),
        ).toContain(step.argumentId);
      },
    );

    test("every step the palette offers under On-Call has code behind it", () => {
      expect(OnCallComponents).toHaveLength(STEPS.length);

      for (const metadata of OnCallComponents) {
        expect(RuntimeComponents[metadata.id]).toBeInstanceOf(Page);
      }
    });

    test("each has a Success and an Error output and nothing else", () => {
      for (const step of STEPS) {
        expect(
          new Page(step.id)
            .getMetadata()
            .outPorts.map((port: { id: string }) => {
              return port.id;
            }),
        ).toEqual(["success", "error"]);
      }
    });

    test("the class refuses to stand in for a step that is not a Page step", () => {
      expect(() => {
        return new Page(ComponentID.IfElse);
      }).toThrow("Component not found.");
      expect(() => {
        return new Page("page-everybody" as ComponentID);
      }).toThrow("Component not found.");
    });

    test("one step's page is not another's: each registry entry is its own object", () => {
      const seen: Set<ComponentCode> = new Set<ComponentCode>();

      for (const step of STEPS) {
        seen.add(RuntimeComponents[step.id]!);
      }

      expect(seen.size).toBe(STEPS.length);
      expect(POLICIES.returnsPagedUsers).toBe(false);
    });
  });
});
