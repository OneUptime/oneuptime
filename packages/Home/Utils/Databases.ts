/*
 * Structured content for the Databases product page (/product/databases).
 *
 * The page's two most checkable claims come from the product's own catalogs
 * in Common instead of being typed into the template, so they cannot drift
 * from what the Databases product does:
 *
 *   - which engines OneUptime knows by name, and where each one's engine
 *     metrics come from (DATABASE_SYSTEMS in
 *     Common/Types/DatabaseServer/DatabaseSystem.ts);
 *   - the ready-made monitors a database's Recommendations tab offers for its
 *     engine (Common/Types/Monitor/DatabaseAlertTemplates.ts).
 *
 * An engine added to the catalog, or a template renamed, shows on the page
 * the next time it renders.
 */
import {
  DATABASE_SYSTEMS,
  DatabaseSystemDescriptor,
  getDatabaseSystemDisplayName,
} from "Common/Types/DatabaseServer/DatabaseSystem";
import {
  DatabaseAlertTemplate,
  DatabaseAlertTemplateSeverity,
  getAllDatabaseAlertTemplates,
  getDatabaseAlertTemplates,
} from "Common/Types/Monitor/DatabaseAlertTemplates";

/*
 * The collector receivers the OneUptime Database Agent ships a config for
 * (agents/DatabaseAgent/configs/<receiver>.yaml). Tests/Databases.test.ts
 * reads that directory, so a config added or removed there fails the suite
 * until this list follows.
 */
export const DATABASE_AGENT_RECEIVERS: ReadonlyArray<string> = [
  "postgresql",
  "mysql",
  "sqlserver",
  "oracledb",
  "redis",
  "mongodb",
  "elasticsearch",
  "memcached",
];

export type DatabaseEngineGroupKey =
  | "database-agent"
  | "collector-receiver"
  | "prometheus"
  | "cloud-monitoring"
  | "no-built-in-metrics"
  | "in-process";

export interface DatabaseEngineEntry {
  // The engine's `db.system.name`, as the catalog stores it.
  system: string;
  displayName: string;
}

export interface DatabaseEngineGroup {
  key: DatabaseEngineGroupKey;
  title: string;
  description: string;
  engines: Array<DatabaseEngineEntry>;
}

export interface DatabaseAlertTemplateEntry {
  name: string;
  severity: DatabaseAlertTemplateSeverity;
}

export interface DatabaseAlertTemplateGroup {
  // The collector receiver whose metrics the group's monitors read.
  receiver: string;
  // The engine that receiver reports: "PostgreSQL", "MySQL".
  title: string;
  // Forks and drop-ins the same monitors are offered to: "MariaDB".
  alsoOfferedTo: Array<string>;
  templates: Array<DatabaseAlertTemplateEntry>;
}

export interface DatabasesPageContent {
  engineCount: number;
  engineGroups: Array<DatabaseEngineGroup>;
  alertTemplateCount: number;
  // Engines whose Recommendations tab offers at least one monitor.
  enginesWithAlertTemplatesCount: number;
  alertTemplateGroups: Array<DatabaseAlertTemplateGroup>;
}

interface DatabaseEngineGroupCopy {
  key: DatabaseEngineGroupKey;
  title: string;
  description: string;
}

// Page order: the most complete coverage first.
const ENGINE_GROUP_COPY: Array<DatabaseEngineGroupCopy> = [
  {
    key: "database-agent",
    title: "Database Agent",
    description:
      "Engine metrics from the OneUptime Database Agent: a stock OpenTelemetry Collector with a ready-made config for each engine.",
  },
  {
    key: "collector-receiver",
    title: "Collector receiver",
    description:
      "Engine metrics from an OpenTelemetry Collector receiver you add to your own collector. Each database's Documentation tab renders the config.",
  },
  {
    key: "prometheus",
    title: "Prometheus endpoint",
    description:
      "The engine serves its own Prometheus metrics. Scrape them with the collector's Prometheus receiver, stamped with the database's identity.",
  },
  {
    key: "cloud-monitoring",
    title: "Cloud monitoring",
    description:
      "Managed services whose metrics come from the provider's monitoring API: CloudWatch through a metric stream, Azure Monitor, or Cloud Monitoring.",
  },
  {
    key: "no-built-in-metrics",
    title: "Queries, pods & containers",
    description:
      "Known by name, so whatever your traces and container agents see of them lands on one page. There is no ready-made engine-metrics path yet: the Documentation tab says what to export.",
  },
  {
    key: "in-process",
    title: "In-process",
    description:
      "Libraries that run inside your application. They are recognised in your traces, and there is no server to collect engine metrics from.",
  },
];

function isDatabaseAgentEngine(descriptor: DatabaseSystemDescriptor): boolean {
  return descriptor.receiverTypes.some((receiver: string): boolean => {
    return DATABASE_AGENT_RECEIVERS.includes(receiver);
  });
}

export function getDatabaseEngineGroupKey(
  descriptor: DatabaseSystemDescriptor,
): DatabaseEngineGroupKey {
  switch (descriptor.engineMetrics.kind) {
    case "receiver":
      return isDatabaseAgentEngine(descriptor)
        ? "database-agent"
        : "collector-receiver";
    case "prometheus":
      return "prometheus";
    case "cloud-monitoring":
      return "cloud-monitoring";
    case "embedded":
      return "in-process";
    case "none":
    default:
      return "no-built-in-metrics";
  }
}

function compareDisplayNames(
  a: DatabaseEngineEntry,
  b: DatabaseEngineEntry,
): number {
  return a.displayName.localeCompare(b.displayName, "en", {
    sensitivity: "base",
  });
}

export function getDatabaseEngineGroups(): Array<DatabaseEngineGroup> {
  return ENGINE_GROUP_COPY.map(
    (copy: DatabaseEngineGroupCopy): DatabaseEngineGroup => {
      const engines: Array<DatabaseEngineEntry> = DATABASE_SYSTEMS.filter(
        (descriptor: DatabaseSystemDescriptor): boolean => {
          return getDatabaseEngineGroupKey(descriptor) === copy.key;
        },
      )
        .map((descriptor: DatabaseSystemDescriptor): DatabaseEngineEntry => {
          return {
            system: descriptor.system,
            displayName: descriptor.displayName,
          };
        })
        .sort(compareDisplayNames);

      return { ...copy, engines };
    },
  ).filter((group: DatabaseEngineGroup): boolean => {
    return group.engines.length > 0;
  });
}

/*
 * One group per collector receiver, in the order the template library
 * declares them. A fork its family's receiver monitors (MariaDB, Valkey,
 * OpenSearch) is offered the family's monitors, so it is named under the
 * family rather than repeated as a group of its own.
 */
export function getDatabaseAlertTemplateGroups(): Array<DatabaseAlertTemplateGroup> {
  const groups: Array<DatabaseAlertTemplateGroup> = [];

  for (const template of getAllDatabaseAlertTemplates()) {
    let group: DatabaseAlertTemplateGroup | undefined = groups.find(
      (existing: DatabaseAlertTemplateGroup): boolean => {
        return existing.receiver === template.receiver;
      },
    );

    if (!group) {
      group = {
        receiver: template.receiver,
        title: getDatabaseSystemDisplayName(template.engine),
        alsoOfferedTo: DATABASE_SYSTEMS.filter(
          (descriptor: DatabaseSystemDescriptor): boolean => {
            return (
              descriptor.system !== template.engine &&
              descriptor.receiverTypes.includes(template.receiver)
            );
          },
        ).map((descriptor: DatabaseSystemDescriptor): string => {
          return descriptor.displayName;
        }),
        templates: [],
      };
      groups.push(group);
    }

    group.templates.push({
      name: template.name,
      severity: template.severity,
    });
  }

  return groups;
}

export function getDatabasesPageContent(): DatabasesPageContent {
  const templates: Array<DatabaseAlertTemplate> =
    getAllDatabaseAlertTemplates();

  return {
    engineCount: DATABASE_SYSTEMS.length,
    engineGroups: getDatabaseEngineGroups(),
    alertTemplateCount: templates.length,
    enginesWithAlertTemplatesCount: DATABASE_SYSTEMS.filter(
      (descriptor: DatabaseSystemDescriptor): boolean => {
        return getDatabaseAlertTemplates(descriptor.system).length > 0;
      },
    ).length,
    alertTemplateGroups: getDatabaseAlertTemplateGroups(),
  };
}

export default getDatabasesPageContent;
