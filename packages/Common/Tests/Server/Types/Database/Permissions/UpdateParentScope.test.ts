import {
  ReadableParentIdsFinder,
  RecordIdsFinder,
} from "../../../../../Server/Types/Database/Permissions/CreatePermission";
import ModelPermission from "../../../../../Server/Types/Database/Permissions/Index";
import UpdatePermission from "../../../../../Server/Types/Database/Permissions/UpdatePermission";
import Query from "../../../../../Server/Types/Database/Query";
import {
  ProjectScopedReferenceException,
  UnreadableParentException,
} from "../../../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentInternalNote from "../../../../../Models/DatabaseModels/IncidentInternalNote";
import MetricPipelineRule from "../../../../../Models/DatabaseModels/MetricPipelineRule";
import Service from "../../../../../Models/DatabaseModels/Service";
import StatusPage from "../../../../../Models/DatabaseModels/StatusPage";
import StatusPageAnnouncement from "../../../../../Models/DatabaseModels/StatusPageAnnouncement";
import StatusPageAnnouncementTemplate from "../../../../../Models/DatabaseModels/StatusPageAnnouncementTemplate";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../../../Types/Database/AccessControl/PermissionScope";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../../../Types/Permission";
import UserType from "../../../../../Types/UserType";
import { ON_HIGHEST_PLAN } from "../../../TestingUtils/RequestPlan";
import { describe, expect, jest, test } from "@jest/globals";

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../../../Server/Utils/Logger");

/*
 * A RECORD MOVED TO ANOTHER PARENT GOES ONLY TO ONE ITS EDITOR MAY READ
 * (UpdatePermission.checkParentPermission).
 *
 * The parent a record is read through is the parent it is created under,
 * and an update that changes it is held to the create's rule: every parent
 * the update names that a record it writes does not have yet must be one a
 * read of the parent's table finds for the caller. The parents a record has
 * already are not asked about again. An update that leaves a record with no
 * parent at all makes it a record of the whole project.
 */

const projectId: ObjectID = new ObjectID(
  "0193c0de-cccc-4aaa-8bbb-000000000001",
);
const productionLabelId: ObjectID = new ObjectID(
  "0193c0de-cccc-4aaa-8bbb-0000000000a1",
);

const PAGE_A: string = "0193c0de-cccc-4aaa-8bbb-00000000d001";
const PAGE_B: string = "0193c0de-cccc-4aaa-8bbb-00000000d002";
const PAGE_C: string = "0193c0de-cccc-4aaa-8bbb-00000000d003";
const SERVICE_A: string = "0193c0de-cccc-4aaa-8bbb-00000000e001";
const SERVICE_B: string = "0193c0de-cccc-4aaa-8bbb-00000000e002";

const row: (
  permission: Permission,
  data?: {
    labelIds?: Array<ObjectID>;
    isBlock?: boolean;
    scope?: PermissionScope;
  },
) => UserPermission = (
  permission: Permission,
  data?: {
    labelIds?: Array<ObjectID>;
    isBlock?: boolean;
    scope?: PermissionScope;
  },
): UserPermission => {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: data?.labelIds || [],
    isBlockPermission: Boolean(data?.isBlock),
    scope:
      data?.scope ||
      (data?.labelIds && data.labelIds.length > 0 && !data.isBlock
        ? PermissionScope.Labels
        : PermissionScope.All),
  };
};

const everywhere: (permission: Permission) => UserPermission = (
  permission: Permission,
): UserPermission => {
  return row(permission);
};

const onProduction: (permission: Permission) => UserPermission = (
  permission: Permission,
): UserPermission => {
  return row(permission, { labelIds: [productionLabelId] });
};

const owned: (permission: Permission) => UserPermission = (
  permission: Permission,
): UserPermission => {
  return row(permission, { scope: PermissionScope.Owned });
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

// Lookups that find these records, and record what they were asked.
interface Lookups {
  readable: ReadableParentIdsFinder;
  inProject: RecordIdsFinder;
  readCalls: Array<{
    parentModelType: { new (): BaseModel };
    ids: Array<string>;
    query: Query<BaseModel>;
    props: DatabaseCommonInteractionProps;
  }>;
  projectCalls: Array<{
    modelType: { new (): BaseModel };
    ids: Array<string>;
  }>;
}

const lookupsFinding: (
  readableIds: Array<string>,
  inProjectIds?: Array<string>,
) => Lookups = (
  readableIds: Array<string>,
  inProjectIds: Array<string> = readableIds,
): Lookups => {
  const lookups: Lookups = {
    readCalls: [],
    projectCalls: [],
    readable: async (data: {
      parentModelType: { new (): BaseModel };
      ids: Array<string>;
      query: Query<BaseModel>;
      props: DatabaseCommonInteractionProps;
    }): Promise<Array<string>> => {
      lookups.readCalls.push(data);
      return data.ids.filter((id: string): boolean => {
        return readableIds.includes(id.toLowerCase());
      });
    },
    inProject: async (data: {
      modelType: { new (): BaseModel };
      ids: Array<string>;
    }): Promise<Array<string>> => {
      lookups.projectCalls.push({ modelType: data.modelType, ids: data.ids });
      return data.ids.filter((id: string): boolean => {
        return inProjectIds.includes(id.toLowerCase());
      });
    },
  };

  return lookups;
};

const check: (data: {
  modelType: { new (): BaseModel };
  data: Record<string, unknown>;
  props: DatabaseCommonInteractionProps;
  heldParentIds: Array<Array<string>>;
  lookups: Lookups;
  referencesCheckedInProject?: boolean;
  checkedParentIds?: Array<string>;
}) => Promise<Array<string>> = async (data: {
  modelType: { new (): BaseModel };
  data: Record<string, unknown>;
  props: DatabaseCommonInteractionProps;
  heldParentIds: Array<Array<string>>;
  lookups: Lookups;
  referencesCheckedInProject?: boolean;
  checkedParentIds?: Array<string>;
}): Promise<Array<string>> => {
  return await ModelPermission.checkUpdateParentPermission({
    modelType: data.modelType,
    data: data.data,
    props: data.props,
    heldParentIds: data.heldParentIds,
    findReadableParentIds: data.lookups.readable,
    findParentIdsInProject: data.lookups.inProject,
    referencesCheckedInProject: data.referencesCheckedInProject ?? true,
    checkedParentIds: data.checkedParentIds,
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

// An editor of announcements whose read of status pages is limited to a label.
const ANNOUNCEMENT_EDITOR: Array<UserPermission> = [
  everywhere(Permission.EditStatusPageAnnouncement),
  everywhere(Permission.ReadStatusPageAnnouncement),
  onProduction(Permission.ReadProjectStatusPage),
];

const pages: (ids: Array<string>) => Array<Record<string, string>> = (
  ids: Array<string>,
): Array<Record<string, string>> => {
  return ids.map((id: string): Record<string, string> => {
    return { _id: id };
  });
};

describe("an update that moves a record to a parent it does not have", () => {
  describe("an announcement, through its status pages", () => {
    test("a status page added must be one the editor may read; the pages it has are not asked again", async () => {
      const lookups: Lookups = lookupsFinding([PAGE_A]);

      // On page A already; page B is added.
      const refusal: unknown = await refusalOf(
        check({
          modelType: StatusPageAnnouncement,
          data: { statusPages: pages([PAGE_A, PAGE_B]) },
          props: member(ANNOUNCEMENT_EDITOR),
          heldParentIds: [[PAGE_A]],
          lookups: lookups,
        }),
      );

      expect(refusal).toBeInstanceOf(UnreadableParentException);
      expect(refusal).toBeInstanceOf(ProjectScopedReferenceException);
      expect((refusal as Error).message).toBe(
        `This status page announcement references records that are not in this project: Status Pages "${PAGE_B}". Please pick values from this project and try again.`,
      );

      // Only the page it does not have was looked up, as the editor.
      expect(lookups.readCalls).toHaveLength(1);
      expect(lookups.readCalls[0]?.parentModelType).toBe(StatusPage);
      expect(lookups.readCalls[0]?.ids).toEqual([PAGE_B]);
      expect(lookups.readCalls[0]?.props.userId).toBeDefined();
    });

    test("a status page added that the editor may read is let through", async () => {
      const lookups: Lookups = lookupsFinding([PAGE_A, PAGE_C]);

      await expect(
        check({
          modelType: StatusPageAnnouncement,
          data: { statusPages: pages([PAGE_A, PAGE_C]) },
          props: member(ANNOUNCEMENT_EDITOR),
          heldParentIds: [[PAGE_A]],
          lookups: lookups,
        }),
      ).resolves.toEqual([PAGE_A, PAGE_C]);

      expect(lookups.readCalls[0]?.ids).toEqual([PAGE_C]);
    });

    test("an edit that keeps a page the editor may not read keeps it, unasked", async () => {
      const lookups: Lookups = lookupsFinding([PAGE_A]);

      // On A, which they read, and B, which they do not: both kept.
      await expect(
        check({
          modelType: StatusPageAnnouncement,
          data: { statusPages: pages([PAGE_A, PAGE_B]) },
          props: member(ANNOUNCEMENT_EDITOR),
          heldParentIds: [[PAGE_A, PAGE_B]],
          lookups: lookups,
        }),
      ).resolves.toEqual([PAGE_A, PAGE_B]);

      // Taking a page off it is no new page either.
      await expect(
        check({
          modelType: StatusPageAnnouncement,
          data: { statusPages: pages([PAGE_A]) },
          props: member(ANNOUNCEMENT_EDITOR),
          heldParentIds: [[PAGE_A, PAGE_B]],
          lookups: lookups,
        }),
      ).resolves.toEqual([PAGE_A]);

      expect(lookups.readCalls).toEqual([]);
    });

    test("a page one of the records it writes does not have is asked about", async () => {
      const lookups: Lookups = lookupsFinding([PAGE_A]);

      const refusal: unknown = await refusalOf(
        check({
          modelType: StatusPageAnnouncement,
          data: { statusPages: pages([PAGE_A, PAGE_B]) },
          props: member(ANNOUNCEMENT_EDITOR),
          // One record is on both pages, the other on A only.
          heldParentIds: [[PAGE_A, PAGE_B], [PAGE_A]],
          lookups: lookups,
        }),
      );

      expect(refusal).toBeInstanceOf(UnreadableParentException);
      expect(lookups.readCalls[0]?.ids).toEqual([PAGE_B]);
    });

    test("any case and shape of id is one id", async () => {
      const lookups: Lookups = lookupsFinding([PAGE_A]);

      await expect(
        check({
          modelType: StatusPageAnnouncement,
          data: {
            statusPages: [PAGE_A.toUpperCase(), new ObjectID(PAGE_A)],
          },
          props: member(ANNOUNCEMENT_EDITOR),
          heldParentIds: [[PAGE_A]],
          lookups: lookups,
        }),
      ).resolves.toEqual([PAGE_A.toUpperCase()]);

      expect(lookups.readCalls).toEqual([]);
    });

    test("a malformed id is refused unread, like a missing one", async () => {
      const lookups: Lookups = lookupsFinding([PAGE_A]);

      const refusal: unknown = await refusalOf(
        check({
          modelType: StatusPageAnnouncement,
          data: { statusPages: [{ _id: PAGE_A }, { _id: "not-a-page" }] },
          props: member(ANNOUNCEMENT_EDITOR),
          heldParentIds: [[PAGE_A]],
          lookups: lookups,
        }),
      );

      expect(refusal).toBeInstanceOf(UnreadableParentException);
      expect((refusal as Error).message).toContain('Status Pages "not-a-page"');
      expect(lookups.readCalls).toEqual([]);
    });

    test("an announcement template is held to the same rule", async () => {
      const lookups: Lookups = lookupsFinding([PAGE_A]);

      const refusal: unknown = await refusalOf(
        check({
          modelType: StatusPageAnnouncementTemplate,
          data: { statusPages: pages([PAGE_A, PAGE_B]) },
          props: member([
            everywhere(Permission.EditStatusPageAnnouncementTemplate),
            everywhere(Permission.ReadStatusPageAnnouncementTemplate),
            onProduction(Permission.ReadProjectStatusPage),
          ]),
          heldParentIds: [[PAGE_A]],
          lookups: lookups,
        }),
      );

      expect(refusal).toBeInstanceOf(UnreadableParentException);
      expect((refusal as Error).message).toContain(`"${PAGE_B}"`);
    });

    test.each([
      [
        "limited to the pages they own",
        [
          everywhere(Permission.EditStatusPageAnnouncement),
          everywhere(Permission.ReadStatusPageAnnouncement),
          owned(Permission.ReadProjectStatusPage),
        ],
      ],
      [
        "with a block with labels on reading status pages",
        [
          everywhere(Permission.EditStatusPageAnnouncement),
          everywhere(Permission.ReadStatusPageAnnouncement),
          everywhere(Permission.ReadProjectStatusPage),
          row(Permission.ReadProjectStatusPage, {
            isBlock: true,
            labelIds: [productionLabelId],
          }),
        ],
      ],
    ] as Array<[string, Array<UserPermission>]>)(
      "an editor whose read of status pages is %s is looked up",
      async (_name: string, rows: Array<UserPermission>) => {
        for (const props of [member(rows), apiKey(rows)]) {
          const lookups: Lookups = lookupsFinding([PAGE_A]);

          const refusal: unknown = await refusalOf(
            check({
              modelType: StatusPageAnnouncement,
              data: { statusPages: pages([PAGE_A, PAGE_B]) },
              props: props,
              heldParentIds: [[PAGE_A]],
              lookups: lookups,
            }),
          );

          expect(refusal).toBeInstanceOf(UnreadableParentException);
          // Read as the caller: their own read rule decides.
          expect(lookups.readCalls[0]?.props).toBe(props);
        }
      },
    );

    test("an editor who reads every status page is not looked up, the service's reference check answers", async () => {
      const lookups: Lookups = lookupsFinding([]);

      await expect(
        check({
          modelType: StatusPageAnnouncement,
          data: { statusPages: pages([PAGE_A, PAGE_B]) },
          props: member([everywhere(Permission.StatusPageAdmin)]),
          heldParentIds: [[PAGE_A]],
          lookups: lookups,
        }),
      ).resolves.toEqual([PAGE_A, PAGE_B]);

      expect(lookups.readCalls).toEqual([]);
    });

    test("with no reference check of its service, a page added is looked up for every editor", async () => {
      const lookups: Lookups = lookupsFinding([PAGE_A]);

      const refusal: unknown = await refusalOf(
        check({
          modelType: StatusPageAnnouncement,
          data: { statusPages: pages([PAGE_A, PAGE_B]) },
          props: member([everywhere(Permission.ProjectOwner)]),
          heldParentIds: [[PAGE_A]],
          lookups: lookups,
          referencesCheckedInProject: false,
        }),
      );

      expect(refusal).toBeInstanceOf(UnreadableParentException);
      expect(lookups.readCalls[0]?.ids).toEqual([PAGE_B]);
    });

    test("an editor who may read no status page is told what to ask for", async () => {
      const refusal: unknown = await refusalOf(
        check({
          modelType: StatusPageAnnouncement,
          data: { statusPages: pages([PAGE_A, PAGE_B]) },
          props: member([
            everywhere(Permission.EditStatusPageAnnouncement),
            everywhere(Permission.ReadStatusPageAnnouncement),
          ]),
          heldParentIds: [[PAGE_A]],
          lookups: lookupsFinding([PAGE_A, PAGE_B]),
        }),
      );

      expect(refusal).toBeInstanceOf(NotAuthorizedException);
      expect((refusal as Error).message).toContain(
        "It is read through its Status Page, and you need one of these permissions to read Status Pages:",
      );
    });

    test("a block with no labels on reading status pages refuses", async () => {
      const refusal: unknown = await refusalOf(
        check({
          modelType: StatusPageAnnouncement,
          data: { statusPages: pages([PAGE_A, PAGE_B]) },
          props: member([
            everywhere(Permission.StatusPageAdmin),
            row(Permission.ReadProjectStatusPage, { isBlock: true }),
          ]),
          heldParentIds: [[PAGE_A]],
          lookups: lookupsFinding([PAGE_A, PAGE_B]),
        }),
      );

      expect(refusal).toBeInstanceOf(NotAuthorizedException);
      expect((refusal as Error).message).toContain(
        "is in your team's permission block list",
      );
    });

    test("leaving it on no status page needs a read that reaches every page", async () => {
      const refusal: unknown = await refusalOf(
        check({
          modelType: StatusPageAnnouncement,
          data: { statusPages: [] },
          props: member(ANNOUNCEMENT_EDITOR),
          heldParentIds: [[PAGE_A]],
          lookups: lookupsFinding([PAGE_A]),
        }),
      );

      expect(refusal).toBeInstanceOf(NotAuthorizedException);
      expect((refusal as Error).message).toBe(
        "A Status Page Announcement you change must belong to a Status Page you can read: your access to Status Pages covers only some of them.",
      );

      await expect(
        check({
          modelType: StatusPageAnnouncement,
          data: { statusPages: [] },
          props: member([everywhere(Permission.StatusPageAdmin)]),
          heldParentIds: [[PAGE_A]],
          lookups: lookupsFinding([]),
        }),
      ).resolves.toEqual([]);

      // A record on no page already stays on none.
      await expect(
        check({
          modelType: StatusPageAnnouncement,
          data: { statusPages: [] },
          props: member(ANNOUNCEMENT_EDITOR),
          heldParentIds: [[]],
          lookups: lookupsFinding([]),
        }),
      ).resolves.toEqual([]);
    });
  });

  describe("a rule of a service, through its service key (a parent read optionally)", () => {
    const RULE_EDITOR: Array<UserPermission> = [
      everywhere(Permission.EditProjectMetricPipelineRule),
      everywhere(Permission.ReadProjectMetricPipelineRule),
    ];

    test.each([
      ["its ID column", { serviceId: new ObjectID(SERVICE_B) }],
      ["its relation", { service: { _id: SERVICE_B } }],
      [
        "both names, agreeing",
        { serviceId: new ObjectID(SERVICE_B), service: { _id: SERVICE_B } },
      ],
    ] as Array<[string, Record<string, unknown>]>)(
      "a service named by %s that the editor may not read is refused",
      async (_name: string, data: Record<string, unknown>) => {
        const lookups: Lookups = lookupsFinding([SERVICE_A]);

        const refusal: unknown = await refusalOf(
          check({
            modelType: MetricPipelineRule,
            data: data,
            props: member([
              ...RULE_EDITOR,
              onProduction(Permission.ReadService),
            ]),
            heldParentIds: [[SERVICE_A]],
            lookups: lookups,
          }),
        );

        expect(refusal).toBeInstanceOf(UnreadableParentException);
        expect((refusal as Error).message).toContain(`Service "${SERVICE_B}"`);
        expect(lookups.readCalls[0]?.parentModelType).toBe(Service);
      },
    );

    test("the two names must agree", async () => {
      const refusal: unknown = await refusalOf(
        check({
          modelType: MetricPipelineRule,
          data: {
            serviceId: new ObjectID(SERVICE_A),
            service: { _id: SERVICE_B },
          },
          props: member([...RULE_EDITOR, everywhere(Permission.ReadService)]),
          heldParentIds: [[SERVICE_A]],
          lookups: lookupsFinding([SERVICE_A, SERVICE_B]),
        }),
      );

      expect(refusal).toBeInstanceOf(BadDataException);
    });

    test("an editor who reads no services is held to the project alone", async () => {
      // A service that checks its references itself answers that.
      const checked: Lookups = lookupsFinding([]);

      await expect(
        check({
          modelType: MetricPipelineRule,
          data: { serviceId: new ObjectID(SERVICE_B) },
          props: member(RULE_EDITOR),
          heldParentIds: [[SERVICE_A]],
          lookups: checked,
        }),
      ).resolves.toEqual([SERVICE_B]);

      expect(checked.readCalls).toEqual([]);
      expect(checked.projectCalls).toEqual([]);

      // Otherwise OneUptime looks it up in the project.
      const unchecked: Lookups = lookupsFinding([], [SERVICE_A]);

      const refusal: unknown = await refusalOf(
        check({
          modelType: MetricPipelineRule,
          data: { serviceId: new ObjectID(SERVICE_B) },
          props: member(RULE_EDITOR),
          heldParentIds: [[SERVICE_A]],
          lookups: unchecked,
          referencesCheckedInProject: false,
        }),
      );

      expect(refusal).toBeInstanceOf(UnreadableParentException);
      expect(unchecked.readCalls).toEqual([]);
      expect(unchecked.projectCalls).toEqual([
        { modelType: Service, ids: [SERVICE_B] },
      ]);
    });

    test("the service it has is not asked about again", async () => {
      const lookups: Lookups = lookupsFinding([]);

      await expect(
        check({
          modelType: MetricPipelineRule,
          data: { serviceId: new ObjectID(SERVICE_A) },
          props: member([...RULE_EDITOR, onProduction(Permission.ReadService)]),
          heldParentIds: [[SERVICE_A]],
          lookups: lookups,
        }),
      ).resolves.toEqual([SERVICE_A]);

      expect(lookups.readCalls).toEqual([]);
    });
  });

  describe("asked once, in the shared update path", () => {
    test("an update that does not name the parent asks nothing", async () => {
      const lookups: Lookups = lookupsFinding([]);

      await expect(
        check({
          modelType: StatusPageAnnouncement,
          data: { title: "Renamed" },
          props: member(ANNOUNCEMENT_EDITOR),
          heldParentIds: [[PAGE_A]],
          lookups: lookups,
        }),
      ).resolves.toEqual([]);

      expect(lookups.readCalls).toEqual([]);
    });

    test("an update that writes no record asks nothing", async () => {
      const lookups: Lookups = lookupsFinding([]);

      await expect(
        check({
          modelType: StatusPageAnnouncement,
          data: { statusPages: pages([PAGE_B]) },
          props: member(ANNOUNCEMENT_EDITOR),
          heldParentIds: [],
          lookups: lookups,
        }),
      ).resolves.toEqual([]);

      expect(lookups.readCalls).toEqual([]);
    });

    test("OneUptime's own updates are not asked", async () => {
      for (const props of [
        { isRoot: true },
        { isRoot: true, tenantId: projectId },
        { isMasterAdmin: true, userId: ObjectID.generate() },
      ] as Array<DatabaseCommonInteractionProps>) {
        const lookups: Lookups = lookupsFinding([]);

        await expect(
          check({
            modelType: StatusPageAnnouncement,
            data: { statusPages: pages([PAGE_B]) },
            props: props,
            heldParentIds: [[PAGE_A]],
            lookups: lookups,
          }),
        ).resolves.toEqual([]);

        expect(lookups.readCalls).toEqual([]);
      }
    });

    test("after the hooks, only the parents they named are asked", async () => {
      const lookups: Lookups = lookupsFinding([PAGE_A, PAGE_B]);

      await expect(
        check({
          modelType: StatusPageAnnouncement,
          data: { statusPages: pages([PAGE_A, PAGE_B, PAGE_C]) },
          props: member(ANNOUNCEMENT_EDITOR),
          heldParentIds: [[PAGE_A]],
          lookups: lookups,
          checkedParentIds: [PAGE_A, PAGE_B],
        }),
      ).rejects.toThrow(UnreadableParentException);

      expect(lookups.readCalls[0]?.ids).toEqual([PAGE_C]);
    });

    test("a model whose parent its editor may not change is never moved: its parent is no write of theirs", () => {
      // A note's incident takes no update; the column check refuses it first.
      expect(
        UpdatePermission.namesParent(
          {
            parentModelType: Service,
            relation: "incident",
            idColumn: "incidentId",
            isList: false,
            title: "Incident",
            isParentReadOptional: false,
          },
          { note: "Updated" },
        ),
      ).toBe(false);

      expect(
        new IncidentInternalNote().getColumnAccessControlForAllColumns()[
          "incidentId"
        ]?.update || [],
      ).toEqual([]);
    });

    test("a parent named under either name counts as named, null included", () => {
      const parent: {
        parentModelType: { new (): BaseModel };
        relation: string;
        idColumn: string | null;
        isList: boolean;
        title: string;
        isParentReadOptional: boolean;
      } = {
        parentModelType: Service,
        relation: "service",
        idColumn: "serviceId",
        isList: false,
        title: "Service",
        isParentReadOptional: true,
      };

      expect(UpdatePermission.namesParent(parent, { serviceId: null })).toBe(
        true,
      );
      expect(UpdatePermission.namesParent(parent, { service: null })).toBe(
        true,
      );
      expect(UpdatePermission.namesParent(parent, { name: "Rule" })).toBe(
        false,
      );
      expect(UpdatePermission.namesParent(parent, undefined)).toBe(false);
    });
  });
});
