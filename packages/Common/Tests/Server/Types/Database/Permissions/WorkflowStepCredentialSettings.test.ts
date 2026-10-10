import { RecordIdsFinder } from "../../../../../Server/Types/Database/Permissions/CreatePermission";
import ModelPermission from "../../../../../Server/Types/Database/Permissions/Index";
import RelationListPermission, {
  CheckedRelationList,
} from "../../../../../Server/Types/Database/Permissions/RelationListPermission";
import Query from "../../../../../Server/Types/Database/Query";
import WorkflowPrincipal from "../../../../../Server/Utils/Workflow/WorkflowPrincipal";
import AllModelTypes from "../../../../../Models/DatabaseModels/Index";
import ApiKey from "../../../../../Models/DatabaseModels/ApiKey";
import ApiKeyPermission from "../../../../../Models/DatabaseModels/ApiKeyPermission";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncomingCallPolicy from "../../../../../Models/DatabaseModels/IncomingCallPolicy";
import NetworkSnmpCredentialProfile from "../../../../../Models/DatabaseModels/NetworkSnmpCredentialProfile";
import ProjectCallSMSConfig from "../../../../../Models/DatabaseModels/ProjectCallSMSConfig";
import ProjectSmtpConfig from "../../../../../Models/DatabaseModels/ProjectSmtpConfig";
import RunbookCredential from "../../../../../Models/DatabaseModels/RunbookCredential";
import StatusPage from "../../../../../Models/DatabaseModels/StatusPage";
import VideoCallConnection from "../../../../../Models/DatabaseModels/VideoCallConnection";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../../../Types/Permission";
import UserType from "../../../../../Types/UserType";
import { ON_HIGHEST_PLAN } from "../../../TestingUtils/RequestPlan";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../../../Server/Utils/Logger");

afterEach(() => {
  jest.restoreAllMocks();
});

/*
 * A WORKFLOW'S STEP NAMES NO SETTING THAT HOLDS CREDENTIALS.
 *
 * A setting that holds credentials - an SMTP server, a call and SMS
 * provider, SNMP credentials, a video call connection, an API key, a
 * runbook credential - is named only by a caller who may read it
 * (RelationListPermission.isHeldToTableRead). A workflow's step acts as a
 * Project Admin, who may read every one of them; but whoever may edit a
 * workflow decides what its steps name - with whatever its variables,
 * webhooks and runs hand them - so a step is lent no read of them, and a
 * create or an update by a step that names one is refused, with a refusal
 * that says a person who may read them has to make the change. Nobody is
 * looked up to answer it. A step that keeps the setting a record names
 * already, or clears it, names nothing new and is let through, as is a
 * person who may read them.
 *
 * The workflow-enabled records that can name one through a step today are
 * pinned at the bottom (the survey); none of the workflow components needs
 * to name one to work.
 */

const projectId: ObjectID = new ObjectID(
  "0193c0de-dddd-4aaa-8bbb-000000000001",
);

const SMTP_A: string = "0193c0de-dddd-4aaa-8bbb-0000000000a1";
const SMTP_B: string = "0193c0de-dddd-4aaa-8bbb-0000000000a2";
const CALL_A: string = "0193c0de-dddd-4aaa-8bbb-0000000000b1";
const API_KEY_A: string = "0193c0de-dddd-4aaa-8bbb-0000000000f1";

const step: () => DatabaseCommonInteractionProps =
  (): DatabaseCommonInteractionProps => {
    return {
      ...WorkflowPrincipal.getPropsWithoutPlan({
        projectId: projectId,
        workflowId: new ObjectID("0193c0de-dddd-4aaa-8bbb-000000000002"),
        workflowName: "Point the status page at the new mail server",
      }),
      ...ON_HIGHEST_PLAN,
    };
  };

const member: (
  permissions: Array<Permission>,
) => DatabaseCommonInteractionProps = (
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps => {
  return {
    userId: ObjectID.generate(),
    userType: UserType.User,
    tenantId: projectId,
    ...ON_HIGHEST_PLAN,
    userGlobalAccessPermission: {
      _type: "UserGlobalAccessPermission",
      projectIds: [projectId],
      globalPermissions: [Permission.Public, Permission.User],
    },
    userTenantAccessPermission: {
      [projectId.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: projectId,
        permissions: permissions.map((permission: Permission) => {
          return {
            _type: "UserPermission",
            permission: permission,
            labelIds: [],
            isBlockPermission: false,
          } as UserPermission;
        }),
      },
    },
  };
};

interface LookupCall {
  modelType: { new (): BaseModel };
  ids: Array<string>;
  query: Query<BaseModel>;
  props: DatabaseCommonInteractionProps;
}

const check: (data: {
  modelType: { new (): BaseModel };
  data: Record<string, unknown>;
  props: DatabaseCommonInteractionProps;
  heldIdsByColumn?: Record<string, Array<Array<string>>>;
  calls?: Array<LookupCall>;
}) => Promise<unknown> = async (data: {
  modelType: { new (): BaseModel };
  data: Record<string, unknown>;
  props: DatabaseCommonInteractionProps;
  heldIdsByColumn?: Record<string, Array<Array<string>>>;
  calls?: Array<LookupCall>;
}): Promise<unknown> => {
  // Every record named is in the project and readable by whoever may read it.
  const finder: RecordIdsFinder = async (
    call: LookupCall,
  ): Promise<Array<string>> => {
    data.calls?.push(call);
    return call.ids;
  };

  try {
    await ModelPermission.checkNamedListsPermission({
      modelType: data.modelType,
      data: data.data,
      props: data.props,
      heldIdsByColumn: data.heldIdsByColumn,
      findReadableIds: finder,
      findIdsInProject: finder,
      referencesCheckedInProject: true,
    });
  } catch (error) {
    return error;
  }

  return undefined;
};

interface NamedSetting {
  label: string;
  modelType: { new (): BaseModel };
  data: Record<string, unknown>;
  // The setting named, as the refusal names it.
  title: string;
  settings: string;
}

const NAMED_SETTINGS: Array<NamedSetting> = [
  {
    label: "a status page's SMTP server, by relation",
    modelType: StatusPage,
    data: { smtpConfig: { _id: SMTP_A } },
    title: "SMTP Config",
    settings: "SMTP Configs",
  },
  {
    label: "a status page's SMTP server, by id",
    modelType: StatusPage,
    data: { smtpConfigId: SMTP_A },
    title: "SMTP Config",
    settings: "SMTP Configs",
  },
  {
    label: "a status page's call and SMS provider",
    modelType: StatusPage,
    data: { callSmsConfigId: CALL_A },
    title: "Call/SMS Config",
    settings: "Call and SMS Configs",
  },
  {
    label: "an incoming call policy's call and SMS provider",
    modelType: IncomingCallPolicy,
    data: { projectCallSMSConfig: { _id: CALL_A } },
    title: "Project Call/SMS Config",
    settings: "Call and SMS Configs",
  },
  {
    label: "the API key a permission is granted to",
    modelType: ApiKeyPermission,
    data: { apiKeyId: API_KEY_A },
    title: "Api Key",
    settings: "API Keys",
  },
];

describe("a workflow's step naming a setting that holds credentials", () => {
  test.each(NAMED_SETTINGS)(
    "is refused for $label, though it acts as a Project Admin, and looks nothing up",
    async (named: NamedSetting) => {
      const calls: Array<LookupCall> = [];

      const error: unknown = await check({
        modelType: named.modelType,
        data: named.data,
        props: step(),
        calls: calls,
      });

      expect(error).toBeInstanceOf(NotAuthorizedException);
      expect((error as Error).message).toBe(
        `Workflow steps cannot set ${named.title}: a setting that holds credentials is chosen only by a person who may read ${named.settings}. Ask someone who may read them to make this change.`,
      );
      expect(calls).toEqual([]);
    },
  );

  test.each(NAMED_SETTINGS)(
    "lets a person who may read them name $label",
    async (named: NamedSetting) => {
      expect(
        await check({
          modelType: named.modelType,
          data: named.data,
          props: member([Permission.ProjectAdmin]),
        }),
      ).toBeUndefined();
    },
  );

  test("lets a step keep the setting a record names already: an update that names nothing new asks nothing", async () => {
    expect(
      await check({
        modelType: StatusPage,
        data: { smtpConfigId: SMTP_A, name: "Status" },
        props: step(),
        heldIdsByColumn: { smtpConfig: [[SMTP_A]] },
      }),
    ).toBeUndefined();
  });

  test("refuses a step that changes it to another one", async () => {
    expect(
      await check({
        modelType: StatusPage,
        data: { smtpConfigId: SMTP_B },
        props: step(),
        heldIdsByColumn: { smtpConfig: [[SMTP_A]] },
      }),
    ).toBeInstanceOf(NotAuthorizedException);
  });

  test("lets a step clear one: clearing names nothing", async () => {
    for (const data of [{ smtpConfig: null }, { smtpConfigId: null }]) {
      expect(
        await check({ modelType: StatusPage, data: data, props: step() }),
      ).toBeUndefined();
    }
  });

  test("lets a step write what names no setting that holds credentials", async () => {
    expect(
      await check({
        modelType: StatusPage,
        data: { name: "Status", pageTitle: "Status" },
        props: step(),
      }),
    ).toBeUndefined();
  });

  test("answers a step as no reader of any setting that holds credentials, and a reader of the rest", () => {
    for (const modelType of [
      ApiKey,
      NetworkSnmpCredentialProfile,
      ProjectCallSMSConfig,
      ProjectSmtpConfig,
      RunbookCredential,
      VideoCallConnection,
    ]) {
      expect(RelationListPermission.mayReadTable(modelType, step())).toBe(
        false,
      );
      expect(
        RelationListPermission.mayReadTable(
          modelType,
          member([Permission.ProjectAdmin]),
        ),
      ).toBe(true);
    }

    expect(RelationListPermission.mayReadTable(StatusPage, step())).toBe(true);
  });

  test("covers every setting that holds credentials", () => {
    expect(RelationListPermission.getCredentialSettingsTables().sort()).toEqual(
      [
        new ApiKey().tableName!,
        new NetworkSnmpCredentialProfile().tableName!,
        new ProjectCallSMSConfig().tableName!,
        new ProjectSmtpConfig().tableName!,
        new RunbookCredential().tableName!,
        new VideoCallConnection().tableName!,
      ].sort(),
    );
  });
});

/*
 * THE SURVEY: every record a workflow step can create or change (one with
 * @EnableWorkflow) that names a setting that holds credentials in a field
 * a write may set. Each is refused to a step by the rule above, and none of
 * the workflow components needs to name one. A new one fails this test
 * until it is looked at and added here.
 */
const WORKFLOW_RECORDS_NAMING_CREDENTIAL_SETTINGS: Array<string> = [
  "ApiKeyPermission.apiKey -> ApiKey",
  "IncomingCallPolicy.projectCallSMSConfig -> ProjectCallSMSConfig",
  "StatusPage.callSmsConfig -> ProjectCallSMSConfig",
  "StatusPage.smtpConfig -> ProjectSMTPConfig",
];

describe("the workflow records that can name a setting that holds credentials", () => {
  test("are the ones pinned here", () => {
    const found: Array<string> = [];

    for (const modelType of AllModelTypes as Array<{ new (): BaseModel }>) {
      const model: BaseModel = new modelType();

      if (!model.enableWorkflowOn) {
        continue;
      }

      for (const relation of RelationListPermission.getCheckedRelations(
        modelType,
      ) as Array<CheckedRelationList>) {
        if (
          RelationListPermission.isHeldToTableRead(relation.listedModelType)
        ) {
          found.push(
            `${model.tableName}.${relation.column} -> ${
              new relation.listedModelType().tableName
            }`,
          );
        }
      }
    }

    expect(found.sort()).toEqual(
      [...WORKFLOW_RECORDS_NAMING_CREDENTIAL_SETTINGS].sort(),
    );
  });
});
