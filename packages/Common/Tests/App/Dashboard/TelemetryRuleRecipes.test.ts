import { describe, expect, test } from "@jest/globals";
import {
  ALL_RECIPES,
  applyRecipe,
  buildAlert,
  buildIncident,
  buildRecipeRule,
  findRecipe,
  getDefaultRecipe,
  getRecipe,
  getRecipes,
  getRuleNameFromFilter,
  getStatusForAction,
  isUntouchedRecipeRule,
  keepTelemetryQuery,
  METRIC_ABOVE_RECIPE,
  TelemetryRuleRecipe,
  TelemetryRuleRecipeKey,
  TelemetryRuleSeeds,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/TelemetryRule/TelemetryRuleRecipes";
import MonitorCriteriaAlignmentUtil, {
  CriteriaSeedOptions,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/MonitorCriteriaAlignment";
import { SpanStatus } from "../../../Models/AnalyticsModels/Span";
import LogSeverity from "../../../Types/Log/LogSeverity";
import { CriteriaAlert } from "../../../Types/Monitor/CriteriaAlert";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import { CriteriaIncident } from "../../../Types/Monitor/CriteriaIncident";
import MonitorCriteria from "../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import { MonitorStepLogMonitorUtil } from "../../../Types/Monitor/MonitorStepLogMonitor";
import { MonitorStepMetricMonitorUtil } from "../../../Types/Monitor/MonitorStepMetricMonitor";
import { MonitorStepTraceMonitorUtil } from "../../../Types/Monitor/MonitorStepTraceMonitor";
import MonitorType from "../../../Types/Monitor/MonitorType";
import TelemetryAlertRuleUtil, {
  TelemetryAlertRule,
  TelemetryAlertRuleAction,
  TelemetryAlertRuleRecovery,
} from "../../../Types/Monitor/TelemetryAlertRule";
import ObjectID from "../../../Types/ObjectID";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import {
  createTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";

/*
 * The recipes a new Logs, Traces, Exceptions or Metrics monitor is set up
 * from ("Too many errors", "A message appears", "Logs stop", ...): what
 * each one fills in, that it reads back as the same recipe, and that
 * Create Monitor can tell criteria nobody has worked on yet - a recipe's
 * rule, the empty criteria a link hands in, a type's out-of-the-box
 * criteria - from criteria somebody has, so a change of monitor type
 * starts the new type on its own recipe instead of a half-fitting copy of
 * the old one.
 */

const ENGLISH: Translator = createTranslator(undefined, "en");

const OPERATIONAL: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const DEGRADED: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const OFFLINE: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const INCIDENT_SEVERITY: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const ALERT_SEVERITY: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const WARNING_ALERT_SEVERITY: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const SERVICE: ObjectID = new ObjectID("77777777-7777-4777-8777-777777777777");

const SEEDS: TelemetryRuleSeeds = {
  monitorName: "Checkout",
  operationalStatusId: OPERATIONAL,
  degradedStatusId: DEGRADED,
  offlineStatusId: OFFLINE,
  incidentSeverityId: INCIDENT_SEVERITY,
  alertSeverityId: ALERT_SEVERITY,
};

const CRITERIA_SEED_OPTIONS: CriteriaSeedOptions = {
  monitorName: "Checkout",
  onlineMonitorStatusId: OPERATIONAL,
  offlineMonitorStatusId: OFFLINE,
  defaultIncidentSeverityId: INCIDENT_SEVERITY,
  defaultAlertSeverityId: ALERT_SEVERITY,
  warningAlertSeverityId: WARNING_ALERT_SEVERITY,
};

// A new step, as a new monitor of this type starts.
const newStep: (monitorType: MonitorType) => MonitorStep = (
  monitorType: MonitorType,
): MonitorStep => {
  const step: MonitorStep = new MonitorStep();

  switch (monitorType) {
    case MonitorType.Logs:
      step.setLogMonitor(MonitorStepLogMonitorUtil.getDefault());
      break;
    case MonitorType.Traces:
      step.setTraceMonitor(MonitorStepTraceMonitorUtil.getDefault());
      break;
    case MonitorType.Metrics:
      step.setMetricMonitor(MonitorStepMetricMonitorUtil.getDefault());
      break;
    default:
      break;
  }

  return step;
};

const recipeOf: (key: TelemetryRuleRecipeKey) => TelemetryRuleRecipe = (
  key: TelemetryRuleRecipeKey,
): TelemetryRuleRecipe => {
  const recipe: TelemetryRuleRecipe | null = getRecipe(key);

  if (!recipe) {
    throw new Error(`No recipe ${key}`);
  }

  return recipe;
};

const applied: (
  key: TelemetryRuleRecipeKey,
  step?: MonitorStep,
) => MonitorStep = (
  key: TelemetryRuleRecipeKey,
  step?: MonitorStep,
): MonitorStep => {
  const recipe: TelemetryRuleRecipe = recipeOf(key);

  return applyRecipe({
    monitorStep: step || newStep(recipe.monitorType),
    recipe,
    seeds: SEEDS,
    translator: ENGLISH,
  });
};

const onlyInstance: (step: MonitorStep) => MonitorCriteriaInstance = (
  step: MonitorStep,
): MonitorCriteriaInstance => {
  const instances: Array<MonitorCriteriaInstance> =
    step.data?.monitorCriteria?.data?.monitorCriteriaInstanceArray || [];

  expect(instances).toHaveLength(1);

  return instances[0]!;
};

const onlyFilter: (step: MonitorStep) => CriteriaFilter = (
  step: MonitorStep,
): CriteriaFilter => {
  const filters: Array<CriteriaFilter> = onlyInstance(step).data!.filters;

  expect(filters).toHaveLength(1);

  return filters[0]!;
};

const readRule: (
  monitorType: MonitorType,
  step: MonitorStep,
) => TelemetryAlertRule = (
  monitorType: MonitorType,
  step: MonitorStep,
): TelemetryAlertRule => {
  const rule: TelemetryAlertRule | null = TelemetryAlertRuleUtil.read({
    monitorType,
    monitorStep: step,
    defaultMonitorStatusId: OPERATIONAL,
  }).rule;

  if (!rule) {
    throw new Error("The recipe's criteria do not read as one rule");
  }

  return rule;
};

describe("the recipes each telemetry monitor type offers", () => {
  test("a Logs monitor asks about errors, a message, or silence, in that order", () => {
    expect(
      getRecipes(MonitorType.Logs).map((recipe: TelemetryRuleRecipe) => {
        return [recipe.key, recipe.title];
      }),
    ).toEqual([
      [TelemetryRuleRecipeKey.ErrorLogs, "Too many errors"],
      [TelemetryRuleRecipeKey.LogMessage, "A message appears"],
      [TelemetryRuleRecipeKey.LogsStop, "Logs stop"],
    ]);
  });

  test("a Traces monitor asks about failed requests or requests that stop", () => {
    expect(
      getRecipes(MonitorType.Traces).map((recipe: TelemetryRuleRecipe) => {
        return [recipe.key, recipe.title];
      }),
    ).toEqual([
      [TelemetryRuleRecipeKey.FailedSpans, "Too many failed requests"],
      [TelemetryRuleRecipeKey.SpansStop, "Requests stop"],
    ]);
  });

  test("an Exceptions monitor asks about any exception, too many, a new one, one back, or a spike", () => {
    expect(
      getRecipes(MonitorType.Exceptions).map((recipe: TelemetryRuleRecipe) => {
        return [recipe.key, recipe.title, recipe.measure];
      }),
    ).toEqual([
      [TelemetryRuleRecipeKey.AnyException, "Any exception", undefined],
      [TelemetryRuleRecipeKey.ExceptionSpike, "Too many exceptions", undefined],
      [
        TelemetryRuleRecipeKey.NewException,
        "A new exception",
        CheckOn.NewExceptionCount,
      ],
      [
        TelemetryRuleRecipeKey.RegressedException,
        "A resolved exception comes back",
        CheckOn.RegressedExceptionCount,
      ],
      [
        TelemetryRuleRecipeKey.ExceptionRise,
        "Exceptions spike",
        CheckOn.ExceptionCountIncreasePercent,
      ],
    ]);
  });

  /*
   * A new or a regressed exception is a rule on another measure: the rule
   * it writes compares that measure, and reads back as the same recipe -
   * never as Any exception, which has the same condition and number.
   */
  test.each([
    [TelemetryRuleRecipeKey.NewException, CheckOn.NewExceptionCount],
    [
      TelemetryRuleRecipeKey.RegressedException,
      CheckOn.RegressedExceptionCount,
    ],
    [
      TelemetryRuleRecipeKey.ExceptionRise,
      CheckOn.ExceptionCountIncreasePercent,
    ],
  ])(
    "%s writes criteria on its own measure",
    (key: TelemetryRuleRecipeKey, measure: CheckOn) => {
      const recipe: TelemetryRuleRecipe = getRecipes(
        MonitorType.Exceptions,
      ).find((candidate: TelemetryRuleRecipe) => {
        return candidate.key === key;
      })!;
      const step: MonitorStep = applyRecipe({
        monitorStep: MonitorStep.getDefaultMonitorStep({
          monitorType: MonitorType.Exceptions,
          monitorName: "Checkout",
          onlineMonitorStatusId: ObjectID.generate(),
          offlineMonitorStatusId: ObjectID.generate(),
          defaultIncidentSeverityId: ObjectID.generate(),
          defaultAlertSeverityId: ObjectID.generate(),
        }),
        recipe,
        seeds: { monitorName: "Checkout" },
        translator: ENGLISH,
      });

      const filters: Array<{ checkOn: CheckOn }> = (
        step.data?.monitorCriteria?.data?.monitorCriteriaInstanceArray || []
      ).flatMap(
        (instance: { data?: { filters: Array<{ checkOn: CheckOn }> } }) => {
          return instance.data?.filters || [];
        },
      );

      expect(filters.length).toBeGreaterThan(0);
      for (const filter of filters) {
        expect(filter.checkOn).toBe(measure);
      }
    },
  );

  test("a Metrics monitor offers no recipe to pick: what is too high depends on the metric", () => {
    expect(getRecipes(MonitorType.Metrics)).toEqual([]);
  });

  test.each([
    MonitorType.Website,
    MonitorType.API,
    MonitorType.Host,
    MonitorType.Kubernetes,
    MonitorType.SecurityEvents,
    MonitorType.Profiles,
    MonitorType.Manual,
  ])("%s offers none", (monitorType: MonitorType) => {
    expect(getRecipes(monitorType)).toEqual([]);
    expect(getDefaultRecipe(monitorType)).toBeNull();
  });

  test("a new monitor starts on its type's first recipe, a Metrics one on 'above a value'", () => {
    expect(getDefaultRecipe(MonitorType.Logs)?.key).toBe(
      TelemetryRuleRecipeKey.ErrorLogs,
    );
    expect(getDefaultRecipe(MonitorType.Traces)?.key).toBe(
      TelemetryRuleRecipeKey.FailedSpans,
    );
    expect(getDefaultRecipe(MonitorType.Exceptions)?.key).toBe(
      TelemetryRuleRecipeKey.AnyException,
    );
    expect(getDefaultRecipe(MonitorType.Metrics)).toBe(METRIC_ABOVE_RECIPE);
  });

  test("every recipe is found by its key, once, and Something else is none of them", () => {
    const keys: Array<TelemetryRuleRecipeKey> = ALL_RECIPES.map(
      (recipe: TelemetryRuleRecipe) => {
        return recipe.key;
      },
    );

    expect(new Set(keys).size).toBe(keys.length);

    for (const recipe of ALL_RECIPES) {
      expect(getRecipe(recipe.key)).toBe(recipe);
    }

    expect(getRecipe(TelemetryRuleRecipeKey.Custom)).toBeNull();
  });

  test("every recipe's window is one the rule's window picker offers, and opens something", () => {
    for (const recipe of ALL_RECIPES) {
      expect([60, 300, 600, 900, 1800, 3600]).toContain(recipe.windowInSeconds);
      expect(recipe.action).not.toBe(TelemetryAlertRuleAction.StatusOnly);
      expect(recipe.openedTitle).toContain("{{monitorName}}");
    }
  });
});

describe("what a recipe's rule opens, and the status it sets", () => {
  test("an alert sets the status between operational and offline", () => {
    expect(
      getStatusForAction({
        action: TelemetryAlertRuleAction.Alert,
        seeds: SEEDS,
      }),
    ).toBe(DEGRADED);
  });

  test("an incident, or both, sets the offline status", () => {
    expect(
      getStatusForAction({
        action: TelemetryAlertRuleAction.Incident,
        seeds: SEEDS,
      }),
    ).toBe(OFFLINE);
    expect(
      getStatusForAction({
        action: TelemetryAlertRuleAction.AlertAndIncident,
        seeds: SEEDS,
      }),
    ).toBe(OFFLINE);
  });

  test("a project with no status between the two uses offline for an alert too", () => {
    expect(
      getStatusForAction({
        action: TelemetryAlertRuleAction.Alert,
        seeds: { ...SEEDS, degradedStatusId: undefined },
      }),
    ).toBe(OFFLINE);
  });

  test("an incident falls back to the degraded status when there is no offline one", () => {
    expect(
      getStatusForAction({
        action: TelemetryAlertRuleAction.Incident,
        seeds: { ...SEEDS, offlineStatusId: undefined },
      }),
    ).toBe(DEGRADED);
  });

  test("the incident and alert a rule opens resolve themselves, on the most severe severity", () => {
    const incident: CriteriaIncident = buildIncident({
      title: "Checkout: too many errors",
      seeds: SEEDS,
    });
    const alert: CriteriaAlert = buildAlert({
      title: "Checkout: too many errors",
      seeds: SEEDS,
    });

    expect(incident).toMatchObject({
      title: "Checkout: too many errors",
      description: "",
      incidentSeverityId: INCIDENT_SEVERITY,
      autoResolveIncident: true,
      onCallPolicyIds: [],
    });
    expect(ObjectID.isValidUUID(incident.id)).toBe(true);

    expect(alert).toMatchObject({
      title: "Checkout: too many errors",
      description: "",
      alertSeverityId: ALERT_SEVERITY,
      autoResolveAlert: true,
      onCallPolicyIds: [],
    });
    expect(ObjectID.isValidUUID(alert.id)).toBe(true);
    expect(alert.id).not.toBe(incident.id);
  });

  test("a rule is named after its filter, the way every criteria named after its filters is", () => {
    expect(
      getRuleNameFromFilter({
        monitorType: MonitorType.Logs,
        filterType: FilterType.GreaterThan,
        threshold: 10,
      }),
    ).toMatch(/Log Count/);
    expect(
      getRuleNameFromFilter({
        monitorType: MonitorType.Traces,
        filterType: FilterType.EqualTo,
        threshold: 0,
      }),
    ).toMatch(/Span Count/);
    expect(
      getRuleNameFromFilter({
        monitorType: MonitorType.Exceptions,
        filterType: FilterType.GreaterThan,
        threshold: 0,
      }),
    ).toMatch(/Exception Count/);
    expect(
      getRuleNameFromFilter({
        monitorType: MonitorType.Website,
        filterType: FilterType.GreaterThan,
        threshold: 0,
      }),
    ).toBeTruthy();
  });
});

describe("a recipe's rule", () => {
  test("Too many errors: more than 10 error and fatal logs in 5 minutes opens an alert", () => {
    const rule: TelemetryAlertRule = buildRecipeRule({
      recipe: recipeOf(TelemetryRuleRecipeKey.ErrorLogs),
      seeds: SEEDS,
      translator: ENGLISH,
    });

    expect(rule).toMatchObject({
      filterType: FilterType.GreaterThan,
      threshold: 10,
      windowInSeconds: 300,
      action: TelemetryAlertRuleAction.Alert,
      monitorStatusId: DEGRADED,
      recovery: TelemetryAlertRuleRecovery.DefaultStatus,
      incident: undefined,
    });
    expect(rule.alert?.title).toBe("Checkout: too many errors");
    expect(rule.alert?.alertSeverityId).toBe(ALERT_SEVERITY);
    expect(ObjectID.isValidUUID(rule.ruleCriteriaId)).toBe(true);
  });

  test("Logs stop: exactly none in 10 minutes declares an incident", () => {
    const rule: TelemetryAlertRule = buildRecipeRule({
      recipe: recipeOf(TelemetryRuleRecipeKey.LogsStop),
      seeds: SEEDS,
      translator: ENGLISH,
    });

    expect(rule).toMatchObject({
      filterType: FilterType.EqualTo,
      threshold: 0,
      windowInSeconds: 600,
      action: TelemetryAlertRuleAction.Incident,
      monitorStatusId: OFFLINE,
      alert: undefined,
    });
    expect(rule.incident?.title).toBe("Checkout: logs stopped");
    expect(rule.incident?.incidentSeverityId).toBe(INCIDENT_SEVERITY);
  });

  test("a Metrics monitor's rule: the average over 5 minutes above a value still to enter", () => {
    const rule: TelemetryAlertRule = buildRecipeRule({
      recipe: METRIC_ABOVE_RECIPE,
      seeds: SEEDS,
      translator: ENGLISH,
    });

    expect(rule).toMatchObject({
      filterType: FilterType.GreaterThan,
      threshold: undefined,
      windowInSeconds: undefined,
      rollingTime: RollingTime.Past5Minutes,
      metricAggregationType: EvaluateOverTimeType.Average,
      action: TelemetryAlertRuleAction.Alert,
    });
  });

  test("its title is said in the reader's language", () => {
    const german: Translator = createTranslator((text: string) => {
      return text === "{{monitorName}}: too many errors"
        ? "{{monitorName}}: zu viele Fehler"
        : undefined;
    }, "de");

    expect(
      buildRecipeRule({
        recipe: recipeOf(TelemetryRuleRecipeKey.ErrorLogs),
        seeds: SEEDS,
        translator: german,
      }).alert?.title,
    ).toBe("Checkout: zu viele Fehler");
  });
});

describe("a recipe applied to a step", () => {
  test("Too many errors watches error and fatal logs, keeping the rest of the query", () => {
    const step: MonitorStep = newStep(MonitorType.Logs);
    step.setLogMonitor({
      ...MonitorStepLogMonitorUtil.getDefault(),
      body: "payment",
      telemetryServiceIds: [SERVICE],
      severityTexts: [LogSeverity.Information],
    });

    const result: MonitorStep = applied(TelemetryRuleRecipeKey.ErrorLogs, step);

    expect(result.data?.logMonitor).toMatchObject({
      body: "payment",
      telemetryServiceIds: [SERVICE],
      severityTexts: [LogSeverity.Error, LogSeverity.Fatal],
      lastXSecondsOfLogs: 300,
    });
    expect(onlyFilter(result)).toMatchObject({
      checkOn: CheckOn.LogCount,
      filterType: FilterType.GreaterThan,
      value: 10,
    });
    expect(onlyInstance(result).data).toMatchObject({
      createAlerts: true,
      createIncidents: false,
      changeMonitorStatus: true,
      monitorStatusId: DEGRADED,
      isEnabled: true,
    });
    // The step it was applied to is left as it was.
    expect(step.data?.logMonitor?.severityTexts).toEqual([
      LogSeverity.Information,
    ]);
  });

  test("A message appears and Logs stop watch every severity", () => {
    for (const key of [
      TelemetryRuleRecipeKey.LogMessage,
      TelemetryRuleRecipeKey.LogsStop,
    ]) {
      const step: MonitorStep = newStep(MonitorType.Logs);
      step.setLogMonitor({
        ...MonitorStepLogMonitorUtil.getDefault(),
        severityTexts: [LogSeverity.Error],
      });

      expect(applied(key, step).data?.logMonitor?.severityTexts).toEqual([]);
    }
  });

  test("Too many failed requests watches spans with an error status; Requests stop every status", () => {
    expect(
      applied(TelemetryRuleRecipeKey.FailedSpans).data?.traceMonitor
        ?.spanStatuses,
    ).toEqual([SpanStatus.Error]);
    expect(
      onlyFilter(applied(TelemetryRuleRecipeKey.FailedSpans)),
    ).toMatchObject({
      checkOn: CheckOn.SpanCount,
      filterType: FilterType.GreaterThan,
      value: 10,
    });

    const failed: MonitorStep = applied(TelemetryRuleRecipeKey.FailedSpans);
    expect(
      applied(TelemetryRuleRecipeKey.SpansStop, failed).data?.traceMonitor
        ?.spanStatuses,
    ).toEqual([]);
  });

  test("an Exceptions recipe counts exceptions over 5 minutes", () => {
    const step: MonitorStep = applied(TelemetryRuleRecipeKey.AnyException);

    expect(step.data?.exceptionMonitor?.lastXSecondsOfExceptions).toBe(300);
    expect(onlyFilter(step)).toMatchObject({
      checkOn: CheckOn.ExceptionCount,
      filterType: FilterType.GreaterThan,
      value: 0,
    });
  });

  test("a Metrics monitor's rule reads its first query over 5 minutes, by its average", () => {
    const step: MonitorStep = applyRecipe({
      monitorStep: newStep(MonitorType.Metrics),
      recipe: METRIC_ABOVE_RECIPE,
      seeds: SEEDS,
      translator: ENGLISH,
    });

    expect(step.data?.metricMonitor?.rollingTime).toBe(
      RollingTime.Past5Minutes,
    );
    expect(onlyFilter(step)).toMatchObject({
      checkOn: CheckOn.MetricValue,
      filterType: FilterType.GreaterThan,
      value: undefined,
    });
    expect(onlyFilter(step).metricMonitorOptions?.metricAggregationType).toBe(
      EvaluateOverTimeType.Average,
    );
  });

  test.each(
    ALL_RECIPES.map(
      (recipe: TelemetryRuleRecipe): [string, TelemetryRuleRecipe] => {
        return [recipe.key, recipe];
      },
    ),
  )(
    "%s reads back as the rule it wrote, and as itself",
    (_key: string, recipe: TelemetryRuleRecipe) => {
      const step: MonitorStep = applyRecipe({
        monitorStep: newStep(recipe.monitorType),
        recipe,
        seeds: SEEDS,
        translator: ENGLISH,
      });

      const rule: TelemetryAlertRule = readRule(recipe.monitorType, step);

      expect(rule.filterType).toBe(recipe.filterType);
      expect(rule.threshold).toBe(recipe.threshold);
      expect(rule.action).toBe(recipe.action);
      expect(rule.recovery).toBe(TelemetryAlertRuleRecovery.DefaultStatus);

      if (recipe.monitorType === MonitorType.Metrics) {
        expect(rule.rollingTime).toBe(recipe.rollingTime);
        expect(rule.metricAggregationType).toBe(recipe.metricAggregationType);
        // A metric has no recipe to pick: it reads as Something else.
        expect(
          findRecipe({
            monitorType: recipe.monitorType,
            monitorStep: step,
            defaultMonitorStatusId: OPERATIONAL,
          }),
        ).toBe(TelemetryRuleRecipeKey.Custom);
      } else {
        expect(rule.windowInSeconds).toBe(recipe.windowInSeconds);
        expect(
          findRecipe({
            monitorType: recipe.monitorType,
            monitorStep: step,
            defaultMonitorStatusId: OPERATIONAL,
          }),
        ).toBe(recipe.key);
      }
    },
  );
});

describe("which recipe a step is", () => {
  test("a recipe whose number, window or action changed is Something else", () => {
    const step: MonitorStep = applied(TelemetryRuleRecipeKey.ErrorLogs);
    const rule: TelemetryAlertRule = readRule(MonitorType.Logs, step);

    for (const changes of [
      { threshold: 11 },
      { windowInSeconds: 600 },
      { action: TelemetryAlertRuleAction.Incident },
    ] as Array<Partial<TelemetryAlertRule>>) {
      const changed: MonitorStep = TelemetryAlertRuleUtil.write({
        monitorType: MonitorType.Logs,
        monitorStep: step,
        rule: { ...rule, ...changes },
      });

      expect(
        findRecipe({
          monitorType: MonitorType.Logs,
          monitorStep: changed,
          defaultMonitorStatusId: OPERATIONAL,
        }),
      ).toBe(TelemetryRuleRecipeKey.Custom);
    }
  });

  test("Too many errors over other severities is Something else", () => {
    const step: MonitorStep = applied(TelemetryRuleRecipeKey.ErrorLogs);
    step.setLogMonitor({
      ...step.data!.logMonitor!,
      severityTexts: [LogSeverity.Error],
    });

    expect(
      findRecipe({
        monitorType: MonitorType.Logs,
        monitorStep: step,
        defaultMonitorStatusId: OPERATIONAL,
      }),
    ).toBe(TelemetryRuleRecipeKey.Custom);
  });

  test("severities in another order are the same recipe", () => {
    const step: MonitorStep = applied(TelemetryRuleRecipeKey.ErrorLogs);
    step.setLogMonitor({
      ...step.data!.logMonitor!,
      severityTexts: [LogSeverity.Fatal, LogSeverity.Error],
    });

    expect(
      findRecipe({
        monitorType: MonitorType.Logs,
        monitorStep: step,
        defaultMonitorStatusId: OPERATIONAL,
      }),
    ).toBe(TelemetryRuleRecipeKey.ErrorLogs);
  });

  test("criteria that are not one rule are Something else", () => {
    const step: MonitorStep = newStep(MonitorType.Logs);
    step.setMonitorCriteria(
      MonitorCriteria.getDefaultMonitorCriteria({
        monitorType: MonitorType.Logs,
        ...CRITERIA_SEED_OPTIONS,
      }),
    );
    const twice: MonitorCriteria = new MonitorCriteria();
    twice.data = {
      monitorCriteriaInstanceArray: [
        ...applied(TelemetryRuleRecipeKey.ErrorLogs).data!.monitorCriteria!
          .data!.monitorCriteriaInstanceArray,
        ...applied(TelemetryRuleRecipeKey.LogsStop).data!.monitorCriteria!.data!
          .monitorCriteriaInstanceArray,
        ...applied(TelemetryRuleRecipeKey.LogMessage).data!.monitorCriteria!
          .data!.monitorCriteriaInstanceArray,
      ],
    };
    step.setMonitorCriteria(twice);

    expect(
      findRecipe({
        monitorType: MonitorType.Logs,
        monitorStep: step,
        defaultMonitorStatusId: OPERATIONAL,
      }),
    ).toBe(TelemetryRuleRecipeKey.Custom);
  });
});

describe("criteria nobody has worked on yet", () => {
  test.each(
    ALL_RECIPES.map(
      (recipe: TelemetryRuleRecipe): [string, TelemetryRuleRecipe] => {
        return [recipe.key, recipe];
      },
    ),
  )(
    "%s, untouched, is nobody's work, on a step of any type",
    (_key: string, recipe: TelemetryRuleRecipe) => {
      const step: MonitorStep = applyRecipe({
        monitorStep: newStep(recipe.monitorType),
        recipe,
        seeds: SEEDS,
        translator: ENGLISH,
      });

      expect(
        isUntouchedRecipeRule({
          monitorStep: step,
          seeds: SEEDS,
          translator: ENGLISH,
        }),
      ).toBe(true);

      // The step's type does not matter: the criteria are what is compared.
      const elsewhere: MonitorStep = newStep(MonitorType.Website);
      elsewhere.setMonitorCriteria(step.data!.monitorCriteria!);

      expect(
        isUntouchedRecipeRule({
          monitorStep: elsewhere,
          seeds: SEEDS,
          translator: ENGLISH,
        }),
      ).toBe(true);
    },
  );

  test("a recipe's rule still is after the monitor was renamed: its titles are not compared", () => {
    const step: MonitorStep = applyRecipe({
      monitorStep: newStep(MonitorType.Logs),
      recipe: recipeOf(TelemetryRuleRecipeKey.ErrorLogs),
      seeds: { ...SEEDS, monitorName: "Shop" },
      translator: ENGLISH,
    });

    expect(
      isUntouchedRecipeRule({
        monitorStep: step,
        seeds: { ...SEEDS, monitorName: "Checkout API" },
        translator: ENGLISH,
      }),
    ).toBe(true);
  });

  test("a recipe whose number, action, status or severity changed is somebody's work", () => {
    const step: MonitorStep = applied(TelemetryRuleRecipeKey.ErrorLogs);
    const rule: TelemetryAlertRule = readRule(MonitorType.Logs, step);

    for (const changes of [
      { threshold: 50 },
      { action: TelemetryAlertRuleAction.AlertAndIncident },
      { monitorStatusId: OFFLINE },
      {
        alert: { ...rule.alert!, alertSeverityId: WARNING_ALERT_SEVERITY },
      },
    ] as Array<Partial<TelemetryAlertRule>>) {
      const changed: MonitorStep = TelemetryAlertRuleUtil.write({
        monitorType: MonitorType.Logs,
        monitorStep: step,
        rule: { ...rule, ...changes },
      });

      expect(
        isUntouchedRecipeRule({
          monitorStep: changed,
          seeds: SEEDS,
          translator: ENGLISH,
        }),
      ).toBe(false);
    }
  });

  test("a Metrics rule with a value entered is somebody's work", () => {
    const step: MonitorStep = applyRecipe({
      monitorStep: newStep(MonitorType.Metrics),
      recipe: METRIC_ABOVE_RECIPE,
      seeds: SEEDS,
      translator: ENGLISH,
    });
    const rule: TelemetryAlertRule = readRule(MonitorType.Metrics, step);

    const withValue: MonitorStep = TelemetryAlertRuleUtil.write({
      monitorType: MonitorType.Metrics,
      monitorStep: step,
      rule: { ...rule, threshold: 80 },
    });

    expect(
      isUntouchedRecipeRule({
        monitorStep: withValue,
        seeds: SEEDS,
        translator: ENGLISH,
      }),
    ).toBe(false);
  });

  test("the empty criteria a new step starts with, and a type's out-of-the-box criteria, are not a recipe's rule", () => {
    const blank: MonitorStep = new MonitorStep();

    expect(
      isUntouchedRecipeRule({
        monitorStep: blank,
        seeds: SEEDS,
        translator: ENGLISH,
      }),
    ).toBe(false);

    const defaults: MonitorStep = newStep(MonitorType.Logs);
    defaults.setMonitorCriteria(
      MonitorCriteria.getDefaultMonitorCriteria({
        monitorType: MonitorType.Logs,
        ...CRITERIA_SEED_OPTIONS,
      }),
    );

    expect(
      isUntouchedRecipeRule({
        monitorStep: defaults,
        seeds: SEEDS,
        translator: ENGLISH,
      }),
    ).toBe(false);
  });

  test("blank criteria are nobody's work, and so are every type's out-of-the-box criteria, whatever the monitor is called", () => {
    expect(
      MonitorCriteriaAlignmentUtil.isBlankOrUntouchedDefault({
        monitorCriteria: new MonitorCriteria(),
        seedOptions: CRITERIA_SEED_OPTIONS,
      }),
    ).toBe(true);

    for (const monitorType of [
      MonitorType.Website,
      MonitorType.API,
      MonitorType.Ping,
      MonitorType.SSLCertificate,
      MonitorType.Logs,
      MonitorType.Traces,
      MonitorType.Exceptions,
      MonitorType.Metrics,
      MonitorType.IncomingRequest,
    ]) {
      const seededAsShop: MonitorCriteria =
        MonitorCriteria.getDefaultMonitorCriteria({
          monitorType,
          ...CRITERIA_SEED_OPTIONS,
          monitorName: "Shop",
        });

      expect(
        MonitorCriteriaAlignmentUtil.isBlankOrUntouchedDefault({
          monitorCriteria: seededAsShop,
          seedOptions: CRITERIA_SEED_OPTIONS,
        }),
      ).toBe(true);
    }
  });

  test("out-of-the-box criteria with a changed status, severity or filter are somebody's work", () => {
    const defaults: MonitorCriteria = MonitorCriteria.getDefaultMonitorCriteria(
      {
        monitorType: MonitorType.Website,
        ...CRITERIA_SEED_OPTIONS,
      },
    );

    const changedStatus: MonitorCriteria = MonitorCriteria.fromJSON(
      defaults.toJSON(),
    );
    changedStatus.data!.monitorCriteriaInstanceArray[0]!.data!.monitorStatusId =
      DEGRADED;

    const changedFilter: MonitorCriteria = MonitorCriteria.fromJSON(
      defaults.toJSON(),
    );
    changedFilter.data!.monitorCriteriaInstanceArray[0]!.data!.filters = [
      {
        checkOn: CheckOn.ResponseTime,
        filterType: FilterType.GreaterThan,
        value: 2000,
      },
    ];

    for (const criteria of [changedStatus, changedFilter]) {
      expect(
        MonitorCriteriaAlignmentUtil.isBlankOrUntouchedDefault({
          monitorCriteria: criteria,
          seedOptions: CRITERIA_SEED_OPTIONS,
        }),
      ).toBe(false);
    }

    // A recipe's rule is not a type's out-of-the-box criteria either.
    expect(
      MonitorCriteriaAlignmentUtil.isBlankOrUntouchedDefault({
        monitorCriteria: applied(TelemetryRuleRecipeKey.ErrorLogs).data!
          .monitorCriteria!,
        seedOptions: CRITERIA_SEED_OPTIONS,
      }),
    ).toBe(false);
  });

  test("criteria told apart by their words alone have the same word-blind fingerprint, and different full ones", () => {
    const shop: MonitorCriteria = MonitorCriteria.getDefaultMonitorCriteria({
      monitorType: MonitorType.Logs,
      ...CRITERIA_SEED_OPTIONS,
      monitorName: "Shop",
    });
    const checkout: MonitorCriteria = MonitorCriteria.getDefaultMonitorCriteria(
      {
        monitorType: MonitorType.Logs,
        ...CRITERIA_SEED_OPTIONS,
        monitorName: "Checkout",
      },
    );

    expect(MonitorCriteriaAlignmentUtil.fingerprint(shop)).not.toBe(
      MonitorCriteriaAlignmentUtil.fingerprint(checkout),
    );
    expect(MonitorCriteriaAlignmentUtil.fingerprintIgnoringWords(shop)).toBe(
      MonitorCriteriaAlignmentUtil.fingerprintIgnoringWords(checkout),
    );
    // The criteria themselves keep their words.
    expect(shop.data!.monitorCriteriaInstanceArray[0]!.data!.name).toContain(
      "Shop",
    );
  });
});

describe("a step's query kept when its criteria are set up afresh", () => {
  test("a Metrics monitor keeps the queries it was handed, and nothing of another type", () => {
    const handedIn: MonitorStep = new MonitorStep();
    handedIn.setMetricMonitor({
      ...MonitorStepMetricMonitorUtil.getDefault(),
      rollingTime: RollingTime.Past1Hour,
      metricViewConfig: {
        queryConfigs: [
          {
            metricAliasData: {
              metricVariable: "a",
              title: "Queue depth",
              description: "",
              legend: "",
              legendUnit: "",
            },
            metricQueryData: {
              filterData: { metricName: "shop.queue.depth" },
            },
          },
        ],
        formulaConfigs: [],
      },
    });

    const fresh: MonitorStep = newStep(MonitorType.Metrics);

    const kept: MonitorStep = keepTelemetryQuery({
      monitorType: MonitorType.Metrics,
      from: handedIn,
      to: fresh,
    });

    expect(
      kept.data?.metricMonitor?.metricViewConfig.queryConfigs[0]
        ?.metricQueryData.filterData.metricName,
    ).toBe("shop.queue.depth");
    expect(kept.data?.metricMonitor?.rollingTime).toBe(RollingTime.Past1Hour);
    expect(kept.data?.logMonitor).toBeUndefined();
    // The fresh step itself is left as it was.
    expect(fresh.data?.metricMonitor?.metricViewConfig.queryConfigs).toEqual(
      MonitorStepMetricMonitorUtil.getDefault().metricViewConfig.queryConfigs,
    );

    // Then the recipe's rule: its own window, over the kept queries.
    const seeded: MonitorStep = applyRecipe({
      monitorStep: kept,
      recipe: METRIC_ABOVE_RECIPE,
      seeds: SEEDS,
      translator: ENGLISH,
    });

    expect(seeded.data?.metricMonitor?.rollingTime).toBe(
      RollingTime.Past5Minutes,
    );
    expect(
      seeded.data?.metricMonitor?.metricViewConfig.queryConfigs[0]
        ?.metricQueryData.filterData.metricName,
    ).toBe("shop.queue.depth");
  });

  test("a step without the type's query hands nothing over", () => {
    const website: MonitorStep = new MonitorStep();
    const fresh: MonitorStep = newStep(MonitorType.Logs);

    const kept: MonitorStep = keepTelemetryQuery({
      monitorType: MonitorType.Logs,
      from: website,
      to: fresh,
    });

    expect(kept.data?.logMonitor).toEqual(fresh.data?.logMonitor);
  });

  test.each([
    [MonitorType.Logs, "logMonitor"],
    [MonitorType.Traces, "traceMonitor"],
    [MonitorType.Exceptions, "exceptionMonitor"],
  ])(
    "%s: a step keeps its own filters",
    (monitorType: MonitorType, key: string) => {
      const from: MonitorStep = applied(
        getDefaultRecipe(monitorType)!.key,
        newStep(monitorType),
      );
      const kept: MonitorStep = keepTelemetryQuery({
        monitorType,
        from,
        to: new MonitorStep(),
      });

      expect((kept.data as unknown as Record<string, unknown>)[key]).toEqual(
        (from.data as unknown as Record<string, unknown>)[key],
      );
    },
  );
});
