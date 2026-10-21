import CreatePermission, {
  CreateParent,
  ReadableParentIdsFinder,
  RecordIdsFinder,
} from "../../../../../Server/Types/Database/Permissions/CreatePermission";
import ModelPermission from "../../../../../Server/Types/Database/Permissions/Index";
import Query from "../../../../../Server/Types/Database/Query";
import {
  ProjectScopedReferenceException,
  UnreadableParentException,
} from "../../../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import IncidentAlert from "../../../../../Models/DatabaseModels/IncidentAlert";
import IncidentInternalNote from "../../../../../Models/DatabaseModels/IncidentInternalNote";
import StatusPage from "../../../../../Models/DatabaseModels/StatusPage";
import StatusPageAnnouncement from "../../../../../Models/DatabaseModels/StatusPageAnnouncement";
import StatusPageSubscriber from "../../../../../Models/DatabaseModels/StatusPageSubscriber";
import Workflow from "../../../../../Models/DatabaseModels/Workflow";
import WorkflowVariable from "../../../../../Models/DatabaseModels/WorkflowVariable";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../../../Types/Database/AccessControl/PermissionScope";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import NotAuthenticatedException from "../../../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../../../Types/Permission";
import UserType from "../../../../../Types/UserType";
import { ON_HIGHEST_PLAN } from "../../../TestingUtils/RequestPlan";
import { describe, expect, jest, test } from "@jest/globals";

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../../../Server/Utils/Logger");

/*
 * A RECORD READ THROUGH ANOTHER ONE IS CREATED ONLY UNDER A PARENT ITS
 * CREATOR MAY READ (CreatePermission.checkParentPermission).
 *
 * The rows of a model declared with @CanAccessIfCanReadOn - an incident's
 * notes, a status page's announcements - are read, changed and deleted only
 * through the parents their caller may read. A create names its parent
 * itself, and is held to the same rule:
 *
 *   - reading the parent needs one of its read permissions, and a block
 *     with no labels on one of them refuses (optional for the models whose
 *     shipped readers do not read the parent);
 *   - every parent the create names, under either of its names, must be one
 *     a read of the parent's table finds for the caller - the lookup is
 *     handed in, as DatabaseService hands in a read with the caller's own
 *     props, with the parent table's rule for its private records; a caller
 *     whose read of the parents is not narrowed at all is not looked up;
 *   - a create that names no parent needs a read that reaches the whole
 *     project, asked once the create's hooks have run.
 *
 * A parent the caller may not read is answered like one that does not
 * exist.
 */

const projectId: ObjectID = new ObjectID(
  "0193c0de-aaaa-4aaa-8bbb-000000000001",
);
const productionLabelId: ObjectID = new ObjectID(
  "0193c0de-aaaa-4aaa-8bbb-0000000000a1",
);

const INCIDENT_ID: string = "0193c0de-aaaa-4aaa-8bbb-00000000c001";
const OTHER_INCIDENT_ID: string = "0193c0de-aaaa-4aaa-8bbb-00000000c002";
const PAGE_A: string = "0193c0de-aaaa-4aaa-8bbb-00000000d001";
const PAGE_B: string = "0193c0de-aaaa-4aaa-8bbb-00000000d002";
const PAGE_C: string = "0193c0de-aaaa-4aaa-8bbb-00000000d003";

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

// A member of the project with these permission rows.
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

// An API key of the project with these permission rows: no person.
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

// A lookup that finds these parents, and records what it was asked.
interface Lookup {
  find: ReadableParentIdsFinder;
  calls: Array<{
    parentModelType: { new (): BaseModel };
    ids: Array<string>;
    query: Query<BaseModel>;
    props: DatabaseCommonInteractionProps;
  }>;
}

const lookupFinding: (readableIds: Array<string>) => Lookup = (
  readableIds: Array<string>,
): Lookup => {
  const lookup: Lookup = {
    calls: [],
    find: async (data: {
      parentModelType: { new (): BaseModel };
      ids: Array<string>;
      query: Query<BaseModel>;
      props: DatabaseCommonInteractionProps;
    }): Promise<Array<string>> => {
      lookup.calls.push(data);

      return data.ids.filter((id: string): boolean => {
        return readableIds
          .map((readableId: string): string => {
            return readableId.toLowerCase();
          })
          .includes(id.toLowerCase());
      });
    },
  };

  return lookup;
};

const noteOn: (values: Record<string, unknown>) => IncidentInternalNote = (
  values: Record<string, unknown>,
): IncidentInternalNote => {
  const note: IncidentInternalNote = new IncidentInternalNote();
  note.note = "Synthetic note";

  for (const [key, value] of Object.entries(values)) {
    (note as unknown as Record<string, unknown>)[key] = value;
  }

  return note;
};

const announcementOn: (
  statusPages: Array<unknown> | undefined,
) => StatusPageAnnouncement = (
  statusPages: Array<unknown> | undefined,
): StatusPageAnnouncement => {
  const announcement: StatusPageAnnouncement = new StatusPageAnnouncement();
  announcement.title = "Synthetic announcement";

  if (statusPages) {
    (announcement as unknown as Record<string, unknown>)["statusPages"] =
      statusPages;
  }

  return announcement;
};

// A lookup by OneUptime in the project, finding these records.
interface ProjectLookup {
  find: RecordIdsFinder;
  calls: Array<{
    modelType: { new (): BaseModel };
    ids: Array<string>;
    query: Query<BaseModel>;
  }>;
}

const projectLookupFinding: (inProjectIds: Array<string>) => ProjectLookup = (
  inProjectIds: Array<string>,
): ProjectLookup => {
  const lookup: ProjectLookup = {
    calls: [],
    find: async (data: {
      modelType: { new (): BaseModel };
      ids: Array<string>;
      query: Query<BaseModel>;
    }): Promise<Array<string>> => {
      lookup.calls.push(data);

      return data.ids.filter((id: string): boolean => {
        return inProjectIds
          .map((inProjectId: string): string => {
            return inProjectId.toLowerCase();
          })
          .includes(id.toLowerCase());
      });
    },
  };

  return lookup;
};

/*
 * The check as DatabaseService asks it. A model's service holds its
 * references to its project (ProjectReferencesService) unless a test says
 * it does not (`referencesCheckedInProject: false`, a service such as the
 * workflow log's).
 */
const check: <TBaseModel extends BaseModel>(data: {
  modelType: { new (): TBaseModel };
  data: TBaseModel;
  props: DatabaseCommonInteractionProps;
  lookup: Lookup;
  projectLookup?: ProjectLookup;
  referencesCheckedInProject?: boolean;
  checkedParentIds?: Array<string>;
}) => Promise<Array<string>> = async <TBaseModel extends BaseModel>(data: {
  modelType: { new (): TBaseModel };
  data: TBaseModel;
  props: DatabaseCommonInteractionProps;
  lookup: Lookup;
  projectLookup?: ProjectLookup;
  referencesCheckedInProject?: boolean;
  checkedParentIds?: Array<string>;
}): Promise<Array<string>> => {
  return await ModelPermission.checkCreateParentPermission({
    modelType: data.modelType,
    data: data.data,
    props: data.props,
    findReadableParentIds: data.lookup.find,
    findParentIdsInProject: (data.projectLookup || projectLookupFinding([]))
      .find,
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

// The one refusal every reference check answers with.
const missingParentMessage: (subject: string, described: string) => string = (
  subject: string,
  described: string,
): string => {
  return `This ${subject} references records that are not in this project: ${described}. Please pick values from this project and try again.`;
};

// A member who may create notes and read the incidents carrying a label.
const NOTE_WRITER_ON_PRODUCTION: Array<UserPermission> = [
  everywhere(Permission.CreateIncidentInternalNote),
  everywhere(Permission.ReadIncidentInternalNote),
  onProduction(Permission.ReadProjectIncident),
];

describe("a record read through another one is created only under a parent its creator may read", () => {
  describe("who is asked", () => {
    test("root and master admin creates are not asked, nor looked up", async () => {
      for (const props of [
        { isRoot: true },
        { isRoot: true, tenantId: projectId },
        { isMasterAdmin: true, userId: ObjectID.generate() },
      ] as Array<DatabaseCommonInteractionProps>) {
        const lookup: Lookup = lookupFinding([]);

        await expect(
          check({
            modelType: IncidentInternalNote,
            data: noteOn({ incidentId: new ObjectID(INCIDENT_ID) }),
            props: props,
            lookup: lookup,
          }),
        ).resolves.toEqual([]);

        expect(lookup.calls).toEqual([]);
      }
    });

    test("a model read through no other record is not asked", async () => {
      const lookup: Lookup = lookupFinding([]);
      const incident: Incident = new Incident();
      incident.title = "Synthetic incident";

      await expect(
        check({
          modelType: Incident,
          data: incident,
          props: member([onProduction(Permission.CreateProjectIncident)]),
          lookup: lookup,
        }),
      ).resolves.toEqual([]);

      expect(lookup.calls).toEqual([]);
    });

    test("the parent of every model read through another record is one the check can follow", () => {
      const parent: CreateParent | null =
        CreatePermission.getCreateParent(IncidentInternalNote);

      expect(parent).toEqual({
        parentModelType: Incident,
        relation: "incident",
        idColumn: "incidentId",
        isList: false,
        title: "Incident",
        isParentReadOptional: false,
      });

      expect(CreatePermission.getCreateParent(StatusPageAnnouncement)).toEqual({
        parentModelType: StatusPage,
        relation: "statusPages",
        idColumn: null,
        isList: true,
        title: "Status Pages",
        isParentReadOptional: false,
      });

      expect(CreatePermission.getCreateParent(IncidentAlert)).toMatchObject({
        parentModelType: Incident,
        isParentReadOptional: true,
      });

      expect(CreatePermission.getCreateParent(Incident)).toBeNull();
    });
  });

  describe("reading the parent at all", () => {
    test("a caller who holds none of the parent's read permissions is refused, naming what they need", async () => {
      const lookup: Lookup = lookupFinding([INCIDENT_ID]);

      const refusal: unknown = await refusalOf(
        check({
          modelType: IncidentInternalNote,
          data: noteOn({ incidentId: new ObjectID(INCIDENT_ID) }),
          props: member([
            everywhere(Permission.CreateIncidentInternalNote),
            everywhere(Permission.ReadIncidentInternalNote),
          ]),
          lookup: lookup,
        }),
      );

      expect(refusal).toBeInstanceOf(NotAuthorizedException);
      expect((refusal as Error).message).toContain(
        "You do not have permissions to create Incident Internal Note. It is read through its Incident, and you need one of these permissions to read Incidents:",
      );
      expect(lookup.calls).toEqual([]);
    });

    test("a block with no labels on reading the parent refuses, whatever else is held", async () => {
      const lookup: Lookup = lookupFinding([INCIDENT_ID]);

      const refusal: unknown = await refusalOf(
        check({
          modelType: IncidentInternalNote,
          data: noteOn({ incidentId: new ObjectID(INCIDENT_ID) }),
          props: member([
            everywhere(Permission.ProjectMember),
            row(Permission.ReadProjectIncident, { isBlock: true }),
          ]),
          lookup: lookup,
        }),
      );

      expect(refusal).toBeInstanceOf(NotAuthorizedException);
      expect((refusal as Error).message).toContain(
        "It is read through its Incident, and ReadProjectIncident is in your team's permission block list.",
      );
      expect(lookup.calls).toEqual([]);
    });

    test("someone with no session and no API key gets the 401 reading the parent would give", async () => {
      // A subscriber is publicly creatable; its status page is not publicly readable.
      for (const props of [
        {},
        { tenantId: projectId },
        { userType: UserType.Public, tenantId: projectId },
      ] as Array<DatabaseCommonInteractionProps>) {
        const subscriber: StatusPageSubscriber = new StatusPageSubscriber();
        subscriber.statusPageId = new ObjectID(PAGE_A);

        const lookup: Lookup = lookupFinding([PAGE_A]);

        const refusal: unknown = await refusalOf(
          check({
            modelType: StatusPageSubscriber,
            data: subscriber,
            props: props,
            lookup: lookup,
          }),
        );

        expect(refusal).toBeInstanceOf(NotAuthenticatedException);
        expect((refusal as NotAuthenticatedException).code).toBe(401);
        expect((refusal as Error).message).toBe(
          "Authenticated user or a valid API key is needed to read record of Status Page.",
        );
        expect(lookup.calls).toEqual([]);
      }
    });
  });

  describe("a parent named by its key", () => {
    test("a caller who reads every status page of the project is not looked up", async () => {
      for (const rows of [
        [
          everywhere(Permission.CreateStatusPageAnnouncement),
          everywhere(Permission.ReadProjectStatusPage),
        ],
        [everywhere(Permission.ProjectMember)],
        [everywhere(Permission.ProjectAdmin)],
        // The scope of a role that cannot be scoped is not weighed.
        [owned(Permission.ProjectOwner)],
      ]) {
        const lookup: Lookup = lookupFinding([]);

        await expect(
          check({
            modelType: StatusPageAnnouncement,
            data: announcementOn([PAGE_A]),
            props: member(rows),
            lookup: lookup,
          }),
        ).resolves.toEqual([PAGE_A]);

        expect(lookup.calls).toEqual([]);
      }
    });

    test("a project owner or admin, who sees every private incident, is not looked up", async () => {
      for (const rows of [
        [everywhere(Permission.ProjectAdmin)],
        [everywhere(Permission.ProjectOwner)],
      ]) {
        const lookup: Lookup = lookupFinding([]);

        await expect(
          check({
            modelType: IncidentInternalNote,
            data: noteOn({ incidentId: new ObjectID(INCIDENT_ID) }),
            props: member(rows),
            lookup: lookup,
          }),
        ).resolves.toEqual([INCIDENT_ID]);

        expect(lookup.calls).toEqual([]);
      }
    });

    test("anyone else who reads every incident is looked up with the rule for private incidents", async () => {
      for (const rows of [
        [
          everywhere(Permission.CreateIncidentInternalNote),
          everywhere(Permission.ReadProjectIncident),
        ],
        [everywhere(Permission.ProjectMember)],
      ]) {
        const props: DatabaseCommonInteractionProps = member(rows);

        // A private incident that does not name them reads like a missing one.
        const missing: Lookup = lookupFinding([]);
        const refusal: unknown = await refusalOf(
          check({
            modelType: IncidentInternalNote,
            data: noteOn({ incidentId: new ObjectID(INCIDENT_ID) }),
            props: props,
            lookup: missing,
          }),
        );

        expect(refusal).toBeInstanceOf(UnreadableParentException);
        expect((refusal as Error).message).toBe(
          missingParentMessage(
            "incident internal note",
            `Incident "${INCIDENT_ID}"`,
          ),
        );
        expect(missing.calls).toHaveLength(1);
        // The lookup carries the incident table's rule for private records.
        expect(Object.keys(missing.calls[0]!.query).sort()).toEqual([
          "_id",
          "isPrivate",
        ]);

        const found: Lookup = lookupFinding([INCIDENT_ID]);

        await expect(
          check({
            modelType: IncidentInternalNote,
            data: noteOn({ incidentId: new ObjectID(INCIDENT_ID) }),
            props: props,
            lookup: found,
          }),
        ).resolves.toEqual([INCIDENT_ID]);
      }
    });

    test("a caller whose read is limited to labels creates under a parent their read finds", async () => {
      const lookup: Lookup = lookupFinding([INCIDENT_ID]);
      const props: DatabaseCommonInteractionProps = member(
        NOTE_WRITER_ON_PRODUCTION,
      );

      await expect(
        check({
          modelType: IncidentInternalNote,
          data: noteOn({ incidentId: new ObjectID(INCIDENT_ID) }),
          props: props,
          lookup: lookup,
        }),
      ).resolves.toEqual([INCIDENT_ID]);

      expect(lookup.calls).toHaveLength(1);
      expect(lookup.calls[0]!.parentModelType).toBe(Incident);
      expect(lookup.calls[0]!.ids).toEqual([INCIDENT_ID]);
      // Read as the caller themselves.
      expect(lookup.calls[0]!.props).toBe(props);
    });

    test("and is refused a parent their read does not find, in the words of one that does not exist", async () => {
      const lookup: Lookup = lookupFinding([]);

      const refusal: unknown = await refusalOf(
        check({
          modelType: IncidentInternalNote,
          data: noteOn({ incidentId: new ObjectID(INCIDENT_ID) }),
          props: member(NOTE_WRITER_ON_PRODUCTION),
          lookup: lookup,
        }),
      );

      expect(refusal).toBeInstanceOf(ProjectScopedReferenceException);
      expect(refusal).toBeInstanceOf(BadDataException);
      expect((refusal as Error).message).toBe(
        missingParentMessage(
          "incident internal note",
          `Incident "${INCIDENT_ID}"`,
        ),
      );
    });

    test("a read limited to owned incidents, or a block with labels on reading them, is looked up too", async () => {
      for (const rows of [
        [
          everywhere(Permission.CreateIncidentInternalNote),
          owned(Permission.ReadProjectIncident),
        ],
        [
          everywhere(Permission.CreateIncidentInternalNote),
          everywhere(Permission.ReadProjectIncident),
          row(Permission.ReadProjectIncident, {
            isBlock: true,
            labelIds: [productionLabelId],
          }),
        ],
      ]) {
        const lookup: Lookup = lookupFinding([]);

        const refusal: unknown = await refusalOf(
          check({
            modelType: IncidentInternalNote,
            data: noteOn({ incidentId: new ObjectID(INCIDENT_ID) }),
            props: member(rows),
            lookup: lookup,
          }),
        );

        expect(refusal).toBeInstanceOf(ProjectScopedReferenceException);
        expect(lookup.calls).toHaveLength(1);
      }
    });

    test("an API key whose read is limited to labels is held to the same rule", async () => {
      const lookup: Lookup = lookupFinding([]);

      const refusal: unknown = await refusalOf(
        check({
          modelType: IncidentInternalNote,
          data: noteOn({ incidentId: new ObjectID(INCIDENT_ID) }),
          props: apiKey(NOTE_WRITER_ON_PRODUCTION),
          lookup: lookup,
        }),
      );

      expect(refusal).toBeInstanceOf(ProjectScopedReferenceException);
      expect(lookup.calls).toHaveLength(1);
    });

    test("the parent is read under either of its names", async () => {
      for (const values of [
        { incidentId: new ObjectID(INCIDENT_ID) },
        { incidentId: INCIDENT_ID },
        { incident: { _id: INCIDENT_ID } },
        { incident: new ObjectID(INCIDENT_ID) },
        // The same id under both names, in two cases, is one parent.
        {
          incidentId: new ObjectID(INCIDENT_ID),
          incident: { _id: INCIDENT_ID.toUpperCase() },
        },
      ]) {
        const lookup: Lookup = lookupFinding([]);

        const refusal: unknown = await refusalOf(
          check({
            modelType: IncidentInternalNote,
            data: noteOn(values),
            props: member(NOTE_WRITER_ON_PRODUCTION),
            lookup: lookup,
          }),
        );

        expect(refusal).toBeInstanceOf(ProjectScopedReferenceException);
        expect(lookup.calls).toHaveLength(1);
        expect(
          lookup.calls[0]!.ids.map((id: string): string => {
            return id.toLowerCase();
          }),
        ).toEqual([INCIDENT_ID]);
      }
    });

    test("two names that point at two parents are refused before anything is read", async () => {
      const lookup: Lookup = lookupFinding([INCIDENT_ID, OTHER_INCIDENT_ID]);

      const refusal: unknown = await refusalOf(
        check({
          modelType: IncidentInternalNote,
          data: noteOn({
            incidentId: new ObjectID(INCIDENT_ID),
            incident: { _id: OTHER_INCIDENT_ID },
          }),
          props: member(NOTE_WRITER_ON_PRODUCTION),
          lookup: lookup,
        }),
      );

      expect(refusal).toBeInstanceOf(BadDataException);
      expect((refusal as Error).message).toContain(
        "Conflicting Incident references were provided.",
      );
      expect(lookup.calls).toEqual([]);
    });

    test("an id that is not a uuid is refused like a missing parent, without a lookup", async () => {
      const lookup: Lookup = lookupFinding([]);

      const refusal: unknown = await refusalOf(
        check({
          modelType: IncidentInternalNote,
          data: noteOn({ incident: { _id: "not-an-id" } }),
          props: member(NOTE_WRITER_ON_PRODUCTION),
          lookup: lookup,
        }),
      );

      expect(refusal).toBeInstanceOf(ProjectScopedReferenceException);
      expect((refusal as Error).message).toBe(
        missingParentMessage("incident internal note", `Incident "not-an-id"`),
      );
      expect(lookup.calls).toEqual([]);
    });

    test("an id the lookup answers in another case is the same parent", async () => {
      const lookup: Lookup = lookupFinding([INCIDENT_ID]);

      await expect(
        check({
          modelType: IncidentInternalNote,
          data: noteOn({ incidentId: INCIDENT_ID.toUpperCase() }),
          props: member(NOTE_WRITER_ON_PRODUCTION),
          lookup: lookup,
        }),
      ).resolves.toEqual([INCIDENT_ID.toUpperCase()]);
    });
  });

  describe("parents through a join table: an announcement's status pages", () => {
    const ANNOUNCER_ON_PRODUCTION: Array<UserPermission> = [
      everywhere(Permission.CreateStatusPageAnnouncement),
      everywhere(Permission.ReadStatusPageAnnouncement),
      onProduction(Permission.ReadProjectStatusPage),
    ];

    test("every page named must be one the caller may read; the refusal names only the others", async () => {
      const lookup: Lookup = lookupFinding([PAGE_A, PAGE_C]);

      const refusal: unknown = await refusalOf(
        check({
          modelType: StatusPageAnnouncement,
          data: announcementOn([{ _id: PAGE_A }, new ObjectID(PAGE_B), PAGE_C]),
          props: member(ANNOUNCER_ON_PRODUCTION),
          lookup: lookup,
        }),
      );

      expect(refusal).toBeInstanceOf(ProjectScopedReferenceException);
      expect((refusal as Error).message).toBe(
        missingParentMessage(
          "status page announcement",
          `Status Pages "${PAGE_B}"`,
        ),
      );
      expect(lookup.calls).toHaveLength(1);
      expect(lookup.calls[0]!.parentModelType).toBe(StatusPage);
      expect(lookup.calls[0]!.ids).toEqual([PAGE_A, PAGE_B, PAGE_C]);
    });

    test("pages the caller may all read are let through, each looked up once", async () => {
      const lookup: Lookup = lookupFinding([PAGE_A, PAGE_B]);

      await expect(
        check({
          modelType: StatusPageAnnouncement,
          data: announcementOn([
            { _id: PAGE_A },
            { _id: PAGE_B },
            { _id: PAGE_A.toUpperCase() },
          ]),
          props: member(ANNOUNCER_ON_PRODUCTION),
          lookup: lookup,
        }),
      ).resolves.toEqual([PAGE_A, PAGE_B]);

      expect(lookup.calls[0]!.ids).toEqual([PAGE_A, PAGE_B]);
    });

    test("a caller who reads every status page is not looked up", async () => {
      const lookup: Lookup = lookupFinding([]);

      await expect(
        check({
          modelType: StatusPageAnnouncement,
          data: announcementOn([{ _id: PAGE_A }]),
          props: member([everywhere(Permission.StatusPageAdmin)]),
          lookup: lookup,
        }),
      ).resolves.toEqual([PAGE_A]);

      expect(lookup.calls).toEqual([]);
    });

    test("with no reference check of its service, every parent is looked up, for a caller who reads them all too", async () => {
      for (const rows of [
        [everywhere(Permission.StatusPageAdmin)],
        [everywhere(Permission.ProjectAdmin)],
        [everywhere(Permission.ProjectOwner)],
      ]) {
        const lookup: Lookup = lookupFinding([PAGE_A]);

        await expect(
          check({
            modelType: StatusPageAnnouncement,
            data: announcementOn([{ _id: PAGE_A }]),
            props: member(rows),
            lookup: lookup,
            referencesCheckedInProject: false,
          }),
        ).resolves.toEqual([PAGE_A]);

        expect(lookup.calls).toHaveLength(1);
        expect(lookup.calls[0]?.ids).toEqual([PAGE_A]);

        // A page of another project reads like a missing one.
        const refusal: unknown = await refusalOf(
          check({
            modelType: StatusPageAnnouncement,
            data: announcementOn([{ _id: PAGE_B }]),
            props: member(rows),
            lookup: lookupFinding([PAGE_A]),
            referencesCheckedInProject: false,
          }),
        );

        expect(refusal).toBeInstanceOf(UnreadableParentException);
      }
    });
  });

  describe("a create that names no parent - a record of the whole project", () => {
    test("is asked about after the hooks: a hook may name the parent, and a missing one is the required check's", async () => {
      const lookup: Lookup = lookupFinding([]);

      await expect(
        check({
          modelType: StatusPageAnnouncement,
          data: announcementOn([]),
          props: member([
            everywhere(Permission.CreateStatusPageAnnouncement),
            onProduction(Permission.ReadProjectStatusPage),
          ]),
          lookup: lookup,
        }),
      ).resolves.toEqual([]);

      expect(lookup.calls).toEqual([]);
    });

    test("needs a read of the parents that is limited neither to labels nor to owned records", async () => {
      for (const rows of [
        [
          everywhere(Permission.CreateStatusPageAnnouncement),
          onProduction(Permission.ReadProjectStatusPage),
        ],
        [
          everywhere(Permission.CreateStatusPageAnnouncement),
          owned(Permission.ReadProjectStatusPage),
        ],
      ]) {
        for (const statusPages of [undefined, []]) {
          const lookup: Lookup = lookupFinding([]);

          const refusal: unknown = await refusalOf(
            check({
              modelType: StatusPageAnnouncement,
              data: announcementOn(statusPages),
              props: member(rows),
              lookup: lookup,
              checkedParentIds: [],
            }),
          );

          expect(refusal).toBeInstanceOf(NotAuthorizedException);
          expect((refusal as Error).message).toBe(
            "A Status Page Announcement you create must belong to a Status Page you can read: your access to Status Pages covers only some of them.",
          );
          expect(lookup.calls).toEqual([]);
        }
      }
    });

    test("a variable of no workflow, by a caller who reads only some workflows, is refused", async () => {
      const variable: WorkflowVariable = new WorkflowVariable();
      variable.name = "SYNTHETIC";

      const refusal: unknown = await refusalOf(
        check({
          modelType: WorkflowVariable,
          data: variable,
          props: member([
            everywhere(Permission.CreateWorkflowVariable),
            onProduction(Permission.ReadWorkflow),
          ]),
          lookup: lookupFinding([]),
          checkedParentIds: [],
        }),
      );

      expect(refusal).toBeInstanceOf(NotAuthorizedException);
      expect((refusal as Error).message).toBe(
        "A Workflow Variable you create must belong to a Workflow you can read: your access to Workflows covers only some of them.",
      );
    });

    test("a caller who reads every parent may, and a block with labels does not stop them", async () => {
      for (const rows of [
        [everywhere(Permission.StatusPageAdmin)],
        [
          everywhere(Permission.CreateStatusPageAnnouncement),
          everywhere(Permission.ReadProjectStatusPage),
          row(Permission.ReadProjectStatusPage, {
            isBlock: true,
            labelIds: [productionLabelId],
          }),
        ],
      ]) {
        const lookup: Lookup = lookupFinding([]);

        await expect(
          check({
            modelType: StatusPageAnnouncement,
            data: announcementOn([]),
            props: member(rows),
            lookup: lookup,
          }),
        ).resolves.toEqual([]);

        expect(lookup.calls).toEqual([]);
      }
    });

    test("the rule reads what a read of the parents reaches", () => {
      expect(
        CreatePermission.reachesRecordsOfNoParent(
          Workflow,
          member([everywhere(Permission.ReadWorkflow)]),
        ),
      ).toBe(true);
      expect(
        CreatePermission.reachesRecordsOfNoParent(
          Workflow,
          member([onProduction(Permission.ReadWorkflow)]),
        ),
      ).toBe(false);
      expect(
        CreatePermission.readsEveryParent(
          Workflow,
          member([
            everywhere(Permission.ReadWorkflow),
            row(Permission.ReadWorkflow, {
              isBlock: true,
              labelIds: [productionLabelId],
            }),
          ]),
        ),
      ).toBe(false);
      expect(
        CreatePermission.readsEveryParent(
          Workflow,
          member([everywhere(Permission.ReadWorkflow)]),
        ),
      ).toBe(true);
    });
  });

  describe("a model whose parent read is optional (an incident's links to alerts)", () => {
    const ALERT_RESPONDER: Array<UserPermission> = [
      everywhere(Permission.CreateIncidentAlert),
      everywhere(Permission.ReadIncidentAlert),
      everywhere(Permission.AlertMember),
    ];

    test("a caller who reads no incidents keeps creating it by its own rule", async () => {
      const link: IncidentAlert = new IncidentAlert();
      link.incidentId = new ObjectID(INCIDENT_ID);

      const lookup: Lookup = lookupFinding([]);
      const projectLookup: ProjectLookup = projectLookupFinding([]);

      await expect(
        check({
          modelType: IncidentAlert,
          data: link,
          props: member(ALERT_RESPONDER),
          lookup: lookup,
          projectLookup: projectLookup,
        }),
      ).resolves.toEqual([INCIDENT_ID]);

      // The service's own reference check holds it to the project.
      expect(lookup.calls).toEqual([]);
      expect(projectLookup.calls).toEqual([]);
    });

    test("with no reference check of its service, the parent need only be the project's: looked up by OneUptime", async () => {
      const link: IncidentAlert = new IncidentAlert();
      link.incidentId = new ObjectID(INCIDENT_ID);

      const lookup: Lookup = lookupFinding([]);
      const projectLookup: ProjectLookup = projectLookupFinding([INCIDENT_ID]);

      await expect(
        check({
          modelType: IncidentAlert,
          data: link,
          props: member(ALERT_RESPONDER),
          lookup: lookup,
          projectLookup: projectLookup,
          referencesCheckedInProject: false,
        }),
      ).resolves.toEqual([INCIDENT_ID]);

      // Never as the caller, who reads no incidents.
      expect(lookup.calls).toEqual([]);
      expect(projectLookup.calls).toHaveLength(1);
      expect(projectLookup.calls[0]?.modelType).toBe(Incident);
      expect(projectLookup.calls[0]?.ids).toEqual([INCIDENT_ID]);

      // An incident of another project, or none, reads like a missing one.
      const foreign: IncidentAlert = new IncidentAlert();
      foreign.incidentId = new ObjectID(OTHER_INCIDENT_ID);

      const refusal: unknown = await refusalOf(
        check({
          modelType: IncidentAlert,
          data: foreign,
          props: member(ALERT_RESPONDER),
          lookup: lookupFinding([]),
          projectLookup: projectLookupFinding([INCIDENT_ID]),
          referencesCheckedInProject: false,
        }),
      );

      expect(refusal).toBeInstanceOf(UnreadableParentException);
      expect((refusal as Error).message).toContain(
        `references records that are not in this project: Incident "${OTHER_INCIDENT_ID}"`,
      );
    });

    test("a caller who reads some incidents is held to them", async () => {
      const link: IncidentAlert = new IncidentAlert();
      link.incidentId = new ObjectID(INCIDENT_ID);

      const lookup: Lookup = lookupFinding([]);

      const refusal: unknown = await refusalOf(
        check({
          modelType: IncidentAlert,
          data: link,
          props: member([
            ...ALERT_RESPONDER,
            onProduction(Permission.ReadProjectIncident),
          ]),
          lookup: lookup,
        }),
      );

      expect(refusal).toBeInstanceOf(ProjectScopedReferenceException);
      expect((refusal as Error).message).toBe(
        missingParentMessage("incident alert", `Incident "${INCIDENT_ID}"`),
      );
      expect(lookup.calls).toHaveLength(1);
    });

    test("a block with no labels on reading incidents still refuses", async () => {
      const link: IncidentAlert = new IncidentAlert();
      link.incidentId = new ObjectID(INCIDENT_ID);

      const refusal: unknown = await refusalOf(
        check({
          modelType: IncidentAlert,
          data: link,
          props: member([
            ...ALERT_RESPONDER,
            row(Permission.ReadProjectIncident, { isBlock: true }),
          ]),
          lookup: lookupFinding([INCIDENT_ID]),
        }),
      );

      expect(refusal).toBeInstanceOf(NotAuthorizedException);
    });
  });

  describe("asked again once the create hooks have run", () => {
    test("the parents asked about before are not looked up again, in any order or case", async () => {
      const lookup: Lookup = lookupFinding([]);

      await expect(
        check({
          modelType: StatusPageAnnouncement,
          data: announcementOn([{ _id: PAGE_A }, { _id: PAGE_B }]),
          props: member([
            everywhere(Permission.CreateStatusPageAnnouncement),
            onProduction(Permission.ReadProjectStatusPage),
          ]),
          lookup: lookup,
          checkedParentIds: [PAGE_B.toUpperCase(), PAGE_A],
        }),
      ).resolves.toEqual([PAGE_A, PAGE_B]);

      expect(lookup.calls).toEqual([]);
    });

    test("a parent a hook named instead is looked up", async () => {
      const lookup: Lookup = lookupFinding([INCIDENT_ID]);

      const refusal: unknown = await refusalOf(
        check({
          modelType: IncidentInternalNote,
          data: noteOn({ incidentId: new ObjectID(OTHER_INCIDENT_ID) }),
          props: member(NOTE_WRITER_ON_PRODUCTION),
          lookup: lookup,
          checkedParentIds: [INCIDENT_ID],
        }),
      );

      expect(refusal).toBeInstanceOf(ProjectScopedReferenceException);
      expect(lookup.calls).toHaveLength(1);
      expect(lookup.calls[0]!.ids).toEqual([OTHER_INCIDENT_ID]);
    });
  });

  test("the rule reads the parent's read as a read of it does", () => {
    // Narrowed: a label-limited grant, an owned-only grant.
    expect(
      CreatePermission.readsEveryParent(
        StatusPage,
        member([onProduction(Permission.ReadProjectStatusPage)]),
      ),
    ).toBe(false);
    expect(
      CreatePermission.readsEveryParent(
        StatusPage,
        member([owned(Permission.ReadProjectStatusPage)]),
      ),
    ).toBe(false);
    // Not narrowed: a grant over the project, beside a narrower one.
    expect(
      CreatePermission.readsEveryParent(
        StatusPage,
        member([
          onProduction(Permission.ReadProjectStatusPage),
          everywhere(Permission.StatusPageViewer),
        ]),
      ),
    ).toBe(true);
    // A table of private records: read whole only by who sees them all.
    expect(
      CreatePermission.readsEveryParent(
        Incident,
        member([everywhere(Permission.IncidentViewer)]),
      ),
    ).toBe(false);
    expect(
      CreatePermission.readsEveryParent(
        Incident,
        member([everywhere(Permission.ProjectAdmin)]),
      ),
    ).toBe(true);
  });
});
