import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentMember from "../../../../Models/DatabaseModels/IncidentMember";
import IncidentRole from "../../../../Models/DatabaseModels/IncidentRole";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../../Models/DatabaseModels/IncidentState";
import OnCallDutyPolicyExecutionLog from "../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import TeamMember from "../../../../Models/DatabaseModels/TeamMember";
import User from "../../../../Models/DatabaseModels/User";
import DatabaseConfig from "../../../../Server/DatabaseConfig";
import IncidentMemberService from "../../../../Server/Services/IncidentMemberService";
import IncidentRoleService from "../../../../Server/Services/IncidentRoleService";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentSeverityService from "../../../../Server/Services/IncidentSeverityService";
import IncidentStateService from "../../../../Server/Services/IncidentStateService";
import OnCallPageService, {
  OnCallPageRecordType,
  OnCallPageResult,
} from "../../../../Server/Services/OnCallPageService";
import TeamMemberService from "../../../../Server/Services/TeamMemberService";
import { WHAT_TO_DO_WHEN_NOBODY_WAS_REACHED } from "../../../../Server/Utils/Workspace/LiveMessages/OnCallPolicyRunMessageView";
import { SLACK_INCIDENT_ACTION_IDS } from "../../../../Server/Utils/Workspace/Slack/Messages/Incident";
import WorkspaceActionAuthorization from "../../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import WorkspaceIncidentActions, {
  WorkspaceIncidentCard,
  WorkspaceIncidentForForm,
  WorkspaceIncidentRoleForm,
  WorkspaceIncidentRoleHolder,
  WorkspaceRoleAssignment,
} from "../../../../Server/Utils/Workspace/WorkspaceIncidentActions";
import { WorkspaceCustomFieldsForm } from "../../../../Server/Utils/Workspace/WorkspaceIncidentCustomFields";
import WorkspaceMemberActions, {
  WorkspaceEventRecord,
  WorkspaceEventType,
} from "../../../../Server/Utils/Workspace/WorkspaceMemberActions";
import {
  WORKSPACE_PAGE_FORM_TEXT,
  WORKSPACE_PAGE_MAX_WAIT_FOR_RECORD_IN_MS,
} from "../../../../Server/Utils/Workspace/WorkspacePage";
import URL from "../../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../../Types/Exception/NotFoundException";
import PaymentRequiredException from "../../../../Types/Exception/PaymentRequiredException";
import ObjectID from "../../../../Types/ObjectID";
import { MAX_ON_CALL_DIRECT_PAGE_TARGETS } from "../../../../Types/OnCallDutyPolicy/OnCallDirectPage";
import Permission, { UserPermission } from "../../../../Types/Permission";
import {
  WorkspaceMessageBlock,
  WorkspacePayloadButtons,
  WorkspacePayloadMarkdown,
} from "../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";

/*
 * ACTING ON AN INCIDENT FROM SLACK OR MICROSOFT TEAMS: WHAT BOTH CHATS SHARE.
 *
 * Customer feedback: "incident actions (set a custom fields, escalate to
 * someone else, etc.) cannot be triggered directly from Slack (requiring
 * users to use the web UI), and the /incident command only creates
 * incidents." WorkspaceIncidentActions is what the incident message's menu
 * and `/oneuptime incident <number>` do in both chats: who may do what, the
 * incident as the member reads it, the writes - always as the member, never
 * as OneUptime - and the words each chat answers with. Only the database is
 * stubbed here; the chats' own handling has suites of its own.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "8091a2b3-c4d5-4e6f-9a7b-8c9d0e1f2a3b",
);
const USER_ID: ObjectID = new ObjectID("91a2b3c4-d5e6-4f7a-8b8c-9d0e1f2a3b4c");
const INCIDENT_ID: ObjectID = new ObjectID(
  "a2b3c4d5-e6f7-4a8b-9c9d-0e1f2a3b4c5d",
);
const SEVERITY_ID: ObjectID = new ObjectID(
  "b3c4d5e6-f7a8-4b9c-8d0e-1f2a3b4c5d6e",
);
const OTHER_SEVERITY_ID: ObjectID = new ObjectID(
  "c4d5e6f7-a8b9-4c0d-9e1f-2a3b4c5d6e7f",
);
const COMMANDER_ROLE_ID: ObjectID = new ObjectID(
  "d5e6f7a8-b9c0-4d1e-8f2a-3b4c5d6e7f80",
);
const SCRIBE_ROLE_ID: ObjectID = new ObjectID(
  "e6f7a8b9-c0d1-4e2f-9a3b-4c5d6e7f8091",
);
const ANA_ID: ObjectID = new ObjectID("f7a8b9c0-d1e2-4f3a-8b4c-5d6e7f8091a2");
const LEE_ID: ObjectID = new ObjectID("08b9c0d1-e2f3-4a4b-9c5d-6e7f8091a2b3");
const ANA_MEMBER_ID: ObjectID = new ObjectID(
  "19c0d1e2-f3a4-4b5c-8d6e-7f8091a2b3c4",
);
const LEE_MEMBER_ID: ObjectID = new ObjectID(
  "2ad1e2f3-a4b5-4c6d-9e7f-8091a2b3c4d5",
);
const STATE_ID: ObjectID = new ObjectID("3be2f3a4-b5c6-4d7e-8f80-91a2b3c4d5e6");

const DASHBOARD_URL: string = "https://oneuptime.test/dashboard";
const INCIDENT_LINK: string = `${DASHBOARD_URL}/${PROJECT_ID.toString()}/incidents/${INCIDENT_ID.toString()}`;
const RECORD: string = `**[Incident INC-42](${INCIDENT_LINK})**`;

function memberProps(
  permissions: Array<Permission> = [Permission.ProjectMember],
): DatabaseCommonInteractionProps {
  return {
    userId: USER_ID,
    tenantId: PROJECT_ID,
    userTeamIds: [],
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: permissions.map(
          (permission: Permission): UserPermission => {
            return {
              _type: "UserPermission",
              permission: permission,
              isBlockPermission: false,
              labelIds: [],
            };
          },
        ),
      },
    },
  };
}

function incidentEvent(
  more: Partial<WorkspaceEventRecord> = {},
): WorkspaceEventRecord {
  return {
    type: WorkspaceEventType.Incident,
    id: INCIDENT_ID,
    projectId: PROJECT_ID,
    currentStateId: undefined,
    number: 42,
    numberWithPrefix: "INC-42",
    ...more,
  };
}

function user(name: string | null, email: string): User {
  const row: User = new User();
  if (name !== null) {
    row.name = name as never;
  }
  row.email = email as never;
  return row;
}

function holderRow(data: {
  memberId: ObjectID;
  userId: ObjectID;
  roleId: ObjectID;
  roleName: string;
  name: string;
}): IncidentMember {
  const row: IncidentMember = new IncidentMember();
  row.id = data.memberId;
  row.userId = data.userId;
  row.incidentRoleId = data.roleId;
  row.user = user(
    data.name,
    `${data.name.split(" ")[0]!.toLowerCase()}@acme.test`,
  );
  const role: IncidentRole = new IncidentRole();
  role.name = data.roleName;
  row.incidentRole = role;
  return row;
}

const ANA_AS_COMMANDER: IncidentMember = holderRow({
  memberId: ANA_MEMBER_ID,
  userId: ANA_ID,
  roleId: COMMANDER_ROLE_ID,
  roleName: "Incident Commander",
  name: "Ana Ruiz",
});

const LEE_AS_SCRIBE: IncidentMember = holderRow({
  memberId: LEE_MEMBER_ID,
  userId: LEE_ID,
  roleId: SCRIBE_ROLE_ID,
  roleName: "Scribe",
  name: "Lee Wong",
});

function stubHolders(
  rows: Array<IncidentMember>,
): SpyInstance<typeof IncidentMemberService.findBy> {
  return jest.spyOn(IncidentMemberService, "findBy").mockResolvedValue(rows);
}

function role(data: {
  id: ObjectID;
  name: string;
  canAssignMultipleUsers: boolean;
}): IncidentRole {
  const row: IncidentRole = new IncidentRole();
  row.id = data.id;
  row.name = data.name;
  row.canAssignMultipleUsers = data.canAssignMultipleUsers;
  return row;
}

const COMMANDER: IncidentRole = role({
  id: COMMANDER_ROLE_ID,
  name: "Incident Commander",
  canAssignMultipleUsers: false,
});

const SCRIBE: IncidentRole = role({
  id: SCRIBE_ROLE_ID,
  name: "Scribe",
  canAssignMultipleUsers: true,
});

function teamMember(
  userId: ObjectID,
  name: string | null,
  email: string,
): TeamMember {
  const row: TeamMember = new TeamMember();
  row.userId = userId;
  row.user = user(name, email);
  row.user.id = userId;
  return row;
}

/*
 * readEventForMember is generic, which a SpyInstance of its own type cannot
 * hold: its spy, as these tests stub and read it.
 */
type FindEventSpy = SpyInstance<(data: unknown) => Promise<unknown>>;

function spyOnFindEvent(): FindEventSpy {
  return jest.spyOn(
    WorkspaceMemberActions,
    "readEventForMember",
  ) as unknown as FindEventSpy;
}

// The read that answers null, not a refusal: for a chat's own answer.
function spyOnFindEventOrNull(): FindEventSpy {
  return jest.spyOn(
    WorkspaceMemberActions,
    "findEventForMember",
  ) as unknown as FindEventSpy;
}

beforeEach(() => {
  jest
    .spyOn(DatabaseConfig, "getDashboardUrl")
    .mockResolvedValue(URL.fromString(DASHBOARD_URL));
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("WorkspaceIncidentActions.authorizeForForm: may the member do what a form does, and the incident as they read it", () => {
  function stubFound(title: string | undefined): FindEventSpy {
    const record: Incident = new Incident();
    record.id = INCIDENT_ID;
    if (title !== undefined) {
      record.title = title;
    }

    return spyOnFindEvent().mockResolvedValue({
      record: record,
      event: incidentEvent(),
    });
  }

  test("a form that creates a row (a role's member, a page): the create permission, then the incident as they read it", async () => {
    const props: DatabaseCommonInteractionProps = memberProps();
    const canCreate: SpyInstance<
      typeof WorkspaceActionAuthorization.assertCanCreate
    > = jest
      .spyOn(WorkspaceActionAuthorization, "assertCanCreate")
      .mockResolvedValue();
    const canUpdate: SpyInstance<
      typeof WorkspaceActionAuthorization.assertCanUpdate
    > = jest.spyOn(WorkspaceActionAuthorization, "assertCanUpdate");
    const found: FindEventSpy = stubFound("Checkout is down");

    const incident: WorkspaceIncidentForForm =
      await WorkspaceIncidentActions.authorizeForForm({
        incidentId: INCIDENT_ID,
        props: props,
        check: {
          kind: "create",
          modelType: OnCallDutyPolicyExecutionLog,
          action: "page someone about this incident",
        },
      });

    expect(incident).toEqual({
      event: incidentEvent(),
      title: "Checkout is down",
    });
    expect(canCreate).toHaveBeenCalledWith({
      props: props,
      modelType: OnCallDutyPolicyExecutionLog,
      action: "page someone about this incident",
    });
    expect(canUpdate).not.toHaveBeenCalled();
    /*
     * Read as the member, refusing with why for what the form does - and
     * whether it is private, which only its owners' teams change.
     */
    expect(found).toHaveBeenCalledWith({
      event: { type: WorkspaceEventType.Incident, id: INCIDENT_ID },
      props: props,
      select: { title: true, isPrivate: true },
      action: "page someone about this incident",
    });
  });

  test("a form that changes the incident: the update permission, for exactly the columns it writes", async () => {
    const props: DatabaseCommonInteractionProps = memberProps();
    const canUpdate: SpyInstance<
      typeof WorkspaceActionAuthorization.assertCanUpdate
    > = jest
      .spyOn(WorkspaceActionAuthorization, "assertCanUpdate")
      .mockResolvedValue();
    const canCreate: SpyInstance<
      typeof WorkspaceActionAuthorization.assertCanCreate
    > = jest.spyOn(WorkspaceActionAuthorization, "assertCanCreate");
    stubFound(undefined);

    const incident: WorkspaceIncidentForForm =
      await WorkspaceIncidentActions.authorizeForForm({
        incidentId: INCIDENT_ID,
        props: props,
        check: {
          kind: "update",
          data: { customFields: {} },
          action: "edit the custom fields of this incident",
        },
      });

    // An incident with no title reads as one with an empty one.
    expect(incident.title).toBe("");
    expect(canUpdate).toHaveBeenCalledWith({
      props: props,
      modelType: Incident,
      data: { customFields: {} },
      action: "edit the custom fields of this incident",
    });
    expect(canCreate).not.toHaveBeenCalled();
  });

  test.each([
    [
      "a permission the member lacks",
      new NotAuthorizedException(
        "You do not have permission to change the severity of this incident.",
      ),
    ],
    [
      "a plan that does not include it",
      new PaymentRequiredException("Please upgrade your plan."),
    ],
  ])(
    "%s is refused as it is, before the incident is read",
    async (_name: string, refusal: Error) => {
      jest
        .spyOn(WorkspaceActionAuthorization, "assertCanUpdate")
        .mockRejectedValue(refusal);
      const found: FindEventSpy = spyOnFindEvent();

      await expect(
        WorkspaceIncidentActions.authorizeForForm({
          incidentId: INCIDENT_ID,
          props: memberProps(),
          check: {
            kind: "update",
            data: { incidentSeverityId: SEVERITY_ID },
            action: "change the severity of this incident",
          },
        }),
      ).rejects.toBe(refusal);
      expect(found).not.toHaveBeenCalled();
    },
  );

  test("an incident their access does not include is refused with that, never as one that is not there", async () => {
    jest
      .spyOn(WorkspaceActionAuthorization, "assertCanCreate")
      .mockResolvedValue();
    // Their own read finds nothing; OneUptime's finds it, and it is not private.
    jest
      .spyOn(IncidentService, "findOneBy")
      .mockImplementation((async (findOneBy: {
        props: DatabaseCommonInteractionProps;
      }) => {
        if (!findOneBy.props.isRoot) {
          return null;
        }

        const incident: Incident = new Incident();
        incident.id = INCIDENT_ID;
        return incident;
      }) as never);

    await expect(
      WorkspaceIncidentActions.authorizeForForm({
        incidentId: INCIDENT_ID,
        props: memberProps(),
        check: {
          kind: "create",
          modelType: IncidentMember,
          action: "assign a role on this incident",
        },
      }),
    ).rejects.toThrow(
      new NotAuthorizedException(
        "You do not have permission to assign a role on this incident: your access in this project does not include this incident. Ask a project admin for access to it.",
      ),
    );
  });

  test("an incident that is gone is not found - it may have been deleted", async () => {
    jest
      .spyOn(WorkspaceActionAuthorization, "assertCanCreate")
      .mockResolvedValue();
    jest.spyOn(IncidentService, "findOneBy").mockResolvedValue(null);

    await expect(
      WorkspaceIncidentActions.authorizeForForm({
        incidentId: INCIDENT_ID,
        props: memberProps(),
        check: {
          kind: "create",
          modelType: IncidentMember,
          action: "assign a role on this incident",
        },
      }),
    ).rejects.toThrow(
      new NotAuthorizedException(
        "Could not assign a role on this incident: the incident was not found. It may have been deleted.",
      ),
    );
  });
});

describe("WorkspaceIncidentActions.getFormHeading", () => {
  test.each([
    [incidentEvent(), "🚨 **INC-42** Checkout is down"],
    [incidentEvent({ numberWithPrefix: null }), "🚨 **#42** Checkout is down"],
    [
      incidentEvent({ numberWithPrefix: null, number: null }),
      "🚨 Checkout is down",
    ],
  ])("%p: %p", (event: WorkspaceEventRecord, heading: string) => {
    expect(
      WorkspaceIncidentActions.getFormHeading({
        event: event,
        title: "Checkout is down",
      }).toString(),
    ).toBe(heading);
  });

  test("the title is text: Markdown in it does not act", () => {
    expect(
      WorkspaceIncidentActions.getFormHeading({
        event: incidentEvent(),
        title: "**Down** [now](https://evil.test)",
      }).toString(),
    ).toBe("🚨 **INC-42** \\*\\*Down\\*\\* \\[now\\](https://evil.test)");
  });
});

describe("WorkspaceIncidentActions.getCardHeading and getFactsLine: the card's first two lines", () => {
  test("the number, linked, and the title, both in bold", () => {
    expect(
      WorkspaceIncidentActions.getCardHeading({
        number: "INC-42",
        title: "Checkout is down",
        link: INCIDENT_LINK,
      }).toString(),
    ).toBe(`🚨 **[INC-42](${INCIDENT_LINK})** · **Checkout is down**`);
  });

  test("the title is text, on one line: Markdown in it does not act, a line break is a space", () => {
    expect(
      WorkspaceIncidentActions.getCardHeading({
        number: "INC-42",
        title: "  **Down**\n[now](https://evil.test)  ",
        link: INCIDENT_LINK,
      }).toString(),
    ).toBe(
      `🚨 **[INC-42](${INCIDENT_LINK})** · **\\*\\*Down\\*\\* \\[now\\](https://evil.test)**`,
    );
  });

  test("no title: the number alone", () => {
    expect(
      WorkspaceIncidentActions.getCardHeading({
        number: "#42",
        title: " ",
        link: INCIDENT_LINK,
      }).toString(),
    ).toBe(`🚨 **[#42](${INCIDENT_LINK})**`);
  });

  test.each([
    [
      { severity: "Critical", state: "Identified" },
      "Severity: Critical · State: Identified · Declared {{DATE(2026-10-15T09:30:00Z, SHORT)}} at {{TIME(2026-10-15T09:30:00Z)}}",
    ],
    [
      { severity: null, state: "Resolved" },
      "State: Resolved · Declared {{DATE(2026-10-15T09:30:00Z, SHORT)}} at {{TIME(2026-10-15T09:30:00Z)}}",
    ],
    [
      { severity: "Minor", state: null },
      "Severity: Minor · Declared {{DATE(2026-10-15T09:30:00Z, SHORT)}} at {{TIME(2026-10-15T09:30:00Z)}}",
    ],
  ])(
    "%p: each part there only when the incident has it",
    (
      parts: { severity: string | null; state: string | null },
      line: string,
    ) => {
      expect(
        WorkspaceIncidentActions.getFactsLine({
          ...parts,
          declaredAt: new Date("2026-10-15T09:30:00.000Z"),
        })!.toString(),
      ).toBe(line);
    },
  );

  test("a severity or state named in Markdown is text", () => {
    expect(
      WorkspaceIncidentActions.getFactsLine({
        severity: "*P1*",
        state: null,
        declaredAt: null,
      })!.toString(),
    ).toBe("Severity: \\*P1\\*");
  });

  test("nothing known: no line", () => {
    expect(
      WorkspaceIncidentActions.getFactsLine({
        severity: null,
        state: null,
        declaredAt: null,
      }),
    ).toBeNull();
  });
});

describe("WorkspaceIncidentActions.findByNumber: the incident a number names, as the member reads it", () => {
  function stubIncident(
    numberWithPrefix: string | null,
  ): SpyInstance<typeof IncidentService.findOneBy> {
    const incident: Incident = new Incident();
    incident.id = INCIDENT_ID;
    if (numberWithPrefix) {
      incident.incidentNumberWithPrefix = numberWithPrefix;
    }

    return jest.spyOn(IncidentService, "findOneBy").mockResolvedValue(incident);
  }

  test("42 is incident 42 of this project, read with the member's own props", async () => {
    const props: DatabaseCommonInteractionProps = memberProps();
    const read: SpyInstance<typeof IncidentService.findOneBy> =
      stubIncident("INC-42");

    expect(
      await WorkspaceIncidentActions.findByNumber({
        projectId: PROJECT_ID,
        word: WorkspaceIncidentActions.readNumberWord("42")!,
        props: props,
      }),
    ).toEqual(INCIDENT_ID);

    expect(read).toHaveBeenCalledWith({
      query: { projectId: PROJECT_ID, incidentNumber: 42 },
      select: { _id: true, incidentNumberWithPrefix: true },
      props: props,
    });
  });

  test.each([["INC-42"], ["inc-42"], ["#42"]])(
    "%s names incident INC-42",
    async (typed: string) => {
      stubIncident("INC-42");

      expect(
        await WorkspaceIncidentActions.findByNumber({
          projectId: PROJECT_ID,
          word: WorkspaceIncidentActions.readNumberWord(typed)!,
          props: memberProps(),
        }),
      ).toEqual(INCIDENT_ID);
    },
  );

  test("SEV-42 is not incident INC-42: a prefix that is not the incident's names none", async () => {
    stubIncident("INC-42");

    expect(
      await WorkspaceIncidentActions.findByNumber({
        projectId: PROJECT_ID,
        word: WorkspaceIncidentActions.readNumberWord("SEV-42")!,
        props: memberProps(),
      }),
    ).toBeNull();
  });

  test.each([
    ["no incident of that number", null],
    ["a read the member may not make", new NotAuthorizedException("no read")],
    ["a plan that does not include it", new PaymentRequiredException("plan")],
  ])("%s: none", async (_name: string, outcome: Error | null) => {
    if (outcome) {
      jest.spyOn(IncidentService, "findOneBy").mockRejectedValue(outcome);
    } else {
      jest.spyOn(IncidentService, "findOneBy").mockResolvedValue(null);
    }

    expect(
      await WorkspaceIncidentActions.findByNumber({
        projectId: PROJECT_ID,
        word: WorkspaceIncidentActions.readNumberWord("42")!,
        props: memberProps(),
      }),
    ).toBeNull();
  });

  test("a failure that is not a refusal is thrown", async () => {
    const failure: Error = new Error("connect ECONNREFUSED 10.0.0.5:5432");
    jest.spyOn(IncidentService, "findOneBy").mockRejectedValue(failure);

    await expect(
      WorkspaceIncidentActions.findByNumber({
        projectId: PROJECT_ID,
        word: WorkspaceIncidentActions.readNumberWord("42")!,
        props: memberProps(),
      }),
    ).rejects.toBe(failure);
  });
});

describe("WorkspaceIncidentActions.findChannelOwner: the incident a channel was made for", () => {
  test("read as OneUptime - which channels are an incident's is OneUptime's to know - by the channel's id", async () => {
    const incident: Incident = new Incident();
    incident.id = INCIDENT_ID;
    const read: SpyInstance<typeof IncidentService.findOneBy> = jest
      .spyOn(IncidentService, "findOneBy")
      .mockResolvedValue(incident);

    expect(
      await WorkspaceIncidentActions.findChannelOwner({
        projectId: PROJECT_ID,
        channelId: "C0INC42",
      }),
    ).toEqual(INCIDENT_ID);

    expect(read).toHaveBeenCalledTimes(1);
    const findBy: {
      query: Record<string, unknown>;
      props: DatabaseCommonInteractionProps;
    } = read.mock.calls[0]![0] as never;
    expect(findBy.props).toEqual({ isRoot: true });
    expect(findBy.query["projectId"]).toEqual(PROJECT_ID);
    // A JSON containment of the channel, as the incident stores its channels.
    expect(
      JSON.stringify(findBy.query["postUpdatesToWorkspaceChannels"]),
    ).toContain("C0INC42");
  });

  test("any other channel belongs to no incident", async () => {
    jest.spyOn(IncidentService, "findOneBy").mockResolvedValue(null);

    expect(
      await WorkspaceIncidentActions.findChannelOwner({
        projectId: PROJECT_ID,
        channelId: "C0GENERAL",
      }),
    ).toBeNull();
  });

  test("no channel (a direct message): none, and nothing is read", async () => {
    const read: SpyInstance<typeof IncidentService.findOneBy> = jest.spyOn(
      IncidentService,
      "findOneBy",
    );

    expect(
      await WorkspaceIncidentActions.findChannelOwner({
        projectId: PROJECT_ID,
        channelId: "",
      }),
    ).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });
});

describe("WorkspaceIncidentActions.isReadable", () => {
  test.each([
    ["an incident they may read", "found", true],
    ["none", "none", false],
    ["a refused read", "refused", false],
  ])("%s: %p", async (_name: string, outcome: string, readable: boolean) => {
    const read: SpyInstance<typeof IncidentService.findOneBy> = jest.spyOn(
      IncidentService,
      "findOneBy",
    );

    if (outcome === "found") {
      read.mockResolvedValue(new Incident());
    } else if (outcome === "none") {
      read.mockResolvedValue(null);
    } else {
      read.mockRejectedValue(new NotAuthorizedException("no read"));
    }

    const props: DatabaseCommonInteractionProps = memberProps();

    expect(
      await WorkspaceIncidentActions.isReadable({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
        props: props,
      }),
    ).toBe(readable);
    expect(read.mock.calls[0]![0]).toEqual({
      query: { _id: INCIDENT_ID.toString(), projectId: PROJECT_ID },
      select: { _id: true },
      props: props,
    });
  });
});

describe("WorkspaceIncidentActions.getCard: the incident, as `/oneuptime incident 42` answers it", () => {
  /*
   * The incident as the member reads it; `isBare`: its number and title
   * only, and when it was created, when given.
   */
  function stubIncident(
    options: { isBare?: boolean; stateName?: string; createdAt?: Date } = {},
  ): SpyInstance<typeof IncidentService.findOneBy> {
    const incident: Incident = new Incident();
    incident.id = INCIDENT_ID;
    incident.title = "Checkout is down";
    incident.incidentNumber = 42;

    if (options.createdAt) {
      incident.createdAt = options.createdAt;
    }

    if (!options.isBare) {
      incident.incidentNumberWithPrefix = "INC-42";
      incident.declaredAt = new Date("2026-10-15T09:30:00.000Z");
      const severity: IncidentSeverity = new IncidentSeverity();
      severity.name = "Critical";
      incident.incidentSeverity = severity;
      const state: IncidentState = new IncidentState();
      state.name = options.stateName || "Identified";
      incident.currentIncidentState = state;
    }

    return jest.spyOn(IncidentService, "findOneBy").mockResolvedValue(incident);
  }

  // Its number and title, in bold, first: what the card is about.
  const HEADING: WorkspacePayloadMarkdown = {
    _type: "WorkspacePayloadMarkdown",
    text: `🚨 **[INC-42](${INCIDENT_LINK})** · **Checkout is down**`,
  };

  // Then what it is now, each part named.
  const FACTS: WorkspacePayloadMarkdown = {
    _type: "WorkspacePayloadMarkdown",
    text: "Severity: Critical · State: Identified · Declared {{DATE(2026-10-15T09:30:00Z, SHORT)}} at {{TIME(2026-10-15T09:30:00Z)}}",
  };

  // The blocks of a card, but its buttons.
  function linesOf(card: WorkspaceIncidentCard | null): Array<string> {
    return card!.messageBlocks
      .filter((block: WorkspaceMessageBlock): boolean => {
        return block._type === "WorkspacePayloadMarkdown";
      })
      .map((block: WorkspaceMessageBlock): string => {
        return (block as WorkspacePayloadMarkdown).text;
      });
  }

  test("its number and title, in bold; then its severity, state and when it was declared; who holds its roles; then its buttons and menu", async () => {
    const props: DatabaseCommonInteractionProps = memberProps();
    const read: SpyInstance<typeof IncidentService.findOneBy> = stubIncident();
    stubHolders([ANA_AS_COMMANDER, LEE_AS_SCRIBE]);

    const card: WorkspaceIncidentCard | null =
      await WorkspaceIncidentActions.getCard({
        incidentId: INCIDENT_ID,
        projectId: PROJECT_ID,
        props: props,
        workspaceType: WorkspaceType.Slack,
        actions: SLACK_INCIDENT_ACTION_IDS,
      });

    expect(card).not.toBeNull();
    expect(card!.text).toBe("INC-42 Checkout is down");
    /*
     * Each line a block of its own: Slack stacks them as lines, and Teams
     * would run lines of one text block together.
     */
    expect(card!.messageBlocks).toEqual([
      HEADING,
      FACTS,
      {
        _type: "WorkspacePayloadMarkdown",
        text: "👤 Incident Commander: **Ana Ruiz** · Scribe: **Lee Wong**",
      },
      WorkspaceIncidentActions.getButtonsBlock({
        incidentId: INCIDENT_ID,
        incidentLink: URL.fromString(INCIDENT_LINK),
        actions: SLACK_INCIDENT_ACTION_IDS,
      }),
    ]);

    // Read as the member: their labels and owners decide what they see.
    expect(read.mock.calls[0]![0].props).toBe(props);
    expect(read.mock.calls[0]![0].query).toEqual({
      _id: INCIDENT_ID.toString(),
      projectId: PROJECT_ID,
    });
  });

  test("its buttons carry the incident: four buttons, and five more in its menu", async () => {
    stubIncident();
    stubHolders([]);

    const card: WorkspaceIncidentCard | null =
      await WorkspaceIncidentActions.getCard({
        incidentId: INCIDENT_ID,
        projectId: PROJECT_ID,
        props: memberProps(),
        workspaceType: WorkspaceType.Slack,
        actions: SLACK_INCIDENT_ACTION_IDS,
      });

    const buttons: WorkspacePayloadButtons = card!.messageBlocks.find(
      (block: WorkspaceMessageBlock): boolean => {
        return block._type === "WorkspacePayloadButtons";
      },
    ) as WorkspacePayloadButtons;

    expect(
      buttons.buttons.map((button: { title: string; value: string }) => {
        return [button.title, button.value];
      }),
    ).toEqual([
      ["👀 Acknowledge Incident", INCIDENT_ID.toString()],
      ["✅ Resolve Incident", INCIDENT_ID.toString()],
      ["📄 Add Note", INCIDENT_ID.toString()],
      ["🔗 View Incident", INCIDENT_ID.toString()],
    ]);
    expect(
      (buttons.menuButtons || []).map((button: { title: string }) => {
        return button.title;
      }),
    ).toEqual([
      "⚠️ Change Severity",
      "➡️ Change Incident State",
      "👤 Assign Role",
      "📟 Page Someone",
      "📝 Edit Custom Fields",
    ]);
  });

  test("no roles held, no severity, no prefix: what there is", async () => {
    stubIncident({ isBare: true });
    stubHolders([]);

    const card: WorkspaceIncidentCard | null =
      await WorkspaceIncidentActions.getCard({
        incidentId: INCIDENT_ID,
        projectId: PROJECT_ID,
        props: memberProps(),
        workspaceType: WorkspaceType.Slack,
        actions: SLACK_INCIDENT_ACTION_IDS,
      });

    // Nothing to say of what it is now: no line for it.
    expect(linesOf(card)).toEqual([
      `🚨 **[#42](${INCIDENT_LINK})** · **Checkout is down**`,
    ]);
    expect(card!.text).toBe("#42 Checkout is down");
  });

  test("a resolved incident: 'Declared', never 'since', which would say it is resolved since it began", async () => {
    stubIncident({ stateName: "Resolved" });
    stubHolders([]);

    const card: WorkspaceIncidentCard | null =
      await WorkspaceIncidentActions.getCard({
        incidentId: INCIDENT_ID,
        projectId: PROJECT_ID,
        props: memberProps(),
        workspaceType: WorkspaceType.Slack,
        actions: SLACK_INCIDENT_ACTION_IDS,
      });

    expect(linesOf(card)[1]).toBe(
      "Severity: Critical · State: Resolved · Declared {{DATE(2026-10-15T09:30:00Z, SHORT)}} at {{TIME(2026-10-15T09:30:00Z)}}",
    );
    expect(linesOf(card).join("\n")).not.toContain("since");
  });

  test("declared when it was created, for an incident with no declared time", async () => {
    stubIncident({
      isBare: true,
      createdAt: new Date("2026-10-14T22:05:00.000Z"),
    });
    stubHolders([]);

    const card: WorkspaceIncidentCard | null =
      await WorkspaceIncidentActions.getCard({
        incidentId: INCIDENT_ID,
        projectId: PROJECT_ID,
        props: memberProps(),
        workspaceType: WorkspaceType.MicrosoftTeams,
        actions: SLACK_INCIDENT_ACTION_IDS,
      });

    expect(linesOf(card)[1]).toBe(
      "Declared {{DATE(2026-10-14T22:05:00Z, SHORT)}} at {{TIME(2026-10-14T22:05:00Z)}}",
    );
  });

  test("role holders the member may not read: no roles line, the card all the same", async () => {
    stubIncident();
    jest
      .spyOn(IncidentMemberService, "findBy")
      .mockRejectedValue(new NotAuthorizedException("no read"));

    const card: WorkspaceIncidentCard | null =
      await WorkspaceIncidentActions.getCard({
        incidentId: INCIDENT_ID,
        projectId: PROJECT_ID,
        props: memberProps(),
        workspaceType: WorkspaceType.Slack,
        actions: SLACK_INCIDENT_ACTION_IDS,
      });

    expect(linesOf(card)).toEqual([HEADING.text, FACTS.text]);
  });

  test.each([
    [
      WorkspaceType.Slack,
      "To declare a new incident instead, run `/oneuptime incident` followed by its title.",
    ],
    [
      WorkspaceType.MicrosoftTeams,
      "To declare a new incident instead, type **incident** followed by its title.",
    ],
  ])(
    "asked in the incident's own channel (%s): how to declare another, under the buttons",
    async (workspaceType: WorkspaceType, line: string) => {
      stubIncident();
      stubHolders([]);

      const card: WorkspaceIncidentCard | null =
        await WorkspaceIncidentActions.getCard({
          incidentId: INCIDENT_ID,
          projectId: PROJECT_ID,
          props: memberProps(),
          workspaceType: workspaceType,
          actions: SLACK_INCIDENT_ACTION_IDS,
          isAskedInItsChannel: true,
        });

      // Last, under the buttons: it is about another incident.
      expect(card!.messageBlocks).toHaveLength(4);
      expect(card!.messageBlocks[2]!._type).toBe("WorkspacePayloadButtons");
      expect(card!.messageBlocks[3]).toEqual({
        _type: "WorkspacePayloadContext",
        text: line,
      });
    },
  );

  test.each([
    ["not there", null],
    ["not theirs to read", new NotAuthorizedException("no read")],
  ])(
    "an incident %s: no card",
    async (_name: string, outcome: Error | null) => {
      if (outcome) {
        jest.spyOn(IncidentService, "findOneBy").mockRejectedValue(outcome);
      } else {
        jest.spyOn(IncidentService, "findOneBy").mockResolvedValue(null);
      }

      expect(
        await WorkspaceIncidentActions.getCard({
          incidentId: INCIDENT_ID,
          projectId: PROJECT_ID,
          props: memberProps(),
          workspaceType: WorkspaceType.Slack,
          actions: SLACK_INCIDENT_ACTION_IDS,
        }),
      ).toBeNull();
    },
  );
});

describe("WorkspaceIncidentActions.getNotFoundAnswer", () => {
  test.each([
    [
      WorkspaceType.Slack,
      "🔍 There is no incident 42 in this project, or you do not have access to it. To declare a new incident, run `/oneuptime incident` followed by its title.",
    ],
    [
      WorkspaceType.MicrosoftTeams,
      "🔍 There is no incident 42 in this project, or you do not have access to it. To declare a new incident, type **incident** followed by its title.",
    ],
  ])("%s", (workspaceType: WorkspaceType, markdown: string) => {
    expect(
      WorkspaceIncidentActions.getNotFoundAnswer({
        word: "42",
        workspaceType: workspaceType,
      }),
    ).toEqual({
      markdown: markdown,
      text: "There is no incident 42 in this project",
    });
  });
});

describe("WorkspaceIncidentActions.getSeverityChoices", () => {
  test("the severities the member may read, in the project's order", async () => {
    const props: DatabaseCommonInteractionProps = memberProps();
    const critical: IncidentSeverity = new IncidentSeverity();
    critical.id = SEVERITY_ID;
    critical.name = "Critical";
    const unnamed: IncidentSeverity = new IncidentSeverity();
    unnamed.id = OTHER_SEVERITY_ID;
    const read: SpyInstance<typeof IncidentSeverityService.findBy> = jest
      .spyOn(IncidentSeverityService, "findBy")
      .mockResolvedValue([critical, unnamed]);

    expect(
      await WorkspaceIncidentActions.getSeverityChoices({
        projectId: PROJECT_ID,
        props: props,
      }),
    ).toEqual([{ id: SEVERITY_ID, name: "Critical" }]);

    // An archived severity is never offered: the server would refuse it.
    expect(read.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        query: { projectId: PROJECT_ID, isArchived: false },
        sort: { order: "ASC" },
        props: props,
      }),
    );
  });

  test("severities the member may not read: none to offer", async () => {
    jest
      .spyOn(IncidentSeverityService, "findBy")
      .mockRejectedValue(new NotAuthorizedException("no read"));

    expect(
      await WorkspaceIncidentActions.getSeverityChoices({
        projectId: PROJECT_ID,
        props: memberProps(),
      }),
    ).toEqual([]);
  });
});

describe("WorkspaceIncidentActions.changeSeverity: the incident's update, as the member", () => {
  function stubSeverity(found: boolean): void {
    const severity: IncidentSeverity = new IncidentSeverity();
    severity.id = SEVERITY_ID;
    severity.name = "Critical";
    jest
      .spyOn(IncidentSeverityService, "findOneBy")
      .mockResolvedValue(found ? severity : null);
  }

  function stubCurrent(severityId: ObjectID | null): void {
    const incident: Incident = new Incident();
    incident.id = INCIDENT_ID;
    if (severityId) {
      incident.incidentSeverityId = severityId;
    }
    jest.spyOn(IncidentService, "findOneBy").mockResolvedValue(incident);
  }

  test("another severity: written with the member's props, and said as changed", async () => {
    const props: DatabaseCommonInteractionProps = memberProps();
    stubSeverity(true);
    stubCurrent(OTHER_SEVERITY_ID);
    const update: SpyInstance<typeof IncidentService.updateOneById> = jest
      .spyOn(IncidentService, "updateOneById")
      .mockResolvedValue(1);

    expect(
      await WorkspaceIncidentActions.changeSeverity({
        event: incidentEvent(),
        severityId: SEVERITY_ID,
        props: props,
      }),
    ).toEqual({ isChanged: true, severityName: "Critical" });

    expect(update).toHaveBeenCalledWith({
      id: INCIDENT_ID,
      data: { incidentSeverityId: SEVERITY_ID },
      props: props,
    });
  });

  test("the severity it has already: nothing written", async () => {
    stubSeverity(true);
    stubCurrent(new ObjectID(SEVERITY_ID.toString().toUpperCase()));
    const update: SpyInstance<typeof IncidentService.updateOneById> =
      jest.spyOn(IncidentService, "updateOneById");

    expect(
      await WorkspaceIncidentActions.changeSeverity({
        event: incidentEvent(),
        severityId: SEVERITY_ID,
        props: memberProps(),
      }),
    ).toEqual({ isChanged: false, severityName: "Critical" });
    expect(update).not.toHaveBeenCalled();
  });

  test("a severity not of this project, or gone: not found, nothing written", async () => {
    stubSeverity(false);
    const update: SpyInstance<typeof IncidentService.updateOneById> =
      jest.spyOn(IncidentService, "updateOneById");

    await expect(
      WorkspaceIncidentActions.changeSeverity({
        event: incidentEvent(),
        severityId: SEVERITY_ID,
        props: memberProps(),
      }),
    ).rejects.toThrow(
      new NotAuthorizedException(
        "Could not change the severity of this incident: the incident severity was not found. It may have been deleted.",
      ),
    );
    expect(update).not.toHaveBeenCalled();
  });

  test("a severity of the project their access does not include: so, nothing written", async () => {
    const severity: IncidentSeverity = new IncidentSeverity();
    severity.id = SEVERITY_ID;
    jest
      .spyOn(IncidentSeverityService, "findOneBy")
      .mockImplementation((async (findOneBy: {
        props: DatabaseCommonInteractionProps;
      }) => {
        return findOneBy.props.isRoot ? severity : null;
      }) as never);
    const update: SpyInstance<typeof IncidentService.updateOneById> =
      jest.spyOn(IncidentService, "updateOneById");

    await expect(
      WorkspaceIncidentActions.changeSeverity({
        event: incidentEvent(),
        severityId: SEVERITY_ID,
        props: memberProps(),
      }),
    ).rejects.toThrow(
      new NotAuthorizedException(
        "You do not have permission to change the severity of this incident: your access in this project does not include this incident severity. Ask a project admin for access to it.",
      ),
    );
    expect(update).not.toHaveBeenCalled();
  });

  test("a severity read refused for the permission names the permission", async () => {
    jest
      .spyOn(IncidentSeverityService, "findOneBy")
      .mockRejectedValue(
        new NotAuthorizedException(
          "You do not have permissions to read Incident Severity.",
        ),
      );

    await expect(
      WorkspaceIncidentActions.changeSeverity({
        event: incidentEvent(),
        severityId: SEVERITY_ID,
        props: memberProps(),
      }),
    ).rejects.toThrow(
      new NotAuthorizedException(
        "You do not have permission to change the severity of this incident. You do not have permissions to read Incident Severity.",
      ),
    );
  });

  test("an incident they may read but not change (its labels, its owners): the update's own reason, never 'changed'", async () => {
    stubSeverity(true);
    stubCurrent(OTHER_SEVERITY_ID);
    jest.spyOn(IncidentService, "updateOneById").mockResolvedValue(0);
    const reason: NotAuthorizedException = new NotAuthorizedException(
      "You do not have permission to update this Incident.",
    );
    jest
      .spyOn(IncidentService, "getUnwrittenByIdError")
      .mockResolvedValue(reason);

    await expect(
      WorkspaceIncidentActions.changeSeverity({
        event: incidentEvent(),
        severityId: SEVERITY_ID,
        props: memberProps(),
      }),
    ).rejects.toBe(reason);
  });

  test("an incident gone since it was read: not found - it may have been deleted", async () => {
    stubSeverity(true);
    stubCurrent(OTHER_SEVERITY_ID);
    jest
      .spyOn(IncidentService, "updateOneById")
      .mockImplementation((async () => {
        // Deleted meanwhile: OneUptime's own read finds it no more.
        jest.spyOn(IncidentService, "findOneBy").mockResolvedValue(null);
        return 0;
      }) as never);
    jest
      .spyOn(IncidentService, "getUnwrittenByIdError")
      .mockResolvedValue(new NotFoundException("Incident not found"));

    await expect(
      WorkspaceIncidentActions.changeSeverity({
        event: incidentEvent(),
        severityId: SEVERITY_ID,
        props: memberProps(),
      }),
    ).rejects.toThrow(
      new NotAuthorizedException(
        "Could not change this incident: the incident was not found. It may have been deleted.",
      ),
    );
  });
});

describe("WorkspaceIncidentActions.getRoleForm", () => {
  test("the roles (the primary first), the project's people - you first, marked, then by name - and who holds what", async () => {
    const props: DatabaseCommonInteractionProps = memberProps();
    const roleRead: SpyInstance<typeof IncidentRoleService.findBy> = jest
      .spyOn(IncidentRoleService, "findBy")
      .mockResolvedValue([COMMANDER, SCRIBE]);
    const peopleRead: SpyInstance<typeof TeamMemberService.findBy> = jest
      .spyOn(TeamMemberService, "findBy")
      .mockResolvedValue([
        teamMember(LEE_ID, "Lee Wong", "lee@acme.test"),
        teamMember(USER_ID, "Nawaz Dhandala", "nawaz@acme.test"),
        // In two teams: listed once.
        teamMember(LEE_ID, "Lee Wong", "lee@acme.test"),
        // No name: their email.
        teamMember(ANA_ID, null, "ana@acme.test"),
      ]);
    stubHolders([ANA_AS_COMMANDER]);

    const form: WorkspaceIncidentRoleForm =
      await WorkspaceIncidentActions.getRoleForm({
        event: incidentEvent(),
        props: props,
      });

    expect(form.roles).toEqual([
      {
        id: COMMANDER_ROLE_ID,
        name: "Incident Commander",
        canAssignMultipleUsers: false,
      },
      { id: SCRIBE_ROLE_ID, name: "Scribe", canAssignMultipleUsers: true },
    ]);
    expect(
      form.people.map((person: { label: string }) => {
        return person.label;
      }),
    ).toEqual(["Nawaz Dhandala (you)", "ana@acme.test", "Lee Wong"]);
    expect(form.notShownPeopleCount).toBe(0);
    expect(form.holders).toEqual([
      {
        memberId: ANA_MEMBER_ID,
        roleId: COMMANDER_ROLE_ID,
        roleName: "Incident Commander",
        userId: ANA_ID,
        name: "Ana Ruiz",
      },
    ]);

    // Read as the member, the primary role first, accepted members only.
    expect(roleRead.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        sort: { isPrimaryRole: "DESC", name: "ASC" },
        props: props,
      }),
    );
    expect(peopleRead.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        query: { projectId: PROJECT_ID, hasAcceptedInvitation: true },
        props: props,
      }),
    );
  });

  test("past 100 people: the first 100 by name, and how many more", async () => {
    jest.spyOn(IncidentRoleService, "findBy").mockResolvedValue([COMMANDER]);
    jest.spyOn(TeamMemberService, "findBy").mockResolvedValue(
      Array.from({ length: 103 }, (_value: unknown, index: number) => {
        const padded: string = String(index).padStart(3, "0");
        return teamMember(
          new ObjectID(`00000000-0000-4000-8000-000000000${padded}`),
          `Person ${padded}`,
          `p${padded}@acme.test`,
        );
      }),
    );
    stubHolders([]);

    const form: WorkspaceIncidentRoleForm =
      await WorkspaceIncidentActions.getRoleForm({
        event: incidentEvent(),
        props: memberProps(),
      });

    expect(form.people).toHaveLength(100);
    expect(form.people[0]!.name).toBe("Person 000");
    expect(form.notShownPeopleCount).toBe(3);
  });

  test("past 100 people, whoever opened the form is listed - first - even when their name comes last", async () => {
    jest.spyOn(IncidentRoleService, "findBy").mockResolvedValue([COMMANDER]);
    jest.spyOn(TeamMemberService, "findBy").mockResolvedValue([
      ...Array.from({ length: 150 }, (_value: unknown, index: number) => {
        const padded: string = String(index).padStart(3, "0");
        return teamMember(
          new ObjectID(`00000000-0000-4000-8000-000000000${padded}`),
          `Person ${padded}`,
          `p${padded}@acme.test`,
        );
      }),
      teamMember(USER_ID, "Zoe Zimmermann", "zoe@acme.test"),
    ]);
    stubHolders([]);

    const form: WorkspaceIncidentRoleForm =
      await WorkspaceIncidentActions.getRoleForm({
        event: incidentEvent(),
        props: memberProps(),
      });

    // "I'll take it" is what most people pick: never left off the list.
    expect(form.people).toHaveLength(100);
    expect(form.people[0]).toEqual({
      userId: USER_ID,
      name: "Zoe Zimmermann",
      label: "Zoe Zimmermann (you)",
    });
    expect(form.people[1]!.name).toBe("Person 000");
    expect(form.notShownPeopleCount).toBe(51);
  });
});

describe("WorkspaceIncidentActions.getRoleHint: what the role form says under its fields", () => {
  function choice(
    name: string,
    canAssignMultipleUsers: boolean,
  ): { id: ObjectID; name: string; canAssignMultipleUsers: boolean } {
    return {
      id: ObjectID.generate(),
      name: name,
      canAssignMultipleUsers: canAssignMultipleUsers,
    };
  }

  test("the role that takes one person, by name, and what picking someone for it does", () => {
    expect(
      WorkspaceIncidentActions.getRoleHint([
        choice("Incident Commander", false),
        choice("Scribe", true),
      ]),
    ).toBe(
      "Incident Commander takes one person: picking someone replaces whoever has it.",
    );
  });

  test("several: each by name", () => {
    expect(
      WorkspaceIncidentActions.getRoleHint([
        choice("Incident Commander", false),
        choice("Scribe", true),
        choice("Communications Lead", false),
      ]),
    ).toBe(
      "Incident Commander and Communications Lead take one person each: picking someone replaces whoever has it.",
    );
  });

  test("more than three: three by name, and how many more", () => {
    expect(
      WorkspaceIncidentActions.getRoleHint([
        choice("Incident Commander", false),
        choice("Communications Lead", false),
        choice("Operations Lead", false),
        choice("Planning Lead", false),
        choice("Logistics Lead", false),
      ]),
    ).toBe(
      "Incident Commander, Communications Lead, Operations Lead and 2 more roles take one person each: picking someone replaces whoever has it.",
    );
    expect(
      WorkspaceIncidentActions.getRoleHint([
        choice("Incident Commander", false),
        choice("Communications Lead", false),
        choice("Operations Lead", false),
        choice("Planning Lead", false),
      ]),
    ).toBe(
      "Incident Commander, Communications Lead, Operations Lead and 1 more role take one person each: picking someone replaces whoever has it.",
    );
  });

  test("every role takes several people: nothing to say", () => {
    expect(
      WorkspaceIncidentActions.getRoleHint([
        choice("Scribe", true),
        choice("Subject Matter Expert", true),
      ]),
    ).toBe("");
  });
});

describe("WorkspaceIncidentActions.assignRole: an incident member, as the member", () => {
  function stubRole(row: IncidentRole | null): void {
    jest.spyOn(IncidentRoleService, "findOneBy").mockResolvedValue(row);
  }

  function stubPersonName(name: string | null): void {
    jest
      .spyOn(TeamMemberService, "findOneBy")
      .mockResolvedValue(
        name === null ? null : teamMember(LEE_ID, name, "lee@acme.test"),
      );
  }

  function stubWrites(): {
    create: SpyInstance<typeof IncidentMemberService.create>;
    remove: SpyInstance<typeof IncidentMemberService.deleteOneById>;
    order: Array<string>;
  } {
    const order: Array<string> = [];

    const create: SpyInstance<typeof IncidentMemberService.create> = jest
      .spyOn(IncidentMemberService, "create")
      .mockImplementation(async (): Promise<IncidentMember> => {
        order.push("create");
        return new IncidentMember();
      });
    const remove: SpyInstance<typeof IncidentMemberService.deleteOneById> = jest
      .spyOn(IncidentMemberService, "deleteOneById")
      .mockImplementation(async (): Promise<number> => {
        order.push("delete");
        return 1;
      });

    return { create, remove, order };
  }

  test("a role that takes several people: they are added, nobody is taken off", async () => {
    const props: DatabaseCommonInteractionProps = memberProps();
    stubRole(SCRIBE);
    stubHolders([LEE_AS_SCRIBE]);
    stubPersonName("Nawaz Dhandala");
    const writes: ReturnType<typeof stubWrites> = stubWrites();

    expect(
      await WorkspaceIncidentActions.assignRole({
        event: incidentEvent(),
        roleId: SCRIBE_ROLE_ID,
        userId: USER_ID,
        props: props,
      }),
    ).toEqual({
      roleName: "Scribe",
      personName: "Nawaz Dhandala",
      isHeldAlready: false,
      replacedNames: [],
    });

    expect(writes.create).toHaveBeenCalledTimes(1);
    const created: IncidentMember = writes.create.mock.calls[0]![0].data;
    expect(created.incidentId).toEqual(INCIDENT_ID);
    expect(created.userId).toEqual(USER_ID);
    expect(created.incidentRoleId).toEqual(SCRIBE_ROLE_ID);
    expect(created.projectId).toEqual(PROJECT_ID);
    expect(writes.create.mock.calls[0]![0].props).toBe(props);
    expect(writes.remove).not.toHaveBeenCalled();
  });

  test("a role that takes one person moves to them: added first, then whoever had it taken off", async () => {
    const props: DatabaseCommonInteractionProps = memberProps();
    stubRole(COMMANDER);
    stubHolders([ANA_AS_COMMANDER, LEE_AS_SCRIBE]);
    stubPersonName("Nawaz Dhandala");
    const writes: ReturnType<typeof stubWrites> = stubWrites();

    const assignment: WorkspaceRoleAssignment =
      await WorkspaceIncidentActions.assignRole({
        event: incidentEvent(),
        roleId: COMMANDER_ROLE_ID,
        userId: USER_ID,
        props: props,
      });

    expect(assignment).toEqual({
      roleName: "Incident Commander",
      personName: "Nawaz Dhandala",
      isHeldAlready: false,
      replacedNames: ["Ana Ruiz"],
    });
    // Never without a commander: the new one first.
    expect(writes.order).toEqual(["create", "delete"]);
    expect(writes.remove).toHaveBeenCalledWith({
      id: ANA_MEMBER_ID,
      props: props,
    });
  });

  test("taking somebody off a role needs the member's own permission to: refused before anything is written", async () => {
    stubRole(COMMANDER);
    stubHolders([ANA_AS_COMMANDER]);
    stubPersonName("Nawaz Dhandala");
    const writes: ReturnType<typeof stubWrites> = stubWrites();

    const refusal: Promise<WorkspaceRoleAssignment> =
      WorkspaceIncidentActions.assignRole({
        event: incidentEvent(),
        roleId: COMMANDER_ROLE_ID,
        userId: USER_ID,
        // May add incident members, may not remove them.
        props: memberProps([
          Permission.IncidentViewer,
          Permission.CreateIncidentMember,
        ]),
      });

    // The role, who would come off it, and what allows it - once each.
    await expect(refusal).rejects.toBeInstanceOf(NotAuthorizedException);
    await expect(refusal).rejects.toThrow(
      "Incident Commander takes one person, and you do not have permission to take Ana Ruiz off it. You need one of these permissions: Project Owner, Project Admin, Project Member, Incident Admin, Incident Member, Delete Incident Member.",
    );
    expect(writes.create).not.toHaveBeenCalled();
    expect(writes.remove).not.toHaveBeenCalled();
  });

  test("somebody who holds the role already: nothing written", async () => {
    stubRole(COMMANDER);
    stubHolders([ANA_AS_COMMANDER]);
    stubPersonName("Ana Ruiz");
    const writes: ReturnType<typeof stubWrites> = stubWrites();

    expect(
      await WorkspaceIncidentActions.assignRole({
        event: incidentEvent(),
        roleId: COMMANDER_ROLE_ID,
        userId: new ObjectID(ANA_ID.toString().toUpperCase()),
        props: memberProps(),
      }),
    ).toEqual({
      roleName: "Incident Commander",
      personName: "Ana Ruiz",
      isHeldAlready: true,
      replacedNames: [],
    });
    expect(writes.create).not.toHaveBeenCalled();
  });

  test("a role not of this project, or gone: not found, and nothing written", async () => {
    stubRole(null);
    const writes: ReturnType<typeof stubWrites> = stubWrites();

    await expect(
      WorkspaceIncidentActions.assignRole({
        event: incidentEvent(),
        roleId: COMMANDER_ROLE_ID,
        userId: USER_ID,
        props: memberProps(),
      }),
    ).rejects.toThrow(
      new NotAuthorizedException(
        "Could not assign a role on this incident: the incident role was not found. It may have been deleted.",
      ),
    );
    expect(writes.create).not.toHaveBeenCalled();
  });

  test("a role of the project their access does not include: so, and nothing written", async () => {
    const role: IncidentRole = new IncidentRole();
    role.id = COMMANDER_ROLE_ID;
    jest
      .spyOn(IncidentRoleService, "findOneBy")
      .mockImplementation((async (findOneBy: {
        props: DatabaseCommonInteractionProps;
      }) => {
        return findOneBy.props.isRoot ? role : null;
      }) as never);
    const writes: ReturnType<typeof stubWrites> = stubWrites();

    await expect(
      WorkspaceIncidentActions.assignRole({
        event: incidentEvent(),
        roleId: COMMANDER_ROLE_ID,
        userId: USER_ID,
        props: memberProps(),
      }),
    ).rejects.toThrow(
      "You do not have permission to assign a role on this incident: your access in this project does not include this incident role.",
    );
    expect(writes.create).not.toHaveBeenCalled();
  });

  test("the person is named as OneUptime reads them; somebody with no name and no membership is 'Someone'", async () => {
    stubRole(SCRIBE);
    stubHolders([]);
    stubPersonName(null);
    stubWrites();

    expect(
      (
        await WorkspaceIncidentActions.assignRole({
          event: incidentEvent(),
          roleId: SCRIBE_ROLE_ID,
          userId: LEE_ID,
          props: memberProps(),
        })
      ).personName,
    ).toBe("Someone");
  });
});

describe("WorkspaceIncidentActions.page: the page OneUptime's other pages are, about the incident", () => {
  test("as the member, about this incident, waiting as long as a chat waits", async () => {
    const props: DatabaseCommonInteractionProps = memberProps();
    const result: OnCallPageResult = {
      record: {
        type: OnCallPageRecordType.Incident,
        id: INCIDENT_ID,
        label: "Incident INC-42",
        title: "Checkout is down",
        url: URL.fromString(INCIDENT_LINK),
        isNew: false,
      },
      paged: [],
      startedPolicies: [],
      notPaged: [],
      isAnyonePaged: false,
      directPageExecutionLogId: null,
      summary: "",
    };
    const page: SpyInstance<typeof OnCallPageService.page> = jest
      .spyOn(OnCallPageService, "page")
      .mockResolvedValue(result);

    expect(
      await WorkspaceIncidentActions.page({
        event: incidentEvent(),
        targets: { userIds: [LEE_ID] },
        props: props,
      }),
    ).toBe(result);

    expect(page).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      targets: { userIds: [LEE_ID] },
      about: { incidentId: INCIDENT_ID },
      props: props,
      maxWaitForRecordInMs: WORKSPACE_PAGE_MAX_WAIT_FOR_RECORD_IN_MS,
    });
  });

  test("nobody to page: refused, nothing paged", async () => {
    const page: SpyInstance<typeof OnCallPageService.page> = jest.spyOn(
      OnCallPageService,
      "page",
    );

    await expect(
      WorkspaceIncidentActions.page({
        event: incidentEvent(),
        targets: {},
        props: memberProps(),
      }),
    ).rejects.toThrow(new BadDataException("Pick who to page."));
    expect(page).not.toHaveBeenCalled();
  });
});

describe("WorkspaceIncidentActions.getPageProblem", () => {
  test("nobody picked, or nothing that names anybody", () => {
    expect(WorkspaceIncidentActions.getPageProblem([])).toBe(
      WORKSPACE_PAGE_FORM_TEXT.pickWho,
    );
    expect(WorkspaceIncidentActions.getPageProblem(["user:not-an-id"])).toBe(
      WORKSPACE_PAGE_FORM_TEXT.pickWho,
    );
  });

  test("more than one page takes", () => {
    const picked: Array<string> = Array.from(
      { length: MAX_ON_CALL_DIRECT_PAGE_TARGETS + 1 },
      (_value: unknown, index: number): string => {
        return `user:00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
      },
    );

    expect(WorkspaceIncidentActions.getPageProblem(picked)).toBe(
      WORKSPACE_PAGE_FORM_TEXT.pickFewer,
    );
    expect(
      WorkspaceIncidentActions.getPageProblem(
        picked.slice(0, MAX_ON_CALL_DIRECT_PAGE_TARGETS),
      ),
    ).toBeNull();
  });
});

describe("WorkspaceIncidentActions.getPagedAnswer", () => {
  function result(more: Partial<OnCallPageResult>): OnCallPageResult {
    return {
      record: {
        type: OnCallPageRecordType.Incident,
        id: INCIDENT_ID,
        label: "Incident INC-42",
        title: "Checkout is down",
        url: URL.fromString(INCIDENT_LINK),
        isNew: false,
      },
      paged: [],
      startedPolicies: [],
      notPaged: [],
      isAnyonePaged: true,
      directPageExecutionLogId: null,
      summary: "",
      ...more,
    };
  }

  test("who was paged, about the incident", () => {
    expect(
      WorkspaceIncidentActions.getPagedAnswer(
        result({
          paged: [
            {
              userId: LEE_ID,
              name: "Lee Wong",
              email: null,
              teamName: null,
              scheduleName: null,
              coveringForName: null,
            },
          ],
          directPageExecutionLogId: STATE_ID,
        }),
      ),
    ).toEqual({
      markdown: `📟 Paged **Lee Wong** about ${RECORD}`,
      text: "Paged Lee Wong about Incident INC-42",
    });
  });

  test("an on-call policy started for it", () => {
    expect(
      WorkspaceIncidentActions.getPagedAnswer(
        result({
          startedPolicies: [
            { onCallDutyPolicyId: STATE_ID, name: "Payments primary" },
          ],
        }),
      ).markdown,
    ).toBe(`📟 Started on-call policy **Payments primary** for ${RECORD}`);
  });

  test("nobody reached: said, with why, and what to do next", () => {
    expect(
      WorkspaceIncidentActions.getPagedAnswer(
        result({
          isAnyonePaged: false,
          notPaged: ["Nobody is on call in schedule Primary right now."],
        }),
      ).markdown,
    ).toBe(
      `⚠️ Nobody was paged about ${RECORD}\n\n- Nobody is on call in schedule Primary right now.\n\n${WHAT_TO_DO_WHEN_NOBODY_WAS_REACHED.toString()}`,
    );
  });
});

describe("what each action answers, naming the incident with its link", () => {
  test("Change Severity", async () => {
    expect(
      await WorkspaceIncidentActions.getSeverityAnswer({
        event: incidentEvent(),
        severityName: "Critical",
        isChanged: true,
      }),
    ).toEqual({
      markdown: `⚠️ ${RECORD} is now **Critical**.`,
      text: "Incident INC-42 is now Critical",
    });

    expect(
      await WorkspaceIncidentActions.getSeverityAnswer({
        event: incidentEvent(),
        severityName: "Critical",
        isChanged: false,
      }),
    ).toEqual({
      markdown: `${RECORD} is already **Critical**. Nothing changed.`,
      text: "Incident INC-42 is already Critical",
    });
  });

  test("Assign Role", async () => {
    const assignment: WorkspaceRoleAssignment = {
      roleName: "Incident Commander",
      personName: "Nawaz Dhandala",
      isHeldAlready: false,
      replacedNames: [],
    };

    expect(
      (
        await WorkspaceIncidentActions.getRoleAnswer({
          event: incidentEvent(),
          assignment: assignment,
        })
      ).markdown,
    ).toBe(`👤 **Nawaz Dhandala** is now **Incident Commander** on ${RECORD}.`);

    expect(
      await WorkspaceIncidentActions.getRoleAnswer({
        event: incidentEvent(),
        assignment: { ...assignment, replacedNames: ["Ana Ruiz", "Lee Wong"] },
      }),
    ).toEqual({
      markdown: `👤 **Nawaz Dhandala** is now **Incident Commander** on ${RECORD}, in place of **Ana Ruiz** and **Lee Wong**.`,
      text: "Nawaz Dhandala is now Incident Commander on Incident INC-42",
    });

    expect(
      await WorkspaceIncidentActions.getRoleAnswer({
        event: incidentEvent(),
        assignment: { ...assignment, isHeldAlready: true },
      }),
    ).toEqual({
      markdown: `**Nawaz Dhandala** is already **Incident Commander** on ${RECORD}. Nothing changed.`,
      text: "Nawaz Dhandala is already Incident Commander on Incident INC-42",
    });
  });

  test("Change Incident State, named as OneUptime names the state", async () => {
    const state: IncidentState = new IncidentState();
    state.name = "Identified";
    const read: SpyInstance<typeof IncidentStateService.findOneBy> = jest
      .spyOn(IncidentStateService, "findOneBy")
      .mockResolvedValue(state);

    expect(
      await WorkspaceIncidentActions.getStateChangedAnswer({
        event: incidentEvent(),
        stateId: STATE_ID,
      }),
    ).toEqual({
      markdown: `➡️ You moved ${RECORD} to **Identified**.`,
      text: "You moved Incident INC-42 to Identified",
    });
    expect(read.mock.calls[0]![0].query).toEqual({
      _id: STATE_ID.toString(),
      projectId: PROJECT_ID,
    });

    read.mockResolvedValue(null);
    expect(
      (
        await WorkspaceIncidentActions.getStateChangedAnswer({
          event: incidentEvent(),
          stateId: STATE_ID,
        })
      ).markdown,
    ).toBe(`➡️ You moved ${RECORD} to **its new state**.`);
  });

  test("Add Note: public or private, the incident as the member reads it", async () => {
    const record: Incident = new Incident();
    record.id = INCIDENT_ID;
    const found: FindEventSpy = spyOnFindEventOrNull().mockResolvedValue({
      record: record,
      event: incidentEvent(),
    });

    expect(
      await WorkspaceIncidentActions.getNoteAddedAnswer({
        incidentId: INCIDENT_ID,
        isPublic: false,
        props: memberProps(),
      }),
    ).toEqual({
      markdown: `📄 You added a private note to ${RECORD}.`,
      text: "You added a private note to Incident INC-42",
    });

    found.mockResolvedValue(null);
    expect(
      await WorkspaceIncidentActions.getNoteAddedAnswer({
        incidentId: INCIDENT_ID,
        isPublic: true,
        props: memberProps(),
      }),
    ).toEqual({
      markdown: "📄 You added a public note to the incident.",
      text: "You added a public note to the incident",
    });
  });

  test("Edit Custom Fields: the fields changed, or that nothing did", async () => {
    expect(
      await WorkspaceIncidentActions.getCustomFieldsAnswer({
        event: incidentEvent(),
        changedNames: ["Customer Impact"],
      }),
    ).toEqual({
      markdown: `📝 Updated **Customer Impact** on ${RECORD}.`,
      text: "Updated Customer Impact on Incident INC-42",
    });

    expect(
      (
        await WorkspaceIncidentActions.getCustomFieldsAnswer({
          event: incidentEvent(),
          changedNames: ["Customer Impact", "Ticket", "Due"],
        })
      ).markdown,
    ).toBe(
      `📝 Updated **Customer Impact**, **Ticket** and **Due** on ${RECORD}.`,
    );

    expect(
      await WorkspaceIncidentActions.getCustomFieldsAnswer({
        event: incidentEvent(),
        changedNames: [],
      }),
    ).toEqual({
      markdown: `Nothing changed: the custom fields of ${RECORD} are as they were.`,
      text: "Nothing changed on Incident INC-42",
    });
  });

  test("an incident whose link cannot be built is named in bold, without one", async () => {
    jest
      .spyOn(IncidentService, "getIncidentLinkInDashboard")
      .mockRejectedValue(new Error("no host"));

    expect(
      (
        await WorkspaceIncidentActions.getSeverityAnswer({
          event: incidentEvent(),
          severityName: "Critical",
          isChanged: true,
        })
      ).markdown,
    ).toBe("⚠️ **Incident INC-42** is now **Critical**.");
  });
});

describe("what a form says instead of opening with nothing to offer", () => {
  test.each([
    [
      "no severities",
      WorkspaceIncidentActions.getNoSeveritiesMessage,
      "This project has no incident severities you can pick. Add one in OneUptime under Incidents → Settings → Incident Severity, or ask a project admin for access to them.",
    ],
    [
      "no roles",
      WorkspaceIncidentActions.getNoRolesMessage,
      "This project has no incident roles you can assign. Add one in OneUptime under Incidents → Settings → Incident Roles, or ask a project admin for access to them.",
    ],
    [
      "no custom fields",
      WorkspaceIncidentActions.getNoCustomFieldsMessage,
      "This project has no incident custom fields yet. Add them in OneUptime under Incidents → Settings → Custom Fields.",
    ],
    [
      "only fields copied from the monitor",
      WorkspaceIncidentActions.getOnlyCopiedCustomFieldsMessage,
      "Every custom field of this incident is copied from its monitor, so there is nothing to edit here. Change them on the monitor in OneUptime.",
    ],
  ])("%s", (_name: string, message: () => string, expected: string) => {
    expect(message()).toBe(expected);
  });
});

describe("WorkspaceIncidentActions.getCustomFieldsNote: what the custom fields form says under its fields", () => {
  function form(
    more: Partial<WorkspaceCustomFieldsForm>,
  ): WorkspaceCustomFieldsForm {
    return { inputs: [], notShownCount: 0, copiedFieldNames: [], ...more };
  }

  /*
   * The zone a time is read in is not here: Teams' time input names it, and
   * Slack's picker shows each person their own.
   */
  test.each([
    [form({}), "Leave a field empty to clear it."],
    [
      form({ copiedFieldNames: ["Region"] }),
      "Leave a field empty to clear it. **Region** is copied from the incident's monitor, so it is not here.",
    ],
    [
      form({ copiedFieldNames: ["Region", "Team"] }),
      "Leave a field empty to clear it. **Region** and **Team** are copied from the incident's monitor, so they are not here.",
    ],
    [
      form({ notShownCount: 1 }),
      "Leave a field empty to clear it. 1 more field doesn't fit here: edit it in OneUptime.",
    ],
    [
      form({ notShownCount: 3 }),
      "Leave a field empty to clear it. 3 more fields don't fit here: edit them in OneUptime.",
    ],
  ])("%#: %p", (data: WorkspaceCustomFieldsForm, note: string) => {
    expect(
      WorkspaceIncidentActions.getCustomFieldsNote({
        form: data,
      }).toString(),
    ).toBe(note);
  });
});

describe("WorkspaceIncidentActions.getHoldersMarkdown", () => {
  function holder(
    roleId: ObjectID,
    roleName: string,
    name: string,
  ): WorkspaceIncidentRoleHolder {
    return {
      memberId: ObjectID.generate(),
      roleId: roleId,
      roleName: roleName,
      userId: ObjectID.generate(),
      name: name,
    };
  }

  test("nobody holds a role: no line", () => {
    expect(WorkspaceIncidentActions.getHoldersMarkdown([])).toBeNull();
  });

  test("each role once, in the order it was first given, with whoever holds it", () => {
    expect(
      WorkspaceIncidentActions.getHoldersMarkdown([
        holder(COMMANDER_ROLE_ID, "Incident Commander", "Ana Ruiz"),
        holder(SCRIBE_ROLE_ID, "Scribe", "Lee Wong"),
        holder(SCRIBE_ROLE_ID, "Scribe", "Sam Hill"),
      ])!.toString(),
    ).toBe(
      "👤 Incident Commander: **Ana Ruiz** · Scribe: **Lee Wong** and **Sam Hill**",
    );
  });

  test("names are text", () => {
    expect(
      WorkspaceIncidentActions.getHoldersMarkdown([
        holder(SCRIBE_ROLE_ID, "Scribe", "*Lee*"),
      ])!.toString(),
    ).toBe("👤 Scribe: **\\*Lee\\***");
  });
});

describe("WorkspaceIncidentActions.joinNames and joinBoldNames", () => {
  test.each([
    [[], "", ""],
    [["Ana"], "Ana", "**Ana**"],
    [["Ana", "Lee"], "Ana and Lee", "**Ana** and **Lee**"],
    [["Ana", "Lee", "Sam"], "Ana, Lee and Sam", "**Ana**, **Lee** and **Sam**"],
  ])("%p", (names: Array<string>, plain: string, bold: string) => {
    expect(WorkspaceIncidentActions.joinNames(names)).toBe(plain);
    expect(WorkspaceIncidentActions.joinBoldNames(names).toString()).toBe(bold);
  });
});

describe("WorkspaceIncidentActions.getUnwrittenError", () => {
  test("the update's own refusal, as it is", async () => {
    const refusal: NotAuthorizedException = new NotAuthorizedException(
      "You do not have permission to update this Incident.",
    );
    const why: SpyInstance<typeof IncidentService.getUnwrittenByIdError> = jest
      .spyOn(IncidentService, "getUnwrittenByIdError")
      .mockResolvedValue(refusal);
    const props: DatabaseCommonInteractionProps = memberProps();

    expect(
      await WorkspaceIncidentActions.getUnwrittenError({
        incidentId: INCIDENT_ID,
        props: props,
      }),
    ).toBe(refusal);
    expect(why).toHaveBeenCalledWith({
      id: INCIDENT_ID,
      props: props,
      type: "update",
    });
  });

  test("an incident gone: not found - it may have been deleted", async () => {
    jest
      .spyOn(IncidentService, "getUnwrittenByIdError")
      .mockResolvedValue(new NotFoundException("Incident not found"));
    jest.spyOn(IncidentService, "findOneBy").mockResolvedValue(null);

    const error: Error = await WorkspaceIncidentActions.getUnwrittenError({
      incidentId: INCIDENT_ID,
      props: memberProps(),
    });

    expect(error).toBeInstanceOf(NotAuthorizedException);
    expect(error.message).toBe(
      "Could not change this incident: the incident was not found. It may have been deleted.",
    );
  });

  test("an incident there that they may no longer read: so, never 'not found'", async () => {
    jest
      .spyOn(IncidentService, "getUnwrittenByIdError")
      .mockResolvedValue(new NotFoundException("Incident not found"));
    jest
      .spyOn(IncidentService, "findOneBy")
      .mockImplementation((async (findOneBy: {
        props: DatabaseCommonInteractionProps;
      }) => {
        if (!findOneBy.props.isRoot) {
          return null;
        }

        const incident: Incident = new Incident();
        incident.id = INCIDENT_ID;
        return incident;
      }) as never);

    const error: Error = await WorkspaceIncidentActions.getUnwrittenError({
      incidentId: INCIDENT_ID,
      props: memberProps(),
    });

    expect(error).toBeInstanceOf(NotAuthorizedException);
    expect(error.message).toBe(
      "You do not have permission to change this incident: your access in this project does not include this incident. Ask a project admin for access to it.",
    );
  });
});

describe("the incident message's buttons, as getButtonsBlock builds them", () => {
  test("every button and menu item carries the incident; View opens it", () => {
    const block: WorkspaceMessageBlock =
      WorkspaceIncidentActions.getButtonsBlock({
        incidentId: INCIDENT_ID,
        incidentLink: URL.fromString(INCIDENT_LINK),
        actions: SLACK_INCIDENT_ACTION_IDS,
      });

    const buttons: WorkspacePayloadButtons = block as WorkspacePayloadButtons;
    const every: Array<{ value: string; url?: URL | undefined }> = [
      ...buttons.buttons,
      ...(buttons.menuButtons || []),
    ];

    expect(every).toHaveLength(9);
    for (const button of every) {
      expect(button.value).toBe(INCIDENT_ID.toString());
    }
    expect(buttons.buttons[3]!.url?.toString()).toBe(INCIDENT_LINK);
  });
});
