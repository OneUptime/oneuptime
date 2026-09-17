import {
  ServiceAlertTemplate,
  ServiceAlertTemplateArgs,
  getAllServiceAlertTemplates,
  getLanguagesWithServiceAlertTemplates,
  getServiceAlertTemplateById,
  getServiceAlertTemplates,
} from "../../../Types/Monitor/ServiceAlertTemplates";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import MonitorStepMetricMonitor from "../../../Types/Monitor/MonitorStepMetricMonitor";
import MonitorStepTraceMonitor from "../../../Types/Monitor/MonitorStepTraceMonitor";
import MonitorStepExceptionMonitor from "../../../Types/Monitor/MonitorStepExceptionMonitor";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricFormulaConfigData from "../../../Types/Metrics/MetricFormulaConfigData";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import SeriesLabelDisplay from "../../../Types/Monitor/SeriesContext/SeriesLabelDisplay";
import { ServiceLanguage } from "../../../Types/Service/ServiceLanguage";
import ObjectID from "../../../Types/ObjectID";

/*
 * The service alert library, and the only template module whose answer depends
 * on the resource rather than only on its type.
 *
 * The failure modes worth spending a test file on are all silent — a template
 * that is registered, renders a card, creates a monitor, and then never fires:
 *
 *   1. A `checkOn` the evaluator does not implement for that monitor type.
 *      Only `MetricValue` / `SpanCount` / `ExceptionCount` are evaluated, one
 *      per monitor type, and anything else returns null forever.
 *   2. A `metricAlias` that matches no query and no formula. The evaluator
 *      silently falls back to result slot 0, so a ratio template with a typo'd
 *      alias thresholds raw bytes against "90" and fires permanently.
 *   3. A monitor step that is not scoped to the service, which would evaluate
 *      against every service in the project.
 *   4. The language filter letting one runtime's templates through to another
 *      runtime, which is how you get a JVM monitor on a Go service.
 */

const ARGS: ServiceAlertTemplateArgs = {
  serviceId: ObjectID.generate().toString(),
  onlineMonitorStatusId: ObjectID.generate(),
  offlineMonitorStatusId: ObjectID.generate(),
  defaultIncidentSeverityId: ObjectID.generate(),
  defaultAlertSeverityId: ObjectID.generate(),
  monitorName: "payments-api",
};

// The counts are canaries. Update them deliberately when adding a template.
const AGNOSTIC_COUNT: number = 8;

const TEMPLATE_COUNT_BY_LANGUAGE: Partial<Record<ServiceLanguage, number>> = {
  java: 6,
  dotnet: 4,
  nodejs: 4,
  python: 3,
  go: 4,
};

/*
 * Languages the module deliberately ships nothing extra for. They are not an
 * oversight: none of these ecosystems has a default OpenTelemetry runtime
 * metrics source, so any runtime template written for them would query a
 * metric name that nobody emits.
 */
const LANGUAGES_WITHOUT_TEMPLATES: Array<ServiceLanguage> = [
  "ruby",
  "php",
  "rust",
  "erlang",
  "swift",
  "cpp",
  "webjs",
];

const ALL_TEMPLATES: Array<ServiceAlertTemplate> =
  getAllServiceAlertTemplates();

/*
 * The one CheckOn the evaluator implements for each monitor type. Anything
 * else is accepted by the form, saved to the database, and then never
 * compared against anything.
 */
const CHECK_ON_BY_MONITOR_TYPE: Record<string, CheckOn> = {
  [MonitorType.Metrics]: CheckOn.MetricValue,
  [MonitorType.Traces]: CheckOn.SpanCount,
  [MonitorType.Exceptions]: CheckOn.ExceptionCount,
};

// The comparators `CompareCriteria.compareCriteriaNumbers` actually implements.
const NUMERIC_FILTER_TYPES: Array<FilterType> = [
  FilterType.GreaterThan,
  FilterType.LessThan,
  FilterType.EqualTo,
  FilterType.NotEqualTo,
  FilterType.GreaterThanOrEqualTo,
  FilterType.LessThanOrEqualTo,
];

function getCriteriaInstances(
  step: MonitorStep,
): Array<MonitorCriteriaInstance> {
  return step.data?.monitorCriteria?.data?.monitorCriteriaInstanceArray || [];
}

function getFilters(step: MonitorStep): Array<CriteriaFilter> {
  return getCriteriaInstances(step).flatMap(
    (instance: MonitorCriteriaInstance) => {
      return instance.data?.filters || [];
    },
  );
}

function buildStep(template: ServiceAlertTemplate): MonitorStep {
  return template.getMonitorStep(ARGS);
}

describe("ServiceAlertTemplates", () => {
  describe("the library itself", () => {
    it("ships the expected number of templates", () => {
      const languageCount: number = (
        Object.values(TEMPLATE_COUNT_BY_LANGUAGE) as Array<number>
      ).reduce((total: number, count: number) => {
        return total + count;
      }, 0);

      expect(ALL_TEMPLATES.length).toBe(AGNOSTIC_COUNT + languageCount);
    });

    it("gives every template a unique id", () => {
      const ids: Array<string> = ALL_TEMPLATES.map(
        (template: ServiceAlertTemplate) => {
          return template.id;
        },
      );

      expect(new Set<string>(ids).size).toBe(ids.length);
    });

    /*
     * Template ids are only guaranteed unique WITHIN a module, but the
     * registry-wide id is `<resourceType>:<templateId>` and every module
     * self-prefixes by convention. Keeping the convention here means a
     * `service-` id can never be confused for anyone else's in a log line or a
     * dismissal row.
     */
    it("prefixes every id with service-", () => {
      for (const template of ALL_TEMPLATES) {
        expect(template.id.startsWith("service-")).toBe(true);
      }
    });

    it("gives every template a name and a description", () => {
      for (const template of ALL_TEMPLATES) {
        expect(template.name.trim().length).toBeGreaterThan(0);
        expect(template.description.trim().length).toBeGreaterThan(0);
      }
    });

    it("uses only the three telemetry monitor types", () => {
      for (const template of ALL_TEMPLATES) {
        expect([
          MonitorType.Metrics,
          MonitorType.Traces,
          MonitorType.Exceptions,
        ]).toContain(template.monitorType);
      }
    });

    it("uses only the two recommendation severities", () => {
      for (const template of ALL_TEMPLATES) {
        expect(["Critical", "Warning"]).toContain(template.severity);
      }
    });

    /*
     * The accessors hand out copies. A caller that sorts or splices the result
     * — the recommendations page sorts for display — must not be able to
     * reorder the library for everyone else, which would make the category
     * order the page renders depend on who rendered first.
     */
    it("does not leak the internal array", () => {
      const first: Array<ServiceAlertTemplate> = getAllServiceAlertTemplates();
      first.pop();

      expect(getAllServiceAlertTemplates().length).toBe(ALL_TEMPLATES.length);
    });

    it("looks a template up by id, and answers undefined for an unknown one", () => {
      for (const template of ALL_TEMPLATES) {
        expect(getServiceAlertTemplateById(template.id)).toBe(template);
      }

      expect(
        getServiceAlertTemplateById("service-does-not-exist"),
      ).toBeUndefined();
    });
  });

  describe("selecting by language", () => {
    it("returns exactly the agnostic set when the language is unknown", () => {
      const forNull: Array<ServiceAlertTemplate> =
        getServiceAlertTemplates(null);

      expect(forNull.length).toBe(AGNOSTIC_COUNT);
      expect(getServiceAlertTemplates(undefined).length).toBe(AGNOSTIC_COUNT);
      expect(getServiceAlertTemplates().length).toBe(AGNOSTIC_COUNT);

      for (const template of forNull) {
        expect(template.language).toBeUndefined();
      }
    });

    it.each(
      Object.entries(TEMPLATE_COUNT_BY_LANGUAGE) as Array<
        [ServiceLanguage, number]
      >,
    )(
      "gives %s the agnostic set plus %s of its own",
      (language: ServiceLanguage, ownCount: number) => {
        const templates: Array<ServiceAlertTemplate> =
          getServiceAlertTemplates(language);

        expect(templates.length).toBe(AGNOSTIC_COUNT + ownCount);

        const own: Array<ServiceAlertTemplate> = templates.filter(
          (template: ServiceAlertTemplate) => {
            return Boolean(template.language);
          },
        );

        expect(own.length).toBe(ownCount);

        for (const template of own) {
          expect(template.language).toBe(language);
        }
      },
    );

    /*
     * The whole point of the feature: one runtime's templates must never
     * appear for another. A leak here is not a rendering bug — it creates
     * monitors that query metrics the service does not emit and sit green
     * forever.
     */
    it("never mixes one runtime's templates into another's", () => {
      const languages: Array<ServiceLanguage> =
        getLanguagesWithServiceAlertTemplates();

      expect(languages.length).toBe(
        Object.keys(TEMPLATE_COUNT_BY_LANGUAGE).length,
      );

      for (const language of languages) {
        for (const template of getServiceAlertTemplates(language)) {
          if (template.language) {
            expect(template.language).toBe(language);
          }
        }
      }
    });

    it.each(LANGUAGES_WITHOUT_TEMPLATES)(
      "gives %s exactly the agnostic set, rather than nothing",
      (language: ServiceLanguage) => {
        const templates: Array<ServiceAlertTemplate> =
          getServiceAlertTemplates(language);

        expect(templates.length).toBe(AGNOSTIC_COUNT);

        for (const template of templates) {
          expect(template.language).toBeUndefined();
        }
      },
    );

    /*
     * Order matters downstream: `MonitorRecommendationCatalog.getCategories`
     * derives its section order from the order templates are returned in, so
     * the agnostic sections have to stay on top for every language.
     */
    it("returns the agnostic set first, in a stable order", () => {
      const agnosticIds: Array<string> = getServiceAlertTemplates(null).map(
        (template: ServiceAlertTemplate) => {
          return template.id;
        },
      );

      for (const language of getLanguagesWithServiceAlertTemplates()) {
        const ids: Array<string> = getServiceAlertTemplates(language).map(
          (template: ServiceAlertTemplate) => {
            return template.id;
          },
        );

        expect(ids.slice(0, agnosticIds.length)).toEqual(agnosticIds);
      }
    });

    it("reports only languages that actually have templates", () => {
      for (const language of getLanguagesWithServiceAlertTemplates()) {
        expect(LANGUAGES_WITHOUT_TEMPLATES).not.toContain(language);
        expect(TEMPLATE_COUNT_BY_LANGUAGE[language]).toBeGreaterThan(0);
      }
    });
  });

  describe("the monitor step each template builds", () => {
    it("produces a step that passes monitor-step validation", () => {
      for (const template of ALL_TEMPLATES) {
        const monitorSteps: MonitorSteps = new MonitorSteps();

        monitorSteps.data = {
          monitorStepsInstanceArray: [buildStep(template)],
          defaultMonitorStatusId: ARGS.onlineMonitorStatusId,
        };

        expect(
          MonitorSteps.getValidationError(monitorSteps, template.monitorType),
        ).toBeNull();
      }
    });

    it("seeds the sub-config its monitor type is evaluated through", () => {
      /*
       * `getDefaultMonitorStep` only seeds the config matching the monitor
       * type, and the metrics worker THROWS when `metricMonitor` is missing
       * rather than falling back — so a Metrics template that forgets
       * `setMetricMonitor` is a monitor that errors every cycle.
       */
      for (const template of ALL_TEMPLATES) {
        const step: MonitorStep = buildStep(template);

        if (template.monitorType === MonitorType.Metrics) {
          expect(step.data?.metricMonitor).toBeDefined();
        }

        if (template.monitorType === MonitorType.Traces) {
          expect(step.data?.traceMonitor).toBeDefined();
        }

        if (template.monitorType === MonitorType.Exceptions) {
          expect(step.data?.exceptionMonitor).toBeDefined();
        }
      }
    });

    it("scopes every step to the service it was built for", () => {
      for (const template of ALL_TEMPLATES) {
        const step: MonitorStep = buildStep(template);

        const config:
          | MonitorStepMetricMonitor
          | MonitorStepTraceMonitor
          | MonitorStepExceptionMonitor
          | undefined =
          step.data?.metricMonitor ||
          step.data?.traceMonitor ||
          step.data?.exceptionMonitor;

        const telemetryServiceIds: Array<ObjectID> =
          config?.telemetryServiceIds || [];

        expect(telemetryServiceIds.length).toBe(1);
        expect(telemetryServiceIds[0]!.toString()).toBe(ARGS.serviceId);
      }
    });

    it("builds an unhealthy and a healthy criteria instance for every template", () => {
      /*
       * Both, always. A step with no healthy criteria opens an incident,
       * auto-resolves it, and then leaves the monitor in its offline status
       * with nothing that can ever move it back.
       */
      for (const template of ALL_TEMPLATES) {
        const instances: Array<MonitorCriteriaInstance> = getCriteriaInstances(
          buildStep(template),
        );

        expect(instances.length).toBe(2);

        const [unhealthy, healthy]: Array<MonitorCriteriaInstance> = instances;

        expect(unhealthy!.data?.monitorStatusId?.toString()).toBe(
          ARGS.offlineMonitorStatusId.toString(),
        );
        expect(unhealthy!.data?.createIncidents).toBe(true);
        expect(unhealthy!.data?.createAlerts).toBe(true);
        expect(unhealthy!.data?.incidents?.length).toBe(1);
        expect(unhealthy!.data?.alerts?.length).toBe(1);

        expect(healthy!.data?.monitorStatusId?.toString()).toBe(
          ARGS.onlineMonitorStatusId.toString(),
        );
        expect(healthy!.data?.createIncidents).toBe(false);
        expect(healthy!.data?.createAlerts).toBe(false);
        expect(healthy!.data?.incidents?.length).toBe(0);
        expect(healthy!.data?.alerts?.length).toBe(0);
      }
    });

    it("names and describes every criteria instance", () => {
      for (const template of ALL_TEMPLATES) {
        for (const instance of getCriteriaInstances(buildStep(template))) {
          expect((instance.data?.name || "").trim().length).toBeGreaterThan(0);
          expect(
            (instance.data?.description || "").trim().length,
          ).toBeGreaterThan(0);
        }
      }
    });

    it("interpolates the monitor name into every incident title", () => {
      for (const template of ALL_TEMPLATES) {
        for (const instance of getCriteriaInstances(buildStep(template))) {
          for (const incident of instance.data?.incidents || []) {
            expect(incident.title).toContain(ARGS.monitorName);
            expect((incident.description || "").trim().length).toBeGreaterThan(
              0,
            );
            expect(incident.incidentSeverityId?.toString()).toBe(
              ARGS.defaultIncidentSeverityId.toString(),
            );
            expect(incident.autoResolveIncident).toBe(true);
            // Filled in by the create flow from what the user picks.
            expect(incident.onCallPolicyIds).toEqual([]);
          }

          for (const alert of instance.data?.alerts || []) {
            expect(alert.title).toContain(ARGS.monitorName);
            expect(alert.alertSeverityId?.toString()).toBe(
              ARGS.defaultAlertSeverityId.toString(),
            );
            expect(alert.autoResolveAlert).toBe(true);
            expect(alert.onCallPolicyIds).toEqual([]);
          }
        }
      }
    });
  });

  describe("criteria the evaluator can actually evaluate", () => {
    /*
     * The highest-value test in the file. There is exactly one implemented
     * CheckOn per telemetry monitor type; every other value type-checks, saves
     * and is then ignored, producing a monitor that is green forever.
     */
    it("uses the one checkOn its monitor type implements", () => {
      for (const template of ALL_TEMPLATES) {
        const expected: CheckOn | undefined =
          CHECK_ON_BY_MONITOR_TYPE[template.monitorType];

        expect(expected).toBeDefined();

        const filters: Array<CriteriaFilter> = getFilters(buildStep(template));

        expect(filters.length).toBeGreaterThan(0);

        for (const filter of filters) {
          expect(filter.checkOn).toBe(expected);
        }
      }
    });

    it("uses only comparators the numeric evaluator implements", () => {
      for (const template of ALL_TEMPLATES) {
        for (const filter of getFilters(buildStep(template))) {
          expect(NUMERIC_FILTER_TYPES).toContain(filter.filterType);
          expect(typeof filter.value).toBe("number");
        }
      }
    });

    /*
     * `evaluateOverTime` belongs to the probe-monitor path and is not read on
     * the telemetry path. Setting it would look like it configured something.
     */
    it("does not set evaluateOverTime on any filter", () => {
      for (const template of ALL_TEMPLATES) {
        for (const filter of getFilters(buildStep(template))) {
          expect(filter.evaluateOverTime).toBeFalsy();
        }
      }
    });

    it("partitions the range at the threshold, with no gap and no overlap", () => {
      /*
       * The unhealthy and healthy filters must be exact complements. A gap
       * leaves the monitor stuck in whichever state it was last in; an
       * overlap makes the outcome depend on evaluation order.
       */
      const COMPLEMENTS: Record<string, FilterType> = {
        [FilterType.GreaterThan]: FilterType.LessThanOrEqualTo,
        [FilterType.GreaterThanOrEqualTo]: FilterType.LessThan,
        [FilterType.LessThan]: FilterType.GreaterThanOrEqualTo,
        [FilterType.LessThanOrEqualTo]: FilterType.GreaterThan,
      };

      for (const template of ALL_TEMPLATES) {
        const instances: Array<MonitorCriteriaInstance> = getCriteriaInstances(
          buildStep(template),
        );

        const unhealthy: CriteriaFilter = instances[0]!.data!.filters[0]!;
        const healthy: CriteriaFilter = instances[1]!.data!.filters[0]!;

        expect(healthy.filterType).toBe(
          COMPLEMENTS[unhealthy.filterType as FilterType],
        );
        expect(healthy.value).toBe(unhealthy.value);
      }
    });

    /*
     * A metricAlias that matches no query and no formula does not throw — the
     * evaluator falls back to result slot 0 and thresholds whatever happens to
     * be there. On the two ratio templates that means comparing raw bytes
     * against 90, which fires immediately and never clears.
     */
    it("names an alias that exists, for every metric template", () => {
      for (const template of ALL_TEMPLATES) {
        if (template.monitorType !== MonitorType.Metrics) {
          continue;
        }

        const step: MonitorStep = buildStep(template);
        const metricMonitor: MonitorStepMetricMonitor | undefined =
          step.data?.metricMonitor;

        const knownAliases: Array<string> = [
          ...(metricMonitor?.metricViewConfig?.queryConfigs || []).map(
            (queryConfig: MetricQueryConfigData) => {
              return queryConfig.metricAliasData?.metricVariable || "";
            },
          ),
          ...(metricMonitor?.metricViewConfig?.formulaConfigs || []).map(
            (formulaConfig: MetricFormulaConfigData) => {
              return formulaConfig.metricAliasData?.metricVariable || "";
            },
          ),
        ];

        for (const filter of getFilters(step)) {
          const alias: string | undefined =
            filter.metricMonitorOptions?.metricAlias;

          expect(alias).toBeTruthy();
          expect(knownAliases).toContain(alias);
        }
      }
    });

    it("gives every metric query a metric name and a distinct alias", () => {
      for (const template of ALL_TEMPLATES) {
        if (template.monitorType !== MonitorType.Metrics) {
          continue;
        }

        const metricMonitor: MonitorStepMetricMonitor | undefined =
          buildStep(template).data?.metricMonitor;

        const queryConfigs: Array<MetricQueryConfigData> =
          metricMonitor?.metricViewConfig?.queryConfigs || [];

        expect(queryConfigs.length).toBeGreaterThan(0);

        const aliases: Array<string> = [];

        for (const queryConfig of queryConfigs) {
          const metricName: unknown =
            queryConfig.metricQueryData?.filterData?.["metricName"];

          expect(typeof metricName).toBe("string");
          expect((metricName as string).length).toBeGreaterThan(0);

          const alias: string =
            queryConfig.metricAliasData?.metricVariable || "";

          expect(alias.length).toBeGreaterThan(0);
          aliases.push(alias);
        }

        for (const formulaConfig of metricMonitor?.metricViewConfig
          ?.formulaConfigs || []) {
          aliases.push(formulaConfig.metricAliasData?.metricVariable || "");
        }

        expect(new Set<string>(aliases).size).toBe(aliases.length);
      }
    });

    /*
     * `MetricMonitorCriteria.evaluateAllSeries` writes its `AnyValue` default
     * back THROUGH this object when `metricAggregationType` is unset, and the
     * criteria edit form spreads and re-assigns it. Sharing one object between
     * the two filters makes either of those flip the healthy criteria as a
     * side effect of touching the unhealthy one — which is how you get both
     * criteria reporting Met on different value sets in one evaluation.
     */
    it("gives each criteria filter its own metricMonitorOptions object", () => {
      for (const template of ALL_TEMPLATES) {
        const filters: Array<CriteriaFilter> = getFilters(buildStep(template));

        expect(filters.length).toBe(2);

        const unhealthy: CriteriaFilter = filters[0]!;
        const healthy: CriteriaFilter = filters[1]!;

        if (!unhealthy.metricMonitorOptions) {
          expect(healthy.metricMonitorOptions).toBeUndefined();
          continue;
        }

        // Same content...
        expect(healthy.metricMonitorOptions).toEqual(
          unhealthy.metricMonitorOptions,
        );
        // ...different object.
        expect(healthy.metricMonitorOptions).not.toBe(
          unhealthy.metricMonitorOptions,
        );
      }
    });

    /*
     * Guards the in-place write at `MetricMonitorCriteria.evaluateAllSeries`
     * from ever being reachable: an unset aggregation is what triggers it.
     */
    it("keeps both filters on the sustained aggregation", () => {
      let checked: number = 0;

      for (const template of ALL_TEMPLATES) {
        for (const filter of getFilters(buildStep(template))) {
          if (!filter.metricMonitorOptions) {
            continue;
          }

          expect(filter.metricMonitorOptions.metricAggregationType).toBe(
            EvaluateOverTimeType.AllValues,
          );
          checked++;
        }
      }

      expect(checked).toBeGreaterThan(0);
    });
  });

  /*
   * Without a group-by every replica collapses into one number: an Avg heap
   * template on three JVMs at 95/20/20 reads 45 and stays green while one
   * OOM-kills, and a Max template fires without being able to name the
   * replica. The two latency percentiles are service-level on purpose and are
   * the only exemptions.
   */
  describe("per-instance grouping", () => {
    const INSTANCE_KEY: string = "resource.service.instance.id";

    const SERVICE_LEVEL_METRIC_TEMPLATE_IDS: Array<string> = [
      "service-latency-p95",
      "service-latency-p99",
    ];

    function getQueryConfigs(
      template: ServiceAlertTemplate,
    ): Array<MetricQueryConfigData> {
      return (
        buildStep(template).data?.metricMonitor?.metricViewConfig
          ?.queryConfigs || []
      );
    }

    it("groups every per-process metric template by the service instance", () => {
      let grouped: number = 0;

      for (const template of ALL_TEMPLATES) {
        if (template.monitorType !== MonitorType.Metrics) {
          continue;
        }

        const expected: Array<string> =
          SERVICE_LEVEL_METRIC_TEMPLATE_IDS.includes(template.id)
            ? []
            : [INSTANCE_KEY];

        const queryConfigs: Array<MetricQueryConfigData> =
          getQueryConfigs(template);

        expect(queryConfigs.length).toBeGreaterThan(0);

        for (const queryConfig of queryConfigs) {
          expect(
            queryConfig.metricQueryData?.groupByAttributeKeys || [],
          ).toEqual(expected);
        }

        if (expected.length > 0) {
          grouped++;
        }
      }

      // The canary: if grouping is reverted wholesale this drops to zero.
      expect(grouped).toBeGreaterThan(20);
    });

    /*
     * The two SLO percentiles opt out by passing `[]`, and `buildQueryConfig`
     * must then omit the field rather than serialize an empty array — so an
     * ungrouped template's stored payload is byte-identical to what it was
     * before grouping existed.
     */
    it.each(SERVICE_LEVEL_METRIC_TEMPLATE_IDS)(
      "%s stays service-level, with no group-by key written at all",
      (templateId: string) => {
        for (const queryConfig of getQueryConfigs(
          getServiceAlertTemplateById(templateId)!,
        )) {
          expect(
            queryConfig.metricQueryData?.groupByAttributeKeys,
          ).toBeUndefined();
        }

        expect(
          MonitorStep.getGroupByAttributeKeys(
            buildStep(getServiceAlertTemplateById(templateId)!),
          ),
        ).toEqual([]);
      },
    );

    /*
     * The query config is only half of it: the worker reads the keys back
     * through `MonitorStep.getGroupByAttributeKeys`, and that is what decides
     * whether the evaluation fans out per series at all.
     */
    it("surfaces the instance key through the accessor the worker reads", () => {
      for (const template of ALL_TEMPLATES) {
        if (
          template.monitorType !== MonitorType.Metrics ||
          SERVICE_LEVEL_METRIC_TEMPLATE_IDS.includes(template.id)
        ) {
          continue;
        }

        expect(
          MonitorStep.getGroupByAttributeKeys(buildStep(template)),
        ).toEqual([INSTANCE_KEY]);
      }
    });

    /*
     * A key nobody registered renders as "Service Instance Id: ..." from the
     * prettified-key fallback instead of "Instance: ...", and the
     * catalog-level debuggability suite fails on it.
     */
    it("groups only by keys SeriesLabelDisplay can name", () => {
      for (const template of ALL_TEMPLATES) {
        for (const key of MonitorStep.getGroupByAttributeKeys(
          buildStep(template),
        )) {
          expect(SeriesLabelDisplay.isKnownLabelKey(key)).toBe(true);
        }
      }
    });

    it("names the instance key 'Instance', prefixed or not", () => {
      expect(SeriesLabelDisplay.getFriendlyLabelName(INSTANCE_KEY)).toBe(
        "Instance",
      );
      expect(
        SeriesLabelDisplay.getFriendlyLabelName("service.instance.id"),
      ).toBe("Instance");
    });

    it("ranks the instance above the service it belongs to", () => {
      // The monitor name already says which service; the replica does not.
      expect(SeriesLabelDisplay.getLabelPriority(INSTANCE_KEY)).toBeLessThan(
        SeriesLabelDisplay.getLabelPriority("service.name"),
      );
    });

    /*
     * `service.instance.id` is optional in the resource semantic conventions.
     * An SDK that omits it produces one series whose label value is the empty
     * string, and the display layer must drop it rather than render
     * "Instance: " — which is what makes grouping safe to default on.
     */
    it("renders nothing for a service that does not report an instance", () => {
      expect(
        SeriesLabelDisplay.getDisplayLabels({ [INSTANCE_KEY]: "" }),
      ).toEqual([]);
      expect(
        SeriesLabelDisplay.getDisplayLabels({ [INSTANCE_KEY]: "worker-7" }).map(
          (label: { name: string; value: string }) => {
            return `${label.name}: ${label.value}`;
          },
        ),
      ).toEqual(["Instance: worker-7"]);
    });
  });

  describe("the two ratio templates", () => {
    const RATIO_TEMPLATE_IDS: Array<string> = [
      "service-java-heap-utilization",
      "service-nodejs-heap-pressure",
    ];

    it.each(RATIO_TEMPLATE_IDS)(
      "%s thresholds the formula, not either of its two queries",
      (templateId: string) => {
        const template: ServiceAlertTemplate | undefined =
          getServiceAlertTemplateById(templateId);

        expect(template).toBeDefined();

        const metricMonitor: MonitorStepMetricMonitor | undefined = buildStep(
          template!,
        ).data?.metricMonitor;

        const queryConfigs: Array<MetricQueryConfigData> =
          metricMonitor?.metricViewConfig?.queryConfigs || [];
        const formulaConfigs: Array<MetricFormulaConfigData> =
          metricMonitor?.metricViewConfig?.formulaConfigs || [];

        expect(queryConfigs.length).toBe(2);
        expect(formulaConfigs.length).toBe(1);

        const formulaAlias: string =
          formulaConfigs[0]!.metricAliasData?.metricVariable || "";
        const numeratorAlias: string =
          queryConfigs[0]!.metricAliasData?.metricVariable || "";
        const denominatorAlias: string =
          queryConfigs[1]!.metricAliasData?.metricVariable || "";

        expect(formulaConfigs[0]!.metricFormulaData.metricFormula).toBe(
          `(${numeratorAlias} / ${denominatorAlias}) * 100`,
        );

        for (const filter of getFilters(buildStep(template!))) {
          expect(filter.metricMonitorOptions?.metricAlias).toBe(formulaAlias);
        }
      },
    );

    it.each(RATIO_TEMPLATE_IDS)(
      "%s thresholds a percentage, so it needs no per-deployment tuning",
      (templateId: string) => {
        const template: ServiceAlertTemplate =
          getServiceAlertTemplateById(templateId)!;

        for (const filter of getFilters(buildStep(template))) {
          expect(filter.value).toBeGreaterThan(0);
          expect(filter.value).toBeLessThanOrEqual(100);
          expect(filter.metricMonitorOptions?.thresholdUnit).toBe("%");
        }
      },
    );

    /*
     * The formula divides one query by the other. Both sides must carry the
     * same group-by key, or the "Grouped By" root-cause block — which
     * `MetricMonitorCriteria.buildContext` reads off a SINGLE query config —
     * renders empty for whichever side it happened to read.
     */
    it.each(RATIO_TEMPLATE_IDS)(
      "%s groups both queries on the same key, so the formula divides one instance's usage by its own limit",
      (templateId: string) => {
        const queryConfigs: Array<MetricQueryConfigData> =
          buildStep(getServiceAlertTemplateById(templateId)!).data
            ?.metricMonitor?.metricViewConfig?.queryConfigs || [];

        expect(queryConfigs.length).toBe(2);
        expect(queryConfigs[0]!.metricQueryData?.groupByAttributeKeys).toEqual([
          "resource.service.instance.id",
        ]);
        expect(queryConfigs[1]!.metricQueryData?.groupByAttributeKeys).toEqual(
          queryConfigs[0]!.metricQueryData?.groupByAttributeKeys,
        );
      },
    );
  });

  describe("the metric names each template reads", () => {
    /*
     * Restated here so a rename has to be made twice, on purpose. A template
     * pointed at a metric name nobody emits is registered, renders, creates a
     * monitor, and is green forever — there is no failing state to notice.
     */
    const EXPECTED_METRIC_NAMES: Record<string, Array<string>> = {
      "service-latency-p95": ["http.server.request.duration"],
      "service-latency-p99": ["http.server.request.duration"],
      "service-process-cpu-saturation": ["process.cpu.utilization"],
      "service-process-memory-high": ["process.memory.usage"],
      "service-java-heap-utilization": ["jvm.memory.used", "jvm.memory.limit"],
      "service-java-live-heap-after-gc": ["jvm.memory.used_after_last_gc"],
      "service-java-gc-pause-p99": ["jvm.gc.duration"],
      "service-java-cpu-saturation": ["jvm.cpu.recent_utilization"],
      "service-java-thread-explosion": ["jvm.thread.count"],
      "service-java-non-heap-growth": ["jvm.memory.used"],
      "service-dotnet-threadpool-starvation": [
        "dotnet.thread_pool.queue.length",
      ],
      "service-dotnet-threadpool-growth": ["dotnet.thread_pool.thread.count"],
      "service-dotnet-gen2-heap-growth": [
        "dotnet.gc.last_collection.heap.size",
      ],
      "service-dotnet-working-set": ["dotnet.process.memory.working_set"],
      "service-nodejs-event-loop-saturated": ["nodejs.eventloop.utilization"],
      "service-nodejs-event-loop-lag": ["nodejs.eventloop.delay.p99"],
      "service-nodejs-heap-pressure": [
        "v8js.memory.heap.used",
        "v8js.memory.heap.limit",
      ],
      "service-nodejs-gc-pause-p99": ["v8js.gc.duration"],
      "service-python-request-concurrency": ["http.server.active_requests"],
      "service-python-rss-memory": ["process.runtime.cpython.memory"],
      "service-python-thread-growth": ["process.runtime.cpython.thread_count"],
      "service-go-goroutine-leak": ["go.goroutine.count"],
      "service-go-heap-memory": ["go.memory.used"],
      "service-go-stack-memory": ["go.memory.used"],
      "service-go-scheduler-latency-p99": ["go.schedule.duration"],
    };

    /*
     * Constraint 3 in the module header: a monitor holds exactly ONE metric
     * name, so a template pointed at a pre-stabilization name must at least
     * SAY so — otherwise a team on a current SDK gets a monitor that is green
     * forever and indistinguishable from a healthy service.
     */
    it("names the metric it reads whenever that metric is a pre-stabilization name", () => {
      let checked: number = 0;

      for (const template of ALL_TEMPLATES) {
        if (template.monitorType !== MonitorType.Metrics) {
          continue;
        }

        const queryConfigs: Array<MetricQueryConfigData> =
          buildStep(template).data?.metricMonitor?.metricViewConfig
            ?.queryConfigs || [];

        for (const queryConfig of queryConfigs) {
          const metricName: string = String(
            queryConfig.metricQueryData?.filterData?.["metricName"] || "",
          );

          if (!metricName.startsWith("process.runtime.")) {
            continue;
          }

          expect(template.description).toContain(metricName);
          checked++;
        }
      }

      // Both Python templates read a `process.runtime.cpython.*` name today.
      expect(checked).toBe(2);
    });

    it("covers every metric template", () => {
      const metricTemplateIds: Array<string> = ALL_TEMPLATES.filter(
        (template: ServiceAlertTemplate) => {
          return template.monitorType === MonitorType.Metrics;
        },
      ).map((template: ServiceAlertTemplate) => {
        return template.id;
      });

      expect(metricTemplateIds.sort()).toEqual(
        Object.keys(EXPECTED_METRIC_NAMES).sort(),
      );
    });

    it.each(Object.entries(EXPECTED_METRIC_NAMES))(
      "%s reads %s",
      (templateId: string, metricNames: Array<string>) => {
        const template: ServiceAlertTemplate =
          getServiceAlertTemplateById(templateId)!;

        const queryConfigs: Array<MetricQueryConfigData> =
          buildStep(template).data?.metricMonitor?.metricViewConfig
            ?.queryConfigs || [];

        expect(
          queryConfigs.map((queryConfig: MetricQueryConfigData) => {
            return queryConfig.metricQueryData?.filterData?.["metricName"];
          }),
        ).toEqual(metricNames);
      },
    );

    /*
     * Two Go templates read the same metric and are told apart only by an
     * attribute filter: `go.memory.used` splits into `stack` and `other`
     * series, and an unfiltered query averages the two — reporting about half
     * the heap, which makes the threshold wrong by that factor.
     */
    it("separates the two go.memory.used templates by attribute", () => {
      const heap: ServiceAlertTemplate = getServiceAlertTemplateById(
        "service-go-heap-memory",
      )!;
      const stack: ServiceAlertTemplate = getServiceAlertTemplateById(
        "service-go-stack-memory",
      )!;

      const attributesOf: (template: ServiceAlertTemplate) => unknown = (
        template: ServiceAlertTemplate,
      ): unknown => {
        return buildStep(template).data?.metricMonitor?.metricViewConfig
          ?.queryConfigs?.[0]?.metricQueryData?.filterData?.["attributes"];
      };

      expect(attributesOf(heap)).toEqual({ "go.memory.type": "other" });
      expect(attributesOf(stack)).toEqual({ "go.memory.type": "stack" });
    });

    it("separates the two jvm.memory.used templates by attribute", () => {
      const nonHeap: ServiceAlertTemplate = getServiceAlertTemplateById(
        "service-java-non-heap-growth",
      )!;

      expect(
        buildStep(nonHeap).data?.metricMonitor?.metricViewConfig
          ?.queryConfigs?.[0]?.metricQueryData?.filterData?.["attributes"],
      ).toEqual({ "jvm.memory.type": "non_heap" });
    });
  });

  describe("the trace and exception templates", () => {
    it("counts only error-status spans on the two error templates", () => {
      for (const templateId of [
        "service-failed-operations",
        "service-error-burst",
      ]) {
        const traceMonitor: MonitorStepTraceMonitor | undefined = buildStep(
          getServiceAlertTemplateById(templateId)!,
        ).data?.traceMonitor;

        expect(traceMonitor?.spanStatuses?.length).toBe(1);
      }
    });

    /*
     * The liveness template counts ALL spans, not error spans — filtering to
     * errors would make "no errors" indistinguishable from "no traffic", and
     * the whole point of it is to catch the second.
     */
    it("counts all spans on the liveness template, and inverts the comparison", () => {
      const template: ServiceAlertTemplate = getServiceAlertTemplateById(
        "service-traffic-stopped",
      )!;

      const step: MonitorStep = buildStep(template);

      expect(step.data?.traceMonitor?.spanStatuses).toEqual([]);

      const filters: Array<CriteriaFilter> = getFilters(step);

      expect(filters[0]!.filterType).toBe(FilterType.LessThan);
      expect(filters[1]!.filterType).toBe(FilterType.GreaterThanOrEqualTo);
    });

    /*
     * Excluding resolved and archived exception groups is what lets
     * acknowledging an exception close the incident it opened. Including them
     * would make the alert unclearable short of the occurrences ageing out.
     */
    it("ignores exceptions the team has already resolved or archived", () => {
      const exceptionMonitor: MonitorStepExceptionMonitor | undefined =
        buildStep(getServiceAlertTemplateById("service-unhandled-exceptions")!)
          .data?.exceptionMonitor;

      expect(exceptionMonitor?.includeResolved).toBe(false);
      expect(exceptionMonitor?.includeArchived).toBe(false);
      expect(exceptionMonitor?.exceptionTypes).toEqual([]);
      expect(exceptionMonitor?.message).toBe("");
    });

    /*
     * These two windows are load-bearing beyond their own semantics: they are
     * what keeps these templates' coverage fingerprints distinct from the RUM
     * catalog's structurally identical pair. See the comment on
     * failedOperationsTemplate.
     */
    it("evaluates the two agnostic error templates over ten minutes", () => {
      expect(
        buildStep(getServiceAlertTemplateById("service-failed-operations")!)
          .data?.traceMonitor?.lastXSecondsOfSpans,
      ).toBe(600);

      expect(
        buildStep(getServiceAlertTemplateById("service-unhandled-exceptions")!)
          .data?.exceptionMonitor?.lastXSecondsOfExceptions,
      ).toBe(600);
    });
  });

  describe("thresholds", () => {
    it("expresses ratio thresholds on the 0-1 scale the SDKs report", () => {
      /*
       * `process.cpu.utilization`, `jvm.cpu.recent_utilization` and
       * `nodejs.eventloop.utilization` are all dimensionless [0, 1] ratios, so
       * "85%" is the literal 0.85. A slip to 85 makes the template
       * unreachable — the value can never exceed 1 — and nothing fails.
       */
      for (const templateId of [
        "service-process-cpu-saturation",
        "service-java-cpu-saturation",
        "service-nodejs-event-loop-saturated",
      ]) {
        for (const filter of getFilters(
          buildStep(getServiceAlertTemplateById(templateId)!),
        )) {
          expect(filter.value).toBeGreaterThan(0);
          expect(filter.value).toBeLessThan(1);
        }
      }
    });

    it("states duration thresholds in milliseconds, and says so", () => {
      /*
       * Every duration metric here is reported in seconds by the semantic
       * conventions, so the threshold only means what it reads as if the alias
       * declares milliseconds — the worker converts each sample into the
       * alias's unit before comparing.
       */
      for (const templateId of [
        "service-latency-p95",
        "service-latency-p99",
        "service-java-gc-pause-p99",
        "service-nodejs-event-loop-lag",
        "service-nodejs-gc-pause-p99",
        "service-go-scheduler-latency-p99",
      ]) {
        const template: ServiceAlertTemplate =
          getServiceAlertTemplateById(templateId)!;

        const queryConfigs: Array<MetricQueryConfigData> =
          buildStep(template).data?.metricMonitor?.metricViewConfig
            ?.queryConfigs || [];

        expect(queryConfigs[0]!.metricAliasData?.legendUnit).toBe("ms");

        for (const filter of getFilters(buildStep(template))) {
          expect(filter.metricMonitorOptions?.thresholdUnit).toBe("ms");
          expect(filter.value).toBeGreaterThanOrEqual(50);
        }
      }
    });

    it("gives the error-burst template a much higher bar than failed-operations", () => {
      const anyFailure: CriteriaFilter = getFilters(
        buildStep(getServiceAlertTemplateById("service-failed-operations")!),
      )[0]!;
      const burst: CriteriaFilter = getFilters(
        buildStep(getServiceAlertTemplateById("service-error-burst")!),
      )[0]!;

      expect(Number(burst.value)).toBeGreaterThan(Number(anyFailure.value));
      expect(
        getServiceAlertTemplateById("service-failed-operations")!.severity,
      ).toBe("Warning");
      expect(getServiceAlertTemplateById("service-error-burst")!.severity).toBe(
        "Critical",
      );
    });
  });
});
