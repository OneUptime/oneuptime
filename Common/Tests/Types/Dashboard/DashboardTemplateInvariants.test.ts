import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardVariable, {
  DashboardVariableType,
} from "../../../Types/Dashboard/DashboardVariable";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import {
  DashboardTemplate,
  DashboardTemplateCategories,
  DashboardTemplateCategory,
  DashboardTemplates,
  DashboardTemplateType,
  getDashboardTemplatesByCategory,
  getTemplateConfig,
} from "../../../Types/Dashboard/DashboardTemplates";

/*
 * Structural invariants that must hold for EVERY dashboard template,
 * present and future. Nothing here encodes the editorial content of any
 * one template — these are the rules the renderer, the "Create from
 * Template" modal and the metric fetch layer silently depend on. A new
 * template that breaks one of them ships a dashboard that overlaps
 * itself, renders off-grid, or queries nothing.
 */

// The grid the dashboard renderer lays out against (DashboardSize.widthInDashboardUnits).
const GRID_WIDTH_IN_UNITS: number = 12;

/*
 * Blank is the "start from scratch" entry: it has a catalog card so it
 * shows up in the modal, but deliberately resolves to no config.
 */
const TEMPLATE_TYPES_WITH_CONFIG: Array<DashboardTemplateType> = Object.values(
  DashboardTemplateType,
).filter((type: DashboardTemplateType): boolean => {
  return type !== DashboardTemplateType.Blank;
});

interface LoadedTemplate {
  type: DashboardTemplateType;
  config: DashboardViewConfig;
}

function loadAllTemplates(): Array<LoadedTemplate> {
  return TEMPLATE_TYPES_WITH_CONFIG.map(
    (type: DashboardTemplateType): LoadedTemplate => {
      const config: DashboardViewConfig | null = getTemplateConfig(type);

      if (!config) {
        throw new Error(`Expected ${type} to resolve to a config`);
      }

      return { type: type, config: config };
    },
  );
}

function getArguments(
  component: DashboardBaseComponent,
): Record<string, unknown> {
  return (component.arguments as Record<string, unknown>) || {};
}

/*
 * Widgets keep their human label under different argument keys depending
 * on the component type. Tests report failures by label, never by index.
 */
function describeComponent(component: DashboardBaseComponent): string {
  const args: Record<string, unknown> = getArguments(component);
  const label: unknown =
    args["title"] ??
    args["chartTitle"] ??
    args["gaugeTitle"] ??
    args["tableTitle"] ??
    args["text"];

  return `${component.componentType} "${String(label ?? "<untitled>")}"`;
}

/*
 * The filterData block that actually reaches the metric fetch layer.
 * Returns undefined for widgets that do not query metrics at all (text,
 * log streams, trace widgets, entity lists).
 */
function getMetricFilterData(
  component: DashboardBaseComponent,
): Record<string, unknown> | undefined {
  const queryConfig: Record<string, unknown> | undefined = getArguments(
    component,
  )["metricQueryConfig"] as Record<string, unknown> | undefined;

  if (!queryConfig) {
    return undefined;
  }

  const queryData: Record<string, unknown> | undefined = queryConfig[
    "metricQueryData"
  ] as Record<string, unknown> | undefined;

  return queryData?.["filterData"] as Record<string, unknown> | undefined;
}

interface MetricWidget {
  type: DashboardTemplateType;
  component: DashboardBaseComponent;
  filterData: Record<string, unknown>;
}

function collectMetricWidgets(): Array<MetricWidget> {
  const widgets: Array<MetricWidget> = [];

  for (const loaded of loadAllTemplates()) {
    for (const component of loaded.config.components) {
      const filterData: Record<string, unknown> | undefined =
        getMetricFilterData(component);

      if (filterData) {
        widgets.push({
          type: loaded.type,
          component: component,
          filterData: filterData,
        });
      }
    }
  }

  return widgets;
}

interface TemplateComponent {
  type: DashboardTemplateType;
  component: DashboardBaseComponent;
}

/*
 * Widgets that carry no `metricQueryConfig` — trace charts, trace tables,
 * text headers — are invisible to collectMetricWidgets(), so they need
 * their own collector or their arguments go unchecked entirely.
 */
function collectComponentsByType(
  componentTypes: Array<DashboardComponentType>,
): Array<TemplateComponent> {
  const collected: Array<TemplateComponent> = [];

  for (const loaded of loadAllTemplates()) {
    for (const component of loaded.config.components) {
      if (componentTypes.includes(component.componentType)) {
        collected.push({ type: loaded.type, component: component });
      }
    }
  }

  return collected;
}

function describeTemplateComponent(entry: TemplateComponent): string {
  return `${entry.type} ${describeComponent(entry.component)}`;
}

describe("DashboardTemplates invariants (all templates)", () => {
  describe("catalog", () => {
    test("every template type except Blank resolves to a config with at least one component", (): void => {
      expect(TEMPLATE_TYPES_WITH_CONFIG.length).toBeGreaterThan(0);

      for (const type of TEMPLATE_TYPES_WITH_CONFIG) {
        const config: DashboardViewConfig | null = getTemplateConfig(type);

        expect(config).not.toBeNull();
        expect(
          (config as DashboardViewConfig).components.length,
        ).toBeGreaterThan(0);
      }
    });

    test("Blank resolves to null so the user starts from an empty canvas", (): void => {
      expect(getTemplateConfig(DashboardTemplateType.Blank)).toBeNull();
    });

    test("every enum member has exactly one catalog entry", (): void => {
      const enumMembers: Array<DashboardTemplateType> = Object.values(
        DashboardTemplateType,
      );

      expect(enumMembers.length).toBeGreaterThan(0);

      for (const type of enumMembers) {
        const entries: Array<DashboardTemplate> = DashboardTemplates.filter(
          (template: DashboardTemplate): boolean => {
            return template.type === type;
          },
        );

        expect(`${type}: ${entries.length} catalog entries`).toBe(
          `${type}: 1 catalog entries`,
        );
      }
    });

    test("catalog names and types are unique, and names are non-empty", (): void => {
      expect(DashboardTemplates.length).toBeGreaterThan(0);

      const names: Array<string> = DashboardTemplates.map(
        (template: DashboardTemplate): string => {
          return template.name;
        },
      );
      const types: Array<DashboardTemplateType> = DashboardTemplates.map(
        (template: DashboardTemplate): DashboardTemplateType => {
          return template.type;
        },
      );

      for (const name of names) {
        expect(name.trim().length).toBeGreaterThan(0);
      }

      expect(Array.from(new Set(names)).sort()).toEqual(names.slice().sort());
      expect(Array.from(new Set(types)).sort()).toEqual(types.slice().sort());
    });

    test("every template's category is one of the ordered display categories", (): void => {
      expect(DashboardTemplates.length).toBeGreaterThan(0);

      for (const template of DashboardTemplates) {
        expect(DashboardTemplateCategories).toContain(template.category);
      }
    });

    test("getDashboardTemplatesByCategory partitions the catalog exactly", (): void => {
      expect(DashboardTemplateCategories.length).toBeGreaterThan(0);

      const seen: Array<DashboardTemplateType> = [];

      for (const category of DashboardTemplateCategories) {
        const templates: Array<DashboardTemplate> =
          getDashboardTemplatesByCategory(category);

        for (const template of templates) {
          expect(template.category).toBe(category);
          seen.push(template.type);
        }
      }

      // Union covers the catalog: nothing dropped, nothing counted twice.
      expect(seen.length).toBe(DashboardTemplates.length);
      expect(seen.slice().sort()).toEqual(
        DashboardTemplates.map(
          (template: DashboardTemplate): DashboardTemplateType => {
            return template.type;
          },
        ).sort(),
      );
    });

    /*
     * A category nothing matches must return NOTHING, not fall back to the
     * whole catalog. Asserted against a category that is empty by
     * construction: filtering the live categories for empty ones and then
     * asserting they are empty is a tautology that passes vacuously today
     * (every declared category is populated) and stays green even if the
     * lookup grows a "no matches -> return everything" fallback.
     */
    test("a category no template uses yields an empty list, not the whole catalog", (): void => {
      expect(DashboardTemplates.length).toBeGreaterThan(0);

      const neverUsedCategory: DashboardTemplateCategory =
        "Nonexistent Category" as DashboardTemplateCategory;

      expect(getDashboardTemplatesByCategory(neverUsedCategory)).toEqual([]);

      // Every declared category still has to contribute at least one card.
      const usedCategories: Array<DashboardTemplateCategory> =
        DashboardTemplateCategories.filter(
          (category: DashboardTemplateCategory): boolean => {
            return getDashboardTemplatesByCategory(category).length > 0;
          },
        );

      expect(usedCategories.length).toBeGreaterThan(0);
    });
  });

  describe("layout", () => {
    test("no component is placed outside the 12-unit grid", (): void => {
      const loadedTemplates: Array<LoadedTemplate> = loadAllTemplates();

      expect(loadedTemplates.length).toBeGreaterThan(0);

      for (const loaded of loadedTemplates) {
        expect(loaded.config.components.length).toBeGreaterThan(0);

        for (const component of loaded.config.components) {
          const label: string = `${loaded.type} ${describeComponent(component)}`;

          expect(`${label} left=${component.leftInDashboardUnits}`).toBe(
            `${label} left=${Math.max(component.leftInDashboardUnits, 0)}`,
          );
          expect(`${label} top=${component.topInDashboardUnits}`).toBe(
            `${label} top=${Math.max(component.topInDashboardUnits, 0)}`,
          );
          expect(
            `${label} width=${component.widthInDashboardUnits} positive=${component.widthInDashboardUnits > 0}`,
          ).toBe(
            `${label} width=${component.widthInDashboardUnits} positive=true`,
          );
          expect(
            `${label} height=${component.heightInDashboardUnits} positive=${component.heightInDashboardUnits > 0}`,
          ).toBe(
            `${label} height=${component.heightInDashboardUnits} positive=true`,
          );

          const rightEdge: number =
            component.leftInDashboardUnits + component.widthInDashboardUnits;

          expect(`${label} rightEdge=${rightEdge}`).toBe(
            `${label} rightEdge=${Math.min(rightEdge, GRID_WIDTH_IN_UNITS)}`,
          );
        }
      }
    });

    test("no two components in a template overlap", (): void => {
      const loadedTemplates: Array<LoadedTemplate> = loadAllTemplates();

      expect(loadedTemplates.length).toBeGreaterThan(0);

      for (const loaded of loadedTemplates) {
        const components: Array<DashboardBaseComponent> =
          loaded.config.components;

        expect(components.length).toBeGreaterThan(0);

        const occupiedCellToLabel: Map<string, string> = new Map<
          string,
          string
        >();
        const collisions: Array<string> = [];

        for (const component of components) {
          const label: string = describeComponent(component);

          for (
            let row: number = component.topInDashboardUnits;
            row <
            component.topInDashboardUnits + component.heightInDashboardUnits;
            row++
          ) {
            for (
              let column: number = component.leftInDashboardUnits;
              column <
              component.leftInDashboardUnits + component.widthInDashboardUnits;
              column++
            ) {
              const cell: string = `${row}:${column}`;
              const existing: string | undefined =
                occupiedCellToLabel.get(cell);

              if (existing) {
                collisions.push(
                  `${loaded.type} cell ${cell} shared by ${existing} and ${label}`,
                );
              }

              occupiedCellToLabel.set(cell, label);
            }
          }
        }

        expect(collisions).toEqual([]);
      }
    });

    test("every template is tall enough to contain its lowest component", (): void => {
      const loadedTemplates: Array<LoadedTemplate> = loadAllTemplates();

      expect(loadedTemplates.length).toBeGreaterThan(0);

      for (const loaded of loadedTemplates) {
        expect(loaded.config.components.length).toBeGreaterThan(0);

        const lowestOccupiedEdge: number = Math.max(
          ...loaded.config.components.map(
            (component: DashboardBaseComponent): number => {
              return (
                component.topInDashboardUnits + component.heightInDashboardUnits
              );
            },
          ),
        );

        expect(
          `${loaded.type} height=${loaded.config.heightInDashboardUnits} lowest=${lowestOccupiedEdge}`,
        ).toBe(
          `${loaded.type} height=${Math.max(
            loaded.config.heightInDashboardUnits,
            lowestOccupiedEdge,
          )} lowest=${lowestOccupiedEdge}`,
        );
      }
    });

    test("no component is rendered smaller than the minimum size it declares", (): void => {
      const loadedTemplates: Array<LoadedTemplate> = loadAllTemplates();

      expect(loadedTemplates.length).toBeGreaterThan(0);

      for (const loaded of loadedTemplates) {
        expect(loaded.config.components.length).toBeGreaterThan(0);

        for (const component of loaded.config.components) {
          const label: string = `${loaded.type} ${describeComponent(component)}`;

          expect(
            `${label} w=${component.widthInDashboardUnits} minW=${component.minWidthInDashboardUnits}`,
          ).toBe(
            `${label} w=${Math.max(
              component.widthInDashboardUnits,
              component.minWidthInDashboardUnits,
            )} minW=${component.minWidthInDashboardUnits}`,
          );

          expect(
            `${label} h=${component.heightInDashboardUnits} minH=${component.minHeightInDashboardUnits}`,
          ).toBe(
            `${label} h=${Math.max(
              component.heightInDashboardUnits,
              component.minHeightInDashboardUnits,
            )} minH=${component.minHeightInDashboardUnits}`,
          );
        }
      }
    });
  });

  describe("component identity", () => {
    test("component ids are unique within a single config", (): void => {
      const loadedTemplates: Array<LoadedTemplate> = loadAllTemplates();

      expect(loadedTemplates.length).toBeGreaterThan(0);

      for (const loaded of loadedTemplates) {
        const ids: Array<string> = loaded.config.components.map(
          (component: DashboardBaseComponent): string => {
            return component.componentId.toString();
          },
        );

        expect(ids.length).toBeGreaterThan(0);
        expect(`${loaded.type}: ${new Set(ids).size}`).toBe(
          `${loaded.type}: ${ids.length}`,
        );
      }
    });

    test("two calls for the same template share no component ids", (): void => {
      expect(TEMPLATE_TYPES_WITH_CONFIG.length).toBeGreaterThan(0);

      for (const type of TEMPLATE_TYPES_WITH_CONFIG) {
        const first: DashboardViewConfig = getTemplateConfig(
          type,
        ) as DashboardViewConfig;
        const second: DashboardViewConfig = getTemplateConfig(
          type,
        ) as DashboardViewConfig;

        expect(first.components.length).toBeGreaterThan(0);
        expect(second.components.length).toBe(first.components.length);

        const firstIds: Set<string> = new Set<string>(
          first.components.map((component: DashboardBaseComponent): string => {
            return component.componentId.toString();
          }),
        );
        const shared: Array<string> = second.components
          .map((component: DashboardBaseComponent): string => {
            return component.componentId.toString();
          })
          .filter((id: string): boolean => {
            return firstIds.has(id);
          });

        expect(`${type}: ${shared.length} shared ids`).toBe(
          `${type}: 0 shared ids`,
        );
      }
    });
  });

  describe("metric queries", () => {
    /*
     * The fetch layer reads the MISSPELLED `aggegationType`. A template
     * that "fixes" the spelling compiles fine and renders an empty
     * widget, so pin the misspelling in both directions.
     */
    test("every metric-bearing widget stores its aggregation under aggegationType", (): void => {
      const widgets: Array<MetricWidget> = collectMetricWidgets();

      expect(widgets.length).toBeGreaterThan(0);

      /*
       * An empty or unrecognised value breaks the fetch layer exactly as a
       * missing key does, and both are type-legal, so pin the value against
       * the real AggregationType members rather than only checking the key
       * is present. Mutation testing showed `aggegationType: ""` and
       * `"Avgerage"` both survived a typeof-string check.
       */
      const validAggregations: Array<string> = Object.values(AggregationType);

      for (const widget of widgets) {
        const label: string = `${widget.type} ${describeComponent(widget.component)}`;
        const aggregation: unknown = widget.filterData["aggegationType"];

        expect(`${label} aggegationType=${String(aggregation)}`).not.toBe(
          `${label} aggegationType=undefined`,
        );
        expect(typeof aggregation).toBe("string");
        expect(`${label} aggegationType=${String(aggregation)}`).toBe(
          `${label} aggegationType=${
            validAggregations.includes(String(aggregation))
              ? String(aggregation)
              : "<not an AggregationType>"
          }`,
        );
      }
    });

    test("no metric-bearing widget uses the correctly spelled aggregationType", (): void => {
      const widgets: Array<MetricWidget> = collectMetricWidgets();

      expect(widgets.length).toBeGreaterThan(0);

      for (const widget of widgets) {
        const label: string = `${widget.type} ${describeComponent(widget.component)}`;
        const hasCorrectSpelling: boolean =
          Object.prototype.hasOwnProperty.call(
            widget.filterData,
            "aggregationType",
          );

        expect(`${label} hasAggregationType=${hasCorrectSpelling}`).toBe(
          `${label} hasAggregationType=false`,
        );
      }
    });

    test("every metric-bearing widget queries a non-empty metric name", (): void => {
      const widgets: Array<MetricWidget> = collectMetricWidgets();

      expect(widgets.length).toBeGreaterThan(0);

      for (const widget of widgets) {
        const label: string = `${widget.type} ${describeComponent(widget.component)}`;
        const metricName: unknown = widget.filterData["metricName"];

        expect(`${label} metricName is a ${typeof metricName}`).toBe(
          `${label} metricName is a string`,
        );
        expect(`${label} metricName=${String(metricName).trim()}`).not.toBe(
          `${label} metricName=`,
        );
      }
    });
  });

  /*
   * Trace widgets carry no metricQueryConfig, so every invariant above
   * skips them: their query arguments live directly on `arguments` and
   * the aggregation layer reads them verbatim. `groupByAttribute` is
   * declared optional on the trace chart factory, so the compiler accepts
   * a chart that groups by nothing — only these tests reject it.
   */
  describe("trace queries", () => {
    test("every TraceChart requests a non-empty metric", (): void => {
      const charts: Array<TemplateComponent> = collectComponentsByType([
        DashboardComponentType.TraceChart,
      ]);

      expect(charts.length).toBeGreaterThan(0);

      for (const chart of charts) {
        const label: string = describeTemplateComponent(chart);
        const metric: unknown = getArguments(chart.component)["metric"];

        expect(`${label} metric is a ${typeof metric}`).toBe(
          `${label} metric is a string`,
        );
        expect(`${label} metric=${String(metric).trim()}`).not.toBe(
          `${label} metric=`,
        );
      }
    });

    test("every trace widget groups by a non-empty attribute key", (): void => {
      const traceWidgets: Array<TemplateComponent> = collectComponentsByType([
        DashboardComponentType.TraceChart,
        DashboardComponentType.TraceTable,
      ]);

      expect(traceWidgets.length).toBeGreaterThan(0);

      for (const widget of traceWidgets) {
        const label: string = describeTemplateComponent(widget);
        const groupByAttribute: unknown = getArguments(widget.component)[
          "groupByAttribute"
        ];

        expect(
          `${label} groupByAttribute is a ${typeof groupByAttribute}`,
        ).toBe(`${label} groupByAttribute is a string`);
        expect(
          `${label} groupByAttribute=${String(groupByAttribute).trim()}`,
        ).not.toBe(`${label} groupByAttribute=`);
      }
    });

    test("every trace widget caps its rows with a positive topLimit", (): void => {
      const traceWidgets: Array<TemplateComponent> = collectComponentsByType([
        DashboardComponentType.TraceChart,
        DashboardComponentType.TraceTable,
      ]);

      expect(traceWidgets.length).toBeGreaterThan(0);

      for (const widget of traceWidgets) {
        const label: string = describeTemplateComponent(widget);
        const topLimit: unknown = getArguments(widget.component)["topLimit"];

        expect(`${label} topLimit is a ${typeof topLimit}`).toBe(
          `${label} topLimit is a number`,
        );
        expect(
          `${label} topLimit=${String(topLimit)} positive=${
            typeof topLimit === "number" && topLimit > 0
          }`,
        ).toBe(`${label} topLimit=${String(topLimit)} positive=true`);
      }
    });
  });

  describe("text widgets", () => {
    test("every Text widget renders a non-empty string", (): void => {
      const textWidgets: Array<TemplateComponent> = collectComponentsByType([
        DashboardComponentType.Text,
      ]);

      expect(textWidgets.length).toBeGreaterThan(0);

      for (const widget of textWidgets) {
        const label: string = `${widget.type} Text widget at row ${widget.component.topInDashboardUnits}`;
        const text: unknown = getArguments(widget.component)["text"];

        expect(`${label} text is a ${typeof text}`).toBe(
          `${label} text is a string`,
        );
        expect(`${label} text=${String(text).trim()}`).not.toBe(
          `${label} text=`,
        );
      }
    });
  });

  describe("gauges", () => {
    test("every gauge's thresholds sit inside its own range with warning below critical", (): void => {
      const gauges: Array<TemplateComponent> = collectComponentsByType([
        DashboardComponentType.Gauge,
      ]);

      expect(gauges.length).toBeGreaterThan(0);

      for (const gauge of gauges) {
        const args: Record<string, unknown> = getArguments(gauge.component);
        const label: string = describeTemplateComponent(gauge);
        const minValue: number = args["minValue"] as number;
        const maxValue: number = args["maxValue"] as number;
        const warning: number = args["warningThreshold"] as number;
        const critical: number = args["criticalThreshold"] as number;

        expect(`${label} min=${typeof minValue}`).toBe(`${label} min=number`);
        expect(`${label} max=${typeof maxValue}`).toBe(`${label} max=number`);
        expect(`${label} warning=${typeof warning}`).toBe(
          `${label} warning=number`,
        );
        expect(`${label} critical=${typeof critical}`).toBe(
          `${label} critical=number`,
        );

        /*
         * min <= max needs no separate assertion: the ordering check below
         * chains min <= warning < critical <= max, which implies it.
         */
        const orderedCorrectly: boolean =
          minValue <= warning && warning < critical && critical <= maxValue;

        expect(
          `${label} ${minValue} <= ${warning} < ${critical} <= ${maxValue} : ${orderedCorrectly}`,
        ).toBe(
          `${label} ${minValue} <= ${warning} < ${critical} <= ${maxValue} : true`,
        );
      }
    });
  });

  describe("variables", () => {
    test("variables within a template have unique ids and unique names", (): void => {
      const loadedTemplates: Array<LoadedTemplate> = loadAllTemplates();

      expect(loadedTemplates.length).toBeGreaterThan(0);

      let templatesWithVariables: number = 0;

      for (const loaded of loadedTemplates) {
        const variables: Array<DashboardVariable> =
          loaded.config.variables || [];

        if (variables.length === 0) {
          continue;
        }

        templatesWithVariables++;

        const ids: Array<string> = variables.map(
          (variable: DashboardVariable): string => {
            return variable.id;
          },
        );
        const names: Array<string> = variables.map(
          (variable: DashboardVariable): string => {
            return variable.name;
          },
        );

        expect(`${loaded.type} ids: ${new Set(ids).size}`).toBe(
          `${loaded.type} ids: ${ids.length}`,
        );
        expect(`${loaded.type} names: ${new Set(names).size}`).toBe(
          `${loaded.type} names: ${names.length}`,
        );
      }

      expect(templatesWithVariables).toBeGreaterThan(0);
    });

    test("every TelemetryAttribute variable binds to a non-empty attribute key", (): void => {
      const telemetryVariables: Array<{
        type: DashboardTemplateType;
        variable: DashboardVariable;
      }> = [];

      for (const loaded of loadAllTemplates()) {
        for (const variable of loaded.config.variables || []) {
          if (variable.type === DashboardVariableType.TelemetryAttribute) {
            telemetryVariables.push({ type: loaded.type, variable: variable });
          }
        }
      }

      expect(telemetryVariables.length).toBeGreaterThan(0);

      for (const entry of telemetryVariables) {
        const label: string = `${entry.type} variable "${entry.variable.name}"`;

        expect(
          `${label} attributeKey=${(entry.variable.attributeKey ?? "").trim()}`,
        ).not.toBe(`${label} attributeKey=`);
        expect(entry.variable.name.trim().length).toBeGreaterThan(0);
      }
    });

    test("variable ids are freshly generated on every call", (): void => {
      const typesWithVariables: Array<DashboardTemplateType> =
        TEMPLATE_TYPES_WITH_CONFIG.filter(
          (type: DashboardTemplateType): boolean => {
            const config: DashboardViewConfig = getTemplateConfig(
              type,
            ) as DashboardViewConfig;

            return (config.variables || []).length > 0;
          },
        );

      expect(typesWithVariables.length).toBeGreaterThan(0);

      for (const type of typesWithVariables) {
        const first: DashboardViewConfig = getTemplateConfig(
          type,
        ) as DashboardViewConfig;
        const second: DashboardViewConfig = getTemplateConfig(
          type,
        ) as DashboardViewConfig;

        const firstIds: Set<string> = new Set<string>(
          (first.variables || []).map((variable: DashboardVariable): string => {
            return variable.id;
          }),
        );
        const shared: Array<string> = (second.variables || [])
          .map((variable: DashboardVariable): string => {
            return variable.id;
          })
          .filter((id: string): boolean => {
            return firstIds.has(id);
          });

        expect(`${type}: ${shared.length} shared variable ids`).toBe(
          `${type}: 0 shared variable ids`,
        );
      }
    });
  });
});
