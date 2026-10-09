import ResourceAiAccessSettings, {
  NEVER_CONFIGURED_RESOURCE_AI_ACCESS,
  RESOURCE_AI_ACCESS_SERVER_ONLY_KEYS,
  RESOURCE_AI_ACCESS_SETTING_KEYS,
  RESOURCE_REMEDIATION_MODES_BY_AUTONOMY,
  ResourceAiAccessFeedItem,
  ResourceAiAccessSettingsSnapshot,
  ResourceAiAccessWriteCarryForward,
} from "../../../../../Server/Utils/AI/ResourceAccess/ResourceAiAccessSettings";
import DatabaseService from "../../../../../Server/Services/DatabaseService";
import ResourceAiAgentService from "../../../../../Server/Services/ResourceAiAgentService";
import UserService from "../../../../../Server/Services/UserService";
import { OnUpdate } from "../../../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../../../Server/Types/Database/UpdateBy";
import logger from "../../../../../Server/Utils/Logger";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import CephCluster from "../../../../../Models/DatabaseModels/CephCluster";
import DatabaseServer from "../../../../../Models/DatabaseModels/DatabaseServer";
import DockerHost from "../../../../../Models/DatabaseModels/DockerHost";
import DockerSwarmCluster from "../../../../../Models/DatabaseModels/DockerSwarmCluster";
import Host from "../../../../../Models/DatabaseModels/Host";
import PodmanHost from "../../../../../Models/DatabaseModels/PodmanHost";
import ProxmoxCluster from "../../../../../Models/DatabaseModels/ProxmoxCluster";
import VMwareVCenter from "../../../../../Models/DatabaseModels/VMwareVCenter";
import {
  RESOURCE_AI_ACCESS_ADMIN_PERMISSIONS,
  RESOURCE_AI_ALLOWLIST_EXAMPLES,
  RESOURCE_AI_REMEDIATION_MODE_LABELS,
  getResourceAgentName,
  getResourceAiAccessAdminRefusal,
  getResourceAiAgentResetRefusal,
  getResourceSentenceName,
} from "../../../../../Types/AI/ResourceAiAccessPermissions";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { Gray500, Yellow500 } from "../../../../../Types/BrandColors";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../../../Types/JSON";
import { KUBERNETES_AI_ACCESS_ADMIN_PERMISSIONS } from "../../../../../Types/Kubernetes/KubernetesClusterAiAccessPermissions";
import { KubernetesAiRemediationMode } from "../../../../../Types/Kubernetes/KubernetesClusterAiAccess";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../../../Types/Permission";
import AiResourceType, {
  ALL_AI_RESOURCE_TYPES,
} from "../../../../../Types/ResourceAiAgent/AiResourceType";
import {
  ResourceAiRemediationMode,
  ResourceCommandTier,
} from "../../../../../Types/ResourceAiAgent/ResourceAiAccess";
import ResourceCommandPolicy, {
  RESOURCE_ALLOWLIST_MAX_PATTERNS,
} from "../../../../../Utils/AiRemediation/Resource/ResourceCommandPolicy";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

import FeedMarkdown, {
  MarkdownText,
} from "../../../../../Utils/Markdown/FeedMarkdown";
/*
 * The rules every resource AI agent's resource applies to an operator's
 * write of its AI access settings (ResourceAiAccessSettings), pure and
 * through a stand-in service: validation, who may make AI do more, the
 * server-only columns, the configured marker and the feed item. The
 * services' own wiring is pinned in
 * Tests/Server/Services/ResourceAiSettingsPermission.test.ts.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);
const RESOURCE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const OTHER_RESOURCE_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);

function permissionRow(
  permission: Permission,
  isBlockPermission: boolean = false,
): UserPermission {
  return {
    _type: "UserPermission",
    permission,
    labelIds: [],
    isBlockPermission,
  };
}

function userProps(
  rows: Array<UserPermission>,
  options: {
    tenantId?: ObjectID | null;
    permissionProjectId?: ObjectID;
  } = {},
): DatabaseCommonInteractionProps {
  const tenantId: ObjectID | null =
    options.tenantId === undefined ? PROJECT_ID : options.tenantId;
  const permissionProjectId: ObjectID =
    options.permissionProjectId || tenantId || PROJECT_ID;

  const tenantPermission: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: permissionProjectId,
    permissions: rows,
  };

  return {
    userId: ObjectID.generate(),
    ...(tenantId ? { tenantId } : {}),
    userTenantAccessPermission: {
      [permissionProjectId.toString()]: tenantPermission,
    },
  } as DatabaseCommonInteractionProps;
}

function propsWith(
  ...permissions: Array<Permission>
): DatabaseCommonInteractionProps {
  return userProps(
    permissions.map((permission: Permission) => {
      return permissionRow(permission);
    }),
  );
}

function snapshot(
  overrides: Partial<ResourceAiAccessSettingsSnapshot> = {},
): ResourceAiAccessSettingsSnapshot {
  return {
    projectId: PROJECT_ID,
    isAiInvestigationEnabled: false,
    aiRemediationMode: ResourceAiRemediationMode.Disabled,
    aiCommandAllowlist: [],
    ...overrides,
  };
}

/*
 * A stand-in for a resource's DatabaseService: the settings read, the
 * marker write and the project lookup are all the helper asks of it. The
 * settings of the rows an update writes are read - and the update held to
 * them - by findRowsAndHoldUpdateToThem (DatabaseService's own is pinned by
 * DatabaseServiceRowsAnUpdateWrites.test.ts); here it answers with what the
 * rows read answers.
 */
interface FakeService {
  findBy: jest.Mock;
  findRowsAndHoldUpdateToThem: jest.Mock;
  findOneById: jest.Mock;
  updateBy: jest.Mock;
}

function fakeService(rows: Array<Record<string, unknown>> = []): FakeService {
  const findBy: jest.Mock = jest.fn().mockResolvedValue(rows);

  return {
    findBy: findBy,
    findRowsAndHoldUpdateToThem: jest
      .fn()
      .mockImplementation(
        async (
          heldUpdate: UpdateBy<BaseModel>,
          select: Record<string, unknown>,
        ): Promise<unknown> => {
          return await findBy({ query: heldUpdate.query, select: select });
        },
      ),
    findOneById: jest.fn().mockResolvedValue({ projectId: PROJECT_ID }),
    updateBy: jest.fn().mockResolvedValue(1),
  };
}

function asService(service: FakeService): DatabaseService<BaseModel> {
  return service as unknown as DatabaseService<BaseModel>;
}

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: RESOURCE_ID,
    _id: RESOURCE_ID.toString(),
    projectId: PROJECT_ID,
    isAiInvestigationEnabled: false,
    aiRemediationMode: ResourceAiRemediationMode.Disabled,
    aiCommandAllowlist: null,
    ...overrides,
  };
}

function updateBy(
  data: Record<string, unknown>,
  props: DatabaseCommonInteractionProps,
): UpdateBy<BaseModel> {
  return {
    query: { _id: RESOURCE_ID.toString() },
    data,
    limit: 1,
    skip: 0,
    props,
  } as unknown as UpdateBy<BaseModel>;
}

// Roles that may edit a resource but may not author a FullAuto rule.
const EDITOR_ROLES: Array<Permission> = [
  Permission.SettingsMember,
  Permission.SettingsAdmin,
  Permission.ProjectMember,
  Permission.EditDockerHost,
];

describe("ResourceAiAccessPermissions", () => {
  it("takes exactly the Kubernetes cluster's admin set, so the two can never drift apart", () => {
    expect([...RESOURCE_AI_ACCESS_ADMIN_PERMISSIONS].sort()).toEqual(
      [...KUBERNETES_AI_ACCESS_ADMIN_PERMISSIONS].sort(),
    );
    expect(RESOURCE_AI_ACCESS_ADMIN_PERMISSIONS).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditAutoRemediationRule,
    ]);
  });

  it("names the permissions and what stays open, with the resource named in the sentence", () => {
    expect(getResourceAiAccessAdminRefusal(AiResourceType.DockerHost)).toBe(
      "You need one of these permissions to let OneUptime AI do more on a Docker host (turn AI fixes on or give them more autonomy, or add command allowlist patterns): Project Owner, Project Admin, Edit Auto Remediation Rule. Anyone who may edit the Docker host can still turn AI fixes off or down to Ask for approval, and remove allowlist patterns.",
    );
    expect(
      getResourceAiAccessAdminRefusal(AiResourceType.DatabaseServer),
    ).toContain("do more on a database server");
    expect(getResourceAiAccessAdminRefusal(AiResourceType.Host)).toContain(
      "Anyone who may edit the host can",
    );
    expect(getResourceAiAgentResetRefusal(AiResourceType.CephCluster)).toBe(
      "You need one of these permissions to reset this Ceph cluster's Ceph AI agent: Project Owner, Project Admin, Edit Auto Remediation Rule.",
    );
  });

  it.each(ALL_AI_RESOURCE_TYPES)(
    "has a sentence name, an agent name and a valid allowlist example for %s",
    (resourceType: AiResourceType) => {
      expect(getResourceSentenceName(resourceType)).toMatch(/^[A-Za-z]/);
      expect(getResourceAgentName(resourceType)).toMatch(/AI agent$/);

      const example: string = RESOURCE_AI_ALLOWLIST_EXAMPLES[resourceType];
      expect(
        ResourceCommandPolicy.describeAllowlistPatternProblem({
          resourceType,
          pattern: example,
        }),
      ).toBeNull();
      // An example worth allowlisting: a change that would otherwise ask.
      expect(
        ResourceCommandPolicy.evaluateCommand({
          resourceType,
          command: example,
        }).tier,
      ).toBe(ResourceCommandTier.RiskyWrite);
    },
  );

  it("labels every mode the way a Kubernetes cluster's AI page does", () => {
    expect(RESOURCE_AI_REMEDIATION_MODE_LABELS).toEqual({
      [ResourceAiRemediationMode.Disabled]: "Off",
      [ResourceAiRemediationMode.RequireApproval]: "Ask for approval",
      [ResourceAiRemediationMode.Automatic]: "Automatic",
      [ResourceAiRemediationMode.BypassApproval]: "Bypass approval",
    });
  });
});

describe("ResourceAiAccessSettings constants", () => {
  it("covers the three operator settings and the three server-only columns", () => {
    expect([...RESOURCE_AI_ACCESS_SETTING_KEYS]).toEqual([
      "isAiInvestigationEnabled",
      "aiRemediationMode",
      "aiCommandAllowlist",
    ]);
    expect([...RESOURCE_AI_ACCESS_SERVER_ONLY_KEYS]).toEqual([
      "aiAccessConfiguredAt",
      "aiAccessLastVerifiedAt",
      "aiAccessLastError",
    ]);
  });

  it("orders the modes by autonomy with the Kubernetes values", () => {
    expect([...RESOURCE_REMEDIATION_MODES_BY_AUTONOMY]).toEqual([
      KubernetesAiRemediationMode.Disabled,
      KubernetesAiRemediationMode.RequireApproval,
      KubernetesAiRemediationMode.Automatic,
      KubernetesAiRemediationMode.BypassApproval,
    ]);
  });

  it("starts a never-configured resource from the column defaults: investigation on, fixes Off", () => {
    expect(NEVER_CONFIGURED_RESOURCE_AI_ACCESS).toEqual({
      isAiInvestigationEnabled: true,
      aiRemediationMode: ResourceAiRemediationMode.Disabled,
      aiCommandAllowlist: [],
    });
  });

  /*
   * The snapshot IS the column defaults: it is the "before" a first write
   * is judged and recorded against, so it must move with them.
   */
  it.each([
    ["DockerHost", DockerHost],
    ["PodmanHost", PodmanHost],
    ["DockerSwarmCluster", DockerSwarmCluster],
    ["ProxmoxCluster", ProxmoxCluster],
    ["VMwareVCenter", VMwareVCenter],
    ["CephCluster", CephCluster],
    ["DatabaseServer", DatabaseServer],
    ["Host", Host],
  ])(
    "matches %s's column defaults",
    (_name: string, model: { new (): BaseModel }) => {
      const instance: BaseModel = new model();

      expect(
        instance.getTableColumnMetadata("isAiInvestigationEnabled")
          .defaultValue,
      ).toBe(NEVER_CONFIGURED_RESOURCE_AI_ACCESS.isAiInvestigationEnabled);
      expect(
        instance.getTableColumnMetadata("aiRemediationMode").defaultValue,
      ).toBe(NEVER_CONFIGURED_RESOURCE_AI_ACCESS.aiRemediationMode);
    },
  );
});

describe("ResourceAiAccessSettings.validateSettings", () => {
  function validate(
    data: Record<string, unknown>,
    resourceType: AiResourceType = AiResourceType.DockerHost,
  ): JSONObject {
    const copy: JSONObject = { ...data } as JSONObject;
    ResourceAiAccessSettings.validateSettings({ resourceType, data: copy });
    return copy;
  }

  it.each(Object.values(ResourceAiRemediationMode))(
    "accepts the mode %s",
    (mode: string) => {
      expect(() => {
        return validate({ aiRemediationMode: mode });
      }).not.toThrow();
    },
  );

  it.each([["automatic"], ["Bypass"], [""], [null], [1], [true]])(
    "refuses the unknown mode %p, naming the four it may be",
    (mode: unknown) => {
      expect(() => {
        return validate({ aiRemediationMode: mode });
      }).toThrow(
        "AI remediation mode must be one of Disabled, RequireApproval, Automatic, BypassApproval",
      );
    },
  );

  it("leaves a write without AI settings untouched", () => {
    expect(validate({ name: "web-1" })).toEqual({ name: "web-1" });
  });

  it("stores an allowlist trimmed, and a JSON-encoded one as the array", () => {
    expect(
      validate({ aiCommandAllowlist: ["  docker stop web  "] })[
        "aiCommandAllowlist"
      ],
    ).toEqual(["docker stop web"]);
    expect(
      validate({ aiCommandAllowlist: '["docker stop web", "docker stop *"]' })[
        "aiCommandAllowlist"
      ],
    ).toEqual(["docker stop web", "docker stop *"]);
  });

  it.each([[null], [""], ["   "]])(
    "stores a cleared allowlist (%p) as null",
    (value: unknown) => {
      expect(
        validate({ aiCommandAllowlist: value })["aiCommandAllowlist"],
      ).toBe(null);
    },
  );

  it("keeps an empty list as an empty list", () => {
    expect(validate({ aiCommandAllowlist: [] })["aiCommandAllowlist"]).toEqual(
      [],
    );
  });

  it.each([
    ["not JSON", "docker stop web"],
    ["an object", { pattern: "docker stop web" }],
    ["a number", 7],
    ["a JSON object", '{"a": 1}'],
  ])(
    "refuses %s with the shape of a valid allowlist and an example for the type",
    (_label: string, value: unknown) => {
      expect(() => {
        return validate({ aiCommandAllowlist: value });
      }).toThrow(
        'The AI command allowlist must be a JSON array of command patterns for this Docker host\'s AI agent (docker), for example ["docker stop web"].',
      );
    },
  );

  it("refuses an entry that is not text, naming its position", () => {
    expect(() => {
      return validate({ aiCommandAllowlist: ["docker stop web", 42] });
    }).toThrow(
      "Pattern 2 of the AI command allowlist must be text (got number)",
    );
    expect(() => {
      return validate({ aiCommandAllowlist: [null] });
    }).toThrow("Pattern 1 of the AI command allowlist must be text (got null)");
  });

  it(`refuses more than ${RESOURCE_ALLOWLIST_MAX_PATTERNS} patterns`, () => {
    const patterns: Array<string> = Array.from(
      { length: RESOURCE_ALLOWLIST_MAX_PATTERNS + 1 },
      (_value: unknown, index: number) => {
        return `docker stop web-${index}`;
      },
    );

    expect(() => {
      return validate({ aiCommandAllowlist: patterns });
    }).toThrow(
      `The AI command allowlist can hold at most ${RESOURCE_ALLOWLIST_MAX_PATTERNS} patterns (got ${RESOURCE_ALLOWLIST_MAX_PATTERNS + 1}).`,
    );

    expect(() => {
      return validate({
        aiCommandAllowlist: patterns.slice(0, RESOURCE_ALLOWLIST_MAX_PATTERNS),
      });
    }).not.toThrow();
  });

  it.each([
    ["blank", "   ", "cannot be blank"],
    ["a read", "docker container inspect web", "read-only command"],
    [
      "another program",
      "kubectl delete pod web",
      "does not start with a program",
    ],
    ["too few words", "docker stop", "fewer than two words"],
    ["a * where the command goes", "docker * web", "where the command goes"],
    ["a pipe", "docker stop web | tee", "cannot be read as one command"],
    [
      "a Denied command",
      "docker rm web",
      "can never match a command that runs",
    ],
    ["too long", `docker stop ${"a".repeat(600)}`, "at most 500 characters"],
  ])(
    "refuses %s with the policy's own reason",
    (_label: string, pattern: string, reason: string) => {
      let thrown: unknown = undefined;

      try {
        validate({ aiCommandAllowlist: [pattern] });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(BadDataException);
      expect((thrown as Error).message).toContain(
        "Pattern 1 of the AI command allowlist cannot be used:",
      );
      expect((thrown as Error).message).toContain(reason);
      expect((thrown as Error).message).toContain(
        "* stands for exactly one whole word",
      );
    },
  );

  it("judges an entry by the resource's own type: a docker entry is no entry for a host", () => {
    expect(() => {
      return validate(
        { aiCommandAllowlist: ["docker stop web"] },
        AiResourceType.Host,
      );
    }).toThrow("does not start with a program the Host AI agent runs");

    expect(
      validate(
        { aiCommandAllowlist: ["systemctl stop nginx"] },
        AiResourceType.Host,
      )["aiCommandAllowlist"],
    ).toEqual(["systemctl stop nginx"]);
  });

  it.each(ALL_AI_RESOURCE_TYPES)(
    "accepts the %s example and refuses a read of the same type",
    (resourceType: AiResourceType) => {
      expect(
        validate(
          {
            aiCommandAllowlist: [RESOURCE_AI_ALLOWLIST_EXAMPLES[resourceType]],
          },
          resourceType,
        )["aiCommandAllowlist"],
      ).toEqual([RESOURCE_AI_ALLOWLIST_EXAMPLES[resourceType]]);
    },
  );
});

describe("ResourceAiAccessSettings.getLoosening", () => {
  function loosens(
    data: Record<string, unknown>,
    current: Partial<ResourceAiAccessSettingsSnapshot> = {},
  ): boolean {
    return ResourceAiAccessSettings.getLoosening({
      data: data as JSONObject,
      current: snapshot(current),
    }).loosens;
  }

  it("any move of the mode up is loosening (Off to anything, up to Automatic or Bypass approval); down never is", () => {
    const modes: ReadonlyArray<ResourceAiRemediationMode> =
      RESOURCE_REMEDIATION_MODES_BY_AUTONOMY;

    for (let from: number = 0; from < modes.length; from++) {
      for (let to: number = 0; to < modes.length; to++) {
        expect({
          from: modes[from],
          to: modes[to],
          loosens: loosens(
            { aiRemediationMode: modes[to] },
            { aiRemediationMode: modes[from]! },
          ),
        }).toEqual({ from: modes[from], to: modes[to], loosens: to > from });
      }
    }
  });

  it("adding an allowlist pattern loosens; removing, reordering or clearing does not", () => {
    const current: Partial<ResourceAiAccessSettingsSnapshot> = {
      aiCommandAllowlist: ["docker stop web", "docker stop api"],
    };

    expect(
      loosens(
        { aiCommandAllowlist: ["docker stop web", "docker stop db"] },
        current,
      ),
    ).toBe(true);
    expect(loosens({ aiCommandAllowlist: ["docker stop api"] }, current)).toBe(
      false,
    );
    expect(
      loosens(
        { aiCommandAllowlist: ["docker stop api", "docker stop web"] },
        current,
      ),
    ).toBe(false);
    expect(loosens({ aiCommandAllowlist: [] }, current)).toBe(false);
    expect(loosens({ aiCommandAllowlist: null }, current)).toBe(false);
  });

  it("compares patterns trimmed, the way they are stored", () => {
    expect(
      loosens(
        { aiCommandAllowlist: ["  docker stop web "] },
        { aiCommandAllowlist: ["docker stop web"] },
      ),
    ).toBe(false);
  });

  it("negative control: the investigation switch, re-posted values and other columns loosen nothing", () => {
    expect(loosens({ isAiInvestigationEnabled: true })).toBe(false);
    expect(loosens({ isAiInvestigationEnabled: false })).toBe(false);
    expect(loosens({ name: "web-1" })).toBe(false);
    expect(
      loosens(
        {
          isAiInvestigationEnabled: true,
          aiRemediationMode: ResourceAiRemediationMode.BypassApproval,
          aiCommandAllowlist: ["docker stop web"],
        },
        {
          aiRemediationMode: ResourceAiRemediationMode.BypassApproval,
          aiCommandAllowlist: ["docker stop web"],
        },
      ),
    ).toBe(false);
  });
});

describe("ResourceAiAccessSettings.getLooseningRefusal", () => {
  function refusal(
    data: Record<string, unknown>,
    props: DatabaseCommonInteractionProps,
    current: Array<ResourceAiAccessSettingsSnapshot> = [snapshot()],
  ): string | null {
    return ResourceAiAccessSettings.getLooseningRefusal({
      resourceType: AiResourceType.DockerHost,
      data: data as JSONObject,
      props,
      current,
    });
  }

  const LOOSENING: Record<string, unknown> = {
    aiRemediationMode: ResourceAiRemediationMode.BypassApproval,
  };

  it.each(EDITOR_ROLES)(
    "refuses %s a loosening, in the refusal's own words",
    (role: Permission) => {
      expect(refusal(LOOSENING, propsWith(role))).toBe(
        getResourceAiAccessAdminRefusal(AiResourceType.DockerHost),
      );
    },
  );

  it.each(RESOURCE_AI_ACCESS_ADMIN_PERMISSIONS)(
    "lets %s loosen",
    (role: Permission) => {
      expect(refusal(LOOSENING, propsWith(role))).toBeNull();
    },
  );

  it.each(EDITOR_ROLES)("lets %s tighten", (role: Permission) => {
    expect(
      refusal(
        { aiRemediationMode: ResourceAiRemediationMode.Disabled },
        propsWith(role),
        [snapshot({ aiRemediationMode: ResourceAiRemediationMode.Automatic })],
      ),
    ).toBeNull();
  });

  it("does not read a block row as a grant", () => {
    expect(
      refusal(
        LOOSENING,
        userProps([
          permissionRow(Permission.EditDockerHost),
          permissionRow(Permission.ProjectAdmin, true),
        ]),
      ),
    ).not.toBeNull();
  });

  it("does not count an admin grant held in another project", () => {
    expect(
      refusal(
        LOOSENING,
        userProps([permissionRow(Permission.ProjectAdmin)], {
          tenantId: PROJECT_ID,
          permissionProjectId: OTHER_PROJECT_ID,
        }),
      ),
    ).not.toBeNull();
  });

  it("needs the permission in EVERY matched resource's own project", () => {
    expect(
      refusal(
        LOOSENING,
        userProps([permissionRow(Permission.ProjectAdmin)], {
          tenantId: null,
          permissionProjectId: PROJECT_ID,
        }),
        [snapshot(), snapshot({ projectId: OTHER_PROJECT_ID })],
      ),
    ).not.toBeNull();
  });

  it("refuses when the write loosens ANY matched resource, even if another is already there", () => {
    expect(
      refusal(LOOSENING, propsWith(Permission.SettingsMember), [
        snapshot({
          aiRemediationMode: ResourceAiRemediationMode.BypassApproval,
        }),
        snapshot({
          aiRemediationMode: ResourceAiRemediationMode.RequireApproval,
        }),
      ]),
    ).not.toBeNull();
  });

  it("judges a write that matched nothing against the never-configured defaults in the caller's tenant", () => {
    expect(
      refusal(LOOSENING, propsWith(Permission.SettingsMember), []),
    ).not.toBeNull();
    expect(
      refusal(LOOSENING, propsWith(Permission.ProjectAdmin), []),
    ).toBeNull();
    expect(
      refusal(
        { aiRemediationMode: ResourceAiRemediationMode.Disabled },
        propsWith(Permission.SettingsMember),
        [],
      ),
    ).toBeNull();
  });

  it("fails closed when nothing matched and the caller has no tenant", () => {
    expect(
      refusal(
        LOOSENING,
        userProps([permissionRow(Permission.ProjectAdmin)], {
          tenantId: null,
          permissionProjectId: PROJECT_ID,
        }),
        [],
      ),
    ).not.toBeNull();
  });
});

describe("ResourceAiAccessSettings.getServerOnlyColumnRefusal", () => {
  it.each([...RESOURCE_AI_ACCESS_SERVER_ONLY_KEYS])(
    "refuses a write of %s, a null clear included",
    (key: string) => {
      for (const value of [new Date(), "x", null]) {
        expect(
          ResourceAiAccessSettings.getServerOnlyColumnRefusal({
            [key]: value,
          } as JSONObject),
        ).toBe(
          `${key} is written by OneUptime itself and cannot be set through the API.`,
        );
      }
    },
  );

  it("names every server-only column a write carries", () => {
    expect(
      ResourceAiAccessSettings.getServerOnlyColumnRefusal({
        aiAccessConfiguredAt: new Date(),
        aiAccessLastError: "boom",
      } as unknown as JSONObject),
    ).toBe(
      "aiAccessConfiguredAt, aiAccessLastError are written by OneUptime itself and cannot be set through the API.",
    );
  });

  it("negative control: settings and other columns are not refused", () => {
    expect(
      ResourceAiAccessSettings.getServerOnlyColumnRefusal({
        isAiInvestigationEnabled: true,
        aiRemediationMode: ResourceAiRemediationMode.Automatic,
        name: "web",
      } as JSONObject),
    ).toBeNull();
  });
});

describe("ResourceAiAccessSettings.readStoredMode / readStoredAllowlist", () => {
  it("reads an unknown mode as Disabled", () => {
    for (const value of [undefined, null, "automatic", 3, {}]) {
      expect(ResourceAiAccessSettings.readStoredMode(value)).toBe(
        ResourceAiRemediationMode.Disabled,
      );
    }
    expect(
      ResourceAiAccessSettings.readStoredMode(
        ResourceAiRemediationMode.Automatic,
      ),
    ).toBe(ResourceAiRemediationMode.Automatic);
  });

  it("reads trimmed non-empty strings, a JSON string, and nothing else", () => {
    expect(
      ResourceAiAccessSettings.readStoredAllowlist([
        " docker stop web ",
        "",
        7,
        null,
      ]),
    ).toEqual(["docker stop web"]);
    expect(
      ResourceAiAccessSettings.readStoredAllowlist('["docker stop web"]'),
    ).toEqual(["docker stop web"]);
    expect(ResourceAiAccessSettings.readStoredAllowlist(null)).toEqual([]);
    expect(ResourceAiAccessSettings.readStoredAllowlist({})).toEqual([]);
  });
});

describe("ResourceAiAccessSettings.checkUpdate", () => {
  let service: FakeService;

  beforeEach(() => {
    service = fakeService([row()]);
    /*
     * Investigation and fixes chosen in OneUptime: no agent reports them
     * (one older than these settings, or none yet). What happens while an
     * agent sets them is ResourceAiSettingsSetByAgent.test.ts's business;
     * the last tests here pin only that it comes before who may loosen.
     */
    jest
      .spyOn(ResourceAiAgentService, "getAiSettingsSourcesForResources")
      .mockResolvedValue(new Map());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function check(
    data: Record<string, unknown>,
    props: DatabaseCommonInteractionProps,
    resourceType: AiResourceType = AiResourceType.DockerHost,
  ): Promise<ResourceAiAccessWriteCarryForward | null> {
    return ResourceAiAccessSettings.checkUpdate({
      resourceType,
      service: asService(service),
      updateBy: updateBy(data, props),
    });
  }

  it("refuses an editor's loosening before anything is written, and reads the settings of the rows the update writes", async () => {
    await expect(
      check(
        { aiRemediationMode: ResourceAiRemediationMode.RequireApproval },
        propsWith(Permission.SettingsMember),
      ),
    ).rejects.toThrow(NotAuthorizedException);

    // The rows the update writes, the update held to them.
    expect(service.findRowsAndHoldUpdateToThem).toHaveBeenCalledTimes(1);
    const [heldUpdate, select] = service.findRowsAndHoldUpdateToThem.mock
      .calls[0] as [UpdateBy<BaseModel>, Record<string, unknown>];
    expect(heldUpdate.query).toEqual({ _id: RESOURCE_ID.toString() });
    for (const column of [
      "projectId",
      "isAiInvestigationEnabled",
      "aiRemediationMode",
      "aiCommandAllowlist",
    ]) {
      expect(select[column]).toBe(true);
    }
    expect(service.updateBy).not.toHaveBeenCalled();
  });

  it("hands an admin's write the settings as they stood, for the marker and the feed", async () => {
    service.findBy.mockResolvedValue([
      row({
        isAiInvestigationEnabled: true,
        aiRemediationMode: ResourceAiRemediationMode.RequireApproval,
        aiCommandAllowlist: ["docker stop web"],
      }),
    ]);

    const carry: ResourceAiAccessWriteCarryForward | null = await check(
      { aiRemediationMode: ResourceAiRemediationMode.BypassApproval },
      propsWith(Permission.EditAutoRemediationRule),
    );

    expect(carry).toEqual({
      resourceType: AiResourceType.DockerHost,
      previousResourceAiAccessSettings: {
        [RESOURCE_ID.toString()]: {
          projectId: PROJECT_ID,
          isAiInvestigationEnabled: true,
          aiRemediationMode: ResourceAiRemediationMode.RequireApproval,
          aiCommandAllowlist: ["docker stop web"],
          // Where they are set, read with them: chosen in OneUptime here.
          aiAccessConfiguredAt: null,
          aiSettingsSource: "oneuptime",
        },
      },
    });
  });

  it("reads an unknown stored mode as Disabled, so moving to Automatic from it is a loosening", async () => {
    service.findBy.mockResolvedValue([row({ aiRemediationMode: "automatic" })]);

    await expect(
      check(
        { aiRemediationMode: ResourceAiRemediationMode.Automatic },
        propsWith(Permission.SettingsMember),
      ),
    ).rejects.toThrow(NotAuthorizedException);
  });

  it("lets an editor re-post every unchanged setting while flipping investigation", async () => {
    service.findBy.mockResolvedValue([
      row({
        aiRemediationMode: ResourceAiRemediationMode.BypassApproval,
        aiCommandAllowlist: ["docker stop web"],
      }),
    ]);

    await expect(
      check(
        {
          isAiInvestigationEnabled: true,
          aiRemediationMode: ResourceAiRemediationMode.BypassApproval,
          aiCommandAllowlist: ["docker stop web"],
        },
        propsWith(Permission.EditDockerHost),
      ),
    ).resolves.not.toBeNull();
  });

  it("returns null (no read, no marker) for a write that carries no AI setting", async () => {
    await expect(
      check({ name: "web-2" }, propsWith(Permission.SettingsMember)),
    ).resolves.toBeNull();
    expect(service.findBy).not.toHaveBeenCalled();
  });

  it("validates before who is asking: an invalid mode is a bad request for an admin too", async () => {
    await expect(
      check(
        { aiRemediationMode: "Everything" },
        propsWith(Permission.ProjectOwner),
      ),
    ).rejects.toThrow(BadDataException);
    expect(service.findBy).not.toHaveBeenCalled();
  });

  it("refuses the server-only columns for every caller but root — a master admin included", async () => {
    for (const props of [
      propsWith(Permission.ProjectOwner),
      { isMasterAdmin: true, userId: ObjectID.generate() },
    ] as Array<DatabaseCommonInteractionProps>) {
      await expect(
        check({ aiAccessConfiguredAt: new Date() }, props),
      ).rejects.toThrow(
        "aiAccessConfiguredAt is written by OneUptime itself and cannot be set through the API.",
      );
    }

    await expect(
      check(
        { aiAccessLastVerifiedAt: new Date(), aiAccessLastError: null },
        { isRoot: true },
      ),
    ).resolves.toBeNull();
  });

  it("lets a master admin loosen without any project permission, and still hands the snapshot forward", async () => {
    await expect(
      check(
        { aiRemediationMode: ResourceAiRemediationMode.BypassApproval },
        { isMasterAdmin: true, userId: ObjectID.generate() },
      ),
    ).resolves.not.toBeNull();
  });

  it("never gates, reads or marks the server's own (root) writes, but still validates them", async () => {
    await expect(
      check(
        {
          isAiInvestigationEnabled: true,
          aiRemediationMode: ResourceAiRemediationMode.RequireApproval,
        },
        { isRoot: true },
      ),
    ).resolves.toBeNull();
    expect(service.findBy).not.toHaveBeenCalled();

    await expect(
      check({ aiRemediationMode: "nope" }, { isRoot: true }),
    ).rejects.toThrow(BadDataException);
  });

  it("normalizes the allowlist in the write itself", async () => {
    const write: UpdateBy<BaseModel> = updateBy(
      { aiCommandAllowlist: '["  docker stop web  "]' },
      propsWith(Permission.ProjectAdmin),
    );

    await ResourceAiAccessSettings.checkUpdate({
      resourceType: AiResourceType.DockerHost,
      service: asService(service),
      updateBy: write,
    });

    expect((write.data as unknown as JSONObject)["aiCommandAllowlist"]).toEqual(
      ["docker stop web"],
    );
  });

  it("an update that reaches several resources is judged per resource", async () => {
    service.findBy.mockResolvedValue([
      row({ aiRemediationMode: ResourceAiRemediationMode.BypassApproval }),
      row({
        id: OTHER_RESOURCE_ID,
        _id: OTHER_RESOURCE_ID.toString(),
        aiRemediationMode: ResourceAiRemediationMode.Disabled,
      }),
    ]);

    await expect(
      check(
        { aiRemediationMode: ResourceAiRemediationMode.BypassApproval },
        propsWith(Permission.SettingsMember),
      ),
    ).rejects.toThrow(NotAuthorizedException);
  });

  it("set by the agent: a change is refused for everyone, master admins too, before who may loosen", async () => {
    jest
      .spyOn(ResourceAiAgentService, "getAiSettingsSourcesForResources")
      .mockResolvedValue(
        new Map([
          [RESOURCE_ID.toString().toLowerCase(), "agent_configuration"],
        ]),
      );

    for (const props of [
      propsWith(Permission.SettingsMember),
      propsWith(Permission.ProjectOwner),
      { isMasterAdmin: true, userId: ObjectID.generate() },
    ]) {
      await expect(
        check(
          { aiRemediationMode: ResourceAiRemediationMode.Automatic },
          props,
        ),
      ).rejects.toThrow(BadDataException);
    }
    await expect(
      check(
        { aiRemediationMode: ResourceAiRemediationMode.Automatic },
        propsWith(Permission.SettingsMember),
      ),
    ).rejects.toThrow(/ONEUPTIME_AI_FIXES/);
    expect(service.updateBy).not.toHaveBeenCalled();
  });

  it("set by the agent: re-posting what the resource has passes", async () => {
    jest
      .spyOn(ResourceAiAgentService, "getAiSettingsSourcesForResources")
      .mockResolvedValue(
        new Map([[RESOURCE_ID.toString().toLowerCase(), "agent_defaults"]]),
      );

    await expect(
      check(
        {
          isAiInvestigationEnabled: false,
          aiRemediationMode: ResourceAiRemediationMode.Disabled,
        },
        propsWith(Permission.SettingsMember),
      ),
    ).resolves.not.toBeNull();
  });

  it("where the settings come from cannot be read: a change is refused, not let past the agent", async () => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      // expected: the read failed
    });
    jest
      .spyOn(ResourceAiAgentService, "getAiSettingsSourcesForResources")
      .mockRejectedValue(new Error("connection refused"));

    await expect(
      check(
        { isAiInvestigationEnabled: true },
        { isMasterAdmin: true, userId: ObjectID.generate() },
      ),
    ).rejects.toThrow(BadDataException);
  });
});

describe("ResourceAiAccessSettings.afterUpdate", () => {
  let service: FakeService;
  let feedItems: Array<ResourceAiAccessFeedItem>;
  let createFeedItem: jest.Mock;
  let getResourceMarkdownLink: jest.Mock;

  beforeEach(() => {
    service = fakeService();
    feedItems = [];
    createFeedItem = jest
      .fn()
      .mockImplementation(async (item: ResourceAiAccessFeedItem) => {
        feedItems.push(item);
      });
    getResourceMarkdownLink = jest
      .fn()
      .mockResolvedValue(
        FeedMarkdown.asMarkdown("[Docker Host web-1](https://x)"),
      );
    jest
      .spyOn(UserService, "getUserMarkdownString")
      .mockResolvedValue(
        FeedMarkdown.asMarkdown("[Jane](https://oneuptime.example/user)"),
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function waitFor(predicate: () => boolean): Promise<void> {
    for (let i: number = 0; i < 100 && !predicate(); i++) {
      await new Promise((resolve: (value: unknown) => void) => {
        setTimeout(resolve, 0);
      });
    }
  }

  function onUpdate(
    data: Record<string, unknown>,
    carryForward: unknown,
    props: DatabaseCommonInteractionProps = propsWith(Permission.ProjectAdmin),
  ): OnUpdate<BaseModel> {
    return {
      updateBy: updateBy(data, props),
      carryForward,
    };
  }

  function carry(
    previous: Partial<ResourceAiAccessSettingsSnapshot> = {},
  ): ResourceAiAccessWriteCarryForward {
    return {
      resourceType: AiResourceType.DockerHost,
      previousResourceAiAccessSettings: {
        [RESOURCE_ID.toString()]: snapshot(previous),
      },
    };
  }

  async function after(
    update: OnUpdate<BaseModel>,
    ids: Array<ObjectID> = [RESOURCE_ID],
  ): Promise<void> {
    await ResourceAiAccessSettings.afterUpdate({
      service: asService(service),
      onUpdate: update,
      updatedItemIds: ids,
      getResourceMarkdownLink,
      createFeedItem,
    });
  }

  it("marks the resource AI-configured, only where it is not yet, as root", async () => {
    await after(
      onUpdate(
        { aiRemediationMode: ResourceAiRemediationMode.RequireApproval },
        carry(),
      ),
    );

    expect(service.updateBy).toHaveBeenCalledTimes(1);
    const args: {
      query: Record<string, unknown>;
      data: Record<string, unknown>;
      props: DatabaseCommonInteractionProps;
    } = service.updateBy.mock.calls[0]![0] as {
      query: Record<string, unknown>;
      data: Record<string, unknown>;
      props: DatabaseCommonInteractionProps;
    };
    expect(args.data["aiAccessConfiguredAt"]).toBeInstanceOf(Date);
    expect(args.query["aiAccessConfiguredAt"]).toBeDefined();
    expect(args.query["_id"]).toBeDefined();
    expect(args.props).toEqual({ isRoot: true });
  });

  it("records who changed what, old to new, yellow for a loosening", async () => {
    const props: DatabaseCommonInteractionProps = propsWith(
      Permission.ProjectAdmin,
    );

    await after(
      onUpdate(
        {
          aiRemediationMode: ResourceAiRemediationMode.BypassApproval,
          aiCommandAllowlist: ["docker stop web"],
        },
        carry({ aiRemediationMode: ResourceAiRemediationMode.RequireApproval }),
        props,
      ),
    );

    await waitFor(() => {
      return feedItems.length > 0;
    });

    expect(feedItems).toHaveLength(1);
    const item: ResourceAiAccessFeedItem = feedItems[0]!;
    expect(item.resourceId).toBe(RESOURCE_ID);
    expect(item.projectId).toBe(PROJECT_ID);
    expect(item.userId).toBe(props.userId);
    expect(item.displayColor).toBe(Yellow500);
    expect(item.feedInfoInMarkdown).toBe(
      "🤖 **[Jane](https://oneuptime.example/user)** changed what OneUptime AI may do on [Docker Host web-1](https://x):\n\n- AI remediation changed from **Ask for approval** to **Bypass approval**\n- AI command allowlist changed to 1 pattern (was none)",
    );
    expect(item.moreInformationInMarkdown).toContain(
      "**Changed by**: [Jane](https://oneuptime.example/user)",
    );
    expect(item.moreInformationInMarkdown).toContain("- `docker stop web`");
    expect(getResourceMarkdownLink).toHaveBeenCalledWith(
      PROJECT_ID,
      RESOURCE_ID,
    );
  });

  it("is grey for a tightening, and attributes a write with no user to an API key", async () => {
    await after(
      onUpdate(
        { aiRemediationMode: ResourceAiRemediationMode.Disabled },
        carry({ aiRemediationMode: ResourceAiRemediationMode.Automatic }),
        { tenantId: PROJECT_ID } as DatabaseCommonInteractionProps,
      ),
    );

    await waitFor(() => {
      return feedItems.length > 0;
    });

    expect(feedItems[0]!.displayColor).toBe(Gray500);
    expect(feedItems[0]!.feedInfoInMarkdown).toContain(
      "🤖 An API key changed what OneUptime AI may do on",
    );
    expect(feedItems[0]!.feedInfoInMarkdown).toContain(
      "AI remediation changed from **Automatic** to **Off**",
    );
    expect(feedItems[0]!.moreInformationInMarkdown).toBe(
      "**Changed by**: An API key (no user)",
    );
  });

  it("records nothing for a save that re-posted unchanged values, but still marks the resource configured", async () => {
    await after(
      onUpdate(
        {
          isAiInvestigationEnabled: false,
          aiRemediationMode: ResourceAiRemediationMode.Disabled,
          aiCommandAllowlist: [],
        },
        carry(),
      ),
    );

    for (let i: number = 0; i < 10; i++) {
      await new Promise((resolve: (value: unknown) => void) => {
        setTimeout(resolve, 0);
      });
    }

    expect(createFeedItem).not.toHaveBeenCalled();
    expect(service.updateBy).toHaveBeenCalledTimes(1);
  });

  it("does nothing without the carry-forward (the server's own writes, other columns)", async () => {
    await after(onUpdate({ name: "web" }, null));
    await after(onUpdate({ name: "web" }, []));

    expect(service.updateBy).not.toHaveBeenCalled();
    expect(createFeedItem).not.toHaveBeenCalled();
  });

  it("does nothing when the update touched no row", async () => {
    await after(
      onUpdate(
        { aiRemediationMode: ResourceAiRemediationMode.RequireApproval },
        carry(),
      ),
      [],
    );

    expect(service.updateBy).not.toHaveBeenCalled();
  });

  it("a feed write that fails never fails the save", async () => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    createFeedItem.mockRejectedValue(new Error("feed down"));

    await expect(
      after(onUpdate({ isAiInvestigationEnabled: true }, carry())),
    ).resolves.toBeUndefined();
  });

  it("a marker write that fails fails the save (a registering agent reads it)", async () => {
    service.updateBy.mockRejectedValue(new Error("db down"));

    await expect(
      after(onUpdate({ isAiInvestigationEnabled: true }, carry())),
    ).rejects.toThrow("db down");
  });

  it("looks the project up when the resource was not in the snapshot", async () => {
    await after(
      onUpdate(
        { isAiInvestigationEnabled: true },
        {
          resourceType: AiResourceType.DockerHost,
          previousResourceAiAccessSettings: {},
        },
      ),
    );

    await waitFor(() => {
      return feedItems.length > 0;
    });

    expect(service.findOneById).toHaveBeenCalledTimes(1);
    expect(feedItems[0]!.feedInfoInMarkdown).toContain(
      "AI investigation with read-only commands turned **on**",
    );
  });
});

describe("ResourceAiAccessSettings.describeChanges", () => {
  it("reports only what changed, old to new", () => {
    expect(
      ResourceAiAccessSettings.describeChanges({
        updateData: {
          isAiInvestigationEnabled: true,
          aiRemediationMode: ResourceAiRemediationMode.Automatic,
          aiCommandAllowlist: null,
        } as JSONObject,
        previous: snapshot({
          aiRemediationMode: ResourceAiRemediationMode.Automatic,
          aiCommandAllowlist: ["docker stop web", "docker stop api"],
        }),
      }).map((change: MarkdownText): string => {
        return change.toString();
      }),
    ).toEqual([
      "AI investigation with read-only commands turned **on**",
      "AI command allowlist cleared",
    ]);
  });

  it("without a previous snapshot reports every written setting as set", () => {
    expect(
      ResourceAiAccessSettings.describeChanges({
        updateData: {
          isAiInvestigationEnabled: false,
          aiRemediationMode: ResourceAiRemediationMode.RequireApproval,
          aiCommandAllowlist: ["docker stop web", "docker stop api"],
        } as JSONObject,
        previous: undefined,
      }).map((change: MarkdownText): string => {
        return change.toString();
      }),
    ).toEqual([
      "AI investigation with read-only commands turned **off**",
      "AI remediation set to **Ask for approval**",
      "AI command allowlist changed to 2 patterns",
    ]);
  });
});
