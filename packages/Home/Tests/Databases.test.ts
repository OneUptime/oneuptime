import {
  DATABASE_AGENT_RECEIVERS,
  DatabaseAlertTemplateEntry,
  DatabaseAlertTemplateGroup,
  DatabaseEngineEntry,
  DatabaseEngineGroup,
  DatabaseEngineGroupKey,
  DatabasesPageContent,
  getDatabaseAlertTemplateGroups,
  getDatabaseEngineGroupKey,
  getDatabaseEngineGroups,
  getDatabasesPageContent,
} from "../Utils/Databases";
import {
  DATABASE_SYSTEMS,
  DatabaseSystemDescriptor,
} from "Common/Types/DatabaseServer/DatabaseSystem";
import {
  DatabaseAlertTemplate,
  getAllDatabaseAlertTemplates,
  getDatabaseAlertTemplates,
} from "Common/Types/Monitor/DatabaseAlertTemplates";
import fs from "fs";
import path from "path";

/*
 * The Databases product page renders its engine list and its recommended
 * monitors from the product's own catalogs, through Utils/Databases.ts.
 * These pin the shaping: every engine lands in exactly one group, in the
 * group its engine-metrics source says, and every monitor is listed under
 * the engines the Recommendations tab really offers it to.
 */

const DATABASE_AGENT_CONFIGS_DIRECTORY: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "agents",
  "DatabaseAgent",
  "configs",
);

function descriptorFor(system: string): DatabaseSystemDescriptor {
  const descriptor: DatabaseSystemDescriptor | undefined =
    DATABASE_SYSTEMS.find((candidate: DatabaseSystemDescriptor): boolean => {
      return candidate.system === system;
    });

  if (!descriptor) {
    throw new Error(`${system} is not in DATABASE_SYSTEMS`);
  }

  return descriptor;
}

function systemsOf(group: DatabaseEngineGroup): Array<string> {
  return group.engines.map((engine: DatabaseEngineEntry): string => {
    return engine.system;
  });
}

function usesDatabaseAgentReceiver(
  descriptor: DatabaseSystemDescriptor,
): boolean {
  return descriptor.receiverTypes.some((receiver: string): boolean => {
    return DATABASE_AGENT_RECEIVERS.includes(receiver);
  });
}

describe("the Database Agent's receivers", () => {
  test("are exactly the configs the agent ships", () => {
    /*
     * install.sh downloads configs/<receiver>.yaml for the engine; a config
     * added or dropped there changes which engines the page files under the
     * Database Agent.
     */
    const shipped: Array<string> = fs
      .readdirSync(DATABASE_AGENT_CONFIGS_DIRECTORY)
      .filter((fileName: string): boolean => {
        return fileName.endsWith(".yaml");
      })
      .map((fileName: string): string => {
        return path.basename(fileName, ".yaml");
      })
      .sort();

    expect(shipped.length).toBeGreaterThan(0);
    expect([...DATABASE_AGENT_RECEIVERS].sort()).toEqual(shipped);
  });

  test("each one monitors an engine the catalog knows", () => {
    for (const receiver of DATABASE_AGENT_RECEIVERS) {
      expect(
        DATABASE_SYSTEMS.some((descriptor: DatabaseSystemDescriptor) => {
          return descriptor.receiverTypes.includes(receiver);
        }),
      ).toBe(true);
    }
  });
});

describe("getDatabaseEngineGroups", () => {
  const groups: Array<DatabaseEngineGroup> = getDatabaseEngineGroups();

  test("puts every catalog engine in exactly one group", () => {
    const grouped: Array<string> = groups.flatMap(systemsOf);

    expect(new Set(grouped).size).toBe(grouped.length);
    expect([...grouped].sort()).toEqual(
      DATABASE_SYSTEMS.map((descriptor: DatabaseSystemDescriptor): string => {
        return descriptor.system;
      }).sort(),
    );
  });

  test("groups each engine by where its engine metrics come from", () => {
    const expectedKind: Record<
      DatabaseEngineGroupKey,
      (descriptor: DatabaseSystemDescriptor) => boolean
    > = {
      "database-agent": (descriptor: DatabaseSystemDescriptor): boolean => {
        return (
          descriptor.engineMetrics.kind === "receiver" &&
          usesDatabaseAgentReceiver(descriptor)
        );
      },
      "collector-receiver": (descriptor: DatabaseSystemDescriptor): boolean => {
        return (
          descriptor.engineMetrics.kind === "receiver" &&
          !usesDatabaseAgentReceiver(descriptor)
        );
      },
      prometheus: (descriptor: DatabaseSystemDescriptor): boolean => {
        return descriptor.engineMetrics.kind === "prometheus";
      },
      "cloud-monitoring": (descriptor: DatabaseSystemDescriptor): boolean => {
        return descriptor.engineMetrics.kind === "cloud-monitoring";
      },
      "no-built-in-metrics": (
        descriptor: DatabaseSystemDescriptor,
      ): boolean => {
        return descriptor.engineMetrics.kind === "none";
      },
      "in-process": (descriptor: DatabaseSystemDescriptor): boolean => {
        return descriptor.engineMetrics.kind === "embedded";
      },
    };

    for (const group of groups) {
      for (const system of systemsOf(group)) {
        const descriptor: DatabaseSystemDescriptor = descriptorFor(system);

        expect(getDatabaseEngineGroupKey(descriptor)).toBe(group.key);
        expect({
          system,
          matches: expectedKind[group.key](descriptor),
        }).toEqual({ system, matches: true });
      }
    }
  });

  test("files exactly the engines the Database Agent documents under it", () => {
    /*
     * docs/telemetry/databases.md: "a pre-configured OpenTelemetry Collector
     * for PostgreSQL, MySQL / MariaDB, SQL Server, Oracle, Redis / Valkey /
     * KeyDB / Dragonfly, MongoDB, Elasticsearch / OpenSearch and Memcached".
     */
    const agentGroup: DatabaseEngineGroup | undefined = groups.find(
      (group: DatabaseEngineGroup): boolean => {
        return group.key === "database-agent";
      },
    );

    expect(agentGroup).toBeDefined();
    expect(systemsOf(agentGroup!).sort()).toEqual(
      [
        "postgresql",
        "mysql",
        "mariadb",
        "microsoft.sql_server",
        "oracle.db",
        "redis",
        "valkey",
        "keydb",
        "dragonfly",
        "mongodb",
        "elasticsearch",
        "opensearch",
        "memcached",
      ].sort(),
    );
  });

  test("orders the engines of a group by name", () => {
    for (const group of groups) {
      const names: Array<string> = group.engines.map(
        (engine: DatabaseEngineEntry): string => {
          return engine.displayName;
        },
      );
      const sorted: Array<string> = [...names].sort(
        (a: string, b: string): number => {
          return a.localeCompare(b, "en", { sensitivity: "base" });
        },
      );

      expect(names).toEqual(sorted);
    }
  });

  test("shows each engine under the catalog's display name", () => {
    for (const group of groups) {
      for (const engine of group.engines) {
        expect(engine.displayName).toBe(
          descriptorFor(engine.system).displayName,
        );
      }
    }
  });

  test("leads with the Database Agent and leaves no group empty", () => {
    const keys: Array<DatabaseEngineGroupKey> = groups.map(
      (group: DatabaseEngineGroup): DatabaseEngineGroupKey => {
        return group.key;
      },
    );

    expect(keys[0]).toBe("database-agent");
    expect(new Set(keys).size).toBe(keys.length);

    for (const group of groups) {
      expect(group.engines.length).toBeGreaterThan(0);
      expect(group.title.trim().length).toBeGreaterThan(0);
      expect(group.description.trim()).toMatch(/\.$/);
    }
  });
});

describe("getDatabaseAlertTemplateGroups", () => {
  const groups: Array<DatabaseAlertTemplateGroup> =
    getDatabaseAlertTemplateGroups();
  const templates: Array<DatabaseAlertTemplate> =
    getAllDatabaseAlertTemplates();

  test("lists every template once, in the library's order", () => {
    const listed: Array<DatabaseAlertTemplateEntry> = groups.flatMap(
      (
        group: DatabaseAlertTemplateGroup,
      ): Array<DatabaseAlertTemplateEntry> => {
        return group.templates;
      },
    );

    expect(listed).toEqual(
      templates.map(
        (template: DatabaseAlertTemplate): DatabaseAlertTemplateEntry => {
          return { name: template.name, severity: template.severity };
        },
      ),
    );
  });

  test("has one group per receiver, titled with the engine it reports", () => {
    const receivers: Array<string> = groups.map(
      (group: DatabaseAlertTemplateGroup): string => {
        return group.receiver;
      },
    );

    expect(new Set(receivers).size).toBe(receivers.length);

    for (const group of groups) {
      const engines: Set<string> = new Set(
        templates
          .filter((template: DatabaseAlertTemplate): boolean => {
            return template.receiver === group.receiver;
          })
          .map((template: DatabaseAlertTemplate): string => {
            return template.engine;
          }),
      );

      expect(engines.size).toBe(1);
      expect(group.title).toBe(descriptorFor([...engines][0]!).displayName);
    }
  });

  test("names exactly the engines the Recommendations tab offers each group to", () => {
    /*
     * The page must promise a monitor to an engine only when that engine's
     * Recommendations tab offers it (getDatabaseAlertTemplates), and must
     * not leave out an engine it is offered to.
     */
    for (const descriptor of DATABASE_SYSTEMS) {
      const offered: Array<string> = getDatabaseAlertTemplates(
        descriptor.system,
      ).map((template: DatabaseAlertTemplate): string => {
        return template.name;
      });
      const naming: Array<DatabaseAlertTemplateGroup> = groups.filter(
        (group: DatabaseAlertTemplateGroup): boolean => {
          return (
            group.title === descriptor.displayName ||
            group.alsoOfferedTo.includes(descriptor.displayName)
          );
        },
      );

      if (offered.length === 0) {
        expect({ engine: descriptor.system, groups: naming.length }).toEqual({
          engine: descriptor.system,
          groups: 0,
        });
        continue;
      }

      expect({ engine: descriptor.system, groups: naming.length }).toEqual({
        engine: descriptor.system,
        groups: 1,
      });
      expect(
        naming[0]!.templates.map(
          (template: DatabaseAlertTemplateEntry): string => {
            return template.name;
          },
        ),
      ).toEqual(offered);
    }
  });

  test("names a fork under the family whose receiver monitors it", () => {
    const alsoOfferedTo: (receiver: string) => Array<string> = (
      receiver: string,
    ): Array<string> => {
      return (
        groups.find((group: DatabaseAlertTemplateGroup): boolean => {
          return group.receiver === receiver;
        })?.alsoOfferedTo || []
      );
    };

    expect(alsoOfferedTo("mysql")).toEqual(["MariaDB"]);
    expect([...alsoOfferedTo("redis")].sort()).toEqual(
      ["Dragonfly", "KeyDB", "Valkey"].sort(),
    );
    expect(alsoOfferedTo("elasticsearch")).toEqual(["OpenSearch"]);
    expect(alsoOfferedTo("postgresql")).toEqual([]);
  });
});

describe("getDatabasesPageContent", () => {
  const content: DatabasesPageContent = getDatabasesPageContent();

  test("counts come from the product's catalogs", () => {
    expect(content.engineCount).toBe(DATABASE_SYSTEMS.length);
    expect(content.alertTemplateCount).toBe(
      getAllDatabaseAlertTemplates().length,
    );
    expect(content.enginesWithAlertTemplatesCount).toBe(
      DATABASE_SYSTEMS.filter((descriptor: DatabaseSystemDescriptor) => {
        return getDatabaseAlertTemplates(descriptor.system).length > 0;
      }).length,
    );
  });

  test("the groups add up to the counts the headings print", () => {
    expect(
      content.engineGroups.reduce(
        (total: number, group: DatabaseEngineGroup): number => {
          return total + group.engines.length;
        },
        0,
      ),
    ).toBe(content.engineCount);

    expect(
      content.alertTemplateGroups.reduce(
        (total: number, group: DatabaseAlertTemplateGroup): number => {
          return total + group.templates.length;
        },
        0,
      ),
    ).toBe(content.alertTemplateCount);

    expect(
      content.alertTemplateGroups.reduce(
        (total: number, group: DatabaseAlertTemplateGroup): number => {
          return total + 1 + group.alsoOfferedTo.length;
        },
        0,
      ),
    ).toBe(content.enginesWithAlertTemplatesCount);
  });

  test("is plain data a template can render", () => {
    expect(JSON.parse(JSON.stringify(content))).toEqual(content);
  });
});
