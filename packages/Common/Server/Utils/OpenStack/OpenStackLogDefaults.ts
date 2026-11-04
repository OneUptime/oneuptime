import LogDropFilter from "../../../Models/DatabaseModels/LogDropFilter";
import LogScrubRule from "../../../Models/DatabaseModels/LogScrubRule";
import LogDropFilterAction from "../../../Types/Log/LogDropFilterAction";
import LogScrubAction from "../../../Types/Log/LogScrubAction";
import LogScrubField from "../../../Types/Log/LogScrubField";
import LogScrubPatternType from "../../../Types/Log/LogScrubPatternType";
import ObjectID from "../../../Types/ObjectID";
import {
  OPENSTACK_LOG_NOISE_HEALTH_CHECK,
  OpenStackLogAttribute,
} from "../../../Utils/OpenStack/OpenStackLogs";
import {
  OpenStackEventAttribute,
  OpenStackEventImportance,
} from "../../../Utils/OpenStack/OpenStackNotifications";
import GlobalCache from "../../Infrastructure/GlobalCache";
import LogDropFilterService from "../../Services/LogDropFilterService";
import LogScrubRuleService from "../../Services/LogScrubRuleService";
import logger from "../Logger";

/*
 * WHAT A PROJECT'S OPENSTACK LOGS COST, AND KEEP, BEFORE ANYONE HAS SET ANYTHING.
 *
 * A cloud's services write a great deal nobody reads: DEBUG lines, a load balancer's check
 * of each API every few seconds, and the notifications that only say nothing changed.
 * These are the project's own drop filters, added the first time its OpenStack logs arrive,
 * so they are seen on the Logs settings page, counted, and one toggle away from off. Turned
 * off there, they stay off: only a project with none of them gets them.
 *
 * Each one reads what OpenStackLogs stamped, so it can only ever match a record of a cloud.
 *
 * The scrub rules cover what the ingest's own scrub (OpenStackLogScrub) cannot reach: a line
 * from a pod with no openstack.cloud.name on it. Scrub rules run over a project's every log,
 * so these only match shapes that are a secret whatever wrote them.
 */

export const OPENSTACK_DEFAULTS_NAME_PREFIX: string = "OpenStack: ";

export interface OpenStackDefaultDropFilter {
  name: string;
  description: string;
  filterQuery: string;
}

export const OPENSTACK_DEFAULT_DROP_FILTERS: ReadonlyArray<OpenStackDefaultDropFilter> =
  [
    {
      name: `${OPENSTACK_DEFAULTS_NAME_PREFIX}DEBUG lines`,
      description:
        "OpenStack services' DEBUG lines. On a cloud with debug = True these are most of what it writes, and they are where its secrets have leaked. Turn this off while you debug a service.",
      filterQuery: `${OpenStackLogAttribute.Level} = 'DEBUG'`,
    },
    {
      name: `${OPENSTACK_DEFAULTS_NAME_PREFIX}health checks`,
      description:
        "A load balancer asking each API for / or /healthcheck, which is one line every few seconds per API per controller.",
      filterQuery: `${OpenStackLogAttribute.Noise} = '${OPENSTACK_LOG_NOISE_HEALTH_CHECK}'`,
    },
    {
      name: `${OPENSTACK_DEFAULTS_NAME_PREFIX}routine notifications`,
      description:
        "Notifications that only say nothing changed: Nova's metrics.update, and every *.exists and *.usage. Turn this off to keep every notification.",
      filterQuery: `${OpenStackEventAttribute.Importance} = '${OpenStackEventImportance.Routine}'`,
    },
  ];

export interface OpenStackDefaultScrubRule {
  name: string;
  description: string;
  customRegex: string;
}

export const OPENSTACK_DEFAULT_SCRUB_RULES: ReadonlyArray<OpenStackDefaultScrubRule> =
  [
    {
      name: `${OPENSTACK_DEFAULTS_NAME_PREFIX}Fernet tokens`,
      description:
        "A Keystone Fernet token, which is a login for as long as it lasts, wherever it appears in a log.",
      customRegex: "gAAAA[A-Za-z0-9_=-]{32,}",
    },
    {
      name: `${OPENSTACK_DEFAULTS_NAME_PREFIX}auth token headers`,
      description:
        "The value of an X-Auth-Token, X-Subject-Token or X-Service-Token header, as a service's debug log writes a request.",
      customRegex:
        "(?<=[Xx]-(?:[Aa]uth|[Ss]ubject|[Ss]ervice|[Ss]torage)-[Tt]oken['\"]?\\s*[:=]\\s*['\"]?)[^\\s'\",}]+",
    },
    {
      name: `${OPENSTACK_DEFAULTS_NAME_PREFIX}passwords in URLs`,
      description:
        "The password in a message bus's or a database's address, as a service writes its transport_url or connection.",
      customRegex:
        "(?<=(?:rabbit|amqp|kombu|mysql|mysql\\+pymysql|postgresql|postgresql\\+psycopg2)://[^:@/\\s]{1,256}:)[^@/\\s]{1,1024}(?=@)",
    },
    {
      name: `${OPENSTACK_DEFAULTS_NAME_PREFIX}passwords in requests`,
      description:
        "A password or an admin password in what a service's debug log writes of a request.",
      customRegex:
        "(?<=['\"](?:password|adminPass|admin_pass|admin_password|new_password|original_password)['\"]\\s*:\\s*['\"])[^'\"]{1,1024}",
    },
  ];

const CACHE_NAMESPACE: string = "openstack-log-defaults";
// Until the cache is flushed: a project with these never needs asking again.
const REMEMBERED_FOR_IN_SECONDS: number = 10 * 365 * 24 * 60 * 60;

export default class OpenStackLogDefaults {
  /*
   * Adds them to a project the first time its OpenStack logs arrive. One read of the
   * cache per batch once they are there. Never throws: the logs matter more.
   */
  public static async ensureForProject(projectId: ObjectID): Promise<void> {
    try {
      const isFirstTime: boolean = await GlobalCache.setStringIfNotExists(
        CACHE_NAMESPACE,
        projectId.toString(),
        "1",
        { expiresInSeconds: REMEMBERED_FOR_IN_SECONDS },
      );

      if (!isFirstTime) {
        return;
      }

      await this.addDropFilters(projectId);
      await this.addScrubRules(projectId);
    } catch (error) {
      logger.warn(
        `OpenStack's default log filters could not be added to project ${projectId.toString()}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private static async addDropFilters(projectId: ObjectID): Promise<void> {
    const existing: Array<LogDropFilter> = await LogDropFilterService.findBy({
      query: { projectId },
      select: { name: true },
      limit: 1000,
      skip: 0,
      props: { isRoot: true },
    });
    const names: Set<string> = new Set(
      existing.map((row: LogDropFilter): string => {
        return row.name || "";
      }),
    );

    let sortOrder: number = existing.length;

    for (const filter of OPENSTACK_DEFAULT_DROP_FILTERS) {
      if (names.has(filter.name)) {
        continue;
      }

      const row: LogDropFilter = new LogDropFilter();
      row.projectId = projectId;
      row.name = filter.name;
      row.description = filter.description;
      row.filterQuery = filter.filterQuery;
      row.action = LogDropFilterAction.Drop;
      row.isEnabled = true;
      row.sortOrder = sortOrder++;

      await LogDropFilterService.create({
        data: row,
        props: { isRoot: true },
      });
    }
  }

  private static async addScrubRules(projectId: ObjectID): Promise<void> {
    const existing: Array<LogScrubRule> = await LogScrubRuleService.findBy({
      query: { projectId },
      select: { name: true },
      limit: 1000,
      skip: 0,
      props: { isRoot: true },
    });
    const names: Set<string> = new Set(
      existing.map((row: LogScrubRule): string => {
        return row.name || "";
      }),
    );

    let sortOrder: number = existing.length;

    for (const rule of OPENSTACK_DEFAULT_SCRUB_RULES) {
      if (names.has(rule.name)) {
        continue;
      }

      const row: LogScrubRule = new LogScrubRule();
      row.projectId = projectId;
      row.name = rule.name;
      row.description = rule.description;
      row.patternType = LogScrubPatternType.Custom;
      row.customRegex = rule.customRegex;
      row.scrubAction = LogScrubAction.Redact;
      row.fieldsToScrub = LogScrubField.Both;
      row.isEnabled = true;
      row.sortOrder = sortOrder++;

      await LogScrubRuleService.create({
        data: row,
        props: { isRoot: true },
      });
    }
  }
}
