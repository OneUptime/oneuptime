/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it, and DatabaseService imports it.
 */
jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

import CephClusterService from "../../../Server/Services/CephClusterService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import DockerHostService from "../../../Server/Services/DockerHostService";
import DockerSwarmClusterService from "../../../Server/Services/DockerSwarmClusterService";
import HostService from "../../../Server/Services/HostService";
import IoTFleetService from "../../../Server/Services/IoTFleetService";
import KubernetesClusterService from "../../../Server/Services/KubernetesClusterService";
import LabelService from "../../../Server/Services/LabelService";
import PodmanHostService from "../../../Server/Services/PodmanHostService";
import ProxmoxClusterService from "../../../Server/Services/ProxmoxClusterService";
import ServiceService from "../../../Server/Services/ServiceService";
import VMwareVCenterService from "../../../Server/Services/VMwareVCenterService";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { ARCHIVED_RESOURCE_HINT } from "../../../Server/Utils/Telemetry/DiscoveredResourceCreate";
import DiscoveredResourceUpdate, {
  MatchColumn,
  matchedOnIdentifier,
  matchedOnName,
} from "../../../Server/Utils/Telemetry/DiscoveredResourceUpdate";
import logger from "../../../Server/Utils/Logger";
import CephCluster from "../../../Models/DatabaseModels/CephCluster";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DockerHost from "../../../Models/DatabaseModels/DockerHost";
import DockerSwarmCluster from "../../../Models/DatabaseModels/DockerSwarmCluster";
import Host from "../../../Models/DatabaseModels/Host";
import IoTFleet from "../../../Models/DatabaseModels/IoTFleet";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import PodmanHost from "../../../Models/DatabaseModels/PodmanHost";
import ProxmoxCluster from "../../../Models/DatabaseModels/ProxmoxCluster";
import Service from "../../../Models/DatabaseModels/Service";
import VMwareVCenter from "../../../Models/DatabaseModels/VMwareVCenter";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import { getJestSpyOn } from "../../Spy";

/*
 * Changing what a resource's telemetry is matched on - a host's host name,
 * a Kubernetes cluster's cluster name, the name of a Proxmox cluster, a
 * vCenter or a service - from the details card on its Settings page, the
 * API or Terraform.
 *
 * A person's write of that column is held to what creating the resource
 * holds it to: no spaces around it (ingest looks resources up by the
 * trimmed value), never blank, and never the value another resource of the
 * project already has - archived ones included. Only a change is looked up,
 * so saving a resource's description never trips over a clash that was
 * already there. Ingest's own (root) writes are left exactly as sent.
 *
 * Pinned on the helper itself, then through each service's real update
 * pipeline (DatabaseService.updateOneById) with only the database stubbed,
 * and on the hook that runs it.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const USER_ID: ObjectID = new ObjectID("dddddddd-dddd-4ddd-8ddd-dddddddddddd");
const ROW_ID: ObjectID = new ObjectID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");

function userPermission(permission: Permission): UserPermission {
  return {
    permission,
    labelIds: [],
    isBlockPermission: false,
    _type: "UserPermission",
  };
}

function memberProps(
  permissions: Array<Permission> = [Permission.ProjectOwner],
): DatabaseCommonInteractionProps {
  return {
    userId: USER_ID,
    tenantId: PROJECT_ID,
    userGlobalAccessPermission: {
      projectIds: [PROJECT_ID],
      globalPermissions: [Permission.Public, Permission.User],
      _type: "UserGlobalAccessPermission",
    },
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        projectId: PROJECT_ID,
        permissions: permissions.map(userPermission),
        _type: "UserTenantAccessPermission",
      },
    },
  };
}

const ROOT: DatabaseCommonInteractionProps = { isRoot: true };

function silenceLogs(): void {
  for (const level of ["error", "warn", "info", "debug"] as const) {
    jest.spyOn(logger, level).mockImplementation(() => {
      return undefined as never;
    });
  }
}

// The operator QueryHelper.findWithSameText builds, read back.
function sameTextValue(operator: unknown): unknown {
  return Object.values(
    (operator as { objectLiteralParameters: Record<string, unknown> })
      .objectLiteralParameters,
  )[0];
}

/*
 * ---------------------------------------------------------------------------
 * The rules
 * ---------------------------------------------------------------------------
 */

describe("the match columns", () => {
  test("an identifier is refused in the words a clash on create uses", () => {
    const host: MatchColumn = matchedOnIdentifier({
      identityColumn: "hostIdentifier",
      resourceName: "host",
      identityName: "host name",
    });

    expect(host.column).toBe("hostIdentifier");
    expect(host.getTakenMessage("web-01")).toBe(
      'A host with the host name "web-01" already exists.',
    );
    expect(host.blankMessage).toBe(
      "Enter the host name this host's telemetry reports.",
    );
    expect(host.sharedMessage).toBe("Each host needs a host name of its own.");
  });

  test("a matched name is the name column, refused by name", () => {
    const proxmox: MatchColumn = matchedOnName({
      resourceName: "Proxmox cluster",
    });

    expect(proxmox.column).toBe("name");
    expect(proxmox.getTakenMessage("pve-production")).toBe(
      'Another Proxmox cluster is already named "pve-production".',
    );
    expect(proxmox.blankMessage).toBe(
      "Enter the name this Proxmox cluster's telemetry reports.",
    );
    expect(proxmox.sharedMessage).toBe(
      "Each Proxmox cluster needs a name of its own.",
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * The helper
 * ---------------------------------------------------------------------------
 */

describe("DiscoveredResourceUpdate.checkMatchColumn", () => {
  const HOST_MATCH: MatchColumn = matchedOnIdentifier({
    identityColumn: "hostIdentifier",
    resourceName: "host",
    identityName: "host name",
  });

  interface Request {
    query: Record<string, unknown>;
    select: Record<string, unknown>;
    props: DatabaseCommonInteractionProps;
    limit?: number;
  }

  let finds: Array<Request>;
  let lookups: Array<Request>;
  let targets: Array<BaseModel>;
  let clash: BaseModel | null;

  const service: any = {
    findBy: async (request: Request): Promise<Array<BaseModel>> => {
      finds.push(request);
      return targets;
    },
    findOneBy: async (request: Request): Promise<BaseModel | null> => {
      lookups.push(request);
      return clash;
    },
  };

  function storedHost(identity: string, id: ObjectID = ROW_ID): Host {
    const host: Host = new Host();
    host._id = id.toString();
    host.projectId = PROJECT_ID;
    host.hostIdentifier = identity;
    return host;
  }

  function hostUpdate(
    data: Record<string, unknown>,
    props: DatabaseCommonInteractionProps = memberProps(),
  ): UpdateBy<Host> {
    return {
      query: { _id: ROW_ID.toString(), projectId: PROJECT_ID },
      data: data as any,
      props,
      skip: 0,
      limit: 1,
    } as unknown as UpdateBy<Host>;
  }

  function check(updateBy: UpdateBy<Host>): Promise<void> {
    return DiscoveredResourceUpdate.checkMatchColumn({
      service,
      updateBy,
      matchColumn: HOST_MATCH,
    });
  }

  beforeEach(() => {
    finds = [];
    lookups = [];
    targets = [storedHost("web-01")];
    clash = null;
  });

  test("lets a new identifier that clashes with nothing through", async () => {
    const updateBy: UpdateBy<Host> = hostUpdate({ hostIdentifier: "web-02" });

    await expect(check(updateBy)).resolves.toBeUndefined();

    expect(finds).toHaveLength(1);
    expect(lookups).toHaveLength(1);
    expect((updateBy.data as any).hostIdentifier).toBe("web-02");
  });

  test("reads the rows the write reaches, as root, from the narrowed query", async () => {
    const updateBy: UpdateBy<Host> = hostUpdate({ hostIdentifier: "web-02" });

    await check(updateBy);

    expect(finds[0]!.query).toBe(updateBy.query);
    expect(finds[0]!.select).toEqual({
      _id: true,
      projectId: true,
      hostIdentifier: true,
    });
    expect(finds[0]!.props).toEqual({ isRoot: true });
    expect(finds[0]!.limit).toBe(2);
  });

  test("looks the new identifier up in the project, case and spaces aside, other rows only, archived ones included", async () => {
    await check(hostUpdate({ hostIdentifier: "  Web-02 " }));

    expect(Object.keys(lookups[0]!.query).sort()).toEqual([
      "_id",
      "hostIdentifier",
      "projectId",
    ]);
    expect(lookups[0]!.query["projectId"]).toBe(PROJECT_ID);
    expect(sameTextValue(lookups[0]!.query["hostIdentifier"])).toBe("web-02");
    // Not the row being saved.
    expect(JSON.stringify(lookups[0]!.query["_id"])).toContain(
      ROW_ID.toString(),
    );
    expect(lookups[0]!.query["isArchived"]).toBeUndefined();
    expect(lookups[0]!.select).toEqual({ _id: true, isArchived: true });
    expect(lookups[0]!.props).toEqual({ isRoot: true });
  });

  test("stores a person's identifier without the spaces around it", async () => {
    const updateBy: UpdateBy<Host> = hostUpdate({
      hostIdentifier: "  web-02\t",
    });

    await check(updateBy);

    expect((updateBy.data as any).hostIdentifier).toBe("web-02");
  });

  test("refuses another host's identifier, saying which", async () => {
    clash = storedHost("web-02", ObjectID.generate());

    await expect(
      check(hostUpdate({ hostIdentifier: "web-02" })),
    ).rejects.toThrow(
      new BadDataException(
        'A host with the host name "web-02" already exists.',
      ),
    );
  });

  test("says when the host that has it is archived", async () => {
    const archived: Host = storedHost("web-02", ObjectID.generate());
    archived.isArchived = true;
    clash = archived;

    await expect(
      check(hostUpdate({ hostIdentifier: "web-02" })),
    ).rejects.toThrow(
      `A host with the host name "web-02" already exists. ${ARCHIVED_RESOURCE_HINT}`,
    );
  });

  test("refuses a blank identifier without looking anything up", async () => {
    await expect(check(hostUpdate({ hostIdentifier: "   " }))).rejects.toThrow(
      new BadDataException(
        "Enter the host name this host's telemetry reports.",
      ),
    );

    expect(finds).toEqual([]);
    expect(lookups).toEqual([]);
  });

  test("looks nothing up for the identifier the host already has, so an old clash never blocks a save", async () => {
    // Another host has it too - from before this rule. The description still saves.
    clash = storedHost("web-01", ObjectID.generate());

    await expect(
      check(hostUpdate({ hostIdentifier: "web-01", description: "Front end" })),
    ).resolves.toBeUndefined();

    expect(finds).toHaveLength(1);
    expect(lookups).toEqual([]);
  });

  test("treats a change of case or spaces as the same identifier", async () => {
    clash = storedHost("web-01", ObjectID.generate());

    await expect(
      check(hostUpdate({ hostIdentifier: " WEB-01 " })),
    ).resolves.toBeUndefined();

    expect(lookups).toEqual([]);
  });

  test("leaves a write without the identifier alone", async () => {
    const updateBy: UpdateBy<Host> = hostUpdate({ description: "Front end" });

    await check(updateBy);

    expect(finds).toEqual([]);
    expect(lookups).toEqual([]);
    expect((updateBy.data as any).hostIdentifier).toBeUndefined();
  });

  test("leaves ingest's (root) writes exactly as sent, with no lookups", async () => {
    clash = storedHost("web-02", ObjectID.generate());
    const updateBy: UpdateBy<Host> = hostUpdate(
      { hostIdentifier: " web-02 " },
      ROOT,
    );

    await expect(check(updateBy)).resolves.toBeUndefined();

    expect((updateBy.data as any).hostIdentifier).toBe(" web-02 ");
    expect(finds).toEqual([]);
    expect(lookups).toEqual([]);
  });

  test("does nothing when the write reaches no host", async () => {
    targets = [];

    await expect(
      check(hostUpdate({ hostIdentifier: "web-02" })),
    ).resolves.toBeUndefined();

    expect(lookups).toEqual([]);
  });

  test("refuses one write that would give a host name to two hosts", async () => {
    targets = [storedHost("web-01"), storedHost("web-03", ObjectID.generate())];

    await expect(
      check(hostUpdate({ hostIdentifier: "web-02" })),
    ).rejects.toThrow(
      new BadDataException("Each host needs a host name of its own."),
    );

    expect(lookups).toEqual([]);
  });

  test("lets a write that leaves every reached host's identifier as it is through", async () => {
    targets = [storedHost("web-01"), storedHost("WEB-01", ObjectID.generate())];

    await expect(
      check(hostUpdate({ hostIdentifier: "web-01" })),
    ).resolves.toBeUndefined();
  });

  test("checks a matched name the same way", async () => {
    const proxmox: MatchColumn = matchedOnName({
      resourceName: "Proxmox cluster",
    });
    const cluster: ProxmoxCluster = new ProxmoxCluster();
    cluster._id = ROW_ID.toString();
    cluster.projectId = PROJECT_ID;
    cluster.name = "pve-staging";
    targets = [cluster];
    clash = new ProxmoxCluster();

    const updateBy: UpdateBy<ProxmoxCluster> = {
      query: { _id: ROW_ID.toString() },
      data: { name: " pve-production " } as any,
      props: memberProps(),
      skip: 0,
      limit: 1,
    } as unknown as UpdateBy<ProxmoxCluster>;

    await expect(
      DiscoveredResourceUpdate.checkMatchColumn({
        service,
        updateBy,
        matchColumn: proxmox,
      }),
    ).rejects.toThrow(
      new BadDataException(
        'Another Proxmox cluster is already named "pve-production".',
      ),
    );

    expect(sameTextValue(lookups[0]!.query["name"])).toBe("pve-production");
    expect((updateBy.data as any).name).toBe("pve-production");
  });
});

/*
 * ---------------------------------------------------------------------------
 * Through each service's real update pipeline
 * ---------------------------------------------------------------------------
 */

interface Wiring {
  label: string;
  service: any;
  modelType: { new (): BaseModel };
  column: string;
  // What the resource has now, and what a person changes it to.
  stored: string;
  changed: string;
  takenMessage: string;
  blankMessage: string;
}

const identifierWiring: (data: {
  label: string;
  service: any;
  modelType: { new (): BaseModel };
  column: string;
  resourceName: string;
  identityName: string;
}) => Wiring = (data: {
  label: string;
  service: any;
  modelType: { new (): BaseModel };
  column: string;
  resourceName: string;
  identityName: string;
}): Wiring => {
  return {
    label: data.label,
    service: data.service,
    modelType: data.modelType,
    column: data.column,
    stored: "web-01",
    changed: "web-02",
    takenMessage: `A ${data.resourceName} with the ${data.identityName} "web-02" already exists.`,
    blankMessage: `Enter the ${data.identityName} this ${data.resourceName}'s telemetry reports.`,
  };
};

const nameWiring: (data: {
  label: string;
  service: any;
  modelType: { new (): BaseModel };
  resourceName: string;
}) => Wiring = (data: {
  label: string;
  service: any;
  modelType: { new (): BaseModel };
  resourceName: string;
}): Wiring => {
  return {
    label: data.label,
    service: data.service,
    modelType: data.modelType,
    column: "name",
    stored: "production",
    changed: "staging",
    takenMessage: `Another ${data.resourceName} is already named "staging".`,
    blankMessage: `Enter the name this ${data.resourceName}'s telemetry reports.`,
  };
};

const WIRINGS: Array<Wiring> = [
  identifierWiring({
    label: "Host",
    service: HostService,
    modelType: Host,
    column: "hostIdentifier",
    resourceName: "host",
    identityName: "host name",
  }),
  identifierWiring({
    label: "Docker host",
    service: DockerHostService,
    modelType: DockerHost,
    column: "hostIdentifier",
    resourceName: "Docker host",
    identityName: "host name",
  }),
  identifierWiring({
    label: "Podman host",
    service: PodmanHostService,
    modelType: PodmanHost,
    column: "hostIdentifier",
    resourceName: "Podman host",
    identityName: "host name",
  }),
  identifierWiring({
    label: "Kubernetes cluster",
    service: KubernetesClusterService,
    modelType: KubernetesCluster,
    column: "clusterIdentifier",
    resourceName: "Kubernetes cluster",
    identityName: "cluster name",
  }),
  nameWiring({
    label: "Ceph cluster",
    service: CephClusterService,
    modelType: CephCluster,
    resourceName: "Ceph cluster",
  }),
  nameWiring({
    label: "Proxmox cluster",
    service: ProxmoxClusterService,
    modelType: ProxmoxCluster,
    resourceName: "Proxmox cluster",
  }),
  nameWiring({
    label: "vCenter",
    service: VMwareVCenterService,
    modelType: VMwareVCenter,
    resourceName: "vCenter",
  }),
  nameWiring({
    label: "Docker Swarm cluster",
    service: DockerSwarmClusterService,
    modelType: DockerSwarmCluster,
    resourceName: "Docker Swarm cluster",
  }),
  nameWiring({
    label: "IoT fleet",
    service: IoTFleetService,
    modelType: IoTFleet,
    resourceName: "IoT fleet",
  }),
  nameWiring({
    label: "Service",
    service: ServiceService,
    modelType: Service,
    resourceName: "service",
  }),
];

describe.each(WIRINGS)(
  "$label - changed through DatabaseService.updateOneById",
  (wiring: Wiring) => {
    let update: jest.Mock;
    let clash: BaseModel | null;
    let findOneBy: jest.SpyInstance;

    function stored(value: string, id: ObjectID = ROW_ID): BaseModel {
      const row: BaseModel = new wiring.modelType();
      Object.assign(row, {
        _id: id.toString(),
        projectId: PROJECT_ID,
        [wiring.column]: value,
      });
      return row;
    }

    beforeEach(() => {
      silenceLogs();
      clash = null;

      update = jest.fn(async () => {
        return { affected: 1 };
      });
      getJestSpyOn(wiring.service, "getRepository").mockReturnValue({
        update,
        save: jest.fn(async (entity: unknown) => {
          return entity;
        }),
      } as never);
      // The rows the update writes, and the rows the check reads.
      getJestSpyOn(wiring.service, "_findBy").mockResolvedValue([
        stored(wiring.stored),
      ] as never);
      getJestSpyOn(wiring.service, "findBy").mockResolvedValue([
        stored(wiring.stored),
      ] as never);
      findOneBy = getJestSpyOn(wiring.service, "findOneBy").mockImplementation(
        async (): Promise<BaseModel | null> => {
          return clash;
        },
      );
      getJestSpyOn(wiring.service, "onTriggerWorkflow").mockResolvedValue(
        undefined as never,
      );
      getJestSpyOn(wiring.service, "onTriggerRealtime").mockResolvedValue(
        undefined as never,
      );
      // The feed, rules and AI bookkeeping after an update are not under test.
      getJestSpyOn(wiring.service, "onUpdateSuccess").mockImplementation(
        async (onUpdate: unknown): Promise<unknown> => {
          return onUpdate;
        },
      );
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    function save(
      value: string,
      props: DatabaseCommonInteractionProps = memberProps(),
    ): Promise<void> {
      return wiring.service.updateOneById({
        id: ROW_ID,
        data: { [wiring.column]: value },
        props,
      });
    }

    function written(): Record<string, unknown> {
      expect(update).toHaveBeenCalledTimes(1);
      return update.mock.calls[0]![1] as Record<string, unknown>;
    }

    test("writes a person's new value without the spaces around it", async () => {
      await save(`  ${wiring.changed} `);

      expect(written()[wiring.column]).toBe(wiring.changed);
    });

    test("refuses the value another one of the project already has", async () => {
      clash = stored(wiring.changed, ObjectID.generate());

      await expect(save(wiring.changed)).rejects.toThrow(
        new BadDataException(wiring.takenMessage),
      );

      expect(update).not.toHaveBeenCalled();
    });

    test("refuses a blank value", async () => {
      await expect(save("  ")).rejects.toThrow(
        new BadDataException(wiring.blankMessage),
      );

      expect(update).not.toHaveBeenCalled();
    });

    test("saves the value it already has without looking for clashes", async () => {
      clash = stored(wiring.stored, ObjectID.generate());

      await save(wiring.stored);

      expect(findOneBy).not.toHaveBeenCalled();
      expect(written()[wiring.column]).toBe(wiring.stored);
    });

    test("leaves ingest's (root) write as it came, with no lookups", async () => {
      clash = stored(wiring.changed, ObjectID.generate());

      await save(` ${wiring.changed}`, ROOT);

      expect(findOneBy).not.toHaveBeenCalled();
      expect(written()[wiring.column]).toBe(` ${wiring.changed}`);
    });

    test("refuses a caller who may not edit it before looking anything up", async () => {
      clash = stored(wiring.changed, ObjectID.generate());

      await expect(
        save(wiring.changed, memberProps([Permission.Viewer])),
      ).rejects.toThrow();

      expect(findOneBy).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    });
  },
);

/*
 * ---------------------------------------------------------------------------
 * The hook in DatabaseService's update
 * ---------------------------------------------------------------------------
 */

describe("DatabaseService.onBeforeUpdateUniqueCheck", () => {
  const service: any = HostService;

  beforeEach(() => {
    silenceLogs();
    getJestSpyOn(service, "getRepository").mockReturnValue({
      update: jest.fn(async () => {
        return { affected: 1 };
      }),
    } as never);
    const host: Host = new Host();
    host._id = ROW_ID.toString();
    host.projectId = PROJECT_ID;
    host.hostIdentifier = "web-01";
    getJestSpyOn(service, "_findBy").mockResolvedValue([host] as never);
    getJestSpyOn(service, "findBy").mockResolvedValue([host] as never);
    getJestSpyOn(service, "findOneBy").mockResolvedValue(null as never);
    getJestSpyOn(service, "onTriggerWorkflow").mockResolvedValue(
      undefined as never,
    );
    getJestSpyOn(service, "onTriggerRealtime").mockResolvedValue(
      undefined as never,
    );
    getJestSpyOn(service, "onUpdateSuccess").mockImplementation(
      async (onUpdate: unknown): Promise<unknown> => {
        return onUpdate;
      },
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("runs after onBeforeUpdate and the permission checks, with the narrowed query", async () => {
    const before: jest.SpyInstance = getJestSpyOn(service, "onBeforeUpdate");
    const permission: jest.SpyInstance = jest.spyOn(
      ModelPermission,
      "checkUpdateQueryPermissions",
    );
    const hook: jest.SpyInstance = getJestSpyOn(
      service,
      "onBeforeUpdateUniqueCheck",
    );

    await service.updateOneById({
      id: ROW_ID,
      data: { hostIdentifier: "web-02" },
      props: memberProps(),
    });

    expect(hook).toHaveBeenCalledTimes(1);
    expect(before.mock.invocationCallOrder[0]!).toBeLessThan(
      permission.mock.invocationCallOrder[0]!,
    );
    expect(permission.mock.invocationCallOrder[0]!).toBeLessThan(
      hook.mock.invocationCallOrder[0]!,
    );

    const narrowed: unknown = await permission.mock.results[0]!.value;
    expect((hook.mock.calls[0]![0] as UpdateBy<Host>).query).toBe(narrowed);
  });

  test("is skipped with the other hooks when an update ignores them", async () => {
    const hook: jest.SpyInstance = getJestSpyOn(
      service,
      "onBeforeUpdateUniqueCheck",
    );

    await service.updateOneById({
      id: ROW_ID,
      data: { hostIdentifier: "web-02" },
      props: { isRoot: true, ignoreHooks: true },
    });

    expect(hook).not.toHaveBeenCalled();
  });

  test("does nothing in a service that does not override it", async () => {
    expect(
      (LabelService as any).onBeforeUpdateUniqueCheck ===
        (DatabaseService.prototype as any).onBeforeUpdateUniqueCheck,
    ).toBe(true);

    await expect(
      (DatabaseService.prototype as any).onBeforeUpdateUniqueCheck.call(
        LabelService,
        { query: {}, data: {}, props: memberProps() },
      ),
    ).resolves.toBeUndefined();
  });

  test("is overridden by every service whose telemetry is matched on an editable column", () => {
    for (const wiring of WIRINGS) {
      expect(
        (wiring.service as any).onBeforeUpdateUniqueCheck ===
          (DatabaseService.prototype as any).onBeforeUpdateUniqueCheck,
      ).toBe(false);
    }
  });
});
