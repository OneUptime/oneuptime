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

import CloudResourceService from "../../../Server/Services/CloudResourceService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import DockerHostService from "../../../Server/Services/DockerHostService";
import HostService from "../../../Server/Services/HostService";
import KubernetesClusterService from "../../../Server/Services/KubernetesClusterService";
import LabelService from "../../../Server/Services/LabelService";
import PodmanHostService from "../../../Server/Services/PodmanHostService";
import RumApplicationService from "../../../Server/Services/RumApplicationService";
import ServerlessFunctionService from "../../../Server/Services/ServerlessFunctionService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import DiscoveredResourceCreate, {
  ARCHIVED_RESOURCE_HINT,
  DiscoveredResourceNaming,
  getDiscoveredResourceNameTakenMessage,
  namedAfterCloudEnvironment,
  namedAfterIdentity,
} from "../../../Server/Utils/Telemetry/DiscoveredResourceCreate";
import logger from "../../../Server/Utils/Logger";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DockerHost from "../../../Models/DatabaseModels/DockerHost";
import Host from "../../../Models/DatabaseModels/Host";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import PodmanHost from "../../../Models/DatabaseModels/PodmanHost";
import RumApplication from "../../../Models/DatabaseModels/RumApplication";
import ServerlessFunction from "../../../Models/DatabaseModels/ServerlessFunction";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import PositiveNumber from "../../../Types/PositiveNumber";
import { getJestSpyOn } from "../../Spy";

/*
 * Adding a resource that telemetry also discovers - a host, a Docker or
 * Podman host, a Kubernetes cluster, a RUM application, a serverless
 * function, a cloud environment - from the dashboard, the API or Terraform.
 *
 * The dashboard's create form asks only for what the telemetry is matched
 * on, and an API caller may leave the name out too: the service names the
 * resource the way ingest names a discovered one, before the required-field
 * check, so the name column stays required and the API and Terraform schema
 * do not change. A clash with an existing resource is refused in plain
 * words - by its identifier first, since a resource named after its
 * identifier would otherwise read as a clash of names - once the caller has
 * passed the permission checks.
 *
 * Pinned here on the helper itself, then through each service's real create
 * pipeline (DatabaseService.create) with only the database stubbed.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const USER_ID: ObjectID = new ObjectID("dddddddd-dddd-4ddd-8ddd-dddddddddddd");

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

interface Wiring {
  label: string;
  service: any;
  modelType: { new (): BaseModel };
  identityColumn: string;
  // What the telemetry reports, as a person would type it.
  identity: string;
  // Other values the resource is created with (a cloud environment's parts).
  extra: Record<string, unknown>;
  // The name ingest gives such a resource.
  defaultName: string;
  identityTakenMessage: string;
  nameTakenMessage: (name: string) => string;
}

const hostLike: (data: {
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
    identityColumn: "hostIdentifier",
    identity: "web-01",
    extra: {},
    defaultName: "web-01",
    identityTakenMessage: `A ${data.resourceName} with the host name "web-01" already exists.`,
    nameTakenMessage: (name: string): string => {
      return `Another ${data.resourceName} is already named "${name}". Give this one a different display name.`;
    },
  };
};

const WIRINGS: Array<Wiring> = [
  hostLike({
    label: "Host",
    service: HostService,
    modelType: Host,
    resourceName: "host",
  }),
  hostLike({
    label: "Docker host",
    service: DockerHostService,
    modelType: DockerHost,
    resourceName: "Docker host",
  }),
  hostLike({
    label: "Podman host",
    service: PodmanHostService,
    modelType: PodmanHost,
    resourceName: "Podman host",
  }),
  {
    label: "Kubernetes cluster",
    service: KubernetesClusterService,
    modelType: KubernetesCluster,
    identityColumn: "clusterIdentifier",
    identity: "production-us-east-1",
    extra: {},
    defaultName: "production-us-east-1",
    identityTakenMessage:
      'A Kubernetes cluster with the cluster name "production-us-east-1" already exists.',
    nameTakenMessage: (name: string): string => {
      return `Another Kubernetes cluster is already named "${name}". Give this one a different display name.`;
    },
  },
  {
    label: "RUM application",
    service: RumApplicationService,
    modelType: RumApplication,
    identityColumn: "appIdentifier",
    identity: "storefront-web",
    extra: {},
    defaultName: "storefront-web",
    identityTakenMessage:
      'A RUM application with the app name "storefront-web" already exists.',
    nameTakenMessage: (name: string): string => {
      return `Another RUM application is already named "${name}". Give this one a different display name.`;
    },
  },
  {
    label: "Serverless function",
    service: ServerlessFunctionService,
    modelType: ServerlessFunction,
    identityColumn: "functionIdentifier",
    identity: "checkout-handler",
    extra: {},
    defaultName: "checkout-handler",
    identityTakenMessage:
      'A serverless function with the function name "checkout-handler" already exists.',
    nameTakenMessage: (name: string): string => {
      return `Another serverless function is already named "${name}". Give this one a different display name.`;
    },
  },
  {
    label: "Cloud environment",
    service: CloudResourceService,
    modelType: CloudResource,
    identityColumn: "resourceIdentifier",
    // What the dashboard's onBeforeCreate joins the three parts into.
    identity: "aws_ecs|123456789012|us-east-1",
    extra: {
      cloudPlatform: "aws_ecs",
      cloudAccountId: "123456789012",
      cloudRegion: "us-east-1",
    },
    defaultName: "AWS ECS · us-east-1 · 123456789012",
    identityTakenMessage:
      "A cloud environment for this platform, account and region (aws_ecs|123456789012|us-east-1) already exists.",
    nameTakenMessage: (name: string): string => {
      return `Another cloud environment is already named "${name}". Give this one a different display name.`;
    },
  },
];

function makeModel(
  wiring: Wiring,
  values: Record<string, unknown> = {},
): BaseModel {
  const model: BaseModel = new wiring.modelType();
  Object.assign(
    model,
    {
      projectId: PROJECT_ID,
      [wiring.identityColumn]: wiring.identity,
      ...wiring.extra,
    },
    values,
  );
  return model;
}

function read(model: BaseModel, column: string): unknown {
  return (model as unknown as Record<string, unknown>)[column];
}

/*
 * ---------------------------------------------------------------------------
 * The helper
 * ---------------------------------------------------------------------------
 */

const HOST_NAMING: DiscoveredResourceNaming<Host> = namedAfterIdentity<Host>({
  identityColumn: "hostIdentifier",
  resourceName: "host",
  identityName: "host name",
});

function hostCreate(
  values: Record<string, unknown>,
  props: DatabaseCommonInteractionProps = memberProps(),
): CreateBy<Host> {
  const host: Host = new Host();
  Object.assign(host, { projectId: PROJECT_ID }, values);
  return { data: host, props };
}

describe("DiscoveredResourceCreate.fillName", () => {
  test("names a resource created without a name after its identifier", () => {
    const createBy: CreateBy<Host> = hostCreate({ hostIdentifier: "web-01" });

    DiscoveredResourceCreate.fillName({ createBy, naming: HOST_NAMING });

    expect(createBy.data.name).toBe("web-01");
  });

  test.each([
    ["an empty name", ""],
    ["a name of spaces", "   "],
    ["a null name", null],
  ])("treats %s as no name", (_label: string, name: unknown) => {
    const createBy: CreateBy<Host> = hostCreate({
      hostIdentifier: "web-01",
      name,
    });

    DiscoveredResourceCreate.fillName({ createBy, naming: HOST_NAMING });

    expect(createBy.data.name).toBe("web-01");
  });

  test("keeps a name the caller gave, without the spaces around it", () => {
    const createBy: CreateBy<Host> = hostCreate({
      hostIdentifier: "web-01",
      name: "  Production web server  ",
    });

    DiscoveredResourceCreate.fillName({ createBy, naming: HOST_NAMING });

    expect(createBy.data.name).toBe("Production web server");
  });

  test("stores a person's identifier without the spaces around it, and names it so", () => {
    /*
     * Ingest looks a host up by the trimmed host.name its telemetry reports;
     * a stored " web-01 " would never match, and ingest would create a
     * second host beside this empty one.
     */
    const createBy: CreateBy<Host> = hostCreate({
      hostIdentifier: "  web-01 \t",
    });

    DiscoveredResourceCreate.fillName({ createBy, naming: HOST_NAMING });

    expect(createBy.data.hostIdentifier).toBe("web-01");
    expect(createBy.data.name).toBe("web-01");
  });

  test("keeps the identifier's case: the telemetry decides what it is", () => {
    const createBy: CreateBy<Host> = hostCreate({ hostIdentifier: "PRIMARY01" });

    DiscoveredResourceCreate.fillName({ createBy, naming: HOST_NAMING });

    expect(createBy.data.hostIdentifier).toBe("PRIMARY01");
    expect(createBy.data.name).toBe("PRIMARY01");
  });

  test("leaves what ingest (root) sends exactly as sent", () => {
    const createBy: CreateBy<Host> = hostCreate(
      { hostIdentifier: " web-01 ", name: " web-01 " },
      ROOT,
    );

    DiscoveredResourceCreate.fillName({ createBy, naming: HOST_NAMING });

    expect(createBy.data.hostIdentifier).toBe(" web-01 ");
    expect(createBy.data.name).toBe(" web-01 ");
  });

  test("still names a root create that came without a name", () => {
    const createBy: CreateBy<Host> = hostCreate(
      { hostIdentifier: "web-01" },
      ROOT,
    );

    DiscoveredResourceCreate.fillName({ createBy, naming: HOST_NAMING });

    expect(createBy.data.name).toBe("web-01");
  });

  test("leaves the name out when there is nothing to name it after", () => {
    for (const hostIdentifier of [undefined, "", "   "]) {
      const createBy: CreateBy<Host> = hostCreate({ hostIdentifier });

      DiscoveredResourceCreate.fillName({ createBy, naming: HOST_NAMING });

      expect(createBy.data.name).toBeUndefined();
    }
  });

  test("never makes an identifier from a name", () => {
    const createBy: CreateBy<Host> = hostCreate({ name: "web-01" });

    DiscoveredResourceCreate.fillName({ createBy, naming: HOST_NAMING });

    expect(createBy.data.hostIdentifier).toBeUndefined();
    expect(createBy.data.name).toBe("web-01");
  });

  test("names a cloud environment after its platform, region and account", () => {
    const naming: DiscoveredResourceNaming<CloudResource> =
      namedAfterCloudEnvironment<CloudResource>();

    const environment: CloudResource = new CloudResource();
    Object.assign(environment, {
      cloudPlatform: "gcp_cloud_run",
      cloudRegion: "us-central1",
      resourceIdentifier: "gcp_cloud_run||us-central1",
    });
    const createBy: CreateBy<CloudResource> = {
      data: environment,
      props: memberProps(),
    };

    DiscoveredResourceCreate.fillName({ createBy, naming });

    expect(environment.name).toBe("GCP Cloud Run · us-central1");
  });

  test("names an environment sent with its key alone from the key", () => {
    const environment: CloudResource = new CloudResource();
    environment.resourceIdentifier = "aws_ecs|123456789012|us-east-1";

    DiscoveredResourceCreate.fillName({
      createBy: { data: environment, props: memberProps() },
      naming: namedAfterCloudEnvironment<CloudResource>(),
    });

    expect(environment.name).toBe("AWS ECS · us-east-1 · 123456789012");
  });
});

describe("the refusals", () => {
  test("name the clash and say what to do", () => {
    expect(HOST_NAMING.getIdentityTakenMessage("web-01")).toBe(
      'A host with the host name "web-01" already exists.',
    );
    expect(HOST_NAMING.getNameTakenMessage("web-01")).toBe(
      'Another host is already named "web-01". Give this one a different display name.',
    );
    expect(
      getDiscoveredResourceNameTakenMessage({
        resourceName: "Kubernetes cluster",
        name: "prod",
      }),
    ).toBe(
      'Another Kubernetes cluster is already named "prod". Give this one a different display name.',
    );
  });
});

describe("DiscoveredResourceCreate.refuseClash", () => {
  interface Lookup {
    query: Record<string, unknown>;
    select: Record<string, unknown>;
    props: DatabaseCommonInteractionProps;
  }

  let lookups: Array<Lookup>;
  let existing: { identity: BaseModel | null; name: BaseModel | null };

  const service: any = {
    findOneBy: async (request: Lookup): Promise<BaseModel | null> => {
      lookups.push(request);
      return request.query["name"] !== undefined
        ? existing.name
        : existing.identity;
    },
  };

  beforeEach(() => {
    lookups = [];
    existing = { identity: null, name: null };
  });

  function refuse(createBy: CreateBy<Host>): Promise<void> {
    return DiscoveredResourceCreate.refuseClash({
      service,
      createBy,
      naming: HOST_NAMING,
    });
  }

  // The operator QueryHelper.findWithSameText builds, read back.
  function sameTextValue(operator: unknown): unknown {
    return Object.values(
      (operator as { objectLiteralParameters: Record<string, unknown> })
        .objectLiteralParameters,
    )[0];
  }

  test("lets a resource that clashes with nothing through", async () => {
    await expect(
      refuse(hostCreate({ hostIdentifier: "web-01", name: "web-01" })),
    ).resolves.toBeUndefined();

    expect(lookups).toHaveLength(2);
  });

  test("looks the identifier up first, then the name, case and spaces aside, archived ones included", async () => {
    await refuse(hostCreate({ hostIdentifier: "Web-01", name: "Web server" }));

    expect(Object.keys(lookups[0]!.query).sort()).toEqual([
      "hostIdentifier",
      "projectId",
    ]);
    expect(sameTextValue(lookups[0]!.query["hostIdentifier"])).toBe("web-01");
    expect(lookups[0]!.select).toEqual({ _id: true, isArchived: true });

    expect(Object.keys(lookups[1]!.query).sort()).toEqual([
      "name",
      "projectId",
    ]);
    expect(sameTextValue(lookups[1]!.query["name"])).toBe("web server");

    for (const lookup of lookups) {
      expect(lookup.query["projectId"]).toBe(PROJECT_ID);
      expect(lookup.query["isArchived"]).toBeUndefined();
      expect(lookup.props).toEqual({ isRoot: true });
    }
  });

  test("refuses a resource that is already there by its identifier, not as a clash of names", async () => {
    // A discovered host: named after its identifier, so both would clash.
    existing.identity = new Host();
    existing.name = new Host();

    await expect(
      refuse(hostCreate({ hostIdentifier: "web-01", name: "web-01" })),
    ).rejects.toThrow(
      new BadDataException('A host with the host name "web-01" already exists.'),
    );

    // The name was never looked up.
    expect(lookups).toHaveLength(1);
  });

  test("says when the resource already there is archived", async () => {
    const archived: Host = new Host();
    archived.isArchived = true;
    existing.identity = archived;

    await expect(refuse(hostCreate({ hostIdentifier: "web-01" }))).rejects.toThrow(
      `A host with the host name "web-01" already exists. ${ARCHIVED_RESOURCE_HINT}`,
    );
  });

  test("refuses a clash of names with what to do about it", async () => {
    existing.name = new Host();

    await expect(
      refuse(hostCreate({ hostIdentifier: "web-02", name: "web-01" })),
    ).rejects.toThrow(
      new BadDataException(
        'Another host is already named "web-01". Give this one a different display name.',
      ),
    );
  });

  test("leaves ingest's (root) creates to settle their own races, without a lookup", async () => {
    existing.identity = new Host();

    await expect(
      refuse(hostCreate({ hostIdentifier: "web-01", name: "web-01" }, ROOT)),
    ).resolves.toBeUndefined();

    expect(lookups).toEqual([]);
  });

  test("looks nothing up without a project, or without anything to look up", async () => {
    await refuse({
      data: Object.assign(new Host(), { hostIdentifier: "web-01" }),
      props: { userId: USER_ID },
    });
    expect(lookups).toEqual([]);

    await refuse(hostCreate({}));
    expect(lookups).toEqual([]);
  });

  test("uses the caller's tenant when the row names no project", async () => {
    const tenant: ObjectID = ObjectID.generate();

    await refuse({
      data: Object.assign(new Host(), { hostIdentifier: "web-01" }),
      props: { ...memberProps(), tenantId: tenant },
    });

    expect(lookups[0]!.query["projectId"]).toBe(tenant);
  });
});

/*
 * ---------------------------------------------------------------------------
 * Through each service's real create pipeline
 * ---------------------------------------------------------------------------
 */

describe.each(WIRINGS)(
  "$label - created through DatabaseService.create",
  (wiring: Wiring) => {
    let save: jest.Mock;
    let findOneBy: jest.SpyInstance;
    let existing: { identity: BaseModel | null; name: BaseModel | null };

    beforeEach(() => {
      silenceLogs();
      existing = { identity: null, name: null };

      save = jest.fn(async (entity: any) => {
        entity._id = ObjectID.generate().toString();
        return entity;
      });
      getJestSpyOn(wiring.service, "getRepository").mockReturnValue({
        save,
      } as never);
      getJestSpyOn(wiring.service, "countBy").mockResolvedValue(
        new PositiveNumber(0) as never,
      );
      findOneBy = getJestSpyOn(wiring.service, "findOneBy").mockImplementation(
        async (request: any): Promise<BaseModel | null> => {
          return request.query["name"] !== undefined
            ? existing.name
            : existing.identity;
        },
      );
      getJestSpyOn(wiring.service, "onTriggerWorkflow").mockResolvedValue(
        undefined as never,
      );
      getJestSpyOn(wiring.service, "onTriggerRealtime").mockResolvedValue(
        undefined as never,
      );
      // The rules, feed and owner writes that follow a create are not under test.
      getJestSpyOn(wiring.service, "onCreateSuccess").mockImplementation(
        async (_onCreate: unknown, item: unknown): Promise<unknown> => {
          return item;
        },
      );
      getJestSpyOn(wiring.service, "autoOwnerOnCreate").mockResolvedValue(
        undefined as never,
      );
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test("names a resource a person added without a name the way ingest would", async () => {
      const created: BaseModel = await wiring.service.create({
        data: makeModel(wiring),
        props: memberProps(),
      });

      expect(save).toHaveBeenCalledTimes(1);
      expect(read(created, "name")).toBe(wiring.defaultName);
      expect(read(created, wiring.identityColumn)).toBe(wiring.identity);
      // The slug is made from the name it was given.
      expect(read(created, "slug")).toBeTruthy();
    });

    test("names it the same when the name sent is blank", async () => {
      const created: BaseModel = await wiring.service.create({
        data: makeModel(wiring, { name: "  " }),
        props: memberProps(),
      });

      expect(read(created, "name")).toBe(wiring.defaultName);
    });

    test("keeps a display name the person gave it", async () => {
      const created: BaseModel = await wiring.service.create({
        data: makeModel(wiring, { name: " Production " }),
        props: memberProps(),
      });

      expect(read(created, "name")).toBe("Production");
      expect(read(created, wiring.identityColumn)).toBe(wiring.identity);
    });

    test("stores a person's identifier without the spaces around it", async () => {
      const created: BaseModel = await wiring.service.create({
        data: makeModel(wiring, {
          [wiring.identityColumn]: `  ${wiring.identity} `,
        }),
        props: memberProps(),
      });

      expect(read(created, wiring.identityColumn)).toBe(wiring.identity);
    });

    test("refuses a resource that is already there by its identifier", async () => {
      existing.identity = makeModel(wiring);
      existing.name = makeModel(wiring);

      await expect(
        wiring.service.create({
          data: makeModel(wiring),
          props: memberProps(),
        }),
      ).rejects.toThrow(new BadDataException(wiring.identityTakenMessage));

      expect(save).not.toHaveBeenCalled();
    });

    test("refuses a clash of names, saying to pick another display name", async () => {
      existing.name = makeModel(wiring);

      await expect(
        wiring.service.create({
          data: makeModel(wiring, { name: "Production" }),
          props: memberProps(),
        }),
      ).rejects.toThrow(
        new BadDataException(wiring.nameTakenMessage("Production")),
      );

      expect(save).not.toHaveBeenCalled();
    });

    test("refuses a caller who may not add one before looking anything up", async () => {
      existing.identity = makeModel(wiring);

      await expect(
        wiring.service.create({
          data: makeModel(wiring),
          props: memberProps([Permission.Viewer]),
        }),
      ).rejects.toThrow(NotAuthorizedException);

      expect(findOneBy).not.toHaveBeenCalled();
      expect(save).not.toHaveBeenCalled();
    });

    test("still refuses a create with nothing to name it after", async () => {
      const data: BaseModel = makeModel(wiring, {
        [wiring.identityColumn]: undefined,
        cloudPlatform: undefined,
      });

      await expect(
        wiring.service.create({ data, props: memberProps() }),
      ).rejects.toThrow(/is required/);

      expect(save).not.toHaveBeenCalled();
    });

    test("leaves ingest's (root) create as it came, with no lookups", async () => {
      const created: BaseModel = await wiring.service.create({
        data: makeModel(wiring, { name: wiring.defaultName }),
        props: ROOT,
      });

      expect(read(created, "name")).toBe(wiring.defaultName);
      expect(findOneBy).not.toHaveBeenCalled();
      expect(save).toHaveBeenCalledTimes(1);
    });

    test("names a root create that came without a name, too", async () => {
      const created: BaseModel = await wiring.service.create({
        data: makeModel(wiring),
        props: ROOT,
      });

      expect(read(created, "name")).toBe(wiring.defaultName);
    });
  },
);

/*
 * ---------------------------------------------------------------------------
 * The hook in DatabaseService.create
 * ---------------------------------------------------------------------------
 */

describe("DatabaseService.onBeforeCreateUniqueCheck", () => {
  const service: any = HostService;

  beforeEach(() => {
    silenceLogs();
    getJestSpyOn(service, "getRepository").mockReturnValue({
      save: jest.fn(async (entity: any) => {
        entity._id = ObjectID.generate().toString();
        return entity;
      }),
    } as never);
    getJestSpyOn(service, "countBy").mockResolvedValue(
      new PositiveNumber(0) as never,
    );
    getJestSpyOn(service, "findOneBy").mockResolvedValue(null as never);
    getJestSpyOn(service, "onTriggerWorkflow").mockResolvedValue(
      undefined as never,
    );
    getJestSpyOn(service, "onTriggerRealtime").mockResolvedValue(
      undefined as never,
    );
    getJestSpyOn(service, "onCreateSuccess").mockImplementation(
      async (_onCreate: unknown, item: unknown): Promise<unknown> => {
        return item;
      },
    );
    getJestSpyOn(service, "autoOwnerOnCreate").mockResolvedValue(
      undefined as never,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("runs after the permission checks and before the generic unique checks", async () => {
    const permission: jest.SpyInstance = jest.spyOn(
      ModelPermission,
      "checkCreatePermissions",
    );
    const hook: jest.SpyInstance = getJestSpyOn(
      service,
      "onBeforeCreateUniqueCheck",
    );
    const uniqueCheck: jest.SpyInstance = getJestSpyOn(
      service,
      "checkUniqueColumnBy",
    );

    await service.create({
      data: Object.assign(new Host(), {
        projectId: PROJECT_ID,
        hostIdentifier: "web-01",
      }),
      props: memberProps(),
    });

    expect(hook).toHaveBeenCalledTimes(1);
    expect(permission.mock.invocationCallOrder[0]!).toBeLessThan(
      hook.mock.invocationCallOrder[0]!,
    );
    expect(hook.mock.invocationCallOrder[0]!).toBeLessThan(
      uniqueCheck.mock.invocationCallOrder[0]!,
    );
  });

  test("is skipped with the other hooks when a create ignores them", async () => {
    const hook: jest.SpyInstance = getJestSpyOn(
      service,
      "onBeforeCreateUniqueCheck",
    );

    await service.create({
      data: Object.assign(new Host(), {
        projectId: PROJECT_ID,
        name: "web-01",
        hostIdentifier: "web-01",
      }),
      props: { isRoot: true, ignoreHooks: true },
    });

    expect(hook).not.toHaveBeenCalled();
  });

  test("does nothing in a service that does not override it", async () => {
    expect(
      (LabelService as any).onBeforeCreateUniqueCheck ===
        (DatabaseService.prototype as any).onBeforeCreateUniqueCheck,
    ).toBe(true);

    await expect(
      (DatabaseService.prototype as any).onBeforeCreateUniqueCheck.call(
        LabelService,
        { data: {}, props: memberProps() },
      ),
    ).resolves.toBeUndefined();
  });
});
