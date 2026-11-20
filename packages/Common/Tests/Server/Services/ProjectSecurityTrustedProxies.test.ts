import ProjectService from "../../../Server/Services/ProjectService";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import ColumnPermissions from "../../../Server/Types/Database/Permissions/ColumnPermission";
import TablePermission from "../../../Server/Types/Database/Permissions/TablePermission";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import SecurityEdgeRanges, {
  CLOUDFLARE_EDGE,
} from "../../../Server/Utils/SecurityBlocklist/SecurityEdgeRanges";
import SecurityTrustedProxies, {
  TRUSTED_PROXIES_CACHE_TTL_MS,
} from "../../../Server/Utils/SecurityEvent/SecurityTrustedProxies";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Project from "../../../Models/DatabaseModels/Project";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import TableColumnType from "../../../Types/Database/TableColumnType";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import {
  ClientAddressReading,
  ClientAddressTrust,
  MAX_TRUSTED_PROXIES,
  TrustedProxies,
  isTrustedProxy,
  resolveClientAddress,
} from "../../../Utils/SecurityEvent/ClientAddressTrust";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * ISSUE #10416: the proxies a project's apps sit behind, so Security Events
 * trusts the client address they forward - Project.securityTrustedProxies,
 * one IP address or range a line, set where the project's other settings
 * are set (a Project Owner or Admin), and read by the scans once a minute
 * (SecurityTrustedProxies). What is saved is an address or a range, kept
 * one way; anything else is refused with the reason, never read later as
 * no proxy.
 */

const COLUMN: string = "securityTrustedProxies";

const PROJECT_ID: ObjectID = new ObjectID(
  "e5000000-0000-4000-8000-000000010416",
);

function permissionRow(permission: Permission): UserPermission {
  return {
    _type: "UserPermission",
    permission,
    labelIds: [],
    isBlockPermission: false,
  };
}

function propsWith(
  ...permissions: Array<Permission>
): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: permissions.map(permissionRow),
  };

  return {
    userId: ObjectID.generate(),
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: tenantPermission,
    },
  } as DatabaseCommonInteractionProps;
}

function mayWrite(
  data: Record<string, unknown>,
  ...permissions: Array<Permission>
): boolean {
  const props: DatabaseCommonInteractionProps = propsWith(...permissions);

  try {
    TablePermission.checkTableLevelPermissions(
      Project,
      props,
      DatabaseRequestType.Update,
    );
    ColumnPermissions.checkDataColumnPermissions(
      Project,
      data as unknown as BaseModel,
      props,
      DatabaseRequestType.Update,
    );
    return true;
  } catch {
    return false;
  }
}

interface ProjectHookAccess {
  onBeforeUpdate(updateBy: UpdateBy<Project>): Promise<OnUpdate<Project>>;
}

const hooks: ProjectHookAccess = ProjectService as unknown as ProjectHookAccess;

afterEach(() => {
  jest.restoreAllMocks();
  SecurityTrustedProxies.clearCache();
  SecurityEdgeRanges.setFetchForTests(null);
});

describe("Project.securityTrustedProxies: the column", () => {
  const project: Project = new Project();

  it("is optional very long text, titled and described for the API reference", () => {
    const metadata: {
      type: TableColumnType;
      required?: boolean;
      title?: string;
      description?: string;
    } = project.getTableColumnMetadata(COLUMN) as unknown as {
      type: TableColumnType;
      required?: boolean;
      title?: string;
      description?: string;
    };

    expect(metadata.type).toBe(TableColumnType.VeryLongText);
    expect(metadata.required).toBe(false);
    expect(metadata.title).toBe("Security Trusted Proxies");
    expect(metadata.description).toContain("X-Forwarded-For");
  });

  it("is read and written as the project's other Security Events settings are", () => {
    expect(project.getColumnAccessControlFor(COLUMN)).toEqual(
      project.getColumnAccessControlFor("securityRiskCaseThreshold"),
    );
  });

  it.each([Permission.ProjectOwner, Permission.ProjectAdmin])(
    "the column layer lets %s write it",
    (permission: Permission) => {
      expect(mayWrite({ [COLUMN]: "203.0.113.0/24" }, permission)).toBe(true);
    },
  );

  it.each([
    Permission.ProjectMember,
    Permission.EditProject,
    Permission.Viewer,
    Permission.ReadProject,
    Permission.SecurityMember,
    Permission.SecurityViewer,
  ])("and refuses %s", (permission: Permission) => {
    expect(mayWrite({ [COLUMN]: "203.0.113.0/24" }, permission)).toBe(false);
  });

  it("starts unset on a new project: only private addresses are trusted", () => {
    expect(new Project().securityTrustedProxies).toBeUndefined();
  });
});

describe("ProjectService.applySecurityTrustedProxyRules: what a project may store", () => {
  it("keeps each address and range one way, once, a line each", () => {
    const data: { securityTrustedProxies?: unknown } = {
      securityTrustedProxies:
        " 203.0.113.50\r\n198.51.100.35/24, 2001:DB8:1::/48\n203.0.113.50 ",
    };

    ProjectService.applySecurityTrustedProxyRules(data);

    expect(data.securityTrustedProxies).toBe(
      "203.0.113.50\n198.51.100.0/24\n2001:db8:1::/48",
    );
  });

  it("stores a blank list as none", () => {
    for (const blank of ["", "  \n\t ", ",,"]) {
      const data: { securityTrustedProxies?: unknown } = {
        securityTrustedProxies: blank,
      };

      ProjectService.applySecurityTrustedProxyRules(data);

      expect(data.securityTrustedProxies).toBeNull();
    }

    const cleared: { securityTrustedProxies?: unknown } = {
      securityTrustedProxies: null,
    };
    ProjectService.applySecurityTrustedProxyRules(cleared);
    expect(cleared.securityTrustedProxies).toBeNull();
  });

  it("a write that leaves it out is not judged on it, and does not gain it", () => {
    const data: Record<string, unknown> = { name: "Renamed" };

    ProjectService.applySecurityTrustedProxyRules(data);

    expect(data).toEqual({ name: "Renamed" });
  });

  it("refuses what is no address or range, with the reason", () => {
    expect(() => {
      ProjectService.applySecurityTrustedProxyRules({
        securityTrustedProxies: "203.0.113.0/24\ncloudflare",
      });
    }).toThrow(
      new BadDataException(
        '"cloudflare" is not an IP address or a range. Write an address, such as 203.0.113.7, or a range, such as 203.0.113.0/24.',
      ),
    );

    for (const value of [42, true, ["203.0.113.7"], { proxy: "203.0.113.7" }]) {
      expect(() => {
        ProjectService.applySecurityTrustedProxyRules({
          securityTrustedProxies: value,
        });
      }).toThrow(BadDataException);
    }
  });

  it("refuses more proxies than a project may trust", () => {
    const many: Array<string> = [];

    for (let index: number = 0; index <= MAX_TRUSTED_PROXIES; index++) {
      many.push(`10.${Math.floor(index / 256)}.${index % 256}.1`);
    }

    expect(() => {
      ProjectService.applySecurityTrustedProxyRules({
        securityTrustedProxies: many.join("\n"),
      });
    }).toThrow(BadDataException);
  });

  it("runs on every update of the project, before anything is read", async () => {
    const find: SpyInstance<typeof ProjectService.findBy> = jest.spyOn(
      ProjectService,
      "findBy",
    );

    await expect(
      hooks.onBeforeUpdate({
        query: { _id: PROJECT_ID.toString() },
        data: { securityTrustedProxies: "not an address" },
        props: { isRoot: true },
      } as unknown as UpdateBy<Project>),
    ).rejects.toThrow(BadDataException);
    expect(find).not.toHaveBeenCalled();

    const result: OnUpdate<Project> = await hooks.onBeforeUpdate({
      query: { _id: PROJECT_ID.toString() },
      data: { securityTrustedProxies: "198.51.100.35/24" },
      props: { isRoot: true },
    } as unknown as UpdateBy<Project>);

    expect((result.updateBy.data as Record<string, unknown>)[COLUMN]).toBe(
      "198.51.100.0/24",
    );
  });
});

describe("SecurityTrustedProxies: what the scans read", () => {
  it("reads the project's list, as OneUptime, and keeps it a minute", async () => {
    const project: Project = new Project();
    project.securityTrustedProxies = "198.51.100.0/24\n203.0.113.50";

    const findOne: SpyInstance<typeof ProjectService.findOneById> = jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(project);

    const proxies: TrustedProxies =
      await SecurityTrustedProxies.getForProject(PROJECT_ID);

    expect(isTrustedProxy("198.51.100.200", proxies)).toBe(true);
    expect(isTrustedProxy("203.0.113.50", proxies)).toBe(true);
    expect(isTrustedProxy("203.0.113.51", proxies)).toBe(false);
    expect(findOne).toHaveBeenCalledWith({
      id: PROJECT_ID,
      select: { securityTrustedProxies: true },
      props: { isRoot: true },
    });

    await SecurityTrustedProxies.getForProject(PROJECT_ID);
    expect(findOne).toHaveBeenCalledTimes(1);
    expect(TRUSTED_PROXIES_CACHE_TTL_MS).toBe(60 * 1000);
  });

  it("a project with none trusts only private addresses", async () => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue(new Project());

    const proxies: TrustedProxies =
      await SecurityTrustedProxies.getForProject(PROJECT_ID);

    expect(proxies.blocks).toEqual([]);
    expect(isTrustedProxy("10.0.0.5", proxies)).toBe(true);
    expect(isTrustedProxy("203.0.113.7", proxies)).toBe(false);
  });

  it("a read that fails trusts less, never more, and is read again next time", async () => {
    const findOne: SpyInstance<typeof ProjectService.findOneById> = jest
      .spyOn(ProjectService, "findOneById")
      .mockRejectedValueOnce(new Error("database is down"));

    const proxies: TrustedProxies =
      await SecurityTrustedProxies.getForProject(PROJECT_ID);

    expect(proxies.blocks).toEqual([]);

    const project: Project = new Project();
    project.securityTrustedProxies = "203.0.113.50";
    findOne.mockResolvedValueOnce(project);

    expect(
      isTrustedProxy(
        "203.0.113.50",
        await SecurityTrustedProxies.getForProject(PROJECT_ID),
      ),
    ).toBe(true);
    expect(findOne).toHaveBeenCalledTimes(2);
  });

  it("trusts the published ranges of an edge the project has connected, so the client it forwards is verified", async () => {
    const project: Project = new Project();
    project.securityTrustedProxies = "198.51.100.0/24";
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue(project);

    const edges: SpyInstance<typeof SecurityEdgeRanges.findConnectedEdges> =
      jest
        .spyOn(SecurityEdgeRanges, "findConnectedEdges")
        .mockResolvedValue([CLOUDFLARE_EDGE]);

    SecurityEdgeRanges.setFetchForTests(
      async (url: string): Promise<string> => {
        return url.endsWith("v6")
          ? "2606:4700::/32\n"
          : "104.16.0.0/13\n172.64.0.0/13\n";
      },
    );

    const proxies: TrustedProxies =
      await SecurityTrustedProxies.getForProject(PROJECT_ID);

    expect(edges).toHaveBeenCalledWith(PROJECT_ID);
    expect(isTrustedProxy("104.16.1.1", proxies)).toBe(true);
    expect(isTrustedProxy("2606:4700::6810:84e5", proxies)).toBe(true);
    // Its own list still counts.
    expect(isTrustedProxy("198.51.100.7", proxies)).toBe(true);
    expect(isTrustedProxy("203.0.113.7", proxies)).toBe(false);

    /*
     * A connected Cloudflare edge as the peer, with its forwarded address:
     * the client Cloudflare added is verified; what the sender wrote is
     * only claimed.
     */
    const reading: ClientAddressReading = resolveClientAddress(
      {
        peer: "104.16.1.1",
        forwardedClient: "192.0.2.44",
        forwardedClientFrom: "client.address",
        forwardedFor: "192.0.2.44, 203.0.113.7",
      },
      proxies,
    );

    expect(reading.address).toBe("203.0.113.7");
    expect(reading.trust).toBe(ClientAddressTrust.TrustedProxy);
    expect(reading.claimed?.address).toBe("192.0.2.44");
  });

  it("an edge the project has not connected is not trusted: its address is the one that connected", async () => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue(new Project());
    jest.spyOn(SecurityEdgeRanges, "findConnectedEdges").mockResolvedValue([]);

    const proxies: TrustedProxies =
      await SecurityTrustedProxies.getForProject(PROJECT_ID);
    const reading: ClientAddressReading = resolveClientAddress(
      { peer: "104.16.1.1", forwardedFor: "192.0.2.44, 203.0.113.7" },
      proxies,
    );

    expect(isTrustedProxy("104.16.1.1", proxies)).toBe(false);
    expect(reading.address).toBe("104.16.1.1");
    expect(reading.trust).toBe(ClientAddressTrust.Peer);
  });

  it("edges that cannot be read leave the project's own list trusted, and are read again next time", async () => {
    const project: Project = new Project();
    project.securityTrustedProxies = "198.51.100.0/24";

    const findOne: SpyInstance<typeof ProjectService.findOneById> = jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(project);
    const edges: SpyInstance<typeof SecurityEdgeRanges.findConnectedEdges> =
      jest
        .spyOn(SecurityEdgeRanges, "findConnectedEdges")
        .mockRejectedValueOnce(new Error("database is down"))
        .mockResolvedValueOnce([]);

    const proxies: TrustedProxies =
      await SecurityTrustedProxies.getForProject(PROJECT_ID);

    expect(isTrustedProxy("198.51.100.7", proxies)).toBe(true);
    expect(isTrustedProxy("104.16.1.1", proxies)).toBe(false);

    await SecurityTrustedProxies.getForProject(PROJECT_ID);

    expect(edges).toHaveBeenCalledTimes(2);
    expect(findOne).toHaveBeenCalledTimes(2);
  });
});
