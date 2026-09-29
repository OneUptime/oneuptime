import { CriteriaFilter } from "Common/Types/Monitor/CriteriaFilter";
import MonitorCriteria from "Common/Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import CriteriaFilterUtil from "./CriteriaFilter";

/*
 * Everything MonitorCriteria.getDefaultMonitorCriteria needs to seed the
 * out-of-the-box criteria for a monitor type. The criteria form already
 * holds all of it - it is what the form seeded the criteria with in the
 * first place.
 */
export interface CriteriaSeedIds {
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  defaultIncidentSeverityId: ObjectID;
  defaultAlertSeverityId: ObjectID;
}

export interface CriteriaSeedOptions extends CriteriaSeedIds {
  monitorName: string;
}

export interface MonitorStepsAlignmentResult {
  monitorSteps: MonitorSteps;
  didChange: boolean;
}

export interface MonitorCriteriaAlignmentResult {
  monitorCriteria: MonitorCriteria;
  didChange: boolean;
}

/*
 * Every monitor type, in declaration order. Used to work out which type a
 * set of untouched criteria was seeded for.
 */
const ALL_MONITOR_TYPES: Array<MonitorType> = Object.values(
  MonitorType,
) as Array<MonitorType>;

/*
 * Monitor type and monitor criteria live on different steps of the monitor
 * create form, and the criteria step's fields are unmounted while the user
 * is on another step. So the criteria a user sees can have been seeded for
 * a monitor type they have since changed their mind about: they visit the
 * criteria step, walk back, pick a different type, and come forward again
 * to filters naming checks the new type never offers.
 *
 * This brings such criteria back in line with the monitor type, without
 * throwing away work:
 *
 *   - Criteria still identical to the defaults for the type they were
 *     seeded for are re-seeded outright, because nothing in them is the
 *     user's. Repairing them field by field would leave a mongrel - an
 *     Incoming Request monitor carrying "Check if Acme is offline" over a
 *     blank "not received in minutes" threshold - where re-seeding gives
 *     exactly what picking that type first would have.
 *   - Criteria the user has touched are repaired filter by filter instead,
 *     so their names, incidents, alerts, thresholds and every filter that
 *     still applies to the new type survive. Filters the new type cannot
 *     express are dropped rather than replaced, because a replacement is
 *     a rule the user never wrote - see repairMonitorCriteriaFilters.
 *
 * Criteria that are already valid for the monitor type come back
 * untouched, by object identity, so this is safe to run on every mount:
 * opening an existing monitor's criteria does not rewrite them.
 */
export default class MonitorCriteriaAlignmentUtil {
  public static alignMonitorStepsWithMonitorType(data: {
    monitorSteps: MonitorSteps;
    monitorType: MonitorType;
    seedOptions: CriteriaSeedOptions;
  }): MonitorStepsAlignmentResult {
    const { monitorSteps, monitorType, seedOptions } = data;

    const monitorStepArray: Array<MonitorStep> =
      monitorSteps.data?.monitorStepsInstanceArray || [];

    let didChange: boolean = false;

    const alignedSteps: Array<MonitorStep> = monitorStepArray.map(
      (monitorStep: MonitorStep) => {
        if (!monitorStep.data?.monitorCriteria) {
          return monitorStep;
        }

        const result: MonitorCriteriaAlignmentResult =
          MonitorCriteriaAlignmentUtil.alignMonitorCriteriaWithMonitorType({
            monitorCriteria: monitorStep.data.monitorCriteria,
            monitorType: monitorType,
            seedOptions: seedOptions,
          });

        if (!result.didChange) {
          return monitorStep;
        }

        didChange = true;

        /*
         * Clone the step rather than mutating it, so a caller holding the
         * old MonitorSteps still sees what it had - React state updates
         * are compared by identity.
         */
        const alignedStep: MonitorStep = MonitorStep.clone(monitorStep);
        alignedStep.setMonitorCriteria(result.monitorCriteria);

        return alignedStep;
      },
    );

    if (!didChange) {
      return {
        monitorSteps: monitorSteps,
        didChange: false,
      };
    }

    const alignedMonitorSteps: MonitorSteps = MonitorSteps.clone(monitorSteps);
    alignedMonitorSteps.setMonitorStepsInstanceArray(alignedSteps);

    return {
      monitorSteps: alignedMonitorSteps,
      didChange: true,
    };
  }

  public static alignMonitorCriteriaWithMonitorType(data: {
    monitorCriteria: MonitorCriteria;
    monitorType: MonitorType;
    seedOptions: CriteriaSeedOptions;
  }): MonitorCriteriaAlignmentResult {
    const { monitorCriteria, monitorType, seedOptions } = data;

    /*
     * Untouched defaults for the type we are already on. Nothing to do -
     * checked first so that opening a monitor whose criteria happen to be
     * pristine never churns their generated ids.
     */
    if (
      MonitorCriteriaAlignmentUtil.isUntouchedDefaultFor({
        monitorCriteria: monitorCriteria,
        monitorType: monitorType,
        seedOptions: seedOptions,
      })
    ) {
      return {
        monitorCriteria: monitorCriteria,
        didChange: false,
      };
    }

    const seededForMonitorType: MonitorType | undefined =
      ALL_MONITOR_TYPES.find((candidate: MonitorType) => {
        return (
          candidate !== monitorType &&
          MonitorCriteriaAlignmentUtil.isUntouchedDefaultFor({
            monitorCriteria: monitorCriteria,
            monitorType: candidate,
            seedOptions: seedOptions,
          })
        );
      });

    if (seededForMonitorType) {
      const reSeeded: MonitorCriteria =
        MonitorCriteria.getDefaultMonitorCriteria({
          monitorType: monitorType,
          ...seedOptions,
        });

      /*
       * Through the same repair as anything else. A handful of monitor
       * types seed no real criteria - the metric family, IoT Device,
       * Profiles and Manual all fall through to a blank criteria carrying
       * the constructor's placeholder "Is Online" filter, which their own
       * option lists do not offer. Handing that placeholder back would
       * leave the very dropdown this whole alignment exists to fill in
       * showing "Select..." again, just for a different reason.
       */
      return {
        monitorCriteria:
          MonitorCriteriaAlignmentUtil.repairMonitorCriteriaFilters({
            monitorCriteria: reSeeded,
            monitorType: monitorType,
            seedOptions: seedOptions,
          }).monitorCriteria,
        didChange: true,
      };
    }

    return MonitorCriteriaAlignmentUtil.repairMonitorCriteriaFilters({
      monitorCriteria: monitorCriteria,
      monitorType: monitorType,
      seedOptions: seedOptions,
    });
  }

  /*
   * Walk every filter of every criteria, keeping the ones the new monitor
   * type can still express and dropping the ones it cannot. Nothing else
   * about the criteria is touched - names, descriptions, incidents,
   * alerts, the filter condition, the monitor status it sets and which
   * criteria exist are all the user's.
   *
   * Dropping rather than substituting is deliberate. A filter naming a
   * check the monitor type does not offer has no honest translation, and
   * putting this type's default filter in its place fabricates a rule the
   * user never wrote - a positive, immediately-matching one. Under the
   * "Any" filter condition every seeded offline criteria uses, one such
   * fabricated filter is enough to fire the whole criteria, so an "Acme is
   * offline" rule that opens an incident would start firing while Acme was
   * perfectly healthy. Dropping loses the rule, which is visible; keeping
   * a fabricated one silently changes what the criteria means.
   *
   * A criteria left with no filters at all cannot stay empty, so it is
   * re-seeded from this monitor type's own defaults - and from the right
   * half of them, so that a criteria which fires when the monitor is down
   * still fires when it is down.
   */
  public static repairMonitorCriteriaFilters(data: {
    monitorCriteria: MonitorCriteria;
    monitorType: MonitorType;
    seedOptions: CriteriaSeedOptions;
  }): MonitorCriteriaAlignmentResult {
    const { monitorCriteria, monitorType, seedOptions } = data;

    const instances: Array<MonitorCriteriaInstance> =
      monitorCriteria.data?.monitorCriteriaInstanceArray || [];

    let didChange: boolean = false;

    const repairedInstances: Array<MonitorCriteriaInstance> = instances.map(
      (instance: MonitorCriteriaInstance) => {
        const filters: Array<CriteriaFilter> = instance.data?.filters || [];

        let didInstanceChange: boolean = false;

        const keptFilters: Array<CriteriaFilter> = [];

        for (const criteriaFilter of filters) {
          const repaired: CriteriaFilter | null =
            CriteriaFilterUtil.repairCriteriaFilterForMonitorType({
              criteriaFilter: criteriaFilter,
              monitorType: monitorType,
            });

          if (!repaired) {
            didInstanceChange = true;
            continue;
          }

          if (repaired !== criteriaFilter) {
            didInstanceChange = true;
          }

          keptFilters.push(repaired);
        }

        if (!didInstanceChange) {
          return instance;
        }

        didChange = true;

        return MonitorCriteriaInstance.clone(instance).setFilters(
          keptFilters.length > 0
            ? keptFilters
            : MonitorCriteriaAlignmentUtil.defaultFiltersForCriteria({
                monitorCriteriaInstance: instance,
                monitorType: monitorType,
                seedOptions: seedOptions,
              }),
        );
      },
    );

    if (!didChange) {
      return {
        monitorCriteria: monitorCriteria,
        didChange: false,
      };
    }

    const repairedCriteria: MonitorCriteria = new MonitorCriteria();
    repairedCriteria.data = {
      monitorCriteriaInstanceArray: repairedInstances,
    };

    return {
      monitorCriteria: repairedCriteria,
      didChange: true,
    };
  }

  /*
   * The filters this monitor type would seed for a criteria playing the
   * same part as this one - so a criteria that took the monitor offline
   * and opened an incident is refilled from the type's offline defaults
   * rather than its online ones.
   *
   * Getting that the wrong way round is the failure worth avoiding: the
   * online defaults are positive rules, and handing them to a criteria
   * that still says "create an incident called <monitor> is offline" and
   * still sets the offline monitor status produces alerts that fire
   * exactly when nothing is wrong.
   */
  public static defaultFiltersForCriteria(data: {
    monitorCriteriaInstance: MonitorCriteriaInstance;
    monitorType: MonitorType;
    seedOptions: CriteriaSeedOptions;
  }): Array<CriteriaFilter> {
    const { monitorCriteriaInstance, monitorType, seedOptions } = data;

    /*
     * A criteria is the "monitor is down" one if it raises something or
     * if it parks the monitor on the offline status. Both seeded offline
     * criteria and hand-written ones follow that shape.
     */
    const isOfflineCriteria: boolean =
      Boolean(monitorCriteriaInstance.data?.createIncidents) ||
      Boolean(monitorCriteriaInstance.data?.createAlerts) ||
      monitorCriteriaInstance.data?.monitorStatusId?.toString() ===
        seedOptions.offlineMonitorStatusId.toString();

    const offlineFilters: Array<CriteriaFilter> =
      MonitorCriteriaAlignmentUtil.renderableFilters(
        MonitorCriteriaInstance.getDefaultOfflineMonitorCriteriaInstance({
          monitorType: monitorType,
          monitorStatusId: seedOptions.offlineMonitorStatusId,
          incidentSeverityId: seedOptions.defaultIncidentSeverityId,
          alertSeverityId: seedOptions.defaultAlertSeverityId,
          monitorName: seedOptions.monitorName,
        }).data?.filters || [],
        monitorType,
      );

    const onlineFilters: Array<CriteriaFilter> =
      MonitorCriteriaAlignmentUtil.renderableFilters(
        MonitorCriteriaInstance.getDefaultOnlineMonitorCriteriaInstance({
          monitorType: monitorType,
          monitorStatusId: seedOptions.onlineMonitorStatusId,
          monitorName: seedOptions.monitorName,
        })?.data?.filters || [],
        monitorType,
      );

    const preferred: Array<CriteriaFilter> = isOfflineCriteria
      ? offlineFilters
      : onlineFilters;

    if (preferred.length > 0) {
      return preferred;
    }

    /*
     * Not every monitor type seeds both halves - several ship an offline
     * criteria only. Fall back to the half it does seed before falling
     * back to a bare default filter.
     */
    const other: Array<CriteriaFilter> = isOfflineCriteria
      ? onlineFilters
      : offlineFilters;

    if (other.length > 0) {
      return other;
    }

    /*
     * Last resort, and the only one for the monitor types that seed no
     * real criteria at all - the metric family, IoT Device, Profiles and
     * Manual all fall through to a blank criteria carrying the
     * constructor's placeholder "Is Online" filter, which their own
     * narrowed option lists do not offer. getDefaultCriteriaFilter is
     * derived from those option lists, so it is renderable by
     * construction where the seeded placeholder is not.
     */
    return [CriteriaFilterUtil.getDefaultCriteriaFilter(monitorType)];
  }

  /*
   * The filters out of `filters` that this monitor type's form can draw,
   * with any stale condition corrected - put through exactly the same
   * repair as the user's own filters, so a default this type cannot
   * render is no more privileged than a stale one.
   *
   * Worth doing on the seeded defaults because several monitor types do
   * not have any: the metric family, IoT Device, Profiles and Manual all
   * fall through to a blank criteria carrying a placeholder filter none
   * of them offers.
   */
  public static renderableFilters(
    filters: Array<CriteriaFilter>,
    monitorType: MonitorType,
  ): Array<CriteriaFilter> {
    return filters
      .map((criteriaFilter: CriteriaFilter) => {
        return CriteriaFilterUtil.repairCriteriaFilterForMonitorType({
          criteriaFilter: criteriaFilter,
          monitorType: monitorType,
        });
      })
      .filter((criteriaFilter: CriteriaFilter | null): boolean => {
        return criteriaFilter !== null;
      }) as Array<CriteriaFilter>;
  }

  /*
   * Are these criteria still exactly what picking `monitorType` seeds?
   *
   * Compared on content, ignoring the ObjectIDs generated fresh for every
   * criteria, incident and alert - those differ between two seeds of the
   * same type and say nothing about whether the user has edited anything.
   */
  public static isUntouchedDefaultFor(data: {
    monitorCriteria: MonitorCriteria;
    monitorType: MonitorType;
    seedOptions: CriteriaSeedOptions;
  }): boolean {
    const { monitorCriteria, monitorType, seedOptions } = data;

    const defaultMonitorCriteria: MonitorCriteria =
      MonitorCriteria.getDefaultMonitorCriteria({
        monitorType: monitorType,
        ...seedOptions,
      });

    return (
      MonitorCriteriaAlignmentUtil.fingerprint(monitorCriteria) ===
      MonitorCriteriaAlignmentUtil.fingerprint(defaultMonitorCriteria)
    );
  }

  /*
   * A stable string for a MonitorCriteria's content: keys sorted so the
   * comparison does not depend on property order, generated ids dropped,
   * and undefined treated the same as absent.
   *
   * Both sides are round-tripped through JSON first, because the criteria
   * the form hands back have been - they were serialized into the form's
   * value and read out again on the way to this code. Reading them back
   * fills in fields a freshly seeded criteria leaves undefined (isEnabled,
   * most visibly), so comparing a round-tripped seed against a fresh one
   * without normalising both reports every seed as edited, and nothing is
   * ever re-seeded.
   */
  private static fingerprint(monitorCriteria: MonitorCriteria): string {
    return MonitorCriteriaAlignmentUtil.stableStringify(
      MonitorCriteria.fromJSON(monitorCriteria.toJSON()).toJSON() as JSONValue,
    );
  }

  private static stableStringify(value: JSONValue): string {
    if (value === null || value === undefined) {
      return "null";
    }

    if (Array.isArray(value)) {
      return `[${value
        .map((item: JSONValue) => {
          return MonitorCriteriaAlignmentUtil.stableStringify(item);
        })
        .join(",")}]`;
    }

    if (typeof value === "object" && !(value instanceof Date)) {
      const jsonObject: JSONObject = value as JSONObject;

      const entries: Array<string> = Object.keys(jsonObject)
        .filter((key: string) => {
          return key !== "id" && jsonObject[key] !== undefined;
        })
        .sort()
        .map((key: string) => {
          return `${JSON.stringify(key)}:${MonitorCriteriaAlignmentUtil.stableStringify(
            jsonObject[key] as JSONValue,
          )}`;
        });

      return `{${entries.join(",")}}`;
    }

    return JSON.stringify(value) || "null";
  }
}
