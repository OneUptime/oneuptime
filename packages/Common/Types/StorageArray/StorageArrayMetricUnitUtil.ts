import {
  StorageArrayPlatform,
  StorageArrayUnitRule,
} from "./StorageArrayPlatform";
import StorageArrayPlatformRegistry from "./StorageArrayPlatformRegistry";

/*
 * THE UNIT OF A STORAGE PLATFORM'S SERIES WHOSE EXPORTER DECLARES NONE
 * (#11001).
 *
 * NetApp Harvest writes no UNIT lines, so its series reach OneUptime with
 * no unit, and a latency in microseconds would chart and compare as a bare
 * number. A platform says its series' units (StorageArrayPlatform
 * .unitRules), and the ingest records them as the metric's unit when the
 * series declared none: every chart, the Metrics explorer and every
 * monitor then read it in that unit. A declared unit is never replaced:
 * an exporter that says its unit is right about it, or the operator chose
 * it.
 *
 * Only a metric whose name starts with a platform's metric prefix is
 * looked at, so this costs nothing for anyone else's metrics.
 */

interface CompiledRules {
  prefix: string;
  rules: Array<{ pattern: RegExp; unit: string }>;
}

let compiled: Array<CompiledRules> = [];
let compiledVersion: number = -1;

function getCompiledRules(): Array<CompiledRules> {
  const version: number = StorageArrayPlatformRegistry.getVersion();
  if (version === compiledVersion) {
    return compiled;
  }
  compiled = StorageArrayPlatformRegistry.getPlatforms()
    .filter((platform: StorageArrayPlatform): boolean => {
      return Boolean(platform.metricPrefix && platform.unitRules?.length);
    })
    .map((platform: StorageArrayPlatform): CompiledRules => {
      return {
        prefix: platform.metricPrefix!,
        rules: (platform.unitRules || []).map(
          (rule: StorageArrayUnitRule): { pattern: RegExp; unit: string } => {
            return { pattern: new RegExp(rule.pattern), unit: rule.unit };
          },
        ),
      };
    });
  compiledVersion = version;
  return compiled;
}

export default class StorageArrayMetricUnitUtil {
  /*
   * The unit a platform's rules give a metric: a unit, "" for a number
   * with no unit (a state, a label series), or undefined when no
   * platform's rules know the metric.
   */
  public static getRuleUnit(
    metricName: string | null | undefined,
  ): string | undefined {
    if (!metricName) {
      return undefined;
    }
    for (const platform of getCompiledRules()) {
      if (!metricName.startsWith(platform.prefix)) {
        continue;
      }
      for (const rule of platform.rules) {
        if (rule.pattern.test(metricName)) {
          return rule.unit;
        }
      }
      return undefined;
    }
    return undefined;
  }

  /*
   * The unit to record for a metric: the one it declared, or - when it
   * declared none - the one its platform's rules give it.
   */
  public static getStoredUnit(data: {
    metricName: string;
    declaredUnit: string | null | undefined;
  }): string | undefined {
    const declared: string = (data.declaredUnit || "").trim();
    if (declared) {
      return data.declaredUnit || undefined;
    }
    const ruled: string | undefined = StorageArrayMetricUnitUtil.getRuleUnit(
      data.metricName,
    );
    return ruled ? ruled : data.declaredUnit || undefined;
  }
}
