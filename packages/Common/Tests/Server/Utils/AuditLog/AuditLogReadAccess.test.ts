import "../../TestingUtils/Init";
import CloudBudgetService from "../../../../Server/Services/CloudBudgetService";
import DataStoreFindingService from "../../../../Server/Services/DataStoreFindingService";
import DatabaseService from "../../../../Server/Services/DatabaseService";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncomingCallPolicyPhoneNumberService from "../../../../Server/Services/IncomingCallPolicyPhoneNumberService";
import SecurityCaseService from "../../../../Server/Services/SecurityCaseService";
import TeamMemberService from "../../../../Server/Services/TeamMemberService";
import WorkflowService from "../../../../Server/Services/WorkflowService";
import DatabaseRequestType from "../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import FindBy from "../../../../Server/Types/Database/FindBy";
import TablePermission from "../../../../Server/Types/Database/Permissions/TablePermission";
import QueryUtil from "../../../../Server/Types/Database/QueryUtil";
import AuditLogReadAccess from "../../../../Server/Utils/AuditLog/AuditLogReadAccess";
import AuditLog from "../../../../Models/AnalyticsModels/AuditLog";
import AllDatabaseModelTypes from "../../../../Models/DatabaseModels/Index";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AuditLogExport from "../../../../Models/DatabaseModels/AuditLogExport";
import CloudBudget from "../../../../Models/DatabaseModels/CloudBudget";
import DataStoreFinding from "../../../../Models/DatabaseModels/DataStoreFinding";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncomingCallPolicyPhoneNumber from "../../../../Models/DatabaseModels/IncomingCallPolicyPhoneNumber";
import SecurityCase from "../../../../Models/DatabaseModels/SecurityCase";
import TeamMember from "../../../../Models/DatabaseModels/TeamMember";
import Workflow from "../../../../Models/DatabaseModels/Workflow";
import AuditLogAction from "../../../../Types/AuditLog/AuditLogAction";
import {
  AUDIT_LOG_HIDDEN_VALUE,
  isAuditLogChangeHidden,
} from "../../../../Types/AuditLog/AuditLogHiddenValues";
import { AUDIT_LOG_SESSION_RESOURCE_TYPE } from "../../../../Types/AuditLog/AuditLogSessionEvent";
import { AUDIT_LOG_SIGN_IN_ATTEMPT_RESOURCE_TYPE } from "../../../../Types/AuditLog/AuditLogSignInFailure";
import { AUDIT_LOG_SIGN_IN_SETTINGS_CLEARED_RESOURCE_TYPE } from "../../../../Types/AuditLog/AuditLogSignInSettingsCleared";
import { AUDIT_LOG_STATUS_PAGE_SESSION_RESOURCE_TYPE } from "../../../../Types/AuditLog/AuditLogStatusPageSession";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../../Types/Billing/SubscriptionPlan";
import PermissionScope from "../../../../Types/Database/AccessControl/PermissionScope";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../../Types/Permission";
import UserType from "../../../../Types/UserType";
import { getJestSpyOn } from "../../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { FindOperator } from "typeorm";

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../../Server/Utils/Logger");

/*
 * NOBODY READS A VALUE THROUGH THE AUDIT LOG THEY COULD NOT READ ON THE
 * RECORD ITSELF (#10642).
 *
 * The audit log is read by Project Owner, Project Admin, Settings Admin and
 * Read Audit Log, and keeps the values before and after of what every change
 * wrote. Here entries are held to their reader the way AuditLogService holds
 * every read (AuditLogReadAccess), with the real models, the real services'
 * reads (readsEveryRecordInProject: their hooks, then the permission check)
 * and the real column checks - only the read of the records themselves
 * (findBy) is answered here, as the reader's own read would find them:
 *
 *   - the issue's example, a security case's change, read by a Settings
 *     Admin and by an API key with Read Audit Log (names and values hidden),
 *     and by the Security tiers, a Project Owner and a Project Admin (shown);
 *   - every way a reader is narrowed: a column they may not read, a model
 *     they may not read, owned records, labels, a block with labels, a
 *     product's level (#10475), a record since deleted;
 *   - what names a record, what a relation's names are, the audit log's own
 *     entries, and OneUptime itself and a server admin.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10642000-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("10642000-0000-4000-8000-000000000002");
const API_KEY_ID: ObjectID = new ObjectID(
  "10642000-0000-4000-8000-000000000003",
);
const LABEL_ID: ObjectID = new ObjectID("10642000-0000-4000-8000-000000000004");
const CASE_ID: ObjectID = new ObjectID("10642000-0000-4000-8000-0000000000c1");
const OTHER_CASE_ID: ObjectID = new ObjectID(
  "10642000-0000-4000-8000-0000000000c2",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "10642000-0000-4000-8000-0000000000a1",
);
const OTHER_INCIDENT_ID: ObjectID = new ObjectID(
  "10642000-0000-4000-8000-0000000000a2",
);

interface Row {
  permission: Permission;
  labelIds?: Array<ObjectID> | undefined;
  isBlockPermission?: boolean | undefined;
  scope?: PermissionScope | undefined;
}

function toPermissionRows(rows: Array<Row>): UserTenantAccessPermission {
  return {
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: rows.map((row: Row): UserPermission => {
      return {
        _type: "UserPermission",
        permission: row.permission,
        labelIds: row.labelIds || [],
        isBlockPermission: Boolean(row.isBlockPermission),
        scope: row.scope,
      };
    }),
  };
}

// A person in the project, with these permission rows.
function memberWith(rows: Array<Row>): DatabaseCommonInteractionProps {
  return {
    userId: USER_ID,
    userType: UserType.User,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: toPermissionRows([
        { permission: Permission.CurrentUser },
        { permission: Permission.ProjectUser },
        ...rows,
      ]),
    },
    userTeamIds: [],
    // The plan a request carries, so no plan is looked up.
    currentPlan: PlanType.Enterprise,
    isSubscriptionUnpaid: false,
  };
}

// A project API key with these permissions, as ProjectMiddleware sets it up.
function apiKeyWith(rows: Array<Row>): DatabaseCommonInteractionProps {
  return {
    userType: UserType.API,
    tenantId: PROJECT_ID,
    apiKeyId: API_KEY_ID,
    apiKeyName: "Audit export",
    userGlobalAccessPermission: {
      _type: "UserGlobalAccessPermission",
      projectIds: [PROJECT_ID],
      globalPermissions: [Permission.Public],
    },
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: toPermissionRows(rows),
    },
    currentPlan: PlanType.Enterprise,
    isSubscriptionUnpaid: false,
  };
}

const SETTINGS_ADMIN: DatabaseCommonInteractionProps = memberWith([
  { permission: Permission.SettingsAdmin },
]);

const READ_AUDIT_LOG_KEY: DatabaseCommonInteractionProps = apiKeyWith([
  { permission: Permission.ReadAuditLog },
]);

const PROJECT_OWNER: DatabaseCommonInteractionProps = memberWith([
  { permission: Permission.ProjectOwner },
]);

const PROJECT_ADMIN: DatabaseCommonInteractionProps = memberWith([
  { permission: Permission.ProjectAdmin },
]);

const SECURITY_ADMIN_WITH_AUDIT_LOG: DatabaseCommonInteractionProps =
  memberWith([
    { permission: Permission.SecurityAdmin },
    { permission: Permission.ReadAuditLog },
  ]);

// An update of a security case: its title, verdict and OneUptime AI's report.
function securityCaseUpdate(id: ObjectID = CASE_ID): AuditLog {
  return entryOf({
    resourceType: "Security Case",
    resourceId: id,
    resourceName: "Ransomware on the payments host",
    action: AuditLogAction.Update,
    changes: [
      {
        field: "title",
        oldValue: "Suspicious login",
        newValue: "Ransomware on the payments host",
      },
      { field: "verdict", oldValue: "Suspicious", newValue: "Malicious" },
      {
        field: "aiTriageReport",
        oldValue: null,
        newValue: "The host payments-01 encrypted 4,000 files after ...",
      },
      {
        field: "entities",
        oldValue: [],
        newValue: [{ type: "Host", value: "payments-01" }],
        summary: ['Added "0"'],
      },
    ],
  });
}

function entryOf(data: {
  resourceType: string;
  resourceId: ObjectID;
  resourceName?: string | undefined;
  action: string;
  changes: JSONArray;
}): AuditLog {
  const entry: AuditLog = new AuditLog();
  entry._id = ObjectID.generate();
  entry.projectId = PROJECT_ID;
  entry.resourceType = data.resourceType;
  entry.resourceId = data.resourceId;

  if (data.resourceName !== undefined) {
    entry.resourceName = data.resourceName;
  }

  entry.action = data.action;
  entry.userId = USER_ID;
  entry.userName = "Jane Doe";
  entry.userEmail = "jane@example.com";
  entry.changes = JSON.parse(JSON.stringify(data.changes)) as JSONArray;

  return entry;
}

function changeOf(entry: AuditLog, field: string): JSONObject {
  const change: JSONObject | undefined = (entry.changes || []).find(
    (item: unknown): boolean => {
      return (item as JSONObject)["field"] === field;
    },
  ) as JSONObject | undefined;

  if (!change) {
    throw new Error(`No change of ${field}`);
  }

  return change;
}

type AnyService = DatabaseService<BaseModel>;

/*
 * What each service's read finds, for the services a test says (findsOnly).
 * Answered from DatabaseService's own findBy, so a service still reads as
 * one that narrows its reads only before querying
 * (readsEveryRecordInProject asks exactly that of its findBy): a spy on the
 * service itself would make every reader read record by record.
 */
const foundByService: Map<
  AnyService,
  { ids: Array<ObjectID>; asked: Array<FindBy<BaseModel>> }
> = new Map();

function answerFindsFromTests(): void {
  const original: AnyService["findBy"] = DatabaseService.prototype.findBy;

  jest
    .spyOn(DatabaseService.prototype, "findBy")
    .mockImplementation(async function (
      this: AnyService,
      findBy: FindBy<BaseModel>,
    ): Promise<Array<BaseModel>> {
      const found:
        | { ids: Array<ObjectID>; asked: Array<FindBy<BaseModel>> }
        | undefined = foundByService.get(this);

      if (!found) {
        return await original.call(this, findBy);
      }

      found.asked.push(findBy);

      const idCondition: FindOperator<unknown> = (
        findBy.query as unknown as { _id: FindOperator<unknown> }
      )._id;
      const askedIds: Array<string> = (
        Object.values(
          idCondition.objectLiteralParameters || {},
        )[0] as Array<string>
      ).map((id: string): string => {
        return id.toLowerCase();
      });

      return found.ids
        .filter((id: ObjectID): boolean => {
          return askedIds.includes(id.toString().toLowerCase());
        })
        .map((id: ObjectID): BaseModel => {
          const model: BaseModel = new this.modelType() as BaseModel;
          model._id = id.toString();
          return model;
        });
    } as never);
}

/*
 * The records the reader's own read of a table finds, of those it is asked
 * for: `ids` (or none). Records each findBy it is asked.
 */
function findsOnly(
  service: unknown,
  ids: Array<ObjectID>,
): Array<FindBy<BaseModel>> {
  const asked: Array<FindBy<BaseModel>> = [];

  foundByService.set(service as AnyService, { ids, asked });

  return asked;
}

async function hold(
  entries: Array<AuditLog>,
  props: DatabaseCommonInteractionProps,
): Promise<Array<AuditLog>> {
  await AuditLogReadAccess.holdEntriesToReader({ entries, props });
  return entries;
}

/*
 * The table linking rows to their labels, as Postgres's metadata names it:
 * a grant limited to labels or a block with labels is a condition on it.
 */
function withLabelLinks(): void {
  const original: typeof QueryUtil.getManyToManyRelationMetadata =
    QueryUtil.getManyToManyRelationMetadata.bind(QueryUtil);

  jest
    .spyOn(QueryUtil, "getManyToManyRelationMetadata")
    .mockImplementation(
      (
        modelType: { new (): BaseModel },
        propertyPath: string,
      ): ReturnType<typeof QueryUtil.getManyToManyRelationMetadata> => {
        if (propertyPath !== "labels") {
          return original(modelType, propertyPath);
        }

        return {
          joinTableName: `${new modelType().tableName}Label`,
          ownerColumnName: "ownerId",
          relationColumnName: "labelId",
        };
      },
    );
}

function expectHidden(change: JSONObject, field: string): void {
  expect(change["field"]).toBe(field);
  expect(isAuditLogChangeHidden(change)).toBe(true);
  expect(change["summary"]).toBeUndefined();

  for (const key of ["oldValue", "newValue"]) {
    if (Object.prototype.hasOwnProperty.call(change, key)) {
      expect(change[key]).toBe(AUDIT_LOG_HIDDEN_VALUE);
    }
  }
}

function expectShownAsRecorded(held: AuditLog, recorded: AuditLog): void {
  expect(held.resourceName).toBe(recorded.resourceName);
  expect(held.changes).toEqual(recorded.changes);
}

describe("AuditLogReadAccess", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    foundByService.clear();
    answerFindsFromTests();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    foundByService.clear();
  });

  describe("the issue's example: a security case's change", () => {
    test.each([
      ["a Settings Admin", SETTINGS_ADMIN],
      ["an API key with Read Audit Log", READ_AUDIT_LOG_KEY],
      [
        "a member with Read Audit Log alone",
        memberWith([{ permission: Permission.ReadAuditLog }]),
      ],
    ])(
      "%s sees that the case changed, who changed it, when and which fields - not the values, nor the case's name",
      async (_name: string, props: DatabaseCommonInteractionProps) => {
        const asked: Array<FindBy<BaseModel>> = findsOnly(SecurityCaseService, [
          CASE_ID,
        ]);
        const recorded: AuditLog = securityCaseUpdate();
        const [held] = await hold([securityCaseUpdate()], props);

        // Who, what and when stay.
        expect(held!.resourceType).toBe("Security Case");
        expect(held!.resourceId?.toString()).toBe(CASE_ID.toString());
        expect(held!.action).toBe(AuditLogAction.Update);
        expect(held!.userEmail).toBe(recorded.userEmail);

        // The case is none of theirs: no name, and every field hidden.
        expect(held!.resourceName).toBe(AUDIT_LOG_HIDDEN_VALUE);
        expect(
          (held!.changes || []).map((change: unknown): unknown => {
            return (change as JSONObject)["field"];
          }),
        ).toEqual(["title", "verdict", "aiTriageReport", "entities"]);

        for (const field of [
          "title",
          "verdict",
          "aiTriageReport",
          "entities",
        ]) {
          expectHidden(changeOf(held!, field), field);
        }

        // Nothing in the entry reads like the case any longer.
        expect(JSON.stringify(held!.toJSON())).not.toMatch(
          /Ransomware|Malicious|Suspicious|payments-01|encrypted/,
        );

        // A reader who may not read the table does not look the case up.
        expect(asked).toHaveLength(0);
      },
    );

    test.each([
      ["a Project Owner", PROJECT_OWNER],
      ["a Project Admin", PROJECT_ADMIN],
    ])(
      "%s reads the case's values and its name, as they read every case: nothing is looked up",
      async (_name: string, props: DatabaseCommonInteractionProps) => {
        const asked: Array<FindBy<BaseModel>> = findsOnly(SecurityCaseService, [
          CASE_ID,
        ]);
        const [held] = await hold([securityCaseUpdate()], props);

        expectShownAsRecorded(held!, securityCaseUpdate());
        expect(asked).toHaveLength(0);
      },
    );

    test.each([
      ["a Security Admin with Read Audit Log", SECURITY_ADMIN_WITH_AUDIT_LOG],
      [
        "a Security Viewer with Read Audit Log",
        memberWith([
          { permission: Permission.SecurityViewer },
          { permission: Permission.ReadAuditLog },
        ]),
      ],
      [
        "an API key with Read Security Case and Read Audit Log",
        apiKeyWith([
          { permission: Permission.ReadSecurityCase },
          { permission: Permission.ReadAuditLog },
        ]),
      ],
    ])(
      "%s reads the case's values and its name, as they read every case",
      async (_name: string, props: DatabaseCommonInteractionProps) => {
        const asked: Array<FindBy<BaseModel>> = findsOnly(SecurityCaseService, [
          CASE_ID,
        ]);
        const [held] = await hold([securityCaseUpdate()], props);

        expectShownAsRecorded(held!, securityCaseUpdate());

        // Their read of cases adds nothing beyond the project: no lookup.
        expect(asked).toHaveLength(0);
      },
    );

    test("a Security Viewer limited to some labels reads the cases their own read finds, and only those", async () => {
      withLabelLinks();
      const asked: Array<FindBy<BaseModel>> = findsOnly(SecurityCaseService, [
        CASE_ID,
      ]);
      const props: DatabaseCommonInteractionProps = memberWith([
        { permission: Permission.SecurityViewer, labelIds: [LABEL_ID] },
        { permission: Permission.ReadAuditLog },
      ]);

      const [found, notFound] = await hold(
        [securityCaseUpdate(CASE_ID), securityCaseUpdate(OTHER_CASE_ID)],
        props,
      );

      expectShownAsRecorded(found!, securityCaseUpdate(CASE_ID));
      expect(notFound!.resourceName).toBe(AUDIT_LOG_HIDDEN_VALUE);
      expectHidden(changeOf(notFound!, "verdict"), "verdict");

      expect(asked).toHaveLength(1);
      expect(asked[0]!.props).toBe(props);
    });

    test("a case deleted since is read as every case is: the Project Admin sees its snapshot, the Settings Admin does not", async () => {
      findsOnly(SecurityCaseService, []);

      const deleted: () => AuditLog = (): AuditLog => {
        return entryOf({
          resourceType: "Security Case",
          resourceId: OTHER_CASE_ID,
          resourceName: "Phishing campaign",
          action: AuditLogAction.Delete,
          changes: [
            { field: "title", oldValue: "Phishing campaign" },
            { field: "verdict", oldValue: "Malicious" },
          ],
        });
      };

      const [forAdmin] = await hold([deleted()], PROJECT_ADMIN);
      expectShownAsRecorded(forAdmin!, deleted());

      const [forSettingsAdmin] = await hold([deleted()], SETTINGS_ADMIN);
      expect(forSettingsAdmin!.resourceName).toBe(AUDIT_LOG_HIDDEN_VALUE);
      expect(changeOf(forSettingsAdmin!, "title")).toEqual({
        field: "title",
        valueHidden: true,
        oldValue: AUDIT_LOG_HIDDEN_VALUE,
      });
      expectHidden(changeOf(forSettingsAdmin!, "verdict"), "verdict");
    });
  });

  describe("a column the reader may not read", () => {
    /*
     * A data store finding's masked samples are evidence about real records:
     * the Security Viewer tier, which reads everything else of a finding,
     * does not read them (DataStoreFinding.restrictedReadPermissions).
     */
    const FINDING_ID: ObjectID = new ObjectID(
      "10642000-0000-4000-8000-0000000000f1",
    );

    const findingUpdate: () => AuditLog = (): AuditLog => {
      return entryOf({
        resourceType:
          AuditLogReadAccess.getResourceTypeOf(new DataStoreFinding()) ||
          "missing",
        resourceId: FINDING_ID,
        action: AuditLogAction.Update,
        changes: [
          { field: "sensitivity", oldValue: "Medium", newValue: "High" },
          {
            field: "maskedSamples",
            oldValue: [],
            newValue: ["j***@e******.com"],
          },
          { field: "isFreeText", oldValue: true, newValue: false },
        ],
      });
    };

    test("hides only that field: the Security Viewer reads the rest of the finding", async () => {
      findsOnly(DataStoreFindingService, [FINDING_ID]);

      const [held] = await hold(
        [findingUpdate()],
        memberWith([
          { permission: Permission.SecurityViewer },
          { permission: Permission.ReadAuditLog },
        ]),
      );

      expect(changeOf(held!, "sensitivity")).toEqual({
        field: "sensitivity",
        oldValue: "Medium",
        newValue: "High",
      });
      expect(changeOf(held!, "isFreeText")).toEqual({
        field: "isFreeText",
        oldValue: true,
        newValue: false,
      });
      expectHidden(changeOf(held!, "maskedSamples"), "maskedSamples");
      expect(JSON.stringify(held!.toJSON())).not.toContain("j***@");
    });

    test("the Security Admin reads that field too", async () => {
      findsOnly(DataStoreFindingService, [FINDING_ID]);

      const [held] = await hold(
        [findingUpdate()],
        SECURITY_ADMIN_WITH_AUDIT_LOG,
      );

      expectShownAsRecorded(held!, findingUpdate());
    });
  });

  describe("owned records", () => {
    const incidentUpdate: (id: ObjectID) => AuditLog = (
      id: ObjectID,
    ): AuditLog => {
      return entryOf({
        resourceType: "Incident",
        resourceId: id,
        resourceName: `Incident ${id.toString().slice(-2)}`,
        action: AuditLogAction.Update,
        changes: [
          { field: "title", oldValue: "Down", newValue: "Checkout down" },
        ],
      });
    };

    test("a reader limited to the incidents they own reads those, and nothing of the rest", async () => {
      const asked: Array<FindBy<BaseModel>> = findsOnly(IncidentService, [
        INCIDENT_ID,
      ]);
      const props: DatabaseCommonInteractionProps = memberWith([
        {
          permission: Permission.ReadProjectIncident,
          scope: PermissionScope.Owned,
        },
        { permission: Permission.ReadAuditLog },
      ]);

      const [owned, notOwned] = await hold(
        [incidentUpdate(INCIDENT_ID), incidentUpdate(OTHER_INCIDENT_ID)],
        props,
      );

      expectShownAsRecorded(owned!, incidentUpdate(INCIDENT_ID));
      expect(notOwned!.resourceName).toBe(AUDIT_LOG_HIDDEN_VALUE);
      expectHidden(changeOf(notOwned!, "title"), "title");

      // One read of the table, by the reader, for both records.
      expect(asked).toHaveLength(1);
      expect(asked[0]!.props).toBe(props);
      expect(asked[0]!.select).toEqual({ _id: true });
      expect(asked[0]!.limit).toBe(2);
    });

    test("an owned incident deleted since cannot be told owned: hidden", async () => {
      findsOnly(IncidentService, []);

      const [held] = await hold(
        [incidentUpdate(INCIDENT_ID)],
        memberWith([
          {
            permission: Permission.ReadProjectIncident,
            scope: PermissionScope.Owned,
          },
          { permission: Permission.ReadAuditLog },
        ]),
      );

      expect(held!.resourceName).toBe(AUDIT_LOG_HIDDEN_VALUE);
      expectHidden(changeOf(held!, "title"), "title");
    });
  });

  describe("labels", () => {
    const incidentUpdate: (id: ObjectID) => AuditLog = (
      id: ObjectID,
    ): AuditLog => {
      return entryOf({
        resourceType: "Incident",
        resourceId: id,
        resourceName: "Checkout down",
        action: AuditLogAction.Update,
        changes: [
          {
            field: "description",
            oldValue: "",
            newValue: "Card payments fail",
          },
        ],
      });
    };

    test("a reader limited to some labels reads the incidents carrying them, as their own read finds them", async () => {
      withLabelLinks();
      const asked: Array<FindBy<BaseModel>> = findsOnly(IncidentService, [
        INCIDENT_ID,
      ]);
      const props: DatabaseCommonInteractionProps = memberWith([
        { permission: Permission.ReadProjectIncident, labelIds: [LABEL_ID] },
        { permission: Permission.ReadAuditLog },
      ]);

      const [labelled, other] = await hold(
        [incidentUpdate(INCIDENT_ID), incidentUpdate(OTHER_INCIDENT_ID)],
        props,
      );

      expectShownAsRecorded(labelled!, incidentUpdate(INCIDENT_ID));
      expect(other!.resourceName).toBe(AUDIT_LOG_HIDDEN_VALUE);
      expectHidden(changeOf(other!, "description"), "description");
      expect(asked).toHaveLength(1);
      expect(asked[0]!.props).toBe(props);
    });

    test("a Project Admin with a block on some labels reads the incidents their read finds, not the blocked ones", async () => {
      withLabelLinks();
      findsOnly(IncidentService, [INCIDENT_ID]);

      const [readable, blocked] = await hold(
        [incidentUpdate(INCIDENT_ID), incidentUpdate(OTHER_INCIDENT_ID)],
        memberWith([
          { permission: Permission.ProjectAdmin },
          {
            permission: Permission.ReadProjectIncident,
            labelIds: [LABEL_ID],
            isBlockPermission: true,
          },
        ]),
      );

      expectShownAsRecorded(readable!, incidentUpdate(INCIDENT_ID));
      expect(blocked!.resourceName).toBe(AUDIT_LOG_HIDDEN_VALUE);
      expectHidden(changeOf(blocked!, "description"), "description");
    });

    test("a reader who reads every incident needs no lookup", async () => {
      const asked: Array<FindBy<BaseModel>> = findsOnly(IncidentService, []);

      const [held] = await hold(
        [incidentUpdate(INCIDENT_ID)],
        memberWith([
          { permission: Permission.ProjectOwner },
          { permission: Permission.ReadAuditLog },
        ]),
      );

      expectShownAsRecorded(held!, incidentUpdate(INCIDENT_ID));
      expect(asked).toHaveLength(0);
    });
  });

  describe("a product's level (#10475)", () => {
    const BUDGET_ID: ObjectID = new ObjectID(
      "10642000-0000-4000-8000-0000000000b1",
    );

    const budgetUpdate: () => AuditLog = (): AuditLog => {
      return entryOf({
        resourceType:
          AuditLogReadAccess.getResourceTypeOf(new CloudBudget()) || "missing",
        resourceId: BUDGET_ID,
        resourceName: "Production spend",
        action: AuditLogAction.Update,
        changes: [
          { field: "name", oldValue: "Prod", newValue: "Production spend" },
        ],
      });
    };

    test("Cloud Viewer reads a cloud budget's change, as it reads the budget", async () => {
      findsOnly(CloudBudgetService, [BUDGET_ID]);

      const [held] = await hold(
        [budgetUpdate()],
        memberWith([
          { permission: Permission.CloudViewer },
          { permission: Permission.ReadAuditLog },
        ]),
      );

      expectShownAsRecorded(held!, budgetUpdate());
    });

    test("another product's level reads no cloud budget, nor its change", async () => {
      findsOnly(CloudBudgetService, []);

      const [held] = await hold(
        [budgetUpdate()],
        memberWith([
          { permission: Permission.NetworkViewer },
          { permission: Permission.ReadAuditLog },
        ]),
      );

      expect(held!.resourceName).toBe(AUDIT_LOG_HIDDEN_VALUE);
      expectHidden(changeOf(held!, "name"), "name");
    });
  });

  describe("what names a record", () => {
    test("a record named by its own columns (a phone number) is named only to those who read the number", async () => {
      findsOnly(IncomingCallPolicyPhoneNumberService, []);

      const recorded: () => AuditLog = (): AuditLog => {
        return entryOf({
          resourceType:
            AuditLogReadAccess.getResourceTypeOf(
              new IncomingCallPolicyPhoneNumber(),
            ) || "missing",
          resourceId: ObjectID.generate(),
          resourceName: "+14155550100",
          action: AuditLogAction.Create,
          changes: [{ field: "phoneNumber", newValue: "+14155550100" }],
        });
      };

      const [forOwner] = await hold([recorded()], PROJECT_OWNER);
      expectShownAsRecorded(forOwner!, recorded());

      const [forKey] = await hold([recorded()], READ_AUDIT_LOG_KEY);
      expect(forKey!.resourceName).toBe(AUDIT_LOG_HIDDEN_VALUE);
      expectHidden(changeOf(forKey!, "phoneNumber"), "phoneNumber");
    });

    test("a team member, named after the person, is named to those who read the membership", async () => {
      findsOnly(TeamMemberService, []);

      const recorded: () => AuditLog = (): AuditLog => {
        return entryOf({
          resourceType:
            AuditLogReadAccess.getResourceTypeOf(new TeamMember()) || "missing",
          resourceId: ObjectID.generate(),
          resourceName: "Jane Doe",
          action: AuditLogAction.Delete,
          changes: [
            {
              field: "user",
              oldValue: { _id: USER_ID.toString(), name: "Jane Doe" },
            },
          ],
        });
      };

      const [forAdmin] = await hold([recorded()], PROJECT_ADMIN);
      expectShownAsRecorded(forAdmin!, recorded());

      const [forKey] = await hold([recorded()], READ_AUDIT_LOG_KEY);
      expect(forKey!.resourceName).toBe(AUDIT_LOG_HIDDEN_VALUE);
      expectHidden(changeOf(forKey!, "user"), "user");
    });
  });

  describe("a related record's name", () => {
    test("a person a case is assigned to is named to whoever reads the case: a label on the joined row", async () => {
      findsOnly(SecurityCaseService, [CASE_ID]);

      const recorded: () => AuditLog = (): AuditLog => {
        return entryOf({
          resourceType: "Security Case",
          resourceId: CASE_ID,
          resourceName: "Phishing campaign",
          action: AuditLogAction.Update,
          changes: [
            {
              field: "assignedToUser",
              oldValue: null,
              newValue: { _id: USER_ID.toString(), name: "Jane Doe" },
            },
          ],
        });
      };

      const [held] = await hold(
        [recorded()],
        memberWith([
          { permission: Permission.SecurityViewer },
          { permission: Permission.ReadAuditLog },
        ]),
      );

      expectShownAsRecorded(held!, recorded());
    });
  });

  describe("a table whose service holds what it found after the read (Workflow)", () => {
    const workflowDeleted: () => AuditLog = (): AuditLog => {
      return entryOf({
        resourceType:
          AuditLogReadAccess.getResourceTypeOf(new Workflow()) || "missing",
        resourceId: ObjectID.generate(),
        resourceName: "Page the on-call engineer",
        action: AuditLogAction.Delete,
        changes: [{ field: "name", oldValue: "Page the on-call engineer" }],
      });
    };

    test("its owners and admins read a deleted workflow's snapshot", async () => {
      findsOnly(WorkflowService, []);

      for (const props of [PROJECT_OWNER, PROJECT_ADMIN]) {
        const [held] = await hold([workflowDeleted()], props);
        expectShownAsRecorded(held!, workflowDeleted());
      }
    });

    test("an Admin with a block on its read does not", async () => {
      findsOnly(WorkflowService, []);

      const [held] = await hold(
        [workflowDeleted()],
        memberWith([
          { permission: Permission.ProjectAdmin },
          { permission: Permission.ReadWorkflow, isBlockPermission: true },
        ]),
      );

      expect(held!.resourceName).toBe(AUDIT_LOG_HIDDEN_VALUE);
      expectHidden(changeOf(held!, "name"), "name");
    });
  });

  describe("the audit log's own entries", () => {
    test.each([
      [AUDIT_LOG_SESSION_RESOURCE_TYPE, AuditLogAction.SignIn],
      [AUDIT_LOG_SIGN_IN_ATTEMPT_RESOURCE_TYPE, AuditLogAction.SignInFailed],
      [AUDIT_LOG_SIGN_IN_SETTINGS_CLEARED_RESOURCE_TYPE, AuditLogAction.Update],
      [AUDIT_LOG_STATUS_PAGE_SESSION_RESOURCE_TYPE, AuditLogAction.SignOut],
    ])(
      "an entry of %s is its readers' to read as it was written",
      async (resourceType: string, action: string) => {
        const recorded: () => AuditLog = (): AuditLog => {
          return entryOf({
            resourceType,
            resourceId: ObjectID.generate(),
            resourceName: "Chrome 130 on macOS",
            action,
            changes: [
              { field: "ipAddress", newValue: "203.0.113.7" },
              { field: "enableTwoFactorAuth", oldValue: true, newValue: false },
            ],
          });
        };

        const [held] = await hold([recorded()], READ_AUDIT_LOG_KEY);

        expectShownAsRecorded(held!, recorded());
      },
    );

    test("none of them is the type of a record's entries", () => {
      for (const resourceType of [
        AUDIT_LOG_SESSION_RESOURCE_TYPE,
        AUDIT_LOG_SIGN_IN_ATTEMPT_RESOURCE_TYPE,
        AUDIT_LOG_SIGN_IN_SETTINGS_CLEARED_RESOURCE_TYPE,
        AUDIT_LOG_STATUS_PAGE_SESSION_RESOURCE_TYPE,
      ]) {
        expect(AuditLogReadAccess.isOwnEntryType(resourceType)).toBe(true);
        expect(AuditLogReadAccess.getModelTypesOf(resourceType)).toEqual([]);

        for (const modelType of AllDatabaseModelTypes as Array<DatabaseBaseModelType>) {
          const model: BaseModel = new modelType();

          if (model.enableAuditLogOn) {
            expect(AuditLogReadAccess.getResourceTypeOf(model)).not.toBe(
              resourceType,
            );
          }
        }
      }
    });
  });

  describe("a kind of record no model has any longer", () => {
    const retired: () => AuditLog = (): AuditLog => {
      return entryOf({
        resourceType: "Retired Widget",
        resourceId: ObjectID.generate(),
        resourceName: "Old widget",
        action: AuditLogAction.Delete,
        changes: [{ field: "colour", oldValue: "Blue" }],
      });
    };

    test("is read by the project's owners and admins, as they read every record", async () => {
      for (const props of [PROJECT_OWNER, PROJECT_ADMIN]) {
        const [held] = await hold([retired()], props);
        expectShownAsRecorded(held!, retired());
      }
    });

    test("and by nobody else", async () => {
      const [held] = await hold([retired()], SETTINGS_ADMIN);

      expect(held!.resourceName).toBe(AUDIT_LOG_HIDDEN_VALUE);
      expectHidden(changeOf(held!, "colour"), "colour");
    });
  });

  describe("OneUptime itself and a server admin", () => {
    test.each([
      ["OneUptime itself", { isRoot: true } as DatabaseCommonInteractionProps],
      [
        "a server admin",
        {
          userId: USER_ID,
          isMasterAdmin: true,
          tenantId: PROJECT_ID,
        } as DatabaseCommonInteractionProps,
      ],
    ])(
      "%s reads every entry as it was recorded, looking nothing up",
      async (_name: string, props: DatabaseCommonInteractionProps) => {
        const asked: Array<FindBy<BaseModel>> = findsOnly(
          SecurityCaseService,
          [],
        );
        const readsEvery: jest.SpyInstance = getJestSpyOn(
          SecurityCaseService,
          "readsEveryRecordInProject",
        );

        const [held] = await hold([securityCaseUpdate()], props);

        expectShownAsRecorded(held!, securityCaseUpdate());
        expect(asked).toHaveLength(0);
        expect(readsEvery).not.toHaveBeenCalled();
      },
    );
  });

  describe("where an entry's record is looked up", () => {
    test("in the table's own service, once a table, with the reader's props", async () => {
      const asked: Array<FindBy<BaseModel>> = findsOnly(IncidentService, [
        INCIDENT_ID,
      ]);
      const props: DatabaseCommonInteractionProps = memberWith([
        {
          permission: Permission.ReadProjectIncident,
          scope: PermissionScope.Owned,
        },
        { permission: Permission.ReadAuditLog },
      ]);

      const entries: Array<AuditLog> = [
        INCIDENT_ID,
        OTHER_INCIDENT_ID,
        INCIDENT_ID,
      ].map((id: ObjectID): AuditLog => {
        return entryOf({
          resourceType: "Incident",
          resourceId: id,
          action: AuditLogAction.Update,
          changes: [{ field: "title", oldValue: "a", newValue: "b" }],
        });
      });

      await hold(entries, props);

      expect(DatabaseService.getServiceOf(Incident)).toBe(IncidentService);
      expect(asked).toHaveLength(1);
      expect(asked[0]!.limit).toBe(2);
    });

    test("a read the record's own read refuses finds nothing: every value hidden", async () => {
      getJestSpyOn(IncidentService, "findBy").mockRejectedValue(
        new Error("refused"),
      );

      const [held] = await hold(
        [
          entryOf({
            resourceType: "Incident",
            resourceId: INCIDENT_ID,
            resourceName: "Checkout down",
            action: AuditLogAction.Update,
            changes: [{ field: "title", oldValue: "a", newValue: "b" }],
          }),
        ],
        memberWith([
          {
            permission: Permission.ReadProjectIncident,
            scope: PermissionScope.Owned,
          },
          { permission: Permission.ReadAuditLog },
        ]),
      );

      expect(held!.resourceName).toBe(AUDIT_LOG_HIDDEN_VALUE);
      expectHidden(changeOf(held!, "title"), "title");
    });

    test("every model an entry can be about is found by the type its entries are stored under", () => {
      for (const modelType of AllDatabaseModelTypes as Array<DatabaseBaseModelType>) {
        const model: BaseModel = new modelType();

        if (!model.enableAuditLogOn) {
          continue;
        }

        const resourceType: string | null =
          AuditLogReadAccess.getResourceTypeOf(model);

        expect(resourceType).toBeTruthy();
        expect(AuditLogReadAccess.getModelTypesOf(resourceType)).toContain(
          modelType,
        );
      }
    });

    test("the services this suite reads through are each model's own", () => {
      const pairs: Array<[DatabaseBaseModelType, unknown]> = [
        [SecurityCase, SecurityCaseService],
        [DataStoreFinding, DataStoreFindingService],
        [Incident, IncidentService],
        [CloudBudget, CloudBudgetService],
        [IncomingCallPolicyPhoneNumber, IncomingCallPolicyPhoneNumberService],
        [TeamMember, TeamMemberService],
        [Workflow, WorkflowService],
      ];

      for (const [modelType, service] of pairs) {
        expect(DatabaseService.getServiceOf(modelType)).toBe(service);
      }
    });
  });

  test("an entry that carries neither a name nor changes - a read that selected neither - is left as it is", async () => {
    const entry: AuditLog = new AuditLog();
    entry.resourceType = "Security Case";
    entry.resourceId = CASE_ID;

    await hold([entry], SETTINGS_ADMIN);

    expect(entry.resourceName).toBeUndefined();
    expect(entry.changes).toBeUndefined();
  });

  /*
   * The Enterprise export reads entries as OneUptime itself and sends them as
   * recorded, but for secrets and the fields nobody may read
   * (ee/Server/AuditLogExport/AuditLogExportRedaction): its readers are the
   * project's owners and admins who set it up (AuditLogExport's lists), or
   * a server admin for the instance's export. That stays the rule while
   * they read every record the audit log is about: every audited table's
   * readers name both roles, or nobody's do - and then no field of it is
   * recorded, nobody reading any.
   */
  test("the export's readers, a project's owners and admins, read every table the audit log records", () => {
    const setUpBy: Array<Permission> = TablePermission.getTablePermission(
      AuditLogExport as unknown as DatabaseBaseModelType,
      DatabaseRequestType.Create,
    );

    expect([...setUpBy].sort()).toEqual(
      [Permission.ProjectOwner, Permission.ProjectAdmin].sort(),
    );

    const readByNeither: Array<string> = [];

    for (const modelType of AllDatabaseModelTypes as Array<DatabaseBaseModelType>) {
      const model: BaseModel = new modelType();

      if (!model.enableAuditLogOn) {
        continue;
      }

      const readers: Array<Permission> = TablePermission.getTablePermission(
        modelType,
        DatabaseRequestType.Read,
      );

      if (readers.length === 0) {
        // Nobody reads it: no field of it is in an entry.
        for (const [column, access] of Object.entries(
          model.getColumnAccessControlForAllColumns(),
        )) {
          if (
            model.isTableColumn(column) &&
            !["_id", "createdAt", "updatedAt", "deletedAt"].includes(column)
          ) {
            expect({ column, read: access.read || [] }).toEqual({
              column,
              read: [],
            });
          }
        }

        continue;
      }

      if (
        !readers.includes(Permission.ProjectOwner) ||
        !readers.includes(Permission.ProjectAdmin)
      ) {
        readByNeither.push(model.tableName || "");
      }
    }

    expect(readByNeither).toEqual([]);
  });
});
