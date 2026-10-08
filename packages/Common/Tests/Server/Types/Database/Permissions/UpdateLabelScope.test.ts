import { RecordLabelsFinder } from "../../../../../Server/Types/Database/Permissions/CreateScopePermission";
import ModelPermission from "../../../../../Server/Types/Database/Permissions/Index";
import UpdateScopeException from "../../../../../Server/Types/Database/Permissions/UpdateScopeException";
import UpdateScopePermission from "../../../../../Server/Types/Database/Permissions/UpdateScopePermission";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Label from "../../../../../Models/DatabaseModels/Label";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import StatusPage from "../../../../../Models/DatabaseModels/StatusPage";
import StatusPageAnnouncement from "../../../../../Models/DatabaseModels/StatusPageAnnouncement";
import StatusPageResource from "../../../../../Models/DatabaseModels/StatusPageResource";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseCommonInteractionPropsUtil from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import PermissionScope from "../../../../../Types/Database/AccessControl/PermissionScope";
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
 * A CHANGE LEAVES A RECORD WITHIN ITS EDITOR'S PERMISSION TO CHANGE IT
 * (UpdateScopePermission).
 *
 * An update reaches only the records its caller's permission to update
 * reaches. One that changes the labels a record carries - a monitor's own
 * labels, the monitor a status page resource shows, the status pages an
 * announcement is on - is held to that permission on the labels the record
 * carries once it is written: limited to labels, the record keeps one of
 * them; a block with labels, the record is given none of them. A permission
 * over the whole project lets every change through, and so does one limited
 * to owned records, which a change of labels does not move.
 */

const projectId: ObjectID = new ObjectID(
  "0193c0de-cccc-4aaa-8bbb-000000000001",
);
const PRODUCTION: string = "0193c0de-cccc-4aaa-8bbb-0000000000a1";
const STAGING: string = "0193c0de-cccc-4aaa-8bbb-0000000000a2";

const MONITOR_ID: string = "0193c0de-cccc-4aaa-8bbb-00000000a001";
const PRODUCTION_MONITOR: string = "0193c0de-cccc-4aaa-8bbb-00000000a002";
const STAGING_MONITOR: string = "0193c0de-cccc-4aaa-8bbb-00000000a003";
const UNLABELLED_MONITOR: string = "0193c0de-cccc-4aaa-8bbb-00000000a004";
const PAGE_A: string = "0193c0de-cccc-4aaa-8bbb-00000000d001";
const PAGE_B: string = "0193c0de-cccc-4aaa-8bbb-00000000d002";
const PRODUCTION_PAGE: string = "0193c0de-cccc-4aaa-8bbb-00000000d003";
const STAGING_PAGE: string = "0193c0de-cccc-4aaa-8bbb-00000000d004";

// The labels each record carries, as OneUptime would look them up.
const LABELS_OF: Record<string, Array<string>> = {
  [PRODUCTION_MONITOR]: [PRODUCTION],
  [STAGING_MONITOR]: [STAGING],
  [UNLABELLED_MONITOR]: [],
  [PAGE_A]: [],
  [PAGE_B]: [],
  [PRODUCTION_PAGE]: [PRODUCTION],
  [STAGING_PAGE]: [STAGING],
};

const LABEL_NAMES: Record<string, string> = {
  [PRODUCTION]: "Production",
  [STAGING]: "Staging",
};

const row: (
  permission: Permission,
  data?: {
    labelIds?: Array<string>;
    isBlock?: boolean;
    scope?: PermissionScope;
  },
) => UserPermission = (
  permission: Permission,
  data?: {
    labelIds?: Array<string>;
    isBlock?: boolean;
    scope?: PermissionScope;
  },
): UserPermission => {
  const labelIds: Array<ObjectID> = (data?.labelIds || []).map(
    (labelId: string): ObjectID => {
      return new ObjectID(labelId);
    },
  );

  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: labelIds,
    isBlockPermission: Boolean(data?.isBlock),
    scope:
      data?.scope ||
      (labelIds.length > 0 && !data?.isBlock
        ? PermissionScope.Labels
        : PermissionScope.All),
  };
};

const member: (
  rows: Array<UserPermission>,
) => DatabaseCommonInteractionProps = (
  rows: Array<UserPermission>,
): DatabaseCommonInteractionProps => {
  return {
    userId: ObjectID.generate(),
    userType: UserType.User,
    tenantId: projectId,
    userTeamIds: [],
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
        permissions: rows,
      },
    },
  };
};

const apiKey: (
  rows: Array<UserPermission>,
) => DatabaseCommonInteractionProps = (
  rows: Array<UserPermission>,
): DatabaseCommonInteractionProps => {
  return {
    userType: UserType.API,
    tenantId: projectId,
    ...ON_HIGHEST_PLAN,
    userTenantAccessPermission: {
      [projectId.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: projectId,
        permissions: rows,
      },
    },
  };
};

interface Lookups {
  findRecordLabels: RecordLabelsFinder;
  labelCalls: Array<{ modelType: string; ids: Array<string> }>;
  nameCalls: Array<Array<string>>;
  findLabelNames: (data: { labelIds: Array<string> }) => Promise<Array<string>>;
}

const lookups: () => Lookups = (): Lookups => {
  const labelCalls: Array<{ modelType: string; ids: Array<string> }> = [];
  const nameCalls: Array<Array<string>> = [];

  return {
    labelCalls: labelCalls,
    nameCalls: nameCalls,
    findRecordLabels: async (data: {
      modelType: { new (): BaseModel };
      ids: Array<string>;
    }): Promise<Record<string, Array<string>>> => {
      labelCalls.push({
        modelType: new data.modelType().tableName || "",
        ids: [...data.ids].sort(),
      });

      const labels: Record<string, Array<string>> = {};

      for (const id of data.ids) {
        labels[id.toLowerCase()] = LABELS_OF[id.toLowerCase()] || [];
      }

      return labels;
    },
    findLabelNames: async (data: {
      labelIds: Array<string>;
    }): Promise<Array<string>> => {
      nameCalls.push(data.labelIds);
      return data.labelIds.map((labelId: string): string => {
        return LABEL_NAMES[labelId] || labelId;
      });
    },
  };
};

const labels: (ids: Array<string>) => Array<Label> = (
  ids: Array<string>,
): Array<Label> => {
  return ids.map((id: string): Label => {
    const label: Label = new Label();
    label._id = id;
    return label;
  });
};

const monitorRow: (labelIds: Array<string>) => Monitor = (
  labelIds: Array<string>,
): Monitor => {
  const monitor: Monitor = new Monitor();
  monitor._id = MONITOR_ID;
  monitor.labels = labels(labelIds);
  return monitor;
};

const resourceRow: (data: {
  statusPageId?: string;
  monitorId?: string;
}) => StatusPageResource = (data: {
  statusPageId?: string;
  monitorId?: string;
}): StatusPageResource => {
  const resource: StatusPageResource = new StatusPageResource();
  resource._id = ObjectID.generate().toString();

  if (data.statusPageId) {
    resource.statusPageId = new ObjectID(data.statusPageId);
  }

  if (data.monitorId) {
    resource.monitorId = new ObjectID(data.monitorId);
  }

  return resource;
};

const check: (data: {
  modelType: { new (): BaseModel };
  data: Record<string, unknown>;
  rows: Array<BaseModel>;
  props: DatabaseCommonInteractionProps;
  lookups: Lookups;
}) => Promise<void> = async (data: {
  modelType: { new (): BaseModel };
  data: Record<string, unknown>;
  rows: Array<BaseModel>;
  props: DatabaseCommonInteractionProps;
  lookups: Lookups;
}): Promise<void> => {
  await ModelPermission.checkUpdateScopePermission({
    modelType: data.modelType,
    data: data.data,
    rows: data.rows,
    props: data.props,
    findRecordLabels: data.lookups.findRecordLabels,
    findLabelNames: data.lookups.findLabelNames,
  });
};

const refusalOf: (promise: Promise<unknown>) => Promise<unknown> = async (
  promise: Promise<unknown>,
): Promise<unknown> => {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  return undefined;
};

// An editor of monitors whose permission to change them is limited to Production.
const PRODUCTION_MONITOR_EDITOR: Array<UserPermission> = [
  row(Permission.ReadProjectMonitor),
  row(Permission.EditProjectMonitor, { labelIds: [PRODUCTION] }),
];

// An editor of monitors who may change every monitor but those labelled Staging.
const STAGING_BLOCKED_MONITOR_EDITOR: Array<UserPermission> = [
  row(Permission.ReadProjectMonitor),
  row(Permission.EditProjectMonitor),
  row(Permission.EditProjectMonitor, { labelIds: [STAGING], isBlock: true }),
];

describe("the columns a record's labels are read from", () => {
  test("a model that carries labels: its labels", () => {
    expect(UpdateScopePermission.getLabelColumns(Monitor)).toEqual(["labels"]);
    expect(UpdateScopePermission.getLabelColumns(StatusPage)).toEqual([
      "labels",
    ]);
  });

  test("a model that does not: the labelled records it names", () => {
    const columns: Array<string> =
      UpdateScopePermission.getLabelColumns(StatusPageResource);

    expect(columns).toEqual(
      expect.arrayContaining(["statusPageId", "monitorId"]),
    );
    expect(columns).not.toContain("displayName");
    expect(columns).not.toContain("projectId");
  });

  test("a model read through a list of labelled parents: that list", () => {
    expect(
      UpdateScopePermission.getLabelColumns(StatusPageAnnouncement),
    ).toContain("statusPages");
  });

  test("a model whose records carry no labels at all: none", () => {
    expect(UpdateScopePermission.getLabelColumns(Label)).toEqual([]);
  });
});

describe("which updates change the labels a record carries", () => {
  test("the labels themselves, a clear included", () => {
    expect(UpdateScopePermission.changesLabels(Monitor, { name: "API" })).toBe(
      false,
    );
    expect(UpdateScopePermission.changesLabels(Monitor, { labels: [] })).toBe(
      true,
    );
    expect(UpdateScopePermission.changesLabels(Monitor, { labels: null })).toBe(
      true,
    );
  });

  test("the labelled records a label-less record names, under either name", () => {
    for (const data of [
      { monitorId: PRODUCTION_MONITOR },
      { monitor: { _id: PRODUCTION_MONITOR } },
      { monitorId: null },
      { statusPageId: PAGE_A },
    ]) {
      expect(
        UpdateScopePermission.changesLabels(StatusPageResource, data),
      ).toBe(true);
    }

    expect(
      UpdateScopePermission.changesLabels(StatusPageResource, {
        displayName: "API",
      }),
    ).toBe(false);
  });

  test("an announcement's status pages", () => {
    expect(
      UpdateScopePermission.changesLabels(StatusPageAnnouncement, {
        statusPages: [{ _id: PAGE_A }],
      }),
    ).toBe(true);
    expect(
      UpdateScopePermission.changesLabels(StatusPageAnnouncement, {
        title: "Maintenance",
      }),
    ).toBe(false);
  });

  test("two writes of the same labels compare equal, whatever their shape, case or order", () => {
    const write: (data: unknown) => string = (data: unknown): string => {
      return UpdateScopePermission.getLabelWrite(Monitor, data);
    };

    expect(write({ labels: [{ _id: PRODUCTION }, { _id: STAGING }] })).toBe(
      write({ labels: [STAGING.toUpperCase(), new ObjectID(PRODUCTION)] }),
    );
    expect(write({ labels: [{ _id: PRODUCTION }] })).not.toBe(
      write({ labels: [{ _id: STAGING }] }),
    );
    expect(write({ labels: null })).not.toBe(write({ labels: [] }));
    expect(write({ name: "API" })).toBe(write({}));
  });
});

describe("whose permission to update is limited by labels", () => {
  test("a permission limited to labels, and a block with labels", () => {
    expect(
      UpdateScopePermission.getLimitedScope(
        Monitor,
        member(PRODUCTION_MONITOR_EDITOR),
      )?.grantedLabelIds,
    ).toEqual([PRODUCTION]);

    expect(
      UpdateScopePermission.getLimitedScope(
        Monitor,
        apiKey(PRODUCTION_MONITOR_EDITOR),
      )?.grantedLabelIds,
    ).toEqual([PRODUCTION]);

    const blocked: ReturnType<typeof UpdateScopePermission.getLimitedScope> =
      UpdateScopePermission.getLimitedScope(
        Monitor,
        member(STAGING_BLOCKED_MONITOR_EDITOR),
      );

    expect(blocked?.grantedLabelIds).toEqual([]);
    expect(blocked?.labelledBlocks).toHaveLength(1);
    expect(blocked?.labelledBlocks[0]?.permission).toBe(
      Permission.EditProjectMonitor,
    );
  });

  test.each([
    ["a permission over the whole project", [row(Permission.EditProjectMonitor)]],
    ["a project admin", [row(Permission.ProjectAdmin)]],
    [
      "a permission over the whole project beside one limited to labels",
      [
        row(Permission.EditProjectMonitor, { labelIds: [PRODUCTION] }),
        row(Permission.MonitorAdmin),
      ],
    ],
    [
      "a permission limited to owned records, which labels do not move",
      [
        row(Permission.EditProjectMonitor, {
          scope: PermissionScope.Owned,
        }),
      ],
    ],
    [
      "a permission to update something else limited to labels",
      [
        row(Permission.EditProjectMonitor),
        row(Permission.EditProjectStatusPage, { labelIds: [PRODUCTION] }),
      ],
    ],
  ])(
    "not %s",
    (_name: string, rows: Array<UserPermission>) => {
      expect(
        UpdateScopePermission.getLimitedScope(Monitor, member(rows)),
      ).toBeNull();
    },
  );

  test("not OneUptime's own writes", () => {
    for (const props of [
      { isRoot: true },
      { isMasterAdmin: true },
    ] as Array<DatabaseCommonInteractionProps>) {
      expect(UpdateScopePermission.getLimitedScope(Monitor, props)).toBeNull();
    }
  });
});

describe("an update that changes a labelled record's labels", () => {
  test("limited to labels, the record keeps one of them", async () => {
    const found: Lookups = lookups();

    await expect(
      check({
        modelType: Monitor,
        data: { labels: [{ _id: PRODUCTION }, { _id: STAGING }] },
        rows: [monitorRow([PRODUCTION])],
        props: member(PRODUCTION_MONITOR_EDITOR),
        lookups: found,
      }),
    ).resolves.toBeUndefined();

    // Upper case is the same label.
    await expect(
      check({
        modelType: Monitor,
        data: { labels: [PRODUCTION.toUpperCase()] },
        rows: [monitorRow([PRODUCTION])],
        props: member(PRODUCTION_MONITOR_EDITOR),
        lookups: found,
      }),
    ).resolves.toBeUndefined();

    // Its own labels are written as a whole: nothing to look up.
    expect(found.labelCalls).toEqual([]);
    expect(found.nameCalls).toEqual([]);
  });

  test.each([
    ["for another label", { labels: [{ _id: STAGING }] }],
    ["for none", { labels: [] }],
    ["by a clear", { labels: null }],
  ])(
    "limited to labels, a change that takes the last of them away is refused, %s",
    async (_name: string, data: Record<string, unknown>) => {
      const found: Lookups = lookups();

      const refusal: unknown = await refusalOf(
        check({
          modelType: Monitor,
          data: data,
          rows: [monitorRow([PRODUCTION])],
          props: member(PRODUCTION_MONITOR_EDITOR),
          lookups: found,
        }),
      );

      expect(refusal).toBeInstanceOf(UpdateScopeException);
      expect(refusal).toBeInstanceOf(NotAuthorizedException);
      expect((refusal as Error).message).toBe(
        "Your access lets you change Monitors only with one of these labels: Production. Keep one of them and try again.",
      );
      expect(found.nameCalls).toEqual([[PRODUCTION]]);
    },
  );

  test("an API key's permission is held the same way", async () => {
    const refusal: unknown = await refusalOf(
      check({
        modelType: Monitor,
        data: { labels: [{ _id: STAGING }] },
        rows: [monitorRow([PRODUCTION])],
        props: apiKey(PRODUCTION_MONITOR_EDITOR),
        lookups: lookups(),
      }),
    );

    expect(refusal).toBeInstanceOf(UpdateScopeException);
  });

  test("a block with labels refuses a change that gives the record one of them", async () => {
    const refusal: unknown = await refusalOf(
      check({
        modelType: Monitor,
        data: { labels: [{ _id: PRODUCTION }, { _id: STAGING }] },
        rows: [monitorRow([PRODUCTION])],
        props: member(STAGING_BLOCKED_MONITOR_EDITOR),
        lookups: lookups(),
      }),
    );

    expect(refusal).toBeInstanceOf(UpdateScopeException);
    expect((refusal as Error).message).toBe(
      `You are not authorized to change this Monitor because ${Permission.EditProjectMonitor} is in your team's permission block list for the label "Staging".`,
    );

    // Any other label goes through.
    await expect(
      check({
        modelType: Monitor,
        data: { labels: [{ _id: PRODUCTION }] },
        rows: [monitorRow([])],
        props: member(STAGING_BLOCKED_MONITOR_EDITOR),
        lookups: lookups(),
      }),
    ).resolves.toBeUndefined();
  });

  test("a permission over the whole project lets every change through, unasked", async () => {
    const found: Lookups = lookups();

    for (const rows of [
      [row(Permission.EditProjectMonitor)],
      [row(Permission.ProjectMember)],
      [row(Permission.EditProjectMonitor, { scope: PermissionScope.Owned })],
    ]) {
      await expect(
        check({
          modelType: Monitor,
          data: { labels: [] },
          rows: [monitorRow([PRODUCTION])],
          props: member(rows),
          lookups: found,
        }),
      ).resolves.toBeUndefined();
    }

    expect(found.nameCalls).toEqual([]);
  });

  test("an update that leaves the labels alone, or writes no row, is not asked", async () => {
    const found: Lookups = lookups();

    await expect(
      check({
        modelType: Monitor,
        data: { name: "API" },
        rows: [monitorRow([PRODUCTION])],
        props: member(PRODUCTION_MONITOR_EDITOR),
        lookups: found,
      }),
    ).resolves.toBeUndefined();

    await expect(
      check({
        modelType: Monitor,
        data: { labels: [] },
        rows: [],
        props: member(PRODUCTION_MONITOR_EDITOR),
        lookups: found,
      }),
    ).resolves.toBeUndefined();

    expect(found.nameCalls).toEqual([]);
  });

  test("OneUptime's own writes are not asked", async () => {
    for (const props of [
      { isRoot: true },
      { isRoot: true, tenantId: projectId },
      { isMasterAdmin: true },
    ] as Array<DatabaseCommonInteractionProps>) {
      await expect(
        check({
          modelType: Monitor,
          data: { labels: [] },
          rows: [monitorRow([PRODUCTION])],
          props: props,
          lookups: lookups(),
        }),
      ).resolves.toBeUndefined();
    }
  });

  test("a credential that may only read is refused before anything is asked", async () => {
    const found: Lookups = lookups();

    const refusal: unknown = await refusalOf(
      check({
        modelType: Monitor,
        data: { labels: [{ _id: PRODUCTION }] },
        rows: [monitorRow([PRODUCTION])],
        props: {
          ...member([row(Permission.ProjectAdmin)]),
          isReadOnlyCredential: true,
        },
        lookups: found,
      }),
    );

    expect(refusal).toBeInstanceOf(NotAuthorizedException);
    expect((refusal as Error).message).toBe(
      DatabaseCommonInteractionPropsUtil.READ_ONLY_CREDENTIAL_MESSAGE,
    );
  });
});

describe("an update that changes what a label-less record names", () => {
  // An editor of status page resources whose permission is limited to Production.
  const PRODUCTION_RESOURCE_EDITOR: Array<UserPermission> = [
    row(Permission.ReadStatusPageResource),
    row(Permission.EditStatusPageResource, { labelIds: [PRODUCTION] }),
  ];

  test.each([
    ["by its ID column", { monitorId: PRODUCTION_MONITOR }],
    ["by its relation", { monitor: { _id: PRODUCTION_MONITOR } }],
  ])(
    "limited to labels, a record pointed at another labelled record that carries one of them, %s, is kept",
    async (_name: string, data: Record<string, unknown>) => {
      const found: Lookups = lookups();

      await expect(
        check({
          modelType: StatusPageResource,
          data: data,
          rows: [
            resourceRow({ statusPageId: PAGE_A, monitorId: UNLABELLED_MONITOR }),
          ],
          props: member(PRODUCTION_RESOURCE_EDITOR),
          lookups: found,
        }),
      ).resolves.toBeUndefined();

      // The page it keeps and the monitor it is given, each kind looked up once.
      expect(found.labelCalls).toEqual(
        expect.arrayContaining([
          { modelType: "StatusPage", ids: [PAGE_A] },
          { modelType: "Monitor", ids: [PRODUCTION_MONITOR] },
        ]),
      );
      expect(found.labelCalls).toHaveLength(2);
    },
  );

  test.each([
    ["by its ID column", { monitorId: STAGING_MONITOR }],
    ["by its relation", { monitor: { _id: STAGING_MONITOR } }],
    ["by clearing it", { monitorId: null }],
  ])(
    "limited to labels, a record that comes to carry none of them is refused, %s",
    async (_name: string, data: Record<string, unknown>) => {
      const refusal: unknown = await refusalOf(
        check({
          modelType: StatusPageResource,
          data: data,
          rows: [
            resourceRow({ statusPageId: PAGE_A, monitorId: PRODUCTION_MONITOR }),
          ],
          props: member(PRODUCTION_RESOURCE_EDITOR),
          lookups: lookups(),
        }),
      );

      expect(refusal).toBeInstanceOf(UpdateScopeException);
      expect((refusal as Error).message).toBe(
        "Your access lets you change Status Page Resources only for records with one of these labels: Production.",
      );
    },
  );

  test("a record its parent keeps within the labels is kept, whatever else it names", async () => {
    await expect(
      check({
        modelType: StatusPageResource,
        data: { monitorId: STAGING_MONITOR },
        rows: [
          resourceRow({
            statusPageId: PRODUCTION_PAGE,
            monitorId: PRODUCTION_MONITOR,
          }),
        ],
        props: member(PRODUCTION_RESOURCE_EDITOR),
        lookups: lookups(),
      }),
    ).resolves.toBeUndefined();
  });

  test("a record that comes to name no labelled record at all is about none of them, as a read takes it", async () => {
    await expect(
      check({
        modelType: StatusPageResource,
        data: { monitorId: null },
        rows: [resourceRow({ monitorId: PRODUCTION_MONITOR })],
        props: member(PRODUCTION_RESOURCE_EDITOR),
        lookups: lookups(),
      }),
    ).resolves.toBeUndefined();
  });

  test("every row is held, each kind of record looked up once for all of them", async () => {
    const found: Lookups = lookups();

    const refusal: unknown = await refusalOf(
      check({
        modelType: StatusPageResource,
        data: { monitorId: UNLABELLED_MONITOR },
        rows: [
          resourceRow({
            statusPageId: PRODUCTION_PAGE,
            monitorId: PRODUCTION_MONITOR,
          }),
          resourceRow({ statusPageId: PAGE_B, monitorId: PRODUCTION_MONITOR }),
        ],
        props: member(PRODUCTION_RESOURCE_EDITOR),
        lookups: found,
      }),
    );

    // The second row's page carries no label, and its new monitor none either.
    expect(refusal).toBeInstanceOf(UpdateScopeException);
    expect(found.labelCalls).toEqual(
      expect.arrayContaining([
        { modelType: "StatusPage", ids: [PAGE_B, PRODUCTION_PAGE].sort() },
        { modelType: "Monitor", ids: [UNLABELLED_MONITOR] },
      ]),
    );
    expect(found.labelCalls).toHaveLength(2);
  });

  test("a block with labels refuses a record pointed at a record carrying one of them", async () => {
    const refusal: unknown = await refusalOf(
      check({
        modelType: StatusPageResource,
        data: { monitorId: STAGING_MONITOR },
        rows: [resourceRow({ statusPageId: PAGE_A, monitorId: PRODUCTION_MONITOR })],
        props: member([
          row(Permission.ReadStatusPageResource),
          row(Permission.EditStatusPageResource),
          row(Permission.EditStatusPageResource, {
            labelIds: [STAGING],
            isBlock: true,
          }),
        ]),
        lookups: lookups(),
      }),
    );

    expect(refusal).toBeInstanceOf(UpdateScopeException);
    expect((refusal as Error).message).toBe(
      `You are not authorized to change this Status Page Resource because ${Permission.EditStatusPageResource} is in your team's permission block list for the label "Staging".`,
    );
  });
});

describe("an update that moves an announcement between status pages", () => {
  const PRODUCTION_ANNOUNCER: Array<UserPermission> = [
    row(Permission.ReadStatusPageAnnouncement),
    row(Permission.EditStatusPageAnnouncement, { labelIds: [PRODUCTION] }),
  ];

  const announcementOn: (pageIds: Array<string>) => StatusPageAnnouncement = (
    pageIds: Array<string>,
  ): StatusPageAnnouncement => {
    const announcement: StatusPageAnnouncement = new StatusPageAnnouncement();
    announcement._id = ObjectID.generate().toString();
    announcement.statusPages = pageIds.map((id: string): StatusPage => {
      const page: StatusPage = new StatusPage();
      page._id = id;
      return page;
    });
    return announcement;
  };

  test("limited to labels, it stays on a page carrying one of them", async () => {
    await expect(
      check({
        modelType: StatusPageAnnouncement,
        data: { statusPages: [{ _id: PRODUCTION_PAGE }, { _id: STAGING_PAGE }] },
        rows: [announcementOn([PRODUCTION_PAGE])],
        props: member(PRODUCTION_ANNOUNCER),
        lookups: lookups(),
      }),
    ).resolves.toBeUndefined();

    const refusal: unknown = await refusalOf(
      check({
        modelType: StatusPageAnnouncement,
        data: { statusPages: [{ _id: STAGING_PAGE }] },
        rows: [announcementOn([PRODUCTION_PAGE])],
        props: member(PRODUCTION_ANNOUNCER),
        lookups: lookups(),
      }),
    );

    expect(refusal).toBeInstanceOf(UpdateScopeException);
    expect((refusal as Error).message).toBe(
      "Your access lets you change Status Page Announcements only for records with one of these labels: Production.",
    );
  });
});
