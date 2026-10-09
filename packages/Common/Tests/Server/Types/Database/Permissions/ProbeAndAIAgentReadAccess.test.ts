import ModelPermission from "../../../../../Server/Types/Database/Permissions/Index";
import AIAgent from "../../../../../Models/DatabaseModels/AIAgent";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Probe from "../../../../../Models/DatabaseModels/Probe";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Exception from "../../../../../Types/Exception/Exception";
import NotAuthenticatedException from "../../../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../../../Types/Permission";
import UserType from "../../../../../Types/UserType";
import { describe, expect, test } from "@jest/globals";
import { ON_HIGHEST_PLAN } from "../../../TestingUtils/RequestPlan";

/*
 * A PROBE AND AN AI AGENT ARE READ BY THEIR PROJECT'S OWN MEMBERS ONLY.
 *
 * Both tables named Permission.Public in their read lists, and so did their
 * name, description, slug, version and project columns (and an AI agent's
 * isDefault). Every caller holds Public, signed in or not, so a read that
 * named a project in its tenant header passed the "is anyone logged in"
 * check and every one of those column checks. The condition meant to keep
 * that to the shared global rows (no project) was declared on the models
 * but never applied by the permission layer.
 *
 * Now each is read with its project's read permissions, and nothing about
 * either is read by Public: the lists of public columns below are empty and
 * pinned that way. The shared global probes and AI agents are listed to
 * signed-in members by their own routes (ProbeAPI's global-probes,
 * AIAgentAPI's global-ai-agents), which read a fixed set of columns as
 * OneUptime. A probe or agent named on another record (a monitor's probes, a
 * device's probe) still shows its name there, through the relation, to
 * whoever may read that record.
 *
 * Driven through the real permission layer, no stubs.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const OTHER_PROJECT_ID: ObjectID = ObjectID.generate();

interface ModelCase {
  name: string;
  modelType: { new (): BaseModel };
  // The model's own read list.
  readers: Array<Permission>;
  // The columns Public read before, each now read with the table's readers.
  formerlyPublicColumns: Array<string>;
}

const PROBE: ModelCase = {
  name: "Probe",
  modelType: Probe,
  readers: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.MonitorAdmin,
    Permission.MonitorMember,
    Permission.MonitorViewer,
    Permission.SettingsAdmin,
    Permission.SettingsMember,
    Permission.SettingsViewer,
    Permission.ReadProjectProbe,
  ],
  formerlyPublicColumns: [
    "name",
    "description",
    "slug",
    "probeVersion",
    "project",
    "projectId",
  ],
};

const AI_AGENT: ModelCase = {
  name: "AIAgent",
  modelType: AIAgent,
  readers: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.SettingsAdmin,
    Permission.SettingsMember,
    Permission.SettingsViewer,
    Permission.ReadProjectAIAgent,
  ],
  formerlyPublicColumns: [
    "name",
    "description",
    "slug",
    "aiAgentVersion",
    "project",
    "projectId",
    "isDefault",
  ],
};

const MODELS: Array<[string, ModelCase]> = [
  [PROBE.name, PROBE],
  [AI_AGENT.name, AI_AGENT],
];

// What a stranger may read of each model: nothing.
const PUBLIC_COLUMNS: Record<string, Array<string>> = {
  Probe: [],
  AIAgent: [],
};

// The non-relation columns that were public: what a read selects.
const STRANGER_SAFE_SELECT: Record<string, boolean> = {
  name: true,
  description: true,
  slug: true,
};

function member(data: {
  permissions: Array<Permission>;
  userType?: UserType | undefined;
  memberOf?: ObjectID | undefined;
}): DatabaseCommonInteractionProps {
  const memberOf: ObjectID = data.memberOf || PROJECT_ID;

  return {
    ...ON_HIGHEST_PLAN,
    tenantId: PROJECT_ID,
    userId: data.userType === UserType.API ? undefined : ObjectID.generate(),
    userType: data.userType || UserType.User,
    userTenantAccessPermission: {
      [memberOf.toString()]: {
        projectId: memberOf,
        permissions: data.permissions.map(
          (permission: Permission): UserPermission => {
            return {
              permission: permission,
              labelIds: [],
              isBlockPermission: false,
              _type: "UserPermission",
            } as UserPermission;
          },
        ),
        _type: "UserTenantAccessPermission",
      },
    },
  } as unknown as DatabaseCommonInteractionProps;
}

async function read(
  modelCase: ModelCase,
  props: DatabaseCommonInteractionProps,
  select: Record<string, boolean> = STRANGER_SAFE_SELECT,
): Promise<unknown> {
  return await ModelPermission.checkReadQueryPermission(
    modelCase.modelType as never,
    {},
    select as never,
    props,
  );
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  throw new Error("Expected the read to be refused, but it was allowed.");
}

function readListOf(modelCase: ModelCase, column: string): Array<Permission> {
  return [
    ...(new modelCase.modelType().getColumnAccessControlFor(column)?.read ||
      []),
  ].sort();
}

describe.each(MODELS)(
  "%s - who may read it",
  (name: string, modelCase: ModelCase) => {
    test("its read list names its project's readers, and not Public", () => {
      const readers: Array<Permission> =
        new modelCase.modelType().getReadPermissions();

      expect(readers).not.toContain(Permission.Public);
      expect([...readers].sort()).toEqual([...modelCase.readers].sort());
    });

    test("the columns a caller in no project may read are pinned: none", () => {
      const model: BaseModel = new modelCase.modelType();

      const publicColumns: Array<string> = model
        .getTableColumns()
        .columns.filter((column: string): boolean => {
          return Boolean(
            model
              .getColumnAccessControlFor(column)
              ?.read.includes(Permission.Public),
          );
        });

      expect(publicColumns).toEqual(PUBLIC_COLUMNS[name]);
    });

    test("no create, update or delete is open to Public either", () => {
      const model: BaseModel = new modelCase.modelType();

      expect(model.getCreatePermissions()).not.toContain(Permission.Public);
      expect(model.getUpdatePermissions()).not.toContain(Permission.Public);
      expect(model.getDeletePermissions()).not.toContain(Permission.Public);
    });

    test.each(modelCase.formerlyPublicColumns)(
      "%s is read with the table's readers",
      (column: string) => {
        expect(readListOf(modelCase, column)).toEqual(
          [...modelCase.readers].sort(),
        );
      },
    );

    test("its key is read by the project's owners and admins alone", () => {
      expect(readListOf(modelCase, "key")).toEqual(
        [Permission.ProjectAdmin, Permission.ProjectOwner].sort(),
      );
    });

    test("no row is readable by Public on a condition", () => {
      expect(
        new modelCase.modelType().doesPermissionHaveConditions(
          Permission.Public,
        ),
      ).toBeNull();
    });
  },
);

describe.each(MODELS)(
  "%s - reading it through the permission layer",
  (_name: string, modelCase: ModelCase) => {
    test.each([
      ["with no tenant", {}],
      ["naming a project", { tenantId: PROJECT_ID }],
      [
        "naming a project as an explicit visitor",
        { tenantId: PROJECT_ID, userType: UserType.Public },
      ],
    ])(
      "a caller who is not signed in (%s) is asked to sign in, and reads nothing",
      async (_label: string, props: DatabaseCommonInteractionProps) => {
        const error: unknown = await rejectionOf(read(modelCase, props));

        expect(error).toBeInstanceOf(NotAuthenticatedException);
        expect((error as Exception).code).toBe(401);
      },
    );

    test("a caller who is not signed in may not read even the name alone", async () => {
      expect(
        await rejectionOf(
          read(modelCase, { tenantId: PROJECT_ID }, { name: true }),
        ),
      ).toBeInstanceOf(NotAuthenticatedException);
    });

    test("a member of another project, naming this one, is refused", async () => {
      const error: unknown = await rejectionOf(
        read(
          modelCase,
          member({
            permissions: [Permission.ProjectOwner],
            memberOf: OTHER_PROJECT_ID,
          }),
        ),
      );

      expect(error).toBeInstanceOf(NotAuthorizedException);
    });

    test("a member of the project who may not read it is refused", async () => {
      const error: unknown = await rejectionOf(
        read(
          modelCase,
          member({ permissions: [Permission.ReadProjectIncident] }),
        ),
      );

      expect(error).toBeInstanceOf(NotAuthorizedException);
    });

    test("a project API key that may not read it is refused", async () => {
      const error: unknown = await rejectionOf(
        read(
          modelCase,
          member({
            permissions: [Permission.ReadProjectIncident],
            userType: UserType.API,
          }),
        ),
      );

      expect(error).toBeInstanceOf(NotAuthorizedException);
    });

    test.each(modelCase.readers)(
      "a member holding %s reads the project's rows, and only the project's",
      async (permission: Permission) => {
        const result: { query: Record<string, unknown> } = (await read(
          modelCase,
          member({ permissions: [permission] }),
        )) as { query: Record<string, unknown> };

        // Pinned to the caller's project, whatever shape the scope takes.
        expect(result.query["projectId"]).toBeDefined();
        expect(JSON.stringify(result.query["projectId"])).toContain(
          PROJECT_ID.toString(),
        );
      },
    );

    test("a project API key holding Viewer reads the project's rows", async () => {
      const result: { query: Record<string, unknown> } = (await read(
        modelCase,
        member({ permissions: [Permission.Viewer], userType: UserType.API }),
      )) as { query: Record<string, unknown> };

      expect(JSON.stringify(result.query["projectId"])).toContain(
        PROJECT_ID.toString(),
      );
    });

    test.each(
      modelCase.readers.filter((permission: Permission): boolean => {
        return (
          permission !== Permission.ProjectOwner &&
          permission !== Permission.ProjectAdmin
        );
      }),
    )(
      "a member holding %s still may not read the key",
      async (permission: Permission) => {
        const error: unknown = await rejectionOf(
          read(modelCase, member({ permissions: [permission] }), {
            key: true,
          }),
        );

        expect(error).toBeInstanceOf(NotAuthorizedException);
      },
    );
  },
);
