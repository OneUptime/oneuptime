import { RecordIdsFinder } from "../../../../../Server/Types/Database/Permissions/CreatePermission";
import ModelPermission from "../../../../../Server/Types/Database/Permissions/Index";
import RelationListPermission, {
  CheckedRelationList,
} from "../../../../../Server/Types/Database/Permissions/RelationListPermission";
import Query from "../../../../../Server/Types/Database/Query";
import { UnreadableReferenceException } from "../../../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import AlertVideoCall from "../../../../../Models/DatabaseModels/AlertVideoCall";
import ApiKey from "../../../../../Models/DatabaseModels/ApiKey";
import ApiKeyPermission from "../../../../../Models/DatabaseModels/ApiKeyPermission";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Domain from "../../../../../Models/DatabaseModels/Domain";
import IncidentSeverity from "../../../../../Models/DatabaseModels/IncidentSeverity";
import IncidentVideoCall from "../../../../../Models/DatabaseModels/IncidentVideoCall";
import IncomingCallPolicy from "../../../../../Models/DatabaseModels/IncomingCallPolicy";
import KubernetesCluster from "../../../../../Models/DatabaseModels/KubernetesCluster";
import NetworkDevice from "../../../../../Models/DatabaseModels/NetworkDevice";
import NetworkSite from "../../../../../Models/DatabaseModels/NetworkSite";
import NetworkSnmpCredentialProfile from "../../../../../Models/DatabaseModels/NetworkSnmpCredentialProfile";
import ProjectCallSMSConfig from "../../../../../Models/DatabaseModels/ProjectCallSMSConfig";
import ProjectSmtpConfig from "../../../../../Models/DatabaseModels/ProjectSmtpConfig";
import RunbookCredential from "../../../../../Models/DatabaseModels/RunbookCredential";
import StatusPage from "../../../../../Models/DatabaseModels/StatusPage";
import Team from "../../../../../Models/DatabaseModels/Team";
import VideoCallConnection from "../../../../../Models/DatabaseModels/VideoCallConnection";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../../../Types/Database/AccessControl/PermissionScope";
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
 * A SETTING THAT HOLDS CREDENTIALS IS NAMED ONLY BY A CALLER WHO MAY READ IT.
 *
 * The SMTP server a status page sends its email through, the call and SMS
 * provider a status page or an incoming call policy uses, the credential the
 * AI reaches a cluster with, the SNMP credentials a device or site is polled
 * with, the video call provider a meeting starts through and the API key a
 * permission is granted to are read as a whole table: no label or owner
 * narrows a read of them. A create or an update that names one is held to
 * its caller's permission to read that table (RelationListPermission
 * .isHeldToTableRead), not to the project alone: a caller who may not read
 * the table - who holds none of its read permissions, or whose block with no
 * labels takes them away - names none of its records, and is answered as if
 * the record were not there. Clearing one names nothing, and an update that
 * keeps the one a row holds asks nothing.
 */

const projectId: ObjectID = new ObjectID(
  "0193c0de-cccc-4aaa-8bbb-000000000001",
);

const SMTP_A: string = "0193c0de-cccc-4aaa-8bbb-0000000000a1";
const SMTP_B: string = "0193c0de-cccc-4aaa-8bbb-0000000000a2";
const CALL_A: string = "0193c0de-cccc-4aaa-8bbb-0000000000b1";
const CREDENTIAL_A: string = "0193c0de-cccc-4aaa-8bbb-0000000000c1";
const SNMP_A: string = "0193c0de-cccc-4aaa-8bbb-0000000000d1";
const VIDEO_A: string = "0193c0de-cccc-4aaa-8bbb-0000000000e1";
const API_KEY_A: string = "0193c0de-cccc-4aaa-8bbb-0000000000f1";

const row: (
  permission: Permission,
  data?: { isBlock?: boolean; labelIds?: Array<ObjectID> },
) => UserPermission = (
  permission: Permission,
  data?: { isBlock?: boolean; labelIds?: Array<ObjectID> },
): UserPermission => {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: data?.labelIds || [],
    isBlockPermission: Boolean(data?.isBlock),
    scope:
      data?.labelIds && data.labelIds.length > 0 && !data.isBlock
        ? PermissionScope.Labels
        : PermissionScope.All,
  };
};

const member: (
  permissions: Array<Permission | UserPermission>,
) => DatabaseCommonInteractionProps = (
  permissions: Array<Permission | UserPermission>,
): DatabaseCommonInteractionProps => {
  return {
    userId: ObjectID.generate(),
    userType: UserType.User,
    tenantId: projectId,
    userTeamIds: [ObjectID.generate()],
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
        permissions: permissions.map(
          (permission: Permission | UserPermission): UserPermission => {
            return typeof permission === "string" ? row(permission) : permission;
          },
        ),
      },
    },
  };
};

const apiKey: (
  permissions: Array<Permission>,
) => DatabaseCommonInteractionProps = (
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps => {
  return {
    userType: UserType.API,
    tenantId: projectId,
    ...ON_HIGHEST_PLAN,
    userTenantAccessPermission: {
      [projectId.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: projectId,
        permissions: permissions.map((permission: Permission) => {
          return row(permission);
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

interface Lookups {
  readable: RecordIdsFinder;
  inProject: RecordIdsFinder;
  calls: Array<LookupCall>;
}

// Every record named is in the project and readable by whoever may read it.
const lookups: () => Lookups = (): Lookups => {
  const calls: Array<LookupCall> = [];

  const finder: RecordIdsFinder = async (
    call: LookupCall,
  ): Promise<Array<string>> => {
    calls.push(call);
    return call.ids;
  };

  return { readable: finder, inProject: finder, calls: calls };
};

const check: (data: {
  modelType: { new (): BaseModel };
  data: Record<string, unknown>;
  props: DatabaseCommonInteractionProps;
  lookups?: Lookups;
  heldIdsByColumn?: Record<string, Array<Array<string>>>;
  referencesCheckedInProject?: boolean;
}) => Promise<unknown> = async (data: {
  modelType: { new (): BaseModel };
  data: Record<string, unknown>;
  props: DatabaseCommonInteractionProps;
  lookups?: Lookups;
  heldIdsByColumn?: Record<string, Array<Array<string>>>;
  referencesCheckedInProject?: boolean;
}): Promise<unknown> => {
  const found: Lookups = data.lookups || lookups();

  try {
    await ModelPermission.checkNamedListsPermission({
      modelType: data.modelType,
      data: data.data,
      props: data.props,
      heldIdsByColumn: data.heldIdsByColumn,
      findReadableIds: found.readable,
      findIdsInProject: found.inProject,
      referencesCheckedInProject: data.referencesCheckedInProject ?? true,
    });
  } catch (error) {
    return error;
  }

  return undefined;
};

const referenceOf: (
  modelType: { new (): BaseModel },
  column: string,
) => CheckedRelationList | undefined = (
  modelType: { new (): BaseModel },
  column: string,
): CheckedRelationList | undefined => {
  return RelationListPermission.getCheckedReferences(modelType).find(
    (reference: CheckedRelationList): boolean => {
      return reference.column === column;
    },
  );
};

// What a refusal names: the field's title and the record.
const refusedFor: (title: string, id: string) => RegExp = (
  title: string,
  id: string,
): RegExp => {
  return new RegExp(
    `references records that are not in this project: ${title.replace(
      /[/]/g,
      "\\/",
    )} "${id}"`,
  );
};

describe("the settings that hold credentials", () => {
  test.each([
    [ProjectSmtpConfig],
    [ProjectCallSMSConfig],
    [RunbookCredential],
    [NetworkSnmpCredentialProfile],
    [VideoCallConnection],
    [ApiKey],
  ] as Array<[{ new (): BaseModel }]>)(
    "%p is read as a whole table, and named only by its readers",
    (modelType: { new (): BaseModel }) => {
      expect(RelationListPermission.isReadPerRecord(modelType)).toBe(false);
      expect(RelationListPermission.isHeldToTableRead(modelType)).toBe(true);
      expect(RelationListPermission.isNamedOnlyWhenRead(modelType)).toBe(true);
    },
  );

  test.each([[IncidentSeverity], [Team], [Domain]] as Array<
    [{ new (): BaseModel }]
  >)(
    "%p, read as a whole table and holding no credentials, is left to the project check",
    (modelType: { new (): BaseModel }) => {
      expect(RelationListPermission.isHeldToTableRead(modelType)).toBe(false);
      expect(RelationListPermission.isNamedOnlyWhenRead(modelType)).toBe(
        false,
      );
    },
  );

  test.each([
    [StatusPage, "smtpConfig", "smtpConfigId", ProjectSmtpConfig],
    [StatusPage, "callSmsConfig", "callSmsConfigId", ProjectCallSMSConfig],
    [
      IncomingCallPolicy,
      "projectCallSMSConfig",
      "projectCallSMSConfigId",
      ProjectCallSMSConfig,
    ],
    [
      KubernetesCluster,
      "aiAccessCredential",
      "aiAccessCredentialId",
      RunbookCredential,
    ],
    [
      NetworkDevice,
      "snmpCredentialProfile",
      "snmpCredentialProfileId",
      NetworkSnmpCredentialProfile,
    ],
    [
      NetworkSite,
      "snmpCredentialProfile",
      "snmpCredentialProfileId",
      NetworkSnmpCredentialProfile,
    ],
    [
      IncidentVideoCall,
      "videoCallConnection",
      "videoCallConnectionId",
      VideoCallConnection,
    ],
    [
      AlertVideoCall,
      "videoCallConnection",
      "videoCallConnectionId",
      VideoCallConnection,
    ],
    [ApiKeyPermission, "apiKey", "apiKeyId", ApiKey],
  ] as Array<
    [{ new (): BaseModel }, string, string, { new (): BaseModel }]
  >)(
    "%p.%s is held to the read of the setting it names, under both of its names",
    (
      modelType: { new (): BaseModel },
      column: string,
      idColumn: string,
      settingType: { new (): BaseModel },
    ) => {
      const reference: CheckedRelationList | undefined = referenceOf(
        modelType,
        column,
      );

      expect(reference).toBeDefined();
      expect(reference!.idColumn).toBe(idColumn);
      expect(reference!.listedModelType).toBe(settingType);
    },
  );
});

describe("a status page's SMTP server", () => {
  // Status Page Admins edit status pages, and read no SMTP servers.
  const statusPageAdmin: DatabaseCommonInteractionProps = member([
    Permission.StatusPageAdmin,
  ]);

  test("is refused to a caller who may not read SMTP servers, under either name, and nothing is looked up", async () => {
    for (const data of [
      { smtpConfigId: SMTP_A },
      { smtpConfig: { _id: SMTP_A } },
      { smtpConfigId: new ObjectID(SMTP_A) },
    ]) {
      const found: Lookups = lookups();

      const refusal: unknown = await check({
        modelType: StatusPage,
        data: data,
        props: statusPageAdmin,
        lookups: found,
      });

      expect(refusal).toBeInstanceOf(UnreadableReferenceException);
      expect((refusal as Error).message).toMatch(
        refusedFor("SMTP Config", SMTP_A),
      );
      expect(found.calls).toHaveLength(0);
    }
  });

  test("is refused whether or not the service checks its references in the project itself", async () => {
    for (const referencesCheckedInProject of [true, false]) {
      expect(
        await check({
          modelType: StatusPage,
          data: { smtpConfigId: SMTP_A },
          props: statusPageAdmin,
          referencesCheckedInProject: referencesCheckedInProject,
        }),
      ).toBeInstanceOf(UnreadableReferenceException);
    }
  });

  test("is named by a caller who may read SMTP servers", async () => {
    for (const props of [
      member([Permission.StatusPageAdmin, Permission.ReadProjectSMTPConfig]),
      member([Permission.ProjectMember]),
      member([Permission.ProjectAdmin]),
      member([Permission.ProjectOwner]),
      member([Permission.SettingsViewer, Permission.EditProjectStatusPage]),
    ]) {
      expect(
        await check({
          modelType: StatusPage,
          data: { smtpConfigId: SMTP_A },
          props: props,
        }),
      ).toBeUndefined();
    }
  });

  test("a reader is looked up as themselves when the service does not check the project itself", async () => {
    const found: Lookups = lookups();
    const props: DatabaseCommonInteractionProps = member([
      Permission.ProjectMember,
    ]);

    expect(
      await check({
        modelType: StatusPage,
        data: { smtpConfigId: SMTP_A },
        props: props,
        lookups: found,
        referencesCheckedInProject: false,
      }),
    ).toBeUndefined();

    expect(found.calls).toHaveLength(1);
    expect(found.calls[0]!.modelType).toBe(ProjectSmtpConfig);
    expect(found.calls[0]!.props).toBe(props);
  });

  test("is refused to a reader whose team blocks reading SMTP servers", async () => {
    expect(
      await check({
        modelType: StatusPage,
        data: { smtpConfigId: SMTP_A },
        props: member([
          Permission.ProjectMember,
          row(Permission.ReadProjectSMTPConfig, { isBlock: true }),
        ]),
      }),
    ).toBeInstanceOf(UnreadableReferenceException);
  });

  test("clearing it names nothing", async () => {
    for (const data of [{ smtpConfigId: null }, { smtpConfig: null }]) {
      expect(
        await check({
          modelType: StatusPage,
          data: data,
          props: statusPageAdmin,
        }),
      ).toBeUndefined();
    }
  });

  test("an update that keeps the one the status page holds asks nothing", async () => {
    expect(
      await check({
        modelType: StatusPage,
        data: { smtpConfigId: SMTP_A, name: "Renamed" },
        props: statusPageAdmin,
        heldIdsByColumn: { smtpConfig: [[SMTP_A]] },
      }),
    ).toBeUndefined();
  });

  test("an update that changes it to another is refused", async () => {
    expect(
      await check({
        modelType: StatusPage,
        data: { smtpConfigId: SMTP_B },
        props: statusPageAdmin,
        heldIdsByColumn: { smtpConfig: [[SMTP_A]] },
      }),
    ).toBeInstanceOf(UnreadableReferenceException);
  });

  test("an API key is held to the same rule", async () => {
    expect(
      await check({
        modelType: StatusPage,
        data: { smtpConfigId: SMTP_A },
        props: apiKey([Permission.EditProjectStatusPage]),
      }),
    ).toBeInstanceOf(UnreadableReferenceException);

    expect(
      await check({
        modelType: StatusPage,
        data: { smtpConfigId: SMTP_A },
        props: apiKey([
          Permission.EditProjectStatusPage,
          Permission.ReadProjectSMTPConfig,
        ]),
      }),
    ).toBeUndefined();
  });

  test("OneUptime and master admins are not asked", async () => {
    for (const props of [
      { isRoot: true },
      { isMasterAdmin: true, userId: ObjectID.generate() },
    ] as Array<DatabaseCommonInteractionProps>) {
      const found: Lookups = lookups();

      expect(
        await check({
          modelType: StatusPage,
          data: { smtpConfigId: SMTP_A },
          props: props,
          lookups: found,
        }),
      ).toBeUndefined();
      expect(found.calls).toHaveLength(0);
    }
  });
});

describe("a call and SMS provider", () => {
  test("on a status page: refused to a Status Page Admin, named by one who may read them", async () => {
    expect(
      await check({
        modelType: StatusPage,
        data: { callSmsConfigId: CALL_A },
        props: member([Permission.StatusPageAdmin]),
      }),
    ).toBeInstanceOf(UnreadableReferenceException);

    expect(
      await check({
        modelType: StatusPage,
        data: { callSmsConfigId: CALL_A },
        props: member([
          Permission.StatusPageAdmin,
          Permission.ReadProjectCallSMSConfig,
        ]),
      }),
    ).toBeUndefined();
  });

  test("on an incoming call policy: named by the Settings tiers, who read them; refused to a role that only edits policies", async () => {
    for (const permission of [
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.ProjectAdmin,
    ]) {
      expect(
        await check({
          modelType: IncomingCallPolicy,
          data: { projectCallSMSConfigId: CALL_A },
          props: member([permission]),
        }),
      ).toBeUndefined();
    }

    const refusal: unknown = await check({
      modelType: IncomingCallPolicy,
      data: { projectCallSMSConfig: { _id: CALL_A } },
      props: member([Permission.EditProjectIncomingCallPolicy]),
    });

    expect(refusal).toBeInstanceOf(UnreadableReferenceException);
    expect((refusal as Error).message).toMatch(
      refusedFor("Project Call/SMS Config", CALL_A),
    );
  });
});

describe("the credential the AI reaches a cluster with", () => {
  test("is refused to a cluster editor who may not read credentials", async () => {
    for (const permission of [
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditKubernetesCluster,
    ]) {
      expect(
        await check({
          modelType: KubernetesCluster,
          data: { aiAccessCredentialId: CREDENTIAL_A },
          props: member([permission]),
        }),
      ).toBeInstanceOf(UnreadableReferenceException);
    }
  });

  test("is named by one who may", async () => {
    for (const props of [
      member([Permission.ProjectAdmin]),
      member([Permission.SettingsAdmin, Permission.ReadRunbookCredential]),
    ]) {
      expect(
        await check({
          modelType: KubernetesCluster,
          data: { aiAccessCredential: { _id: CREDENTIAL_A } },
          props: props,
        }),
      ).toBeUndefined();
    }
  });
});

describe("the SNMP credentials a device or site is polled with", () => {
  test.each([
    [NetworkDevice, Permission.EditNetworkDevice],
    [NetworkSite, Permission.EditNetworkSite],
  ] as Array<[{ new (): BaseModel }, Permission]>)(
    "%p: refused to a role that only edits it, named by the Settings tiers",
    async (modelType: { new (): BaseModel }, editPermission: Permission) => {
      expect(
        await check({
          modelType: modelType,
          data: { snmpCredentialProfileId: SNMP_A },
          props: member([editPermission]),
        }),
      ).toBeInstanceOf(UnreadableReferenceException);

      for (const permission of [
        Permission.SettingsMember,
        Permission.ProjectMember,
      ]) {
        expect(
          await check({
            modelType: modelType,
            data: { snmpCredentialProfileId: SNMP_A },
            props: member([permission]),
          }),
        ).toBeUndefined();
      }
    },
  );
});

describe("the video call provider a meeting starts through", () => {
  test.each([
    [IncidentVideoCall, Permission.CreateIncidentVideoCall, Permission.IncidentMember],
    [AlertVideoCall, Permission.CreateAlertVideoCall, Permission.AlertMember],
  ] as Array<[{ new (): BaseModel }, Permission, Permission]>)(
    "%p: the responders who start calls read the providers; a role that only starts calls does not",
    async (
      modelType: { new (): BaseModel },
      createPermission: Permission,
      responder: Permission,
    ) => {
      expect(
        await check({
          modelType: modelType,
          data: { videoCallConnectionId: VIDEO_A },
          props: member([responder]),
        }),
      ).toBeUndefined();

      expect(
        await check({
          modelType: modelType,
          data: { videoCallConnectionId: VIDEO_A },
          props: member([createPermission]),
        }),
      ).toBeInstanceOf(UnreadableReferenceException);

      expect(
        await check({
          modelType: modelType,
          data: { videoCallConnectionId: VIDEO_A },
          props: member([
            createPermission,
            Permission.ReadVideoCallConnection,
          ]),
        }),
      ).toBeUndefined();
    },
  );
});

describe("the API key a permission is granted to", () => {
  test("is refused to a role that edits API key permissions but reads no API keys", async () => {
    const refusal: unknown = await check({
      modelType: ApiKeyPermission,
      data: { apiKeyId: API_KEY_A },
      props: member([Permission.EditProjectApiKeyPermissions]),
    });

    expect(refusal).toBeInstanceOf(UnreadableReferenceException);
    expect((refusal as Error).message).toMatch(refusedFor("Api Key", API_KEY_A));
  });

  test("is named by one who reads them", async () => {
    for (const props of [
      member([Permission.ProjectAdmin]),
      member([
        Permission.EditProjectApiKeyPermissions,
        Permission.ReadProjectApiKey,
      ]),
    ]) {
      expect(
        await check({
          modelType: ApiKeyPermission,
          data: { apiKey: { _id: API_KEY_A } },
          props: props,
        }),
      ).toBeUndefined();
    }
  });
});
