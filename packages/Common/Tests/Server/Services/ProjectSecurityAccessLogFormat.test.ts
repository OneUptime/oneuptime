import ProjectService from "../../../Server/Services/ProjectService";
import CloudResourceService from "../../../Server/Services/CloudResourceService";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import ColumnPermissions from "../../../Server/Types/Database/Permissions/ColumnPermission";
import TablePermission from "../../../Server/Types/Database/Permissions/TablePermission";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import logger from "../../../Server/Utils/Logger";
import SecurityEdgeRanges from "../../../Server/Utils/SecurityBlocklist/SecurityEdgeRanges";
import SecurityTrustedProxies, {
  TrustedProxySourcesRead,
} from "../../../Server/Utils/SecurityEvent/SecurityTrustedProxies";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Project from "../../../Models/DatabaseModels/Project";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import {
  KNOWN_ACCESS_LOG_FORMATS,
  MAX_ACCESS_LOG_FORMAT_LENGTH,
} from "../../../Utils/SecurityEvent/LogParsers/AccessLogFormat";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

/*
 * #11048: Project.securityAccessLogFormat, the nginx log_format a
 * project's access logs are written in. Set beside the Access Logs switch,
 * by the same people (a Project Owner, a Project Admin or a Security
 * Admin); kept as given, and refused with why when OneUptime cannot read a
 * line by it, never stored and read later as no format; read by the scans
 * with the project's other trusted-proxy settings.
 */

const COLUMN: string = "securityAccessLogFormat";

const PROJECT_ID: ObjectID = new ObjectID(
  "11048000-0000-4000-8000-000000000001",
);

const NGINX_MAIN: string = KNOWN_ACCESS_LOG_FORMATS[0]!.text;

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
    permissions: [Permission.ProjectUser, ...permissions].map(permissionRow),
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

beforeEach(() => {
  for (const silenced of ["debug", "info", "warn", "error"]) {
    getJestSpyOn(logger, silenced).mockImplementation((): void => {
      return undefined;
    });
  }
});

afterEach(() => {
  SecurityTrustedProxies.clearCache();
  jest.restoreAllMocks();
});

describe("the column", () => {
  it("is set as the Access Logs switch beside it is, and read by every role that reads the project", () => {
    expect(new Project().getColumnAccessControlFor(COLUMN)).toEqual(
      new Project().getColumnAccessControlFor(
        "securityReadAccessLogForwardedFor",
      ),
    );
  });

  it.each([
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.SecurityAdmin,
  ])("%s may set it, and clear it", (permission: Permission) => {
    expect(mayWrite({ [COLUMN]: NGINX_MAIN }, permission)).toBe(true);
    expect(mayWrite({ [COLUMN]: null }, permission)).toBe(true);
  });

  it.each([
    Permission.SecurityMember,
    Permission.SecurityViewer,
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.ReadProject,
    Permission.EditProject,
    Permission.ManageProjectBilling,
    Permission.BillingAdmin,
  ])("%s may not", (permission: Permission) => {
    expect(mayWrite({ [COLUMN]: NGINX_MAIN }, permission)).toBe(false);
  });

  it("a Security Admin reaches nothing else of the project through it", () => {
    for (const other of [
      { name: "Renamed" },
      { enableAi: false },
      { securityRiskCaseThreshold: 10 },
    ]) {
      expect(
        mayWrite({ ...other, [COLUMN]: NGINX_MAIN }, Permission.SecurityAdmin),
      ).toBe(false);
    }
  });

  it("starts unset: lines are read as the combined format", () => {
    expect(new Project().securityAccessLogFormat).toBeUndefined();
  });
});

describe("ProjectService.applySecurityAccessLogFormatRules: what a project may keep", () => {
  function apply(value: unknown): { securityAccessLogFormat?: unknown } {
    const data: { securityAccessLogFormat?: unknown } = {
      securityAccessLogFormat: value,
    };

    ProjectService.applySecurityAccessLogFormatRules(data);

    return data;
  }

  it("a format it reads lines by, kept as given, the spaces around it dropped", () => {
    expect(apply(`\n  ${NGINX_MAIN}  \n`).securityAccessLogFormat).toBe(
      NGINX_MAIN,
    );
  });

  it("every known format", () => {
    for (const known of KNOWN_ACCESS_LOG_FORMATS) {
      expect(apply(known.text).securityAccessLogFormat).toBe(known.text);
    }
  });

  it("a blank one is none", () => {
    expect(apply("   ").securityAccessLogFormat).toBeNull();
  });

  it("a write that leaves it out, or clears it, is not judged on it", () => {
    expect(apply(undefined).securityAccessLogFormat).toBeUndefined();
    expect(apply(null).securityAccessLogFormat).toBeNull();
  });

  it.each([
    [
      "no text",
      42,
      "Your access log format must be text: an nginx log_format.",
    ],
    [
      "no field",
      "combined",
      "This is no nginx log format: it names no field, such as $remote_addr.",
    ],
    [
      "no address that connected",
      '"$request" "$http_x_forwarded_for"',
      "Your log format must log the address that connected, $remote_addr, so OneUptime can tell whether it was a proxy you trust.",
    ],
    [
      "an X-Forwarded-For whose end cannot be told",
      '$remote_addr "$request" $http_user_agent $http_x_forwarded_for $http_referer',
      'OneUptime can\'t tell where $http_x_forwarded_for ends in your log format. Put it in quotes, as "$http_x_forwarded_for".',
    ],
    [
      "a quote that never closes",
      "log_format main '$remote_addr",
      "A quote in your log format never closes. Paste it as your nginx.conf writes it.",
    ],
    [
      "too long",
      `$remote_addr ${"x".repeat(MAX_ACCESS_LOG_FORMAT_LENGTH)}`,
      `Your log format is too long. OneUptime reads one of up to ${MAX_ACCESS_LOG_FORMAT_LENGTH} characters.`,
    ],
  ])(
    "refuses %s, with why",
    (_what: string, value: unknown, message: string) => {
      let thrown: unknown = null;

      try {
        apply(value);
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(BadDataException);
      expect((thrown as Error).message).toBe(message);
    },
  );

  it("runs on every update of the project, before anything is read", async () => {
    const find: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      ProjectService,
      "findBy",
    );

    await expect(
      hooks.onBeforeUpdate({
        query: { _id: PROJECT_ID.toString() },
        data: { securityAccessLogFormat: "combined" },
        props: { isRoot: true },
      } as unknown as UpdateBy<Project>),
    ).rejects.toThrow(
      "This is no nginx log format: it names no field, such as $remote_addr.",
    );
    expect(find).not.toHaveBeenCalled();
  });
});

describe("what the scans read", () => {
  function useProject(columns: Partial<Project>): void {
    const project: Project = new Project();
    Object.assign(project, columns);

    getJestSpyOn(ProjectService, "findOneById").mockResolvedValue(
      project as never,
    );
    getJestSpyOn(SecurityEdgeRanges, "findConnectedEdges").mockResolvedValue(
      [] as never,
    );
    getJestSpyOn(CloudResourceService, "findBy").mockResolvedValue([] as never);
  }

  it("the project's format, read, beside its other settings", async () => {
    useProject({ securityAccessLogFormat: NGINX_MAIN });

    const read: TrustedProxySourcesRead | null =
      await SecurityTrustedProxies.readSources(PROJECT_ID);

    expect(read?.sources.accessLogFormat?.readsForwardedFor).toBe(true);
    expect(
      (await SecurityTrustedProxies.getForProject(PROJECT_ID)).accessLogFormat
        ?.pattern,
    ).toBe(read?.sources.accessLogFormat?.pattern);
  });

  it("none given, or one no longer read: none", async () => {
    for (const securityAccessLogFormat of [undefined, "", "combined"]) {
      SecurityTrustedProxies.clearCache();
      useProject({ securityAccessLogFormat } as Partial<Project>);

      expect(
        (await SecurityTrustedProxies.readSources(PROJECT_ID))?.sources
          .accessLogFormat,
      ).toBeNull();
    }
  });
});
