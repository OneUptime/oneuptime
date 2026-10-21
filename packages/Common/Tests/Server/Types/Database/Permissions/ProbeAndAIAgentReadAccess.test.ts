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
import {
  PROBE_PICKER_SELECT,
  PROBE_READER_SELECT,
} from "../../../../../Server/Utils/AI/Toolbox/WorkflowProbeTools";

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
 * A project's probes are picked by more people than read them in full:
 * whoever may read, create or edit monitors (the operational resource
 * wildcards included), a monitor's probes, network devices, their discovery
 * scans or network sites reads what a probe picker shows - name,
 * description, icon, status, whether new monitors start with it - and never
 * a probe's key, version, labels or packet capture report.
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
  // The columns Public read before, and who reads each now.
  formerlyPublicColumns: Array<[string, Array<Permission>]>;
}

// Who reads all of a project's probe but its key and its creator.
const PROBE_READERS: Array<Permission> = [
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
];

// Who picks a probe besides them, and reads what a picker shows of it.
const PROBE_PICKERS_ONLY: Array<Permission> = [
  Permission.CreateProjectMonitor,
  Permission.EditProjectMonitor,
  Permission.ReadProjectMonitor,
  Permission.CreateAllOperationalResources,
  Permission.EditAllOperationalResources,
  Permission.ReadAllOperationalResources,
  Permission.CreateMonitorProbe,
  Permission.EditMonitorProbe,
  Permission.ReadMonitorProbe,
  Permission.CreateNetworkDevice,
  Permission.EditNetworkDevice,
  Permission.ReadNetworkDevice,
  Permission.CreateNetworkDeviceDiscoveryScan,
  Permission.EditNetworkDeviceDiscoveryScan,
  Permission.ReadNetworkDeviceDiscoveryScan,
  Permission.CreateNetworkSite,
  Permission.EditNetworkSite,
  Permission.ReadNetworkSite,
  Permission.CreateVMwareVCenter,
  Permission.EditVMwareVCenter,
  Permission.ReadVMwareVCenter,
];

const PROBE_PICKERS: Array<Permission> = [
  ...PROBE_READERS,
  ...PROBE_PICKERS_ONLY,
];

/*
 * Every column of a probe whoever may pick one reads: what tells probes
 * apart in a picker. Pinned: a column added to the list is a decision.
 */
const PROBE_PICKER_COLUMNS: Array<string> = [
  "connectionStatus",
  "description",
  "iconFile",
  "iconFileId",
  "lastAlive",
  "name",
  "project",
  "projectId",
  "shouldAutoEnableProbeOnNewMonitors",
  "slug",
];

// And what only the probe's own readers (or its owners and admins) read.
const PROBE_COLUMNS_PICKERS_NEVER_READ: Array<string> = [
  "key",
  "probeVersion",
  "packetCaptureCapability",
  "labels",
  "createdByUserId",
];

const PROBE: ModelCase = {
  name: "Probe",
  modelType: Probe,
  readers: PROBE_PICKERS,
  formerlyPublicColumns: [
    ["name", PROBE_PICKERS],
    ["description", PROBE_PICKERS],
    ["slug", PROBE_PICKERS],
    ["probeVersion", PROBE_READERS],
    ["project", PROBE_PICKERS],
    ["projectId", PROBE_PICKERS],
  ],
};

const AI_AGENT_READERS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.SettingsViewer,
  Permission.ReadProjectAIAgent,
];

const AI_AGENT: ModelCase = {
  name: "AIAgent",
  modelType: AIAgent,
  readers: AI_AGENT_READERS,
  formerlyPublicColumns: [
    ["name", AI_AGENT_READERS],
    ["description", AI_AGENT_READERS],
    ["slug", AI_AGENT_READERS],
    ["aiAgentVersion", AI_AGENT_READERS],
    ["project", AI_AGENT_READERS],
    ["projectId", AI_AGENT_READERS],
    ["isDefault", AI_AGENT_READERS],
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
      "%s is read by its project's members who may read it",
      (column: string, readers: Array<Permission>) => {
        expect(readListOf(modelCase, column)).toEqual([...readers].sort());
        expect(readListOf(modelCase, column)).not.toContain(Permission.Public);
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

/*
 * WHOEVER MAY PICK A PROBE READS WHAT A PICKER SHOWS OF THE PROJECT'S PROBES.
 *
 * The monitor form, a monitor's probes, its logs and metrics, the monitor
 * list's bulk actions, network devices, their discovery scans and network
 * sites list the project's probes for people who may not read the probe
 * settings page. They read a probe's name, description, icon, status and
 * whether new monitors start with it, and nothing else of it.
 */
describe("Probe - whoever may pick a probe", () => {
  // What the Dashboard's probe pickers ask for (ProbeUtil.getAllProbes).
  const PICKER_LIST_SELECT: Record<string, boolean> = {
    name: true,
    _id: true,
    shouldAutoEnableProbeOnNewMonitors: true,
  };

  // Every column whoever may pick a probe reads.
  const PICKER_COLUMNS_SELECT: Record<string, boolean> = {
    name: true,
    description: true,
    slug: true,
    iconFileId: true,
    lastAlive: true,
    connectionStatus: true,
    shouldAutoEnableProbeOnNewMonitors: true,
    projectId: true,
  };

  test("its table is read by the probe readers and whoever may pick a probe", () => {
    expect([...new Probe().getReadPermissions()].sort()).toEqual(
      [...PROBE_PICKERS].sort(),
    );
  });

  test("the columns they read are pinned: what tells probes apart in a picker", () => {
    const model: Probe = new Probe();

    const readByPickers: Array<string> = Object.keys(
      model.getColumnAccessControlForAllColumns(),
    )
      .filter((column: string): boolean => {
        // Every record's own id and dates are read with its table.
        if (
          ["_id", "createdAt", "updatedAt", "deletedAt", "version"].includes(
            column,
          )
        ) {
          return false;
        }

        return Boolean(
          model
            .getColumnAccessControlFor(column)
            ?.read.includes(Permission.CreateProjectMonitor),
        );
      })
      .sort();

    expect(readByPickers).toEqual([...PROBE_PICKER_COLUMNS].sort());
  });

  test.each(PROBE_PICKER_COLUMNS)(
    "%s is read by every picker, and only by the probe's readers and pickers",
    (column: string) => {
      expect(
        [...(new Probe().getColumnAccessControlFor(column)?.read || [])].sort(),
      ).toEqual([...PROBE_PICKERS].sort());
    },
  );

  test("a probe's version, labels and packet capture report are its readers' alone", () => {
    for (const column of [
      "probeVersion",
      "labels",
      "packetCaptureCapability",
    ]) {
      expect({
        column: column,
        read: [
          ...(new Probe().getColumnAccessControlFor(column)?.read || []),
        ].sort(),
      }).toEqual({ column: column, read: [...PROBE_READERS].sort() });
    }
  });

  test("a probe's key is its project's owners' and admins' alone", () => {
    expect(
      [...(new Probe().getColumnAccessControlFor("key")?.read || [])].sort(),
    ).toEqual([Permission.ProjectAdmin, Permission.ProjectOwner].sort());
  });

  /*
   * The two teams the probe pickers broke for when the probe table stopped
   * naming Public: one that may only create monitors, and one that may only
   * read them.
   */
  test("a team holding only Create Project Monitor reads the probes the monitor form offers", async () => {
    const result: { query: Record<string, unknown> } = (await read(
      PROBE,
      member({ permissions: [Permission.CreateProjectMonitor] }),
      PICKER_LIST_SELECT,
    )) as { query: Record<string, unknown> };

    expect(JSON.stringify(result.query["projectId"])).toContain(
      PROJECT_ID.toString(),
    );
  });

  test("a team holding only Read Project Monitor reads the probes a monitor's pages name", async () => {
    const result: { query: Record<string, unknown> } = (await read(
      PROBE,
      member({ permissions: [Permission.ReadProjectMonitor] }),
      PICKER_COLUMNS_SELECT,
    )) as { query: Record<string, unknown> };

    expect(JSON.stringify(result.query["projectId"])).toContain(
      PROJECT_ID.toString(),
    );
  });

  test.each(PROBE_PICKERS_ONLY)(
    "a member holding only %s reads every column a picker shows, in their project",
    async (permission: Permission) => {
      const result: { query: Record<string, unknown> } = (await read(
        PROBE,
        member({ permissions: [permission] }),
        PICKER_COLUMNS_SELECT,
      )) as { query: Record<string, unknown> };

      expect(JSON.stringify(result.query["projectId"])).toContain(
        PROJECT_ID.toString(),
      );
    },
  );

  const PICKER_NEVER_READS: Array<[Permission, string]> = [];

  for (const permission of PROBE_PICKERS_ONLY) {
    for (const column of PROBE_COLUMNS_PICKERS_NEVER_READ) {
      PICKER_NEVER_READS.push([permission, column]);
    }
  }

  test.each(PICKER_NEVER_READS)(
    "a member holding only %s may not read %s",
    async (permission: Permission, column: string) => {
      const select: Record<string, unknown> =
        column === "labels" ? { labels: { name: true } } : { [column]: true };

      const error: unknown = await rejectionOf(
        read(
          PROBE,
          member({ permissions: [permission] }),
          select as Record<string, boolean>,
        ),
      );

      expect(error).toBeInstanceOf(NotAuthorizedException);
    },
  );

  test("a member of another project holding Create Project Monitor reads none of this one's probes", async () => {
    expect(
      await rejectionOf(
        read(
          PROBE,
          member({
            permissions: [Permission.CreateProjectMonitor],
            memberOf: OTHER_PROJECT_ID,
          }),
          PICKER_LIST_SELECT,
        ),
      ),
    ).toBeInstanceOf(NotAuthorizedException);
  });

  test("a team that blocks Read Project Probe reads no probe, whatever monitor permission it holds", async () => {
    const props: DatabaseCommonInteractionProps = member({
      permissions: [Permission.CreateProjectMonitor],
    });

    (
      props.userTenantAccessPermission![PROJECT_ID.toString()]!
        .permissions as Array<UserPermission>
    ).push({
      permission: Permission.ReadProjectProbe,
      labelIds: [],
      isBlockPermission: true,
      _type: "UserPermission",
    } as UserPermission);

    expect(
      await rejectionOf(read(PROBE, props, PICKER_LIST_SELECT)),
    ).toBeInstanceOf(NotAuthorizedException);
  });

  /*
   * The AI assistant's query_probes reads a project's probes with their
   * version first, and with what a picker shows when that is refused
   * (WorkflowProbeTools): the first is the probe readers', the second every
   * picker's.
   */
  test("the assistant's probe read with versions is the probe readers', its fallback every picker's", async () => {
    for (const permission of PROBE_READERS) {
      await expect(
        read(
          PROBE,
          member({ permissions: [permission] }),
          PROBE_READER_SELECT as Record<string, boolean>,
        ),
      ).resolves.toBeDefined();
    }

    for (const permission of PROBE_PICKERS_ONLY) {
      expect(
        await rejectionOf(
          read(
            PROBE,
            member({ permissions: [permission] }),
            PROBE_READER_SELECT as Record<string, boolean>,
          ),
        ),
      ).toBeInstanceOf(NotAuthorizedException);

      await expect(
        read(
          PROBE,
          member({ permissions: [permission] }),
          PROBE_PICKER_SELECT as Record<string, boolean>,
        ),
      ).resolves.toBeDefined();
    }
  });

  test("whoever may pick a probe reads no AI agent", async () => {
    expect(
      await rejectionOf(
        read(
          AI_AGENT,
          member({ permissions: [Permission.CreateProjectMonitor] }),
        ),
      ),
    ).toBeInstanceOf(NotAuthorizedException);
  });
});

/*
 * A probe's own page asks for what its readers may read: the Packet
 * Captures card reads a probe's report, and never isGlobalProbe, which no
 * one reads on the probe itself (it is read through the records that name
 * a probe), so asking for it refused the whole card.
 */
describe("Probe - its page asks only for what its readers read", () => {
  // What the probe page's Packet Captures card asks for (ProbePacketCaptures).
  const PACKET_CAPTURE_CARD_SELECT: Record<string, boolean> = {
    _id: true,
    name: true,
    projectId: true,
    packetCaptureCapability: true,
  };

  test.each(PROBE_READERS)(
    "a member holding %s reads what the Packet Captures card asks for",
    async (permission: Permission) => {
      await expect(
        read(
          PROBE,
          member({ permissions: [permission] }),
          PACKET_CAPTURE_CARD_SELECT,
        ),
      ).resolves.toBeDefined();
    },
  );

  test.each(PROBE_READERS)(
    "a member holding %s may not ask a probe for isGlobalProbe itself",
    async (permission: Permission) => {
      expect(
        await rejectionOf(
          read(PROBE, member({ permissions: [permission] }), {
            isGlobalProbe: true,
          }),
        ),
      ).toBeInstanceOf(NotAuthorizedException);
    },
  );
});
