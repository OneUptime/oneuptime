import {
  StorageArrayKindDefinition,
  StorageArrayPlatform,
} from "./StorageArrayPlatform";
import { BUILT_IN_STORAGE_ARRAY_PLATFORMS } from "./Platforms/StorageArrayPlatforms";

/*
 * THE STORAGE PLATFORMS STORAGE ARRAYS KNOWS, AND WHERE EACH IS LOOKED UP.
 *
 * Every reader of a platform - StorageSystemUtil, StorageArrayResourceKindUtil,
 * the metric catalog, the alert templates and Recommendations, the ingest's
 * extractors, the criteria evaluator, the pages and the setup guide - asks
 * this registry, so a platform defined in its own folder and listed in
 * Platforms/StorageArrayPlatforms.ts is known everywhere at once.
 *
 * `register` adds a platform at runtime. Nothing in the product calls it:
 * it is how a test defines a platform of its own and follows it end to end
 * without changing a shipped file (StorageArrayAcmePlatform.test.ts). It
 * checks what would otherwise break quietly - a storage.system, alias,
 * metric id or template id already taken - and throws.
 *
 * The readers that build something from every platform (the whole catalog,
 * the built templates) cache it by getVersion(), which moves on every
 * register and unregister.
 */

const WELL_FORMED_SYSTEM: RegExp = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export default class StorageArrayPlatformRegistry {
  private static platforms: Array<StorageArrayPlatform> = [
    ...BUILT_IN_STORAGE_ARRAY_PLATFORMS,
  ];

  private static version: number = 0;

  // Every platform, the shipped ones first, in the order they were listed.
  public static getPlatforms(): ReadonlyArray<StorageArrayPlatform> {
    return StorageArrayPlatformRegistry.platforms;
  }

  /*
   * The platform a StorageArray.storageSystem value names, or null. Only a
   * normalized value matches (StorageSystemUtil.normalize turns an alias or
   * another spelling into it), and nothing indexes an object by the value:
   * `storage.system` is agent-supplied, and `constructor` must not find
   * Object.prototype's.
   */
  public static getPlatform(
    storageSystem: string | null | undefined,
  ): StorageArrayPlatform | null {
    if (!storageSystem) {
      return null;
    }
    return (
      StorageArrayPlatformRegistry.platforms.find(
        (platform: StorageArrayPlatform): boolean => {
          return platform.storageSystem === storageSystem;
        },
      ) || null
    );
  }

  /*
   * The platform an array whose platform OneUptime cannot tell is read as,
   * where a page or a monitor must pick one: the first listed, the
   * platform the agent itself assumes when its .env names none
   * (docker-compose.yml's STORAGE_SYSTEM default).
   */
  public static getDefaultPlatform(): StorageArrayPlatform {
    return StorageArrayPlatformRegistry.platforms[0]!;
  }

  // The platform `storageSystem` names, else the default one.
  public static getPlatformOrDefault(
    storageSystem: string | null | undefined,
  ): StorageArrayPlatform {
    return (
      StorageArrayPlatformRegistry.getPlatform(storageSystem) ||
      StorageArrayPlatformRegistry.getDefaultPlatform()
    );
  }

  /*
   * The platform whose metric prefix a metric name starts with, or null:
   * how a series is read for its platform when the agent stamped no
   * `storage.system`. A platform whose exporter's names carry no vendor
   * prefix is never found this way.
   */
  public static getPlatformByMetricName(
    metricName: string | null | undefined,
  ): StorageArrayPlatform | null {
    if (!metricName) {
      return null;
    }
    return (
      StorageArrayPlatformRegistry.platforms.find(
        (platform: StorageArrayPlatform): boolean => {
          return Boolean(
            platform.metricPrefix &&
              metricName.startsWith(platform.metricPrefix),
          );
        },
      ) || null
    );
  }

  /*
   * The words of a kind a platform declared for itself
   * (StorageArrayPlatform.kindDefinitions), or null.
   */
  public static getKindDefinition(
    kind: string | null | undefined,
  ): StorageArrayKindDefinition | null {
    if (!kind) {
      return null;
    }
    for (const platform of StorageArrayPlatformRegistry.platforms) {
      for (const definition of platform.kindDefinitions || []) {
        if (definition.kind === kind) {
          return definition;
        }
      }
    }
    return null;
  }

  /*
   * The kind of inventory object a metric's object label names, from the
   * platforms' metric families (StorageArrayPlatform.metricFamilies): the
   * named platform's first, then every other's, each family in its order.
   * Null for a family that names no inventory object, or a metric no
   * platform's family covers.
   */
  public static getObjectKindForMetricName(
    metricName: string,
    storageSystem?: string | null | undefined,
  ): string | null {
    const own: StorageArrayPlatform | null =
      StorageArrayPlatformRegistry.getPlatform(storageSystem);
    const platforms: Array<StorageArrayPlatform> = own
      ? [
          own,
          ...StorageArrayPlatformRegistry.platforms.filter(
            (platform: StorageArrayPlatform): boolean => {
              return platform !== own;
            },
          ),
        ]
      : StorageArrayPlatformRegistry.platforms;
    for (const platform of platforms) {
      for (const family of platform.metricFamilies) {
        if (metricName.startsWith(family.prefix)) {
          return family.kind;
        }
      }
    }
    return null;
  }

  // Moves on every register and unregister, for readers that cache.
  public static getVersion(): number {
    return StorageArrayPlatformRegistry.version;
  }

  public static register(platform: StorageArrayPlatform): void {
    const problem: string | null =
      StorageArrayPlatformRegistry.getRegistrationProblem(platform);
    if (problem) {
      throw new Error(
        `Storage array platform ${platform.storageSystem} cannot be registered: ${problem}`,
      );
    }
    StorageArrayPlatformRegistry.platforms = [
      ...StorageArrayPlatformRegistry.platforms,
      platform,
    ];
    StorageArrayPlatformRegistry.version++;
  }

  public static unregister(storageSystem: string): void {
    const before: number = StorageArrayPlatformRegistry.platforms.length;
    StorageArrayPlatformRegistry.platforms =
      StorageArrayPlatformRegistry.platforms.filter(
        (platform: StorageArrayPlatform): boolean => {
          return platform.storageSystem !== storageSystem;
        },
      );
    if (StorageArrayPlatformRegistry.platforms.length !== before) {
      StorageArrayPlatformRegistry.version++;
    }
  }

  /*
   * Why a platform cannot join the others, or null when it can: its value
   * must be well-formed and its own, its aliases must name no other
   * platform, and its metric ids, template ids and agent config keys must
   * be unique across every platform (they are stored on dashboards,
   * monitors and .env files).
   */
  public static getRegistrationProblem(
    platform: StorageArrayPlatform,
    others: ReadonlyArray<StorageArrayPlatform> = StorageArrayPlatformRegistry.platforms,
  ): string | null {
    if (!WELL_FORMED_SYSTEM.test(platform.storageSystem)) {
      return `"${platform.storageSystem}" is not a well-formed storage.system (lowercase vendor.product)`;
    }

    const takenSpellings: Map<string, string> = new Map();
    const takenMetricIds: Set<string> = new Set();
    const takenTemplateIds: Set<string> = new Set();
    const takenAgentConfigs: Set<string> = new Set();
    for (const other of others) {
      if (other.storageSystem === platform.storageSystem) {
        return "another platform already has this storage.system";
      }
      takenSpellings.set(other.storageSystem, other.storageSystem);
      for (const alias of other.aliases) {
        takenSpellings.set(alias, other.storageSystem);
      }
      for (const metric of other.metrics) {
        takenMetricIds.add(metric.id);
      }
      takenTemplateIds.add(other.heartbeat.templateId);
      for (const template of other.alertTemplates) {
        takenTemplateIds.add(template.id);
      }
      for (const config of other.agentConfigs) {
        takenAgentConfigs.add(config.key);
      }
    }

    for (const spelling of [platform.storageSystem, ...platform.aliases]) {
      if (spelling !== spelling.trim().toLowerCase()) {
        return `the alias "${spelling}" is not lowercase and trimmed`;
      }
      const owner: string | undefined = takenSpellings.get(spelling);
      if (owner) {
        return `"${spelling}" already names ${owner}`;
      }
    }
    for (const metric of platform.metrics) {
      if (takenMetricIds.has(metric.id)) {
        return `the metric id ${metric.id} is taken`;
      }
      takenMetricIds.add(metric.id);
    }
    for (const id of [
      platform.heartbeat.templateId,
      ...platform.alertTemplates.map(
        (template: StorageArrayPlatform["alertTemplates"][number]): string => {
          return template.id;
        },
      ),
    ]) {
      if (takenTemplateIds.has(id)) {
        return `the template id ${id} is taken`;
      }
      takenTemplateIds.add(id);
    }
    for (const config of platform.agentConfigs) {
      if (takenAgentConfigs.has(config.key)) {
        return `the agent config ${config.key} is taken`;
      }
      takenAgentConfigs.add(config.key);
    }
    return null;
  }
}
