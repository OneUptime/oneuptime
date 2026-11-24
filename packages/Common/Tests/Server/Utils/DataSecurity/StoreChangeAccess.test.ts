import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * WHO MAY CHANGE A DATA STORE'S COMPLIANCE PAPERWORK (#10375, #10805).
 *
 * A store's impact assessment, its record of processing and OneUptime AI's
 * drafts of either are columns of the store, written as OneUptime once the
 * caller is let through. Holding a store-editing permission somewhere in
 * the project was enough to be let through: a person whose edit of stores
 * is limited to the "staging" label could rewrite the impact assessment of
 * a store labelled "production" that they may only read. Each change is now
 * held to what an update of THAT store is held to
 * (DataStoreService.findOneUpdatableById), and the project's audit evidence
 * to what an update of the record it is kept in - the project's Data
 * Security settings - is held to.
 *
 * Nothing is stubbed between the paperwork and the permission layer but the
 * rows it reads: the caller's real permission rows go through the real
 * checks. What lies past the decision - the write, the feed, the facts the
 * paperwork is built from - stands in for itself.
 */

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../../Server/Utils/Logger");

import AuditEvidenceDrafter, {
  EVIDENCE_CHANGE_REFUSED_MESSAGE,
} from "../../../../Server/Utils/AI/DataSecurity/AuditEvidenceDrafter";
import DataSecurityAiCall from "../../../../Server/Utils/AI/DataSecurity/DataSecurityAiCall";
import ImpactAssessmentDrafter, {
  ASSESSMENT_CHANGE_REFUSED_MESSAGE,
} from "../../../../Server/Utils/AI/DataSecurity/ImpactAssessmentDrafter";
import RecordOfProcessingReader from "../../../../Server/Utils/DataSecurity/RecordOfProcessingReader";
import StoreChangeAccess, {
  STORE_RECORD_CHANGE_REFUSED_MESSAGE,
} from "../../../../Server/Utils/DataSecurity/StoreChangeAccess";
import FeedPersonName from "../../../../Server/Utils/Feed/FeedPersonName";
import UserLanguage from "../../../../Server/Utils/Notification/UserLanguage";
import AIService from "../../../../Server/Services/AIService";
import DataSecuritySettingService from "../../../../Server/Services/DataSecuritySettingService";
import DataStoreFeedService from "../../../../Server/Services/DataStoreFeedService";
import DataStoreService from "../../../../Server/Services/DataStoreService";
import ProjectService from "../../../../Server/Services/ProjectService";
import UserService from "../../../../Server/Services/UserService";
import ModelPermission from "../../../../Server/Types/Database/Permissions/Index";
import DataSecuritySetting from "../../../../Models/DatabaseModels/DataSecuritySetting";
import DataStore from "../../../../Models/DatabaseModels/DataStore";
import Label from "../../../../Models/DatabaseModels/Label";
import Project from "../../../../Models/DatabaseModels/Project";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { FrameworkAuditEvidence } from "../../../../Types/DataSecurity/AuditEvidence";
import ComplianceFramework from "../../../../Types/DataSecurity/ComplianceFramework";
import { ComplianceRequirementStatus } from "../../../../Types/DataSecurity/ComplianceRequirementCatalog";
import { DataSecurityRecordOfProcessingRow } from "../../../../Types/DataSecurity/DataSecurityApiTypes";
import { DataStoreKind } from "../../../../Types/DataSecurity/DataStoreKind";
import {
  ImpactAssessmentPart,
  ImpactAssessmentTrigger,
} from "../../../../Types/DataSecurity/ImpactAssessment";
import Dictionary from "../../../../Types/Dictionary";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../../Types/Permission";
import UserType from "../../../../Types/UserType";
import { withLabelJoinTables } from "../../TestingUtils/LabelJoinTables";
import { ON_HIGHEST_PLAN } from "../../TestingUtils/RequestPlan";

const PROJECT_ID: ObjectID = new ObjectID(
  "10805000-0000-4000-8000-000000000001",
);
const STORE_ID: ObjectID = new ObjectID("10805000-0000-4000-8000-000000000002");
const SETTING_ID: ObjectID = new ObjectID(
  "10805000-0000-4000-8000-000000000003",
);
const USER_ID: ObjectID = new ObjectID("10805000-0000-4000-8000-000000000004");
const STAGING_LABEL_ID: ObjectID = new ObjectID(
  "10805000-0000-4000-8000-0000000000a1",
);
const PRODUCTION_LABEL_ID: ObjectID = new ObjectID(
  "10805000-0000-4000-8000-0000000000a2",
);
const NOW: Date = new Date("2026-11-24T12:00:00.000Z");

// What reading a store's paperwork takes: the store and its issues.
const PAPERWORK_READER: Array<Permission> = [
  Permission.ReadDataStore,
  Permission.ReadDataSecurityIssue,
];

/*
 * A caller's permission rows as an access token carries them: grants with
 * no labels, and grants limited to some labels (`scoped`).
 */
function callerProps(data: {
  permissions: Array<Permission>;
  scoped?: Array<{ permission: Permission; labelIds: Array<ObjectID> }>;
  isReadOnlyCredential?: boolean | undefined;
}): DatabaseCommonInteractionProps {
  const rows: Array<UserPermission> = [
    ...data.permissions.map((permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission,
        labelIds: [],
      } as UserPermission;
    }),
    ...(data.scoped || []).map(
      (row: {
        permission: Permission;
        labelIds: Array<ObjectID>;
      }): UserPermission => {
        return {
          _type: "UserPermission",
          permission: row.permission,
          labelIds: row.labelIds,
        } as UserPermission;
      },
    ),
  ];
  const tenants: Dictionary<UserTenantAccessPermission> = {
    [PROJECT_ID.toString()]: {
      _type: "UserTenantAccessPermission",
      projectId: PROJECT_ID,
      permissions: rows,
    } as UserTenantAccessPermission,
  };

  return {
    tenantId: PROJECT_ID,
    userId: USER_ID,
    userType: UserType.User,
    userTenantAccessPermission: tenants,
    ...ON_HIGHEST_PLAN,
    ...(data.isReadOnlyCredential ? { isReadOnlyCredential: true } : {}),
  } as DatabaseCommonInteractionProps;
}

// A reader of the store whose edit of stores is limited to the "staging" label.
const STAGING_EDITOR: DatabaseCommonInteractionProps = callerProps({
  permissions: PAPERWORK_READER,
  scoped: [
    { permission: Permission.EditDataStore, labelIds: [STAGING_LABEL_ID] },
  ],
});
// ...and one who may edit every store in the project.
const STORE_EDITOR: DatabaseCommonInteractionProps = callerProps({
  permissions: [...PAPERWORK_READER, Permission.EditDataStore],
});

function label(id: ObjectID, name: string): Label {
  const model: Label = new Label();
  model.id = id;
  model.name = name;
  return model;
}

const STAGING: Label = label(STAGING_LABEL_ID, "staging");
const PRODUCTION: Label = label(PRODUCTION_LABEL_ID, "production");

function storeRow(labels: Array<Label>): DataStore {
  const store: DataStore = new DataStore();
  store.id = STORE_ID;
  store.projectId = PROJECT_ID;
  store.name = "orders-db";
  store.kind = DataStoreKind.AwsRdsInstance;
  store.labels = labels;
  return store;
}

let storeLabels: Array<Label>;
let storeRead: jest.SpiedFunction<typeof DataStoreService.findOneBy>;
let storeWrite: jest.SpiedFunction<
  typeof DataStoreService.updateColumnsByIdWithoutHooks
>;
let feedWrite: jest.SpiedFunction<
  typeof DataStoreFeedService.createDataStoreFeedItem
>;
let aiAsk: jest.SpiedFunction<typeof DataSecurityAiCall.ask>;

beforeEach(() => {
  storeLabels = [PRODUCTION];

  // A label limited grant is weighed against the store's label join table.
  withLabelJoinTables();

  storeRead = jest
    .spyOn(DataStoreService, "findOneBy")
    .mockImplementation((async () => {
      return storeRow(storeLabels);
    }) as never);
  storeWrite = jest
    .spyOn(DataStoreService, "updateColumnsByIdWithoutHooks")
    .mockResolvedValue(undefined as never);
  feedWrite = jest
    .spyOn(DataStoreFeedService, "createDataStoreFeedItem")
    .mockResolvedValue(undefined as never);
  aiAsk = jest
    .spyOn(DataSecurityAiCall, "ask")
    .mockRejectedValue(new Error("OneUptime AI is not asked here"));

  jest.spyOn(ProjectService, "findOneById").mockImplementation((async () => {
    const project: Project = new Project(PROJECT_ID);
    project.enableAi = true;
    return project;
  }) as never);
  jest.spyOn(AIService, "assertProjectAIEnabled").mockResolvedValue();
  jest.spyOn(UserLanguage, "getLanguage").mockResolvedValue("en" as never);
  jest
    .spyOn(UserService, "getUserMarkdownString")
    .mockResolvedValue(null as never);
  jest.spyOn(FeedPersonName, "getText").mockResolvedValue("Jane Doe");
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("StoreChangeAccess: a store's paperwork is changed by who may change that store", () => {
  test("an edit grant limited to another label does not reach this store", async () => {
    await expect(
      StoreChangeAccess.mayChange({
        dataStoreId: STORE_ID,
        props: STAGING_EDITOR,
      }),
    ).resolves.toBe(false);
  });

  test("negative control: the same grant reaches a store carrying its label", async () => {
    storeLabels = [STAGING];

    await expect(
      StoreChangeAccess.mayChange({
        dataStoreId: STORE_ID,
        props: STAGING_EDITOR,
      }),
    ).resolves.toBe(true);
  });

  test("an edit grant limited to labels does not reach a store that carries none", async () => {
    storeLabels = [];

    await expect(
      StoreChangeAccess.mayChange({
        dataStoreId: STORE_ID,
        props: STAGING_EDITOR,
      }),
    ).resolves.toBe(false);
  });

  test("an editor of every store may change this one", async () => {
    await expect(
      StoreChangeAccess.mayChange({
        dataStoreId: STORE_ID,
        props: STORE_EDITOR,
      }),
    ).resolves.toBe(true);
  });

  test("a reader of stores changes none", async () => {
    await expect(
      StoreChangeAccess.mayChange({
        dataStoreId: STORE_ID,
        props: callerProps({ permissions: PAPERWORK_READER }),
      }),
    ).resolves.toBe(false);
  });

  test("a credential issued for reading only changes none, whatever its roles", async () => {
    await expect(
      StoreChangeAccess.mayChange({
        dataStoreId: STORE_ID,
        props: callerProps({
          permissions: [Permission.ProjectOwner],
          isReadOnlyCredential: true,
        }),
      }),
    ).resolves.toBe(false);
  });

  test("OneUptime itself is not asked", async () => {
    await expect(
      StoreChangeAccess.mayChange({
        dataStoreId: STORE_ID,
        props: { isRoot: true },
      }),
    ).resolves.toBe(true);
    expect(storeRead).not.toHaveBeenCalled();
  });

  test("a store the caller may not change is refused with the route's own words", async () => {
    await expect(
      StoreChangeAccess.assertMayChange({
        dataStoreId: STORE_ID,
        props: STAGING_EDITOR,
        message: STORE_RECORD_CHANGE_REFUSED_MESSAGE,
      }),
    ).rejects.toEqual(
      new NotAuthorizedException(STORE_RECORD_CHANGE_REFUSED_MESSAGE),
    );
  });

  test("whether a list of stores offers changes is read from the stores an update may reach", async () => {
    const narrowed: jest.SpiedFunction<
      typeof ModelPermission.getUpdatableQuery
    > = jest.spyOn(ModelPermission, "getUpdatableQuery");

    await expect(
      StoreChangeAccess.mayChangeAny({
        projectId: PROJECT_ID,
        props: STAGING_EDITOR,
      }),
    ).resolves.toBe(true);

    expect(narrowed).toHaveBeenCalledTimes(1);
    expect(narrowed.mock.calls[0]![0]).toBe(DataStore);
    expect(narrowed.mock.calls[0]![2]).toBe(STAGING_EDITOR);
    expect(storeRead.mock.calls[0]![0]).toMatchObject({
      query: await narrowed.mock.results[0]!.value,
      props: { isRoot: true },
    });

    // No store an update reaches: nothing to offer.
    storeRead.mockResolvedValue(null);

    await expect(
      StoreChangeAccess.mayChangeAny({
        projectId: PROJECT_ID,
        props: STAGING_EDITOR,
      }),
    ).resolves.toBe(false);
  });

  test("a reader of stores is offered no change of any, before a store is read", async () => {
    for (const props of [
      callerProps({ permissions: PAPERWORK_READER }),
      callerProps({
        permissions: [Permission.ProjectOwner],
        isReadOnlyCredential: true,
      }),
    ]) {
      await expect(
        StoreChangeAccess.mayChangeAny({ projectId: PROJECT_ID, props }),
      ).resolves.toBe(false);
    }

    expect(storeRead).not.toHaveBeenCalled();
  });
});

// A store's assessment, as ImpactAssessmentDrafter reads it before a change.
function assessmentContext(): unknown {
  return {
    store: storeRow(storeLabels),
    row: {
      dataStoreId: STORE_ID.toString(),
      name: "orders-db",
      kind: DataStoreKind.AwsRdsInstance,
      region: "eu-west-1",
    } as DataSecurityRecordOfProcessingRow,
    triggers: [{ trigger: ImpactAssessmentTrigger.LargeScale }],
    assessment: null,
    built: { facts: [], data: [], marks: {} },
  };
}

describe("a store's impact assessment", () => {
  beforeEach(() => {
    jest
      .spyOn(ImpactAssessmentDrafter as never, "readContext")
      .mockImplementation((async () => {
        return assessmentContext();
      }) as never);
  });

  test("a person who may read a store but not change it cannot edit its assessment", async () => {
    await expect(
      ImpactAssessmentDrafter.editPart({
        projectId: PROJECT_ID,
        dataStoreId: STORE_ID,
        props: STAGING_EDITOR,
        part: ImpactAssessmentPart.Risks,
        markdown: "Nothing to worry about.",
        now: NOW,
      }),
    ).rejects.toEqual(
      new NotAuthorizedException(ASSESSMENT_CHANGE_REFUSED_MESSAGE),
    );

    expect(storeWrite).not.toHaveBeenCalled();
    expect(feedWrite).not.toHaveBeenCalled();
  });

  test("...nor have OneUptime AI draft it", async () => {
    await expect(
      ImpactAssessmentDrafter.draftForPerson({
        projectId: PROJECT_ID,
        dataStoreId: STORE_ID,
        props: STAGING_EDITOR,
        now: NOW,
      }),
    ).rejects.toEqual(
      new NotAuthorizedException(ASSESSMENT_CHANGE_REFUSED_MESSAGE),
    );

    expect(aiAsk).not.toHaveBeenCalled();
    expect(storeWrite).not.toHaveBeenCalled();
  });

  test("negative control: the same person edits the assessment of a store carrying their label", async () => {
    storeLabels = [STAGING];

    const answer: { canEdit: boolean } = await ImpactAssessmentDrafter.editPart(
      {
        projectId: PROJECT_ID,
        dataStoreId: STORE_ID,
        props: STAGING_EDITOR,
        part: ImpactAssessmentPart.Risks,
        markdown: "Our own words.",
        now: NOW,
      },
    );

    expect(storeWrite).toHaveBeenCalledTimes(1);
    expect(storeWrite.mock.calls[0]![0]).toMatchObject({ id: STORE_ID });
    expect(feedWrite).toHaveBeenCalledTimes(1);
    expect(answer.canEdit).toBe(true);
  });

  test("the assessment offers its edits and drafts only to who may change the store", async () => {
    const readOnly: { canEdit: boolean; canDraft: boolean } =
      await ImpactAssessmentDrafter.read({
        projectId: PROJECT_ID,
        dataStoreId: STORE_ID,
        props: STAGING_EDITOR,
        now: NOW,
      });

    expect(readOnly.canEdit).toBe(false);
    expect(readOnly.canDraft).toBe(false);

    storeLabels = [STAGING];

    const editable: { canEdit: boolean; canDraft: boolean } =
      await ImpactAssessmentDrafter.read({
        projectId: PROJECT_ID,
        dataStoreId: STORE_ID,
        props: STAGING_EDITOR,
        now: NOW,
      });

    expect(editable.canEdit).toBe(true);
    expect(editable.canDraft).toBe(true);
  });
});

describe("a store's record of processing", () => {
  // Whether the reader may change the record: for one store, or for the whole record.
  async function flagsFor(data: {
    props: DatabaseCommonInteractionProps;
    dataStoreId?: ObjectID | undefined;
  }): Promise<{ canEdit: boolean; canDraft: boolean }> {
    return await (
      RecordOfProcessingReader as unknown as {
        readFlags: (data: {
          projectId: ObjectID;
          props: DatabaseCommonInteractionProps;
          dataStoreId?: ObjectID | undefined;
        }) => Promise<{ canEdit: boolean; canDraft: boolean }>;
      }
    ).readFlags({ projectId: PROJECT_ID, ...data });
  }

  test("one store's record offers its changes and drafts only to who may change that store", async () => {
    expect(
      await flagsFor({ props: STAGING_EDITOR, dataStoreId: STORE_ID }),
    ).toMatchObject({ canEdit: false, canDraft: false });

    storeLabels = [STAGING];

    expect(
      await flagsFor({ props: STAGING_EDITOR, dataStoreId: STORE_ID }),
    ).toMatchObject({ canEdit: true, canDraft: true });
  });

  test("the whole record offers changes to who may change one of its stores, and to no reader", async () => {
    expect(await flagsFor({ props: STORE_EDITOR })).toMatchObject({
      canEdit: true,
    });
    expect(
      await flagsFor({ props: callerProps({ permissions: PAPERWORK_READER }) }),
    ).toMatchObject({ canEdit: false, canDraft: false });
  });
});

// The project's evidence for SOC 2 over 90 days, as AuditEvidenceDrafter reads it before a change.
function evidenceContext(): unknown {
  return {
    read: {
      framework: {
        framework: ComplianceFramework.SOC2,
        fullName: "SOC 2",
        scope: "",
        score: 0,
        storesInScope: 1,
        storesTurnedOff: 0,
        requirements: [
          {
            requirement: "CC6.1",
            title: "Logical access security",
            status: ComplianceRequirementStatus.Failing,
            checkIds: ["public-read"],
            failingIssueCount: 1,
          },
        ],
        turnedOff: [],
      },
      requirements: [],
      issueHistory: [],
      readableStoreIds: [],
    },
    built: { facts: [], data: [], marks: {} },
    stored: null,
    project: { version: 1, entries: {} },
    settingId: SETTING_ID,
  };
}

describe("the project's audit evidence", () => {
  // A Security Member reads the project's issues and may edit them, but not its Data Security settings.
  const SECURITY_MEMBER: DatabaseCommonInteractionProps = callerProps({
    permissions: [Permission.SecurityMember],
  });
  const SECURITY_ADMIN: DatabaseCommonInteractionProps = callerProps({
    permissions: [Permission.SecurityAdmin],
  });
  let evidenceWrite: jest.SpiedFunction<() => Promise<unknown>>;

  beforeEach(() => {
    const setting: DataSecuritySetting = new DataSecuritySetting();
    setting.id = SETTING_ID;
    setting.projectId = PROJECT_ID;

    jest
      .spyOn(DataSecuritySettingService, "getOrCreateForProject")
      .mockResolvedValue(setting);
    jest
      .spyOn(DataSecuritySettingService, "findOneBy")
      .mockResolvedValue(setting);
    jest
      .spyOn(AuditEvidenceDrafter as never, "readContext")
      .mockImplementation((async () => {
        return evidenceContext();
      }) as never);
    jest
      .spyOn(RecordOfProcessingReader, "read")
      .mockResolvedValue({ rows: [] });
    evidenceWrite = jest
      .spyOn(
        AuditEvidenceDrafter as unknown as { write: () => Promise<unknown> },
        "write",
      )
      .mockResolvedValue({
        framework: ComplianceFramework.SOC2,
        periodInDays: 90,
        language: "en",
        paragraphs: {},
        facts: [],
      } as FrameworkAuditEvidence);
  });

  const EDIT: {
    projectId: ObjectID;
    framework: ComplianceFramework;
    periodInDays: number;
    requirement: string;
    text: string;
    now: Date;
  } = {
    projectId: PROJECT_ID,
    framework: ComplianceFramework.SOC2,
    periodInDays: 90,
    requirement: "CC6.1",
    text: "Our own words.",
    now: NOW,
  };

  test("who may read the evidence but not change the settings it is kept in cannot edit it", async () => {
    await expect(
      AuditEvidenceDrafter.editParagraph({ ...EDIT, props: SECURITY_MEMBER }),
    ).rejects.toEqual(
      new NotAuthorizedException(EVIDENCE_CHANGE_REFUSED_MESSAGE),
    );

    expect(evidenceWrite).not.toHaveBeenCalled();
  });

  test("...nor have OneUptime AI draft it", async () => {
    await expect(
      AuditEvidenceDrafter.draftForPerson({
        projectId: PROJECT_ID,
        framework: ComplianceFramework.SOC2,
        periodInDays: 90,
        props: SECURITY_MEMBER,
        now: NOW,
      }),
    ).rejects.toEqual(
      new NotAuthorizedException(EVIDENCE_CHANGE_REFUSED_MESSAGE),
    );

    expect(aiAsk).not.toHaveBeenCalled();
    expect(evidenceWrite).not.toHaveBeenCalled();
  });

  test("negative control: who may change the settings edits it, and is offered its edits", async () => {
    const answer: { canEdit: boolean } =
      await AuditEvidenceDrafter.editParagraph({
        ...EDIT,
        props: SECURITY_ADMIN,
      });

    expect(evidenceWrite).toHaveBeenCalledTimes(1);
    expect(answer.canEdit).toBe(true);
  });

  test("the evidence offers its edits and drafts only to who may change the settings", async () => {
    const read: {
      projectId: ObjectID;
      framework: ComplianceFramework;
      periodInDays: number;
      now: Date;
    } = {
      projectId: PROJECT_ID,
      framework: ComplianceFramework.SOC2,
      periodInDays: 90,
      now: NOW,
    };

    expect(
      await AuditEvidenceDrafter.read({ ...read, props: SECURITY_MEMBER }),
    ).toMatchObject({ canEdit: false, canDraft: false });
    expect(
      await AuditEvidenceDrafter.read({ ...read, props: SECURITY_ADMIN }),
    ).toMatchObject({ canEdit: true, canDraft: true });
  });
});
