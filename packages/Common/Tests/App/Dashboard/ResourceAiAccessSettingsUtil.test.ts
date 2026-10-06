import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import {
  RESOURCE_AI_ACCESS_ADMIN_PERMISSIONS,
  RESOURCE_REMEDIATION_MODES_BY_AUTONOMY,
  RESOURCE_REMEDIATION_MODE_SHORT_NAMES,
  RESOURCE_REMEDIATION_MODE_SUMMARIES,
  ResourceAiAccessConfirmation,
  ResourceAiAccessOfferedFields,
  ResourceAiAccessSavedSettings,
  ResourceAiAccessSettingsFormValues,
  capitalizeFirst,
  formatNameList,
  getEveryModeProtections,
  getEveryModeProtectionsSentence,
  getPermissionTitles,
  getResourceAiAccessAdminPermissionTitles,
  getResourceAiAccessConfirmation,
  getResourceAiAccessLooseningChanges,
  getResourceAiAccessOfferedFields,
  getResourceAiAccessSettingsChanges,
  getResourceAiAccessSettingsInitialValues,
  getResourceAiAccessSubmittedFields,
  getResourceAllowlistFieldDescription,
  getResourceAllowlistInEffect,
  getResourceAllowlistRemovalOnlyError,
  getResourceInvestigationOnSentence,
  getResourceRemediationModeOptionDescriptions,
  isResourceAllowlistFieldShown,
  isResourceRemediationModeOpenToEveryEditor,
  normalizeSavedResourceAllowlist,
  parseResourceAllowlistText,
  readDropdownId,
  readResourceAiAccessSavedSettings,
  readResourceRemediationMode,
  readStoredResourceAllowlist,
  validateResourceAllowlistText,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiAccessSettingsUtil";
import {
  ResourceAiAgentDescriptor,
  getResourceAiAgentDescriptor,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiAgentDescriptors";
import { joinAiAccessProtections } from "../../../../App/FeatureSet/Dashboard/src/Components/AiAccess/AiAccessModes";
import { JSONObject } from "../../../Types/JSON";
import { RESOURCE_AI_ACCESS_ADMIN_PERMISSIONS as SERVER_RESOURCE_AI_ACCESS_ADMIN_PERMISSIONS } from "../../../Types/AI/ResourceAiAccessPermissions";
import { KUBERNETES_AI_ACCESS_ADMIN_PERMISSIONS } from "../../../Types/Kubernetes/KubernetesClusterAiAccessPermissions";
import Permission from "../../../Types/Permission";
import AiResourceType, {
  ALL_AI_RESOURCE_TYPES,
} from "../../../Types/ResourceAiAgent/AiResourceType";
import {
  RESOURCE_AI_ALLOW_WRITES_ENV,
  RESOURCE_AI_WRITE_TARGETS_ENV,
  ResourceAiRemediationMode,
  ResourceCommandTier,
} from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import ResourceCommandPolicy, {
  RESOURCE_ALLOWLIST_MAX_PATTERNS,
  RESOURCE_ALLOWLIST_MAX_PATTERN_LENGTH,
} from "../../../Utils/AiRemediation/Resource/ResourceCommandPolicy";
import type FormValues from "../../../UI/Components/Forms/Types/FormValues";

/*
 * The pure rules behind "What AI may do" on a resource's AI agent page and
 * its Change modal: the words for each mode, who may loosen what (relative
 * to the saved settings, as the server decides), what an edit sends, when a
 * save is confirmed first, and how the command allowlist is read and
 * checked — by the resource type's own command policy, the matcher's rules.
 */

const DOCKER: ResourceAiAgentDescriptor = getResourceAiAgentDescriptor(
  AiResourceType.DockerHost,
);

/*
 * Per type: an entry the policy accepts (a riskier change), one that uses
 * a * for the object it touches (broad; none exists for Proxmox, whose
 * paths are written out per guest), and one that is only a read.
 */
const ENTRIES: Record<
  AiResourceType,
  { valid: string; broad: string | null; read: string }
> = {
  [AiResourceType.DockerHost]: {
    valid: "docker stop web",
    broad: "docker stop *",
    read: "docker ps -a",
  },
  [AiResourceType.PodmanHost]: {
    valid: "docker stop web",
    broad: "docker stop *",
    read: "docker ps -a",
  },
  [AiResourceType.DockerSwarmCluster]: {
    valid: "docker service update --image nginx:1.27 web",
    broad: "docker service update --image nginx:1.27 *",
    read: "docker service ps web",
  },
  [AiResourceType.ProxmoxCluster]: {
    valid: "pvesh create /nodes/pve1/qemu/100/status/shutdown",
    broad: null,
    read: "pvesh get /version",
  },
  [AiResourceType.VMwareVCenter]: {
    valid: "govc vm.power -off web-01",
    broad: "govc vm.power -off *",
    read: "govc vm.info web-01",
  },
  [AiResourceType.CephCluster]: {
    valid: "ceph osd out 3",
    broad: "ceph osd out *",
    read: "ceph health detail",
  },
  [AiResourceType.DatabaseServer]: {
    valid: "db terminate-session 12345",
    broad: "db terminate-session *",
    read: "db sessions --limit 20",
  },
  [AiResourceType.Host]: {
    valid: "systemctl stop nginx",
    broad: "systemctl stop *",
    read: "systemctl status nginx",
  },
};

function saved(
  overrides: Partial<ResourceAiAccessSavedSettings> = {},
): ResourceAiAccessSavedSettings {
  return {
    isAiInvestigationEnabled: true,
    aiRemediationMode: ResourceAiRemediationMode.RequireApproval,
    aiCommandAllowlist: [],
    ...overrides,
  };
}

function values(
  overrides: Partial<ResourceAiAccessSettingsFormValues> = {},
): FormValues<ResourceAiAccessSettingsFormValues> {
  return {
    isAiInvestigationEnabled: true,
    aiRemediationMode: ResourceAiRemediationMode.RequireApproval,
    aiCommandAllowlistText: "",
    ...overrides,
  };
}

const ALL_OFFERED: ResourceAiAccessOfferedFields = {
  allowlist: true,
  allowlistRemoveOnly: false,
};

describe("the words for each mode", () => {
  test("every mode has its own short name, summary and card description", () => {
    for (const type of ALL_AI_RESOURCE_TYPES) {
      const descriptions: Record<ResourceAiRemediationMode, string> =
        getResourceRemediationModeOptionDescriptions(
          getResourceAiAgentDescriptor(type),
        );

      for (const record of [
        RESOURCE_REMEDIATION_MODE_SHORT_NAMES,
        RESOURCE_REMEDIATION_MODE_SUMMARIES,
        descriptions,
      ]) {
        const values: Array<string> = Object.values(
          ResourceAiRemediationMode,
        ).map((mode: ResourceAiRemediationMode): string => {
          return record[mode];
        });
        expect(
          values.every((value: string): boolean => {
            return value.trim().length > 0;
          }),
        ).toBe(true);
        // No two modes read the same.
        expect(new Set(values).size).toBe(values.length);
      }
    }
  });

  /*
   * The card used to say "No — AI investigates with OneUptime data only"
   * beside "Off — AI only investigates": two rows that contradict each
   * other when investigation is off too. Fixes Off speaks of fixes alone.
   */
  test("Off speaks of fixes only, never of investigating", () => {
    expect(
      RESOURCE_REMEDIATION_MODE_SUMMARIES[ResourceAiRemediationMode.Disabled],
    ).toBe("AI never proposes or runs a fix.");
    for (const summary of Object.values(RESOURCE_REMEDIATION_MODE_SUMMARIES)) {
      expect(summary).not.toMatch(/only investigates/);
    }
  });

  test("the summaries say who runs a fix, in increasing autonomy", () => {
    expect(
      RESOURCE_REMEDIATION_MODE_SUMMARIES[
        ResourceAiRemediationMode.RequireApproval
      ],
    ).toContain("A person approves each one before it runs.");
    expect(
      RESOURCE_REMEDIATION_MODE_SUMMARIES[ResourceAiRemediationMode.Automatic],
    ).toMatch(
      /Safe fixes run on their own\. Riskier ones wait for your one-click approval\./,
    );
    expect(
      RESOURCE_REMEDIATION_MODE_SUMMARIES[
        ResourceAiRemediationMode.BypassApproval
      ],
    ).toContain("Changes that always need a person still ask.");
  });

  test.each(ALL_AI_RESOURCE_TYPES)(
    "%s: each mode card says what the mode does, with this type's own examples",
    (type: AiResourceType) => {
      const descriptor: ResourceAiAgentDescriptor =
        getResourceAiAgentDescriptor(type);
      const descriptions: Record<ResourceAiRemediationMode, string> =
        getResourceRemediationModeOptionDescriptions(descriptor);

      expect(descriptions[ResourceAiRemediationMode.Disabled]).toBe(
        "AI never proposes or runs a fix. It can still investigate.",
      );
      expect(descriptions[ResourceAiRemediationMode.RequireApproval]).toMatch(
        /a person approves it with one click before it runs\. A follow-up fix asks again\.$/,
      );

      // Automatic names this type's riskier changes, without the prefix.
      expect(descriptions[ResourceAiRemediationMode.Automatic]).toContain(
        `Riskier ones, such as ${descriptor.riskierChanges}, wait for one-click approval unless the command allowlist names them.`,
      );
      expect(descriptions[ResourceAiRemediationMode.Automatic]).not.toContain(
        "riskier changes such as",
      );

      // Bypass approval says AI does not ask, then what still asks.
      const bypass: string =
        descriptions[ResourceAiRemediationMode.BypassApproval];
      expect(bypass).toMatch(/^AI does not ask: /);
      expect(bypass).toContain("follow-up rounds included");
      if (descriptor.alwaysHumanExamples) {
        expect(bypass).toContain(
          `Changes such as ${descriptor.alwaysHumanExamples} still ask a person.`,
        );
      } else {
        expect(bypass).not.toContain("still ask a person");
      }
    },
  );

  test.each(ALL_AI_RESOURCE_TYPES)(
    "%s: investigation on says what AI may run, and that it changes nothing",
    (type: AiResourceType) => {
      const descriptor: ResourceAiAgentDescriptor =
        getResourceAiAgentDescriptor(type);

      expect(getResourceInvestigationOnSentence(descriptor)).toBe(
        `AI may run ${descriptor.readOnlyCommandsPhrase} on this ${descriptor.noun}: ${descriptor.readExamples}. They never change anything.`,
      );
    },
  );

  test("a database server's investigation sentence, in full", () => {
    expect(
      getResourceInvestigationOnSentence(
        getResourceAiAgentDescriptor(AiResourceType.DatabaseServer),
      ),
    ).toBe(
      "AI may run read-only db diagnostics on this database server: sessions, locks, long-running queries, replication, sizes, settings. They never change anything.",
    );
  });

  test("the short names are a Kubernetes cluster's", () => {
    expect(RESOURCE_REMEDIATION_MODE_SHORT_NAMES).toEqual({
      Disabled: "Off",
      RequireApproval: "Ask for approval",
      Automatic: "Automatic",
      BypassApproval: "Bypass approval",
    });
  });

  test("never speak of Kubernetes or kubectl", () => {
    const words: string = JSON.stringify([
      RESOURCE_REMEDIATION_MODE_SUMMARIES,
      ...ALL_AI_RESOURCE_TYPES.map((type: AiResourceType): unknown => {
        const descriptor: ResourceAiAgentDescriptor =
          getResourceAiAgentDescriptor(type);
        return [
          getResourceRemediationModeOptionDescriptions(descriptor),
          getEveryModeProtections(descriptor),
          getResourceInvestigationOnSentence(descriptor),
          getResourceAllowlistFieldDescription(descriptor),
        ];
      }),
    ]);
    expect(words).not.toMatch(/kubectl|namespace|Kubernetes/i);
  });

  test("an unknown stored mode reads as Off", () => {
    expect(readResourceRemediationMode("Automatic")).toBe(
      ResourceAiRemediationMode.Automatic,
    );
    for (const value of ["automatic", "", null, undefined, 3, {}]) {
      expect(readResourceRemediationMode(value)).toBe(
        ResourceAiRemediationMode.Disabled,
      );
    }
  });
});

describe("what holds in every mode", () => {
  test.each(ALL_AI_RESOURCE_TYPES)(
    "%s: the protections name the agent, the write switch and the targets",
    (type: AiResourceType) => {
      const descriptor: ResourceAiAgentDescriptor =
        getResourceAiAgentDescriptor(type);
      const sentence: string = getEveryModeProtectionsSentence(descriptor);

      expect(sentence).toContain(descriptor.agentName);
      expect(sentence).toContain(`${RESOURCE_AI_ALLOW_WRITES_ENV}=true`);
      expect(sentence).toContain(RESOURCE_AI_WRITE_TARGETS_ENV);
      expect(sentence).toContain("never run");
      expect(sentence).toContain(`holds this ${descriptor.noun}`);
      if (descriptor.alwaysHumanExamples) {
        expect(sentence).toContain(
          `changes such as ${descriptor.alwaysHumanExamples} always need a human`,
        );
      } else {
        expect(sentence).not.toContain("always need a human");
      }
    },
  );

  test.each(ALL_AI_RESOURCE_TYPES)(
    "%s: the list the modal shows is the sentence the confirmations say, clause for clause",
    (type: AiResourceType) => {
      const descriptor: ResourceAiAgentDescriptor =
        getResourceAiAgentDescriptor(type);
      const clauses: Array<string> = getEveryModeProtections(descriptor);

      expect(clauses).toHaveLength(descriptor.alwaysHumanExamples ? 4 : 3);
      expect(getEveryModeProtectionsSentence(descriptor)).toBe(
        joinAiAccessProtections(clauses),
      );
      // The last clause is joined with "and", every one before with "; ".
      expect(getEveryModeProtectionsSentence(descriptor)).toContain(
        `; and ${clauses[clauses.length - 1]}`,
      );
      for (const clause of clauses) {
        expect(clause).toBe(clause.trim());
        expect(clause).not.toMatch(/[.;]$/);
      }
    },
  );

  /*
   * The sentence the confirmations have always said, word for word — the
   * list the Change modal now shows must not have changed what it
   * promises.
   */
  test("a Docker Swarm cluster's protections, in full", () => {
    expect(
      getEveryModeProtectionsSentence(
        getResourceAiAgentDescriptor(AiResourceType.DockerSwarmCluster),
      ),
    ).toBe(
      "commands the policy denies (a shell, exec, deleting data, anything that reads credentials, anything it does not know) never run; changes such as draining or pausing a node always need a human; the Docker Swarm AI agent changes nothing unless it was started with ONEUPTIME_AI_ALLOW_WRITES=true, and then never itself, the collector beside it or a target outside ONEUPTIME_AI_WRITE_TARGETS; and an unattended run becomes a proposal when the hourly circuit breaker trips or another unattended round already holds this Docker Swarm cluster",
    );
  });
});

describe("who may loosen", () => {
  test("is the server's set, which is a Kubernetes cluster's", () => {
    expect([...RESOURCE_AI_ACCESS_ADMIN_PERMISSIONS]).toEqual(
      SERVER_RESOURCE_AI_ACCESS_ADMIN_PERMISSIONS,
    );
    expect([...RESOURCE_AI_ACCESS_ADMIN_PERMISSIONS].sort()).toEqual(
      [...KUBERNETES_AI_ACCESS_ADMIN_PERMISSIONS].sort(),
    );
  });

  test("is named the way the permission table names it", () => {
    expect(getResourceAiAccessAdminPermissionTitles()).toEqual(
      getPermissionTitles([
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.EditAutoRemediationRule,
      ]),
    );
    expect(getResourceAiAccessAdminPermissionTitles().join(", ")).toContain(
      "Edit Auto Remediation Rule",
    );
    // Duplicates and unknown permissions add nothing.
    expect(
      getPermissionTitles([
        Permission.ProjectOwner,
        Permission.ProjectOwner,
        "NotAPermission" as Permission,
      ]),
    ).toHaveLength(1);
  });

  test("modes by autonomy, least first", () => {
    expect(RESOURCE_REMEDIATION_MODES_BY_AUTONOMY).toEqual([
      ResourceAiRemediationMode.Disabled,
      ResourceAiRemediationMode.RequireApproval,
      ResourceAiRemediationMode.Automatic,
      ResourceAiRemediationMode.BypassApproval,
    ]);
  });

  test("every editor may choose the saved mode or any below it — Off -> on included", () => {
    const open: (
      mode: ResourceAiRemediationMode,
      savedMode: ResourceAiRemediationMode,
    ) => boolean = isResourceRemediationModeOpenToEveryEditor;

    expect(
      open(
        ResourceAiRemediationMode.RequireApproval,
        ResourceAiRemediationMode.Disabled,
      ),
    ).toBe(false);
    expect(
      open(
        ResourceAiRemediationMode.Disabled,
        ResourceAiRemediationMode.Disabled,
      ),
    ).toBe(true);
    expect(
      open(
        ResourceAiRemediationMode.Automatic,
        ResourceAiRemediationMode.BypassApproval,
      ),
    ).toBe(true);
    expect(
      open(
        ResourceAiRemediationMode.BypassApproval,
        ResourceAiRemediationMode.Automatic,
      ),
    ).toBe(false);
  });
});

describe("the allowlist text", () => {
  test("is one entry per line, blank lines and extra spaces dropped", () => {
    expect(
      parseResourceAllowlistText(
        "  docker   stop web \n\n\r\ndocker kill -s TERM  api\r\n   ",
      ),
    ).toEqual(["docker stop web", "docker kill -s TERM api"]);
    expect(parseResourceAllowlistText(undefined)).toEqual([]);
    expect(parseResourceAllowlistText(["docker stop web"])).toEqual([]);
  });

  test.each(ALL_AI_RESOURCE_TYPES)(
    "%s: accepts its own kind of entry, empty text too",
    (type: AiResourceType) => {
      expect(
        validateResourceAllowlistText(type, ENTRIES[type].valid),
      ).toBeNull();
      expect(validateResourceAllowlistText(type, "")).toBeNull();
      expect(validateResourceAllowlistText(type, "\n \n")).toBeNull();
      if (ENTRIES[type].broad) {
        // Broad entries are valid; saving one is confirmed instead.
        expect(
          validateResourceAllowlistText(type, ENTRIES[type].broad),
        ).toBeNull();
      }
    },
  );

  test.each(ALL_AI_RESOURCE_TYPES)(
    "%s: refuses a read with the policy's own words, naming the line",
    (type: AiResourceType) => {
      expect(
        ResourceCommandPolicy.evaluateCommand({
          resourceType: type,
          command: ENTRIES[type].read,
        }).tier,
      ).toBe(ResourceCommandTier.Read);
      const problem: string | null = validateResourceAllowlistText(
        type,
        `${ENTRIES[type].valid}\n${ENTRIES[type].read}`,
      );

      expect(problem).toMatch(/^Entry 2: /);
      expect(problem).toContain("is a read-only command");
      expect(problem).toBe(
        `Entry 2: ${ResourceCommandPolicy.describeAllowlistPatternProblem({
          resourceType: type,
          pattern: ENTRIES[type].read,
        })}`,
      );
    },
  );

  test("is checked against THIS resource type's programs", () => {
    // A Host entry means nothing on a Docker host.
    expect(
      validateResourceAllowlistText(
        AiResourceType.DockerHost,
        "systemctl stop nginx",
      ),
    ).toContain("does not start with a program the Docker AI agent runs");
    // docker stop is a container change a Swarm cluster never runs.
    expect(
      validateResourceAllowlistText(
        AiResourceType.DockerSwarmCluster,
        "docker stop web",
      ),
    ).toMatch(/^Entry 1: .*can never match a command that runs/);
    expect(
      validateResourceAllowlistText(
        AiResourceType.DockerHost,
        "kubectl delete pod x",
      ),
    ).toMatch(/^Entry 1: /);
  });

  test("refuses the shapes that can never pre-approve anything", () => {
    for (const entry of [
      "docker",
      "docker stop",
      "docker * web",
      "docker stop web; rm -rf /",
    ]) {
      expect(
        validateResourceAllowlistText(AiResourceType.DockerHost, entry),
      ).toMatch(/^Entry 1: /);
    }
  });

  test("refuses more than the matcher reads, and entries longer than it reads", () => {
    const many: string = Array.from(
      { length: RESOURCE_ALLOWLIST_MAX_PATTERNS + 1 },
      (_value: unknown, index: number): string => {
        return `docker stop web-${index}`;
      },
    ).join("\n");

    expect(validateResourceAllowlistText(AiResourceType.DockerHost, many)).toBe(
      `An allowlist can hold at most ${RESOURCE_ALLOWLIST_MAX_PATTERNS} entries (this one has ${RESOURCE_ALLOWLIST_MAX_PATTERNS + 1}).`,
    );

    const long: string = `docker stop ${"a".repeat(RESOURCE_ALLOWLIST_MAX_PATTERN_LENGTH)}`;
    expect(
      validateResourceAllowlistText(AiResourceType.DockerHost, long),
    ).toMatch(/^Entry 1: An allowlist entry can be at most 500 characters/);
  });
});

describe("the stored allowlist", () => {
  test("is read the way the server reads it", () => {
    expect(readStoredResourceAllowlist([" docker stop web ", "", 3])).toEqual([
      "docker stop web",
    ]);
    expect(readStoredResourceAllowlist('["docker stop web"]')).toEqual([
      "docker stop web",
    ]);
    // A string that is not JSON is ONE entry.
    expect(readStoredResourceAllowlist("docker stop web")).toEqual([
      "docker stop web",
    ]);
    expect(readStoredResourceAllowlist(null)).toEqual([]);
    expect(readStoredResourceAllowlist({ a: 1 })).toEqual([]);
  });

  test("is shown whitespace-collapsed, and flagged when it is not a clean list", () => {
    expect(normalizeSavedResourceAllowlist(undefined)).toEqual({
      patterns: [],
      isClean: true,
    });
    expect(normalizeSavedResourceAllowlist(["docker  stop   web"])).toEqual({
      patterns: ["docker stop web"],
      isClean: true,
    });
    expect(normalizeSavedResourceAllowlist(["docker stop web", ""])).toEqual({
      patterns: ["docker stop web"],
      isClean: false,
    });
    expect(normalizeSavedResourceAllowlist("docker stop web")).toEqual({
      patterns: ["docker stop web"],
      isClean: false,
    });
    expect(normalizeSavedResourceAllowlist('["docker stop web"]')).toEqual({
      patterns: ["docker stop web"],
      isClean: true,
    });
  });

  test("the list in effect is the non-blank strings the status reports", () => {
    expect(
      getResourceAllowlistInEffect([
        "docker stop web",
        " ",
        7,
        "docker kill -s TERM api",
      ]),
    ).toEqual(["docker stop web", "docker kill -s TERM api"]);
    expect(getResourceAllowlistInEffect("docker stop web")).toEqual([]);
  });
});

describe("the saved settings", () => {
  test("investigation is off unless the resource says it is on", () => {
    expect(readResourceAiAccessSavedSettings({})).toEqual({
      isAiInvestigationEnabled: false,
      aiRemediationMode: ResourceAiRemediationMode.Disabled,
      aiCommandAllowlist: undefined,
    });
    expect(
      readResourceAiAccessSavedSettings({
        isAiInvestigationEnabled: true,
        aiRemediationMode: ResourceAiRemediationMode.Automatic,
        aiCommandAllowlist: ["docker stop web"],
      }),
    ).toEqual({
      isAiInvestigationEnabled: true,
      aiRemediationMode: ResourceAiRemediationMode.Automatic,
      aiCommandAllowlist: ["docker stop web"],
    });
  });

  test("seed the form, the allowlist as text", () => {
    expect(
      getResourceAiAccessSettingsInitialValues(
        saved({ aiCommandAllowlist: ["docker  stop web", "docker stop api"] }),
      ),
    ).toEqual({
      isAiInvestigationEnabled: true,
      aiRemediationMode: ResourceAiRemediationMode.RequireApproval,
      aiCommandAllowlistText: "docker stop web\ndocker stop api",
    });
  });
});

describe("what the form offers", () => {
  test("an admin edits the allowlist freely", () => {
    expect(
      getResourceAiAccessOfferedFields({
        saved: saved(),
        canConfigureUnattended: true,
      }),
    ).toEqual({ allowlist: true, allowlistRemoveOnly: false });
  });

  test("an editor gets it only when there is something to remove", () => {
    expect(
      getResourceAiAccessOfferedFields({
        saved: saved(),
        canConfigureUnattended: false,
      }),
    ).toEqual({ allowlist: false, allowlistRemoveOnly: true });
    expect(
      getResourceAiAccessOfferedFields({
        saved: saved({ aiCommandAllowlist: ["docker stop web"] }),
        canConfigureUnattended: false,
      }),
    ).toEqual({ allowlist: true, allowlistRemoveOnly: true });
    // A stored value that is not a clean list can be cleaned up.
    expect(
      getResourceAiAccessOfferedFields({
        saved: saved({ aiCommandAllowlist: "not json" }),
        canConfigureUnattended: false,
      }).allowlist,
    ).toBe(true);
  });

  test("the allowlist field only shows, and is only sent, in Automatic mode", () => {
    expect(
      isResourceAllowlistFieldShown(
        values({ aiRemediationMode: ResourceAiRemediationMode.Automatic }),
      ),
    ).toBe(true);
    expect(
      isResourceAllowlistFieldShown(
        values({
          aiRemediationMode: {
            value: ResourceAiRemediationMode.Automatic,
          } as unknown as string,
        }),
      ),
    ).toBe(true);
    expect(
      isResourceAllowlistFieldShown(
        values({ aiRemediationMode: ResourceAiRemediationMode.BypassApproval }),
      ),
    ).toBe(false);
    expect(
      getResourceAiAccessSubmittedFields({
        offered: ALL_OFFERED,
        values: values(),
      }),
    ).toEqual({ allowlist: false, allowlistRemoveOnly: false });
  });

  test("dropdown values are read bare or wrapped", () => {
    expect(readDropdownId("Automatic")).toBe("Automatic");
    expect(readDropdownId({ value: "Automatic", label: "x" })).toBe(
      "Automatic",
    );
    expect(readDropdownId({ value: { value: 3 } })).toBe("3");
    expect(readDropdownId("")).toBeNull();
    expect(readDropdownId(null)).toBeNull();
  });
});

describe("what a save sends", () => {
  test("nothing when nothing changed", () => {
    expect(
      getResourceAiAccessSettingsChanges({
        saved: saved(),
        values: values(),
        offered: ALL_OFFERED,
      }),
    ).toEqual({});
  });

  test("only the fields the user changed", () => {
    expect(
      getResourceAiAccessSettingsChanges({
        saved: saved({
          aiRemediationMode: ResourceAiRemediationMode.Automatic,
        }),
        values: values({
          isAiInvestigationEnabled: false,
          aiRemediationMode: ResourceAiRemediationMode.Automatic,
        }),
        offered: { allowlist: false, allowlistRemoveOnly: true },
      }),
    ).toEqual({ isAiInvestigationEnabled: false });

    expect(
      getResourceAiAccessSettingsChanges({
        saved: saved(),
        values: values({
          aiRemediationMode: ResourceAiRemediationMode.BypassApproval,
        }),
        offered: ALL_OFFERED,
      }),
    ).toEqual({ aiRemediationMode: ResourceAiRemediationMode.BypassApproval });
  });

  test("never a mode the page does not know", () => {
    expect(
      getResourceAiAccessSettingsChanges({
        saved: saved(),
        values: values({ aiRemediationMode: "FullAuto" }),
        offered: ALL_OFFERED,
      }),
    ).toEqual({});
  });

  test("the allowlist only when offered, and only when it changed", () => {
    const stored: ResourceAiAccessSavedSettings = saved({
      aiRemediationMode: ResourceAiRemediationMode.Automatic,
      aiCommandAllowlist: ["docker stop web"],
    });

    expect(
      getResourceAiAccessSettingsChanges({
        saved: stored,
        values: values({
          aiRemediationMode: ResourceAiRemediationMode.Automatic,
          aiCommandAllowlistText: "docker stop web\ndocker stop api",
        }),
        offered: ALL_OFFERED,
      }),
    ).toEqual({ aiCommandAllowlist: ["docker stop web", "docker stop api"] });

    expect(
      getResourceAiAccessSettingsChanges({
        saved: stored,
        values: values({
          aiRemediationMode: ResourceAiRemediationMode.Automatic,
          aiCommandAllowlistText: "docker   stop web",
        }),
        offered: ALL_OFFERED,
      }),
    ).toEqual({});

    expect(
      getResourceAiAccessSettingsChanges({
        saved: stored,
        values: values({
          aiRemediationMode: ResourceAiRemediationMode.Automatic,
          aiCommandAllowlistText: "",
        }),
        offered: { allowlist: false, allowlistRemoveOnly: false },
      }),
    ).toEqual({});
  });

  test("re-sends a kept entry in the spelling it is stored in", () => {
    expect(
      getResourceAiAccessSettingsChanges({
        saved: saved({
          aiCommandAllowlist: ["docker  stop web", "docker stop api"],
        }),
        values: values({ aiCommandAllowlistText: "docker stop web" }),
        offered: ALL_OFFERED,
      }),
    ).toEqual({ aiCommandAllowlist: ["docker  stop web"] });
  });

  test("rewrites a stored value that is not a clean list", () => {
    expect(
      getResourceAiAccessSettingsChanges({
        saved: saved({ aiCommandAllowlist: ["docker stop web", ""] }),
        values: values({ aiCommandAllowlistText: "docker stop web" }),
        offered: ALL_OFFERED,
      }),
    ).toEqual({ aiCommandAllowlist: ["docker stop web"] });
  });
});

describe("what loosens", () => {
  test("any move up, Off -> Ask for approval included", () => {
    expect(
      getResourceAiAccessLooseningChanges({
        saved: saved({ aiRemediationMode: ResourceAiRemediationMode.Disabled }),
        changes: {
          aiRemediationMode: ResourceAiRemediationMode.RequireApproval,
        },
      }),
    ).toEqual(["switching fixes to Ask for approval"]);
    expect(
      getResourceAiAccessLooseningChanges({
        saved: saved(),
        changes: {
          aiRemediationMode: ResourceAiRemediationMode.BypassApproval,
        },
      }),
    ).toEqual(["switching fixes to Bypass approval"]);
  });

  test("moves down, the investigation switch and removals do not", () => {
    expect(
      getResourceAiAccessLooseningChanges({
        saved: saved({
          aiRemediationMode: ResourceAiRemediationMode.BypassApproval,
          aiCommandAllowlist: ["docker stop web", "docker stop api"],
        }),
        changes: {
          aiRemediationMode: ResourceAiRemediationMode.Automatic,
          isAiInvestigationEnabled: true,
          aiCommandAllowlist: ["docker stop web"],
        },
      }),
    ).toEqual([]);
  });

  test("an entry the stored list does not hold, named", () => {
    expect(
      getResourceAiAccessLooseningChanges({
        saved: saved({ aiCommandAllowlist: ["docker stop web"] }),
        changes: {
          aiCommandAllowlist: ["docker stop web", "docker stop api"],
        },
      }),
    ).toEqual(['adding the allowlist entry "docker stop api"']);
    expect(
      getResourceAiAccessLooseningChanges({
        saved: saved(),
        changes: {
          aiCommandAllowlist: ["docker stop web", "docker stop api"],
          aiRemediationMode: ResourceAiRemediationMode.Automatic,
        },
      }),
    ).toEqual([
      "switching fixes to Automatic",
      'adding the allowlist entries "docker stop web", "docker stop api"',
    ]);
  });

  test("an editor's allowlist field refuses any line the stored list lacks", () => {
    expect(
      getResourceAllowlistRemovalOnlyError({
        text: "docker stop web",
        storedValue: ["docker  stop web", "docker stop api"],
      }),
    ).toBeNull();
    expect(
      getResourceAllowlistRemovalOnlyError({
        text: "",
        storedValue: ["docker stop web"],
      }),
    ).toBeNull();

    const refusal: string | null = getResourceAllowlistRemovalOnlyError({
      text: "docker stop web\ndocker stop db",
      storedValue: ["docker stop web"],
    });
    expect(refusal).toContain(
      'Entry 2 ("docker stop db") is not in the saved allowlist.',
    );
    expect(refusal).toContain("Edit Auto Remediation Rule");
  });
});

describe("the confirmation before a save", () => {
  test("Bypass approval is always confirmed, naming what it unlocks", () => {
    const confirmation: ResourceAiAccessConfirmation | null =
      getResourceAiAccessConfirmation({
        descriptor: DOCKER,
        saved: saved(),
        changes: {
          aiRemediationMode: ResourceAiRemediationMode.BypassApproval,
        },
      });

    expect(confirmation?.title).toBe("Turn on Bypass approval?");
    expect(confirmation?.description).toContain(
      "on this Docker host on its own — riskier changes such as stopping, killing or updating a container included",
    );
    expect(confirmation?.description).toContain(
      getEveryModeProtectionsSentence(DOCKER),
    );
  });

  test.each(
    ALL_AI_RESOURCE_TYPES.filter((type: AiResourceType): boolean => {
      return ENTRIES[type].broad !== null;
    }),
  )("%s: adding a broad entry is confirmed", (type: AiResourceType) => {
    const descriptor: ResourceAiAgentDescriptor =
      getResourceAiAgentDescriptor(type);
    const confirmation: ResourceAiAccessConfirmation | null =
      getResourceAiAccessConfirmation({
        descriptor,
        saved: saved({
          aiRemediationMode: ResourceAiRemediationMode.Automatic,
        }),
        changes: {
          aiCommandAllowlist: [ENTRIES[type].valid, ENTRIES[type].broad!],
        },
      });

    expect(confirmation?.title).toBe(
      "Let riskier changes run without approval?",
    );
    expect(confirmation?.description).toContain(
      `The allowlist entry "${ENTRIES[type].broad}" uses a * for the object a change touches`,
    );
    expect(confirmation?.description).toContain("In Automatic mode");
  });

  test.each(ALL_AI_RESOURCE_TYPES)(
    "%s: an entry that names its object needs no confirmation",
    (type: AiResourceType) => {
      expect(
        getResourceAiAccessConfirmation({
          descriptor: getResourceAiAgentDescriptor(type),
          saved: saved({
            aiRemediationMode: ResourceAiRemediationMode.Automatic,
          }),
          changes: { aiCommandAllowlist: [ENTRIES[type].valid] },
        }),
      ).toBeNull();
    },
  );

  test("a broad entry kept while switching to Automatic is confirmed", () => {
    const confirmation: ResourceAiAccessConfirmation | null =
      getResourceAiAccessConfirmation({
        descriptor: DOCKER,
        saved: saved({ aiCommandAllowlist: ["docker stop *"] }),
        changes: { aiRemediationMode: ResourceAiRemediationMode.Automatic },
      });

    expect(confirmation?.title).toBe(
      "Let riskier changes run without approval?",
    );
  });

  test("a broad entry added before Automatic is on says when it will apply", () => {
    expect(
      getResourceAiAccessConfirmation({
        descriptor: DOCKER,
        saved: saved(),
        changes: {
          aiCommandAllowlist: ["docker stop *", "docker kill -s TERM *"],
        },
      })?.description,
    ).toContain(
      'The allowlist entries "docker stop *", "docker kill -s TERM *" use a * for the object a change touches, so they pre-approve a whole class of changes, not one. Once this Docker host is switched to Automatic mode',
    );
  });

  test("no new risk, no confirmation: stepping down, or keeping what was saved", () => {
    expect(
      getResourceAiAccessConfirmation({
        descriptor: DOCKER,
        saved: saved({
          aiRemediationMode: ResourceAiRemediationMode.BypassApproval,
          aiCommandAllowlist: ["docker stop *"],
        }),
        changes: { aiRemediationMode: ResourceAiRemediationMode.Automatic },
      }),
    ).toBeNull();
    expect(
      getResourceAiAccessConfirmation({
        descriptor: DOCKER,
        saved: saved({
          aiRemediationMode: ResourceAiRemediationMode.Automatic,
          aiCommandAllowlist: ["docker stop *"],
        }),
        changes: { isAiInvestigationEnabled: false },
      }),
    ).toBeNull();
    expect(
      getResourceAiAccessConfirmation({
        descriptor: DOCKER,
        saved: saved(),
        changes: { aiRemediationMode: ResourceAiRemediationMode.Disabled },
      }),
    ).toBeNull();
  });

  test("a Proxmox entry is never broad: its paths are written out per guest", () => {
    const proxmox: ResourceAiAgentDescriptor = getResourceAiAgentDescriptor(
      AiResourceType.ProxmoxCluster,
    );
    const changes: JSONObject = {
      aiRemediationMode: ResourceAiRemediationMode.Automatic,
      aiCommandAllowlist: [
        "pvesh create /nodes/pve1/qemu/100/status/shutdown --timeout *",
      ],
    };
    expect(
      getResourceAiAccessConfirmation({
        descriptor: proxmox,
        saved: saved(),
        changes,
      }),
    ).toBeNull();
  });
});

describe("small words", () => {
  test("lists and capitals", () => {
    expect(formatNameList([], "and")).toBe("");
    expect(formatNameList(["a"], "and")).toBe("a");
    expect(formatNameList(["a", "b"], "or")).toBe("a or b");
    expect(formatNameList(["a", "b", "c"], "and")).toBe("a, b and c");
    expect(capitalizeFirst("switching fixes")).toBe("Switching fixes");
    expect(capitalizeFirst("")).toBe("");
  });

  test.each(ALL_AI_RESOURCE_TYPES)(
    "%s: the allowlist field's help gives its own example and the matcher's rules",
    (type: AiResourceType) => {
      const descriptor: ResourceAiAgentDescriptor =
        getResourceAiAgentDescriptor(type);
      const help: string = getResourceAllowlistFieldDescription(descriptor);

      expect(help).toContain(`for example: ${descriptor.allowlistPlaceholder}`);
      expect(help).toContain(`at most ${RESOURCE_ALLOWLIST_MAX_PATTERNS}`);
      expect(help).toContain("a * stands for exactly one whole word");
      expect(help).toContain(
        "A riskier fix that matches an entry runs without approval.",
      );
    },
  );

  /*
   * The help used to be a paragraph that also restated the permission
   * rules, the broad-entry confirmation and the every-mode protections —
   * each of which the modal says where it applies. It stays short.
   */
  test.each(ALL_AI_RESOURCE_TYPES)(
    "%s: the allowlist field's help stays short and leaves permissions to the admin note",
    (type: AiResourceType) => {
      const help: string = getResourceAllowlistFieldDescription(
        getResourceAiAgentDescriptor(type),
      );

      expect(help.split(/\s+/).length).toBeLessThan(60);
      expect(help).not.toMatch(/permission|Project Owner|Project Admin/);
      expect(help).not.toMatch(/^Optional\./);
    },
  );
});

/*
 * What the resource's Change modal and its confirmations say is looked up
 * in the Dashboard's locale files (src/Locales/README.md). The protections
 * said as one sentence and the refused loosening are built from translated
 * pieces in the language of the sentence they go into: a locale that words
 * the pieces but not the confirmation reads an English confirmation, never
 * English around translated clauses.
 *
 * A pseudo-locale wraps every en.json entry in ‹ ›. These run last: they set
 * up the global i18next instance the functions read.
 */
describe("in the reader's language", () => {
  const ENGLISH: Record<string, unknown> = JSON.parse(
    fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../../App/FeatureSet/Dashboard/src/Locales/en.json",
      ),
      "utf8",
    ),
  ) as Record<string, unknown>;

  const LOOKED_UP: RegExp = /^‹[^]*›$/;

  const BYPASS_SENTENCE: string =
    "With Bypass approval OneUptime AI does not ask: it applies every fix the command policy allows on this {{noun}} on its own — {{riskierExamples}} included, in follow-up rounds too. Even so, {{protections}}.";

  const toBypass: {
    descriptor: ResourceAiAgentDescriptor;
    saved: ResourceAiAccessSavedSettings;
    changes: JSONObject;
  } = {
    descriptor: DOCKER,
    saved: saved(),
    changes: { aiRemediationMode: ResourceAiRemediationMode.BypassApproval },
  };

  beforeAll(async () => {
    const pseudo: Record<string, string> = {};

    for (const [key, value] of Object.entries(ENGLISH)) {
      if (typeof value === "string") {
        pseudo[key] = `‹${value}›`;
      }
    }

    // Every wording but the Bypass approval confirmation's.
    const withoutBypassSentence: Record<string, string> = { ...pseudo };
    delete withoutBypassSentence[BYPASS_SENTENCE];

    await i18next.init({
      lng: "xx",
      fallbackLng: "en",
      resources: {
        xx: { translation: pseudo },
        yy: { translation: withoutBypassSentence },
      },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });
  });

  afterAll(async () => {
    await i18next.changeLanguage("en");
  });

  test("the mode maps are keys in en.json", async () => {
    await i18next.changeLanguage("xx");

    for (const key of [
      ...Object.values(RESOURCE_REMEDIATION_MODE_SHORT_NAMES),
      ...Object.values(RESOURCE_REMEDIATION_MODE_SUMMARIES),
      getResourceAiAccessConfirmation(toBypass)!.title,
    ]) {
      expect({ key, english: ENGLISH[key] }).toEqual({ key, english: key });
    }
  });

  test("every resource's protections, one by one and as one sentence", async () => {
    await i18next.changeLanguage("xx");

    for (const type of ALL_AI_RESOURCE_TYPES) {
      const descriptor: ResourceAiAgentDescriptor =
        getResourceAiAgentDescriptor(type);
      const clauses: Array<string> = getEveryModeProtections(descriptor);

      for (const clause of clauses) {
        expect({ type, clause }).toEqual({
          type,
          clause: expect.stringMatching(LOOKED_UP),
        });
      }
      expect(getEveryModeProtectionsSentence(descriptor)).toMatch(LOOKED_UP);
    }
  });

  test("what loosens, and the allowlist's errors", async () => {
    await i18next.changeLanguage("xx");

    expect(
      getResourceAiAccessLooseningChanges({
        saved: saved({ aiRemediationMode: ResourceAiRemediationMode.Disabled }),
        changes: {
          aiRemediationMode: ResourceAiRemediationMode.Automatic,
          aiCommandAllowlist: ["docker stop web"],
        },
      }),
    ).toEqual([
      "‹switching fixes to ‹Automatic››",
      '‹adding the allowlist entry "docker stop web"›',
    ]);
    // The policy's own words stay as it says them.
    expect(
      validateResourceAllowlistText(
        AiResourceType.DockerHost,
        "docker stop web\nrm -rf /",
      ),
    ).toMatch(/^‹Entry 2: .+›$/);
  });

  test("the confirmations, the protections in them in the reader's words", async () => {
    await i18next.changeLanguage("xx");

    const bypass: ResourceAiAccessConfirmation | null =
      getResourceAiAccessConfirmation(toBypass);

    expect(bypass!.description).toMatch(LOOKED_UP);
    expect(bypass!.description).toContain(
      getEveryModeProtectionsSentence(DOCKER),
    );

    const broad: ResourceAiAccessConfirmation | null =
      getResourceAiAccessConfirmation({
        descriptor: DOCKER,
        saved: saved({
          aiRemediationMode: ResourceAiRemediationMode.Automatic,
        }),
        changes: { aiCommandAllowlist: ["docker stop *"] },
      });

    expect(ENGLISH[broad!.title]).toBe(broad!.title);
    expect(broad!.description).toMatch(LOOKED_UP);
  });

  /*
   * The Automatic card used to cut "riskier changes such as" off a key and
   * look the rest up, which no locale has: its examples read English in
   * every language. The Investigation row's examples are words for a
   * Proxmox cluster and a database server, and command names otherwise.
   */
  test("the mode cards and the investigation sentence name their examples in the reader's words", async () => {
    await i18next.changeLanguage("xx");

    for (const type of ALL_AI_RESOURCE_TYPES) {
      const descriptor: ResourceAiAgentDescriptor =
        getResourceAiAgentDescriptor(type);

      expect(ENGLISH[descriptor.riskierChanges]).toBe(
        descriptor.riskierChanges,
      );
      expect(
        getResourceRemediationModeOptionDescriptions(descriptor)[
          ResourceAiRemediationMode.Automatic
        ],
      ).toContain(`‹${descriptor.riskierChanges}›`);
    }

    for (const type of [
      AiResourceType.ProxmoxCluster,
      AiResourceType.DatabaseServer,
    ]) {
      const descriptor: ResourceAiAgentDescriptor =
        getResourceAiAgentDescriptor(type);

      expect(ENGLISH[descriptor.readExamples]).toBe(descriptor.readExamples);
      expect(getResourceInvestigationOnSentence(descriptor)).toContain(
        `: ‹${descriptor.readExamples}›.`,
      );
    }

    // Command names stay as they are.
    expect(getResourceInvestigationOnSentence(DOCKER)).toContain(
      ": ps, inspect, logs, stats, events.",
    );
  });

  test("a confirmation the reader's language lacks is English, its protections too", async () => {
    await i18next.changeLanguage("en");
    const english: string =
      getResourceAiAccessConfirmation(toBypass)!.description;

    await i18next.changeLanguage("yy");
    expect(getResourceAiAccessConfirmation(toBypass)!.description).toBe(
      english,
    );
    expect(getEveryModeProtectionsSentence(DOCKER)).toMatch(LOOKED_UP);
  });
});
