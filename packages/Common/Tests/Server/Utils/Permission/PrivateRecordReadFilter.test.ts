import PrivateRecordReadFilter from "../../../../Server/Utils/Permission/PrivateRecordReadFilter";
import { shouldBypassRecordPrivacy } from "../../../../Server/Utils/PrivacyFilterUtil";
import PrivateRecordPermission, {
  PrivateRecordColumn,
  PrivateRecordReach,
} from "../../../../Server/Types/Database/Permissions/PrivateRecordPermission";
import DatabaseRequestType from "../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import { applyIncidentSelfPrivacyFilter } from "../../../../Server/Utils/Incident/IncidentPrivacyFilter";
import WorkflowPrincipal from "../../../../Server/Utils/Workflow/WorkflowPrincipal";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentAlert from "../../../../Models/DatabaseModels/IncidentAlert";
import IncidentInternalNote from "../../../../Models/DatabaseModels/IncidentInternalNote";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import OnCallDutyPolicyExecutionLog from "../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import RunbookExecution from "../../../../Models/DatabaseModels/RunbookExecution";
import EmailLog from "../../../../Models/DatabaseModels/EmailLog";
import UserOnCallLog from "../../../../Models/DatabaseModels/UserOnCallLog";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../../Types/Permission";
import UserType from "../../../../Types/UserType";
import {
  clearPrivateRecords,
  rowMatchesWhere,
  setPrivateRecords,
} from "../../TestingUtils/InMemoryRepository";
import { afterEach, describe, expect, test } from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * WHAT IS DONE ABOUT A PRIVATE RECORD IS READ ONLY BY THOSE WHO SEE IT
 * (#8913), and A WORKFLOW'S STEP SEES NO PRIVATE RECORD (#8914).
 *
 * PrivateRecordReadFilter keeps a read of the rows naming private records
 * they are not read through - a page about an incident, a runbook run linked
 * to an alert, an email OneUptime sent about one - to the rows whose every
 * private record the caller sees: not private, or owned by them or a team of
 * theirs they have accepted. Those who see every private record (Project
 * Owners and Admins, OneUptime itself) are not narrowed; a caller who is no
 * person sees no private record at all - and a workflow's step, which acts
 * as a Project Admin, is now such a caller.
 *
 * The conditions are read as the SQL TypeORM would send, with an alias
 * standing for the column.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0b0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a01",
);
const USER_ID: ObjectID = new ObjectID("0b0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a02");

function person(permission: Permission): DatabaseCommonInteractionProps {
  return {
    userId: USER_ID,
    userType: UserType.User,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: [
          {
            _type: "UserPermission",
            permission: permission,
            labelIds: [],
            isBlockPermission: false,
          } as UserPermission,
        ],
      },
    },
  };
}

const workflowStep: DatabaseCommonInteractionProps =
  WorkflowPrincipal.getPropsWithoutPlan({
    projectId: PROJECT_ID,
    workflowId: ObjectID.generate(),
  });

// The SQL a condition sends for a column `alias`, and its parameters.
function sqlOf(condition: unknown): {
  sql: string;
  parameters: Record<string, unknown>;
} {
  const operator: FindOperator<unknown> = condition as FindOperator<unknown>;

  /*
   * A caller's own filter combined with the rule is And(theirs, rule): the
   * rule is the last of its operands.
   */
  const raw: FindOperator<unknown> =
    operator.type === "and"
      ? (operator.value as unknown as Array<FindOperator<unknown>>)[
          (operator.value as unknown as Array<FindOperator<unknown>>).length - 1
        ]!
      : operator;

  return {
    sql: (raw.getSql as (alias: string) => string)("COLUMN"),
    parameters: (raw.objectLiteralParameters || {}) as Record<string, unknown>,
  };
}

function columnsOf(modelType: { new (): BaseModel }): Array<string> {
  return PrivateRecordReadFilter.getNamedRecordColumns(modelType).map(
    (column: PrivateRecordColumn): string => {
      return `${column.kind.tableName}:${column.column}`;
    },
  );
}

describe("the private records a model names beside what it is read through", () => {
  test("a page names the incident, alert or episode it is about", () => {
    expect(columnsOf(OnCallDutyPolicyExecutionLog)).toEqual([
      "Incident:triggeredByIncidentId",
      "Alert:triggeredByAlertId",
      "IncidentEpisode:triggeredByIncidentEpisodeId",
      "AlertEpisode:triggeredByAlertEpisodeId",
    ]);
  });

  test("a runbook run and an email log name an incident or an alert", () => {
    expect(columnsOf(RunbookExecution)).toEqual([
      "Incident:incidentId",
      "Alert:alertId",
    ]);
    expect(columnsOf(EmailLog)).toEqual([
      "Incident:incidentId",
      "Alert:alertId",
    ]);
  });

  test("an incident's link to an alert names the alert: the incident it is read through has its own filter", () => {
    expect(columnsOf(IncidentAlert)).toEqual(["Alert:alertId"]);
  });

  test("a private kind itself, a part of one, a person's own page and a monitor name none", () => {
    expect(columnsOf(Incident)).toEqual([]);
    expect(columnsOf(IncidentInternalNote)).toEqual([]);
    expect(columnsOf(UserOnCallLog)).toEqual([]);
    expect(columnsOf(Monitor)).toEqual([]);
  });
});

describe("PrivateRecordReadFilter.apply", () => {
  test("a person who sees no private record of their own reads the rows of the ones they own, and of no other", () => {
    const query: Record<string, unknown> = PrivateRecordReadFilter.apply(
      {},
      person(Permission.ProjectMember),
      OnCallDutyPolicyExecutionLog,
    );

    expect(Object.keys(query).sort()).toEqual([
      "triggeredByAlertEpisodeId",
      "triggeredByAlertId",
      "triggeredByIncidentEpisodeId",
      "triggeredByIncidentId",
    ]);

    const incident: { sql: string; parameters: Record<string, unknown> } =
      sqlOf(query["triggeredByIncidentId"]);

    // No incident, or no private one the person does not see.
    expect(incident.sql).toMatch(/^\(COLUMN IS NULL OR NOT EXISTS \(/);
    expect(incident.sql).toContain(
      `SELECT 1 FROM "Incident" pr WHERE pr."_id" = COLUMN AND pr."isPrivate" = TRUE`,
    );
    // Seen when they are named on it, or a team of theirs they accepted is.
    expect(incident.sql).toContain(`FROM "IncidentOwnerUser" prou`);
    expect(incident.sql).toContain(`FROM "IncidentOwnerTeam" prot`);
    expect(incident.sql).toContain(`prtm."hasAcceptedInvitation" = TRUE`);
    expect(Object.values(incident.parameters)).toEqual([USER_ID.toString()]);

    // Each kind by its own owner tables.
    expect(sqlOf(query["triggeredByAlertEpisodeId"]).sql).toContain(
      `FROM "AlertEpisodeOwnerTeam" prot`,
    );
  });

  test("keeps the caller's own filter on the column, with the rule beside it", () => {
    const incidentId: ObjectID = ObjectID.generate();

    const query: Record<string, unknown> = PrivateRecordReadFilter.apply(
      { incidentId: incidentId },
      person(Permission.ProjectMember),
      RunbookExecution,
    );

    const operator: FindOperator<unknown> = query[
      "incidentId"
    ] as FindOperator<unknown>;

    expect(operator.type).toBe("and");
    expect(sqlOf(operator).sql).toContain(`FROM "Incident" pr`);
  });

  test.each([
    ["a Project Owner", person(Permission.ProjectOwner)],
    ["a Project Admin", person(Permission.ProjectAdmin)],
    ["OneUptime itself", { isRoot: true } as DatabaseCommonInteractionProps],
    [
      "a server admin",
      { isMasterAdmin: true } as DatabaseCommonInteractionProps,
    ],
  ])(
    "%s reads every row, unnarrowed",
    (_who: string, props: DatabaseCommonInteractionProps) => {
      expect(
        PrivateRecordReadFilter.apply({}, props, OnCallDutyPolicyExecutionLog),
      ).toEqual({});
    },
  );

  test("a model that names no private record is read as it was", () => {
    expect(
      PrivateRecordReadFilter.apply(
        { name: "API" },
        person(Permission.ProjectMember),
        Monitor,
      ),
    ).toEqual({ name: "API" });
  });

  test("a caller who is no person reads only the rows of records that are not private", () => {
    const query: Record<string, unknown> = PrivateRecordReadFilter.apply(
      {},
      { ...person(Permission.ProjectMember), userId: undefined },
      EmailLog,
    );

    const incident: { sql: string; parameters: Record<string, unknown> } =
      sqlOf(query["incidentId"]);

    expect(incident.sql).toBe(
      `(COLUMN IS NULL OR NOT EXISTS (SELECT 1 FROM "Incident" pr WHERE pr."_id" = COLUMN AND pr."isPrivate" = TRUE))`,
    );
    expect(incident.parameters).toEqual({});
  });
});

describe("a workflow's step sees no private record (#8914)", () => {
  test("it acts as a Project Admin, but is never lent the sight of every private record", () => {
    expect(
      WorkflowPrincipal.getTenantAccessPermission(PROJECT_ID).permissions.some(
        (row: UserPermission): boolean => {
          return row.permission === Permission.ProjectAdmin;
        },
      ),
    ).toBe(true);
    expect(shouldBypassRecordPrivacy(workflowStep)).toBe(false);

    // A person who is a Project Admin still sees every one.
    expect(shouldBypassRecordPrivacy(person(Permission.ProjectAdmin))).toBe(
      true,
    );
  });

  test("its read of incidents keeps to the ones that are not private", () => {
    const query: Record<string, unknown> = applyIncidentSelfPrivacyFilter(
      {},
      workflowStep,
    ) as Record<string, unknown>;

    const raw: FindOperator<unknown> = query[
      "isPrivate"
    ] as FindOperator<unknown>;

    expect((raw.getSql as (alias: string) => string)("COLUMN")).toBe(
      "(COLUMN IS NULL OR COLUMN = FALSE)",
    );
  });

  test("its read of the pages, runs and logs about a record keeps to the records that are not private", () => {
    const query: Record<string, unknown> = PrivateRecordReadFilter.apply(
      {},
      workflowStep,
      OnCallDutyPolicyExecutionLog,
    );

    expect(sqlOf(query["triggeredByIncidentId"]).sql).toBe(
      `(COLUMN IS NULL OR NOT EXISTS (SELECT 1 FROM "Incident" pr WHERE pr."_id" = COLUMN AND pr."isPrivate" = TRUE))`,
    );
  });

  test("its change or delete of an incident reaches no private one, and nothing goes under one", () => {
    expect(
      PrivateRecordPermission.narrows(
        Incident,
        workflowStep,
        DatabaseRequestType.Update,
      ),
    ).toBe(true);
    expect(
      PrivateRecordPermission.narrows(
        Incident,
        workflowStep,
        DatabaseRequestType.Delete,
      ),
    ).toBe(true);

    // It is no person and on no team: it owns no private record.
    const reach: PrivateRecordReach = PrivateRecordPermission.getReach(
      Incident,
      workflowStep,
      DatabaseRequestType.Update,
    );

    expect(reach.userId).toBeNull();
    expect(reach.teamIds).toEqual([]);
    expect(reach.labelledTeams).toEqual([]);

    expect(
      PrivateRecordPermission.isWriteUnderRecordsNarrowed({
        recordModelType: Incident,
        props: workflowStep,
      }),
    ).toBe(true);
  });

  test("OneUptime's own bookkeeping of a run, as root, is not narrowed", () => {
    expect(
      shouldBypassRecordPrivacy({
        isRoot: true,
        userType: UserType.Workflow,
      }),
    ).toBe(true);
  });
});

describe("PrivateRecordReadFilter.keepToNotPrivate: what Run Workflow offers", () => {
  test("an incident: one that is not private", () => {
    const query: Record<string, unknown> =
      PrivateRecordReadFilter.keepToNotPrivate({}, Incident);

    expect(sqlOf(query["_id"]).sql).toBe(
      `(COLUMN IS NULL OR NOT EXISTS (SELECT 1 FROM "Incident" pr WHERE pr."_id" = COLUMN AND pr."isPrivate" = TRUE))`,
    );
  });

  test("a note of an incident: one of an incident that is not private", () => {
    const query: Record<string, unknown> =
      PrivateRecordReadFilter.keepToNotPrivate(
        { projectId: PROJECT_ID },
        IncidentInternalNote,
      );

    expect(query["projectId"]).toBe(PROJECT_ID);
    expect(sqlOf(query["incidentId"]).sql).toContain(`FROM "Incident" pr`);
  });

  test("an incident's link to an alert: of an incident and an alert that are not private", () => {
    const query: Record<string, unknown> =
      PrivateRecordReadFilter.keepToNotPrivate({}, IncidentAlert);

    expect(Object.keys(query).sort()).toEqual(["alertId", "incidentId"]);
  });

  test("a monitor is offered as it was", () => {
    expect(PrivateRecordReadFilter.keepToNotPrivate({}, Monitor)).toEqual({});
  });
});

/*
 * The suites that drive a service over rows kept in memory
 * (TestingUtils/InMemoryRepository) answer the rule from the private records
 * they say there are, as Postgres answers its SQL
 * (PrivateRecordActionsPostgres): this holds the two to the same SQL.
 */
describe("the in-memory repository answers the rule as Postgres does", () => {
  const PRIVATE_INCIDENT: string = "0b0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0b01";
  const PUBLIC_INCIDENT: string = "0b0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0b02";
  const OTHER_USER: ObjectID = new ObjectID(
    "0b0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0b03",
  );

  afterEach(() => {
    clearPrivateRecords();
  });

  function readsAs(
    props: DatabaseCommonInteractionProps,
    incidentId: string | null,
  ): boolean {
    return rowMatchesWhere(
      { incidentId: incidentId, alertId: null },
      PrivateRecordReadFilter.apply({}, props, EmailLog),
    );
  }

  test("a log about a private incident is read by those who see it, and no one else", () => {
    setPrivateRecords({
      table: "Incident",
      records: [{ id: PRIVATE_INCIDENT, seenBy: [USER_ID] }],
    });

    expect(readsAs(person(Permission.Viewer), PRIVATE_INCIDENT)).toBe(true);
    expect(
      readsAs(
        { ...person(Permission.Viewer), userId: OTHER_USER },
        PRIVATE_INCIDENT,
      ),
    ).toBe(false);
    expect(readsAs(workflowStep, PRIVATE_INCIDENT)).toBe(false);

    // One about a public incident, or none, is read by every reader.
    for (const incidentId of [PUBLIC_INCIDENT, null]) {
      expect(
        readsAs(
          { ...person(Permission.Viewer), userId: OTHER_USER },
          incidentId,
        ),
      ).toBe(true);
      expect(readsAs(workflowStep, incidentId)).toBe(true);
    }
  });

  test("with no private records said, every log is read as before", () => {
    expect(
      readsAs(
        { ...person(Permission.Viewer), userId: OTHER_USER },
        PRIVATE_INCIDENT,
      ),
    ).toBe(true);
  });
});
