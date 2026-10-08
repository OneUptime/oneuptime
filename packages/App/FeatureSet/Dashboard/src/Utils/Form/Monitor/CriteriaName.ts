import FilterCondition from "Common/Types/Filter/FilterCondition";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "Common/Types/Monitor/CriteriaFilter";
import {
  DatabaseMetricDefinition,
  getDatabaseMetricByMetricType,
} from "Common/Types/Monitor/DatabaseMetricCatalog";
import MonitorCriteria from "Common/Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";

// A threshold written as a plain number ("400", "-1", "99.5").
const NUMERIC_VALUE: RegExp = /^-?\d+(\.\d+)?$/;

export interface CriteriaFiltersSnapshot {
  filters: Array<CriteriaFilter> | undefined;
  filterCondition?: FilterCondition | undefined;
}

export interface MonitorStepsNamingResult {
  monitorSteps: MonitorSteps;
  didChange: boolean;
}

/*
 * A criteria's name, made from its filters, so nobody has to invent one.
 *
 * Every criteria used to open on two empty required inputs, "Criteria Name"
 * and "Criteria Description", and the monitor could not be saved until the
 * user had made up prose for both. The name is still required - it is what
 * the incident and alert a criteria opens say triggered them ("Incident
 * triggered from criteria ...") - but the form fills it in: a criteria added
 * with "Add Criteria" is named after its filters, and the name follows the
 * filters as they are edited until the user types a name of their own.
 *
 * Whether a name is still the generated one is decided by comparing it with
 * what the filters it was made from would give. Nothing extra is stored, so
 * the rule holds across remounts, and a name the user typed, or one a
 * monitor was seeded with ("Check if Acme is online"), never matches and is
 * never touched.
 *
 * The name is data, shared by everyone in the project, so it is written in
 * English - the language of the criteria names the defaults are seeded with
 * - rather than in the language of whoever happened to add the criteria.
 */
export default class CriteriaNameUtil {
  // The name of a criteria whose filters say nothing to name it after.
  public static readonly FALLBACK_NAME: string = "Criteria";

  // Filters spelled out in full before the rest are counted ("and 2 more").
  public static readonly MAX_LISTED_FILTERS: number = 3;

  public static readonly MAX_NAME_LENGTH: number = 120;

  public static readonly MAX_VALUE_LENGTH: number = 40;

  public static readonly ELLIPSIS: string = "…";

  /*
   * "Response Time (in ms) is above 3000", or for several filters
   * "Is Online is false or Response Status Code is at least 400".
   */
  public static getNameFromFilters(data: CriteriaFiltersSnapshot): string {
    const phrases: Array<string> = (data.filters || [])
      .map((criteriaFilter: CriteriaFilter) => {
        return CriteriaNameUtil.describeFilter(criteriaFilter);
      })
      .filter((phrase: string) => {
        return phrase.length > 0;
      });

    if (phrases.length === 0) {
      return CriteriaNameUtil.FALLBACK_NAME;
    }

    const conjunction: string =
      data.filterCondition === FilterCondition.Any ? " or " : " and ";

    let name: string =
      phrases.length <= CriteriaNameUtil.MAX_LISTED_FILTERS
        ? phrases.join(conjunction)
        : `${phrases
            .slice(0, CriteriaNameUtil.MAX_LISTED_FILTERS - 1)
            .join(conjunction)}${conjunction}${
            phrases.length - (CriteriaNameUtil.MAX_LISTED_FILTERS - 1)
          } more`;

    if (name.length > CriteriaNameUtil.MAX_NAME_LENGTH && phrases.length > 1) {
      name = `${phrases[0]}${conjunction}${phrases.length - 1} more`;
    }

    return CriteriaNameUtil.truncate(name, CriteriaNameUtil.MAX_NAME_LENGTH);
  }

  // The name a criteria's own filters give it.
  public static getNameForCriteria(
    monitorCriteriaInstance: MonitorCriteriaInstance,
  ): string {
    return CriteriaNameUtil.getNameFromFilters({
      filters: monitorCriteriaInstance.data?.filters,
      filterCondition: monitorCriteriaInstance.data?.filterCondition,
    });
  }

  /*
   * True while the name is not the user's: empty, or still exactly what
   * the filters gave it. Such a name is replaced when the filters change.
   */
  public static isNameFromFilters(
    data: CriteriaFiltersSnapshot & { name: string | undefined },
  ): boolean {
    const name: string = (data.name || "").trim();

    if (!name) {
      return true;
    }

    return name === CriteriaNameUtil.getNameFromFilters(data);
  }

  /*
   * The name a criteria should carry once its filters or filter condition
   * change from `previous` to `next`: the new generated name while the old
   * one was generated, and the user's own name otherwise.
   */
  public static getNameAfterFiltersChange(data: {
    name: string | undefined;
    previous: CriteriaFiltersSnapshot;
    next: CriteriaFiltersSnapshot;
  }): string {
    if (
      CriteriaNameUtil.isNameFromFilters({
        name: data.name,
        filters: data.previous.filters,
        filterCondition: data.previous.filterCondition,
      })
    ) {
      return CriteriaNameUtil.getNameFromFilters(data.next);
    }

    return data.name || "";
  }

  /*
   * Names every criteria that has no name, after its filters. A criteria
   * without a name cannot be saved, and one can reach the form from the API,
   * which never asked for one. Criteria that have a name come back as they
   * are, by identity, and so does everything when nothing needed a name.
   */
  public static nameUnnamedCriteria(
    monitorSteps: MonitorSteps,
  ): MonitorStepsNamingResult {
    let didChange: boolean = false;

    const steps: Array<MonitorStep> =
      monitorSteps.data?.monitorStepsInstanceArray || [];

    const namedSteps: Array<MonitorStep> = steps.map(
      (monitorStep: MonitorStep) => {
        const instances: Array<MonitorCriteriaInstance> =
          monitorStep.data?.monitorCriteria?.data
            ?.monitorCriteriaInstanceArray || [];

        const hasUnnamed: boolean = instances.some(
          (instance: MonitorCriteriaInstance) => {
            return Boolean(instance.data) && !instance.data?.name?.trim();
          },
        );

        if (!hasUnnamed) {
          return monitorStep;
        }

        didChange = true;

        const namedCriteria: MonitorCriteria = new MonitorCriteria();
        namedCriteria.data = {
          monitorCriteriaInstanceArray: instances.map(
            (instance: MonitorCriteriaInstance) => {
              if (!instance.data || instance.data.name?.trim()) {
                return instance;
              }

              return MonitorCriteriaInstance.clone(instance).setName(
                CriteriaNameUtil.getNameForCriteria(instance),
              );
            },
          ),
        };

        const namedStep: MonitorStep = MonitorStep.clone(monitorStep);
        namedStep.setMonitorCriteria(namedCriteria);

        return namedStep;
      },
    );

    if (!didChange) {
      return {
        monitorSteps: monitorSteps,
        didChange: false,
      };
    }

    const namedMonitorSteps: MonitorSteps = MonitorSteps.clone(monitorSteps);
    namedMonitorSteps.setMonitorStepsInstanceArray(namedSteps);

    return {
      monitorSteps: namedMonitorSteps,
      didChange: true,
    };
  }

  /*
   * One filter as a short phrase: what it checks, then the condition and the
   * value in the words of the condition dropdown ("is above", "contains").
   */
  public static describeFilter(criteriaFilter: CriteriaFilter): string {
    if (!criteriaFilter?.checkOn) {
      return "";
    }

    const subject: string = CriteriaNameUtil.getSubject(criteriaFilter);
    const value: string = CriteriaNameUtil.formatValue(criteriaFilter);
    const valueOrEllipsis: string = value || CriteriaNameUtil.ELLIPSIS;

    switch (criteriaFilter.filterType) {
      case FilterType.EqualTo:
        return `${subject} is ${valueOrEllipsis}`;
      case FilterType.NotEqualTo:
        return `${subject} is not ${valueOrEllipsis}`;
      case FilterType.GreaterThan:
        return `${subject} is above ${valueOrEllipsis}`;
      case FilterType.LessThan:
        return `${subject} is below ${valueOrEllipsis}`;
      case FilterType.GreaterThanOrEqualTo:
        return `${subject} is at least ${valueOrEllipsis}`;
      case FilterType.LessThanOrEqualTo:
        return `${subject} is at most ${valueOrEllipsis}`;
      case FilterType.Contains:
        return `${subject} contains ${valueOrEllipsis}`;
      case FilterType.NotContains:
        return `${subject} does not contain ${valueOrEllipsis}`;
      case FilterType.StartsWith:
        return `${subject} starts with ${valueOrEllipsis}`;
      case FilterType.EndsWith:
        return `${subject} ends with ${valueOrEllipsis}`;
      case FilterType.IsEmpty:
        return `${subject} is empty`;
      case FilterType.IsNotEmpty:
        return `${subject} is not empty`;
      case FilterType.True:
        return `${subject} is true`;
      case FilterType.False:
        return `${subject} is false`;
      case FilterType.RecievedInMinutes:
        return `${subject} received within ${valueOrEllipsis} minutes`;
      case FilterType.NotRecievedInMinutes:
        return `${subject} not received for ${valueOrEllipsis} minutes`;
      case FilterType.EvaluatesToTrue:
        // The value is the expression's code, which is no name.
        return `${subject} evaluates to true`;
      case FilterType.IsExecuting:
        return `${subject} ${valueOrEllipsis} is executing`;
      case FilterType.IsNotExecuting:
        return `${subject} ${valueOrEllipsis} is not executing`;
      case FilterType.AnomalouslyHigh:
        return `${subject} is anomalously high`;
      case FilterType.AnomalouslyLow:
        return `${subject} is anomalously low`;
      case FilterType.Anomalous:
        return `${subject} is anomalous`;
      default:
        return subject;
    }
  }

  // What the filter looks at: the check, narrowed to what it is scoped to.
  private static getSubject(criteriaFilter: CriteriaFilter): string {
    const checkOn: CheckOn = criteriaFilter.checkOn;

    // "Metric Value" says nothing; the query's alias names the metric.
    if (checkOn === CheckOn.MetricValue) {
      const metricAlias: string | undefined =
        criteriaFilter.metricMonitorOptions?.metricAlias?.trim();

      return metricAlias || checkOn;
    }

    // A database filter names its series in its options, not in the check.
    if (
      checkOn === CheckOn.DatabaseMetric &&
      criteriaFilter.databaseMonitorOptions?.metricType
    ) {
      const databaseMetric: DatabaseMetricDefinition | null =
        getDatabaseMetricByMetricType(
          criteriaFilter.databaseMonitorOptions.metricType,
        );

      if (databaseMetric) {
        return databaseMetric.friendlyName;
      }
    }

    // "Email Received not received for 5 minutes" reads twice.
    if (checkOn === CheckOn.EmailReceivedAt) {
      return "Email";
    }

    let subject: string = checkOn.toString();

    const oid: string | undefined =
      criteriaFilter.snmpMonitorOptions?.oid?.trim();

    if (
      oid &&
      (checkOn === CheckOn.SnmpOidValue || checkOn === CheckOn.SnmpOidExists)
    ) {
      subject += ` ${oid}`;
    }

    // Criteria on two fields of one result would otherwise share a name.
    const resultValuePath: string | undefined =
      criteriaFilter.customCodeMonitorOptions?.resultValuePath?.trim();

    if (resultValuePath && checkOn === CheckOn.ResultValue) {
      subject += ` at ${resultValuePath}`;
    }

    const interfaceName: string | undefined =
      criteriaFilter.snmpMonitorOptions?.interfaceName?.trim();

    if (interfaceName) {
      subject += ` on ${interfaceName}`;
    }

    const diskPath: string | undefined =
      criteriaFilter.serverMonitorOptions?.diskPath?.trim();

    if (diskPath) {
      subject += ` on ${diskPath}`;
    }

    return subject;
  }

  /*
   * The filter's value as it reads in a name: numbers as they are, with the
   * unit the threshold was entered in, and text in quotes so it cannot run
   * into the words around it. Empty when there is no value yet.
   */
  private static formatValue(criteriaFilter: CriteriaFilter): string {
    const rawValue: string | number | undefined = criteriaFilter.value;

    if (rawValue === undefined || rawValue === null) {
      return "";
    }

    const value: string = String(rawValue).trim();

    if (!value) {
      return "";
    }

    const isNumeric: boolean = NUMERIC_VALUE.test(value);

    if (!isNumeric) {
      return `"${CriteriaNameUtil.truncate(
        value,
        CriteriaNameUtil.MAX_VALUE_LENGTH,
      )}"`;
    }

    let unit: string = "";

    if (
      criteriaFilter.checkOn === CheckOn.MetricValue &&
      criteriaFilter.metricMonitorOptions?.thresholdUnit
    ) {
      unit = criteriaFilter.metricMonitorOptions.thresholdUnit;
    } else if (
      criteriaFilter.checkOn === CheckOn.DatabaseMetric &&
      criteriaFilter.databaseMonitorOptions?.metricType
    ) {
      unit =
        getDatabaseMetricByMetricType(
          criteriaFilter.databaseMonitorOptions.metricType,
        )?.unit || "";
    }

    return unit ? `${value} ${unit}` : value;
  }

  private static truncate(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
      return text;
    }

    return `${text.slice(0, maxLength - 1).trimEnd()}${CriteriaNameUtil.ELLIPSIS}`;
  }
}
