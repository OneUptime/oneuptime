import DashboardComponentType from "../../Types/Dashboard/DashboardComponentType";
import DashboardBaseComponent from "../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import {
  DashboardResourceScope,
  isDashboardResourceScope,
} from "../../Types/Dashboard/DashboardResourceScope";
import {
  DashboardTemplate,
  DashboardTemplates,
  getTemplateConfig,
} from "../../Types/Dashboard/DashboardTemplates";
import DashboardVariable, {
  DashboardVariableType,
} from "../../Types/Dashboard/DashboardVariable";
import DashboardViewConfig from "../../Types/Dashboard/DashboardViewConfig";
import { JSONObject } from "../../Types/JSON";

/*
 * Names the kind of resource on the variable of a dashboard made from a
 * template before its variables named one (issue #11258).
 *
 * Templates are COPIED into a dashboard when it is created, so a Kubernetes,
 * Hosts, Docker Swarm, Proxmox, VMware, XCP-ng, OpenStack, Ceph or storage
 * array dashboard made before this release has the template's variable
 * without its `resourceScope`, and goes on reading the whole project until a
 * value is picked. This gives that variable the kind its template now ships
 * it with, and nothing else changes: not its pick, its label, the widgets,
 * their filters or their place.
 *
 * Only a board that is the template's is touched - one that holds the
 * template's own variable exactly as the template made it (its type, name
 * and attribute key) AND at least one of the template's own widgets (its
 * type and title, and its metric where it has one: "Pod CPU Cores Over
 * Time" on k8s.pod.cpu.usage). A dashboard of someone's own that only
 * happens to have a "cluster" variable on k8s.cluster.name is left as it
 * is. A variable that already names a kind keeps it.
 *
 * What it means for a board that took on widgets of its own: those read the
 * kind too, as every widget the variable applies to does. The variable's
 * Resource Type in the Variables dialog says so and takes it off again.
 *
 * React-free and import-light so plain node tests load it.
 */

// A template's variable that names its kind, as the template creates it.
export interface ScopedTemplateVariableSignature {
  name: string;
  attributeKey: string;
  resourceScope: DashboardResourceScope;
}

// One of a template's widgets, as the template creates it.
interface TemplateWidgetSignature {
  componentType: string;
  title: string;
  metricName?: string | undefined;
}

interface ScopedTemplate {
  variables: Array<ScopedTemplateVariableSignature>;
  widgets: Array<TemplateWidgetSignature>;
}

export interface TemplateVariableResourceScopeRepairResult {
  config: JSONObject;
  scopedVariableCount: number;
}

const TITLE_ARGUMENTS: ReadonlyArray<string> = [
  "title",
  "chartTitle",
  "gaugeTitle",
  "tableTitle",
];

function asObject(value: unknown): JSONObject | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JSONObject;
  }

  return undefined;
}

function readTitle(argumentsObject: JSONObject | undefined): string | null {
  for (const key of TITLE_ARGUMENTS) {
    const value: unknown = argumentsObject?.[key];

    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }

  return null;
}

function readMetricName(argumentsObject: JSONObject | undefined): string | null {
  const metricQueryConfig: JSONObject | undefined = asObject(
    argumentsObject?.["metricQueryConfig"],
  );
  const metricQueryData: JSONObject | undefined = asObject(
    metricQueryConfig?.["metricQueryData"],
  );
  const filterData: JSONObject | undefined = asObject(
    metricQueryData?.["filterData"],
  );
  const metricName: unknown = filterData?.["metricName"];

  return typeof metricName === "string" && metricName.length > 0
    ? metricName
    : null;
}

function getWidgetSignature(
  component: unknown,
): TemplateWidgetSignature | null {
  const componentObject: JSONObject | undefined = asObject(component);
  const componentType: unknown = componentObject?.["componentType"];

  // Section headings ("Resource Health") prove nothing about a board.
  if (
    typeof componentType !== "string" ||
    componentType === DashboardComponentType.Text
  ) {
    return null;
  }

  const argumentsObject: JSONObject | undefined = asObject(
    componentObject?.["arguments"],
  );
  const title: string | null = readTitle(argumentsObject);

  if (!title) {
    return null;
  }

  const metricName: string | null = readMetricName(argumentsObject);

  return {
    componentType: componentType,
    title: title,
    ...(metricName ? { metricName: metricName } : {}),
  };
}

let scopedTemplates: Array<ScopedTemplate> | null = null;

// Every template whose variables name a kind, read off the templates.
function getScopedTemplates(): Array<ScopedTemplate> {
  if (scopedTemplates) {
    return scopedTemplates;
  }

  scopedTemplates = [];

  for (const template of DashboardTemplates as Array<DashboardTemplate>) {
    const config: DashboardViewConfig | null = getTemplateConfig(template.type);

    if (!config) {
      continue;
    }

    const variables: Array<ScopedTemplateVariableSignature> = [];

    for (const variable of config.variables || []) {
      if (
        variable.type === DashboardVariableType.TelemetryAttribute &&
        variable.attributeKey &&
        isDashboardResourceScope(variable.resourceScope)
      ) {
        variables.push({
          name: variable.name,
          attributeKey: variable.attributeKey,
          resourceScope: variable.resourceScope,
        });
      }
    }

    if (variables.length === 0) {
      continue;
    }

    const widgets: Array<TemplateWidgetSignature> = config.components
      .map((component: DashboardBaseComponent) => {
        return getWidgetSignature(component);
      })
      .filter(
        (
          signature: TemplateWidgetSignature | null,
        ): signature is TemplateWidgetSignature => {
          return signature !== null;
        },
      );

    scopedTemplates.push({ variables: variables, widgets: widgets });
  }

  return scopedTemplates;
}

function matchesWidget(
  stored: TemplateWidgetSignature,
  template: TemplateWidgetSignature,
): boolean {
  return (
    stored.componentType === template.componentType &&
    stored.title === template.title &&
    (template.metricName === undefined ||
      stored.metricName === template.metricName)
  );
}

function holdsTemplateWidget(
  components: Array<unknown>,
  template: ScopedTemplate,
): boolean {
  return components.some((component: unknown): boolean => {
    const stored: TemplateWidgetSignature | null =
      getWidgetSignature(component);

    return (
      stored !== null &&
      template.widgets.some((widget: TemplateWidgetSignature): boolean => {
        return matchesWidget(stored, widget);
      })
    );
  });
}

function isTemplateVariable(
  variable: unknown,
  signature: ScopedTemplateVariableSignature,
): boolean {
  const variableObject: JSONObject | undefined = asObject(variable);

  return (
    variableObject?.["type"] === DashboardVariableType.TelemetryAttribute &&
    variableObject?.["name"] === signature.name &&
    variableObject?.["attributeKey"] === signature.attributeKey
  );
}

export default class TemplateVariableResourceScopeRepair {
  /*
   * Each template variable's signature, deduplicated: Kubernetes and
   * Kubernetes Cost ship the same Cluster variable.
   */
  public static getScopedTemplateVariables(): Array<ScopedTemplateVariableSignature> {
    const seen: Map<string, ScopedTemplateVariableSignature> = new Map<
      string,
      ScopedTemplateVariableSignature
    >();

    for (const template of getScopedTemplates()) {
      for (const variable of template.variables) {
        const key: string = JSON.stringify([
          variable.name,
          variable.attributeKey,
          variable.resourceScope,
        ]);

        if (!seen.has(key)) {
          seen.set(key, variable);
        }
      }
    }

    return Array.from(seen.values());
  }

  /*
   * One variable's signature as a Postgres jsonb containment (`@>`)
   * document: a dashboard matches when one of its variables has the type,
   * name and attribute key together. The widget check is made on each
   * match in repair().
   */
  public static getContainment(
    signature: ScopedTemplateVariableSignature,
  ): JSONObject {
    return {
      variables: [
        {
          type: DashboardVariableType.TelemetryAttribute,
          name: signature.name,
          attributeKey: signature.attributeKey,
        },
      ],
    };
  }

  /*
   * A repaired COPY of a stored dashboardViewConfig, or null when it holds
   * no template variable to name a kind on - so a caller writes only when
   * something changed, and a second run is a no-op. The input is never
   * mutated.
   */
  public static repair(
    dashboardViewConfig: unknown,
  ): TemplateVariableResourceScopeRepairResult | null {
    const configObject: JSONObject | undefined = asObject(dashboardViewConfig);
    const components: unknown = configObject?.["components"];
    const variables: unknown = configObject?.["variables"];

    if (
      !configObject ||
      !Array.isArray(components) ||
      !Array.isArray(variables)
    ) {
      return null;
    }

    // The kind for each variable index, from the templates the board is.
    const scopes: Map<number, DashboardResourceScope> = new Map<
      number,
      DashboardResourceScope
    >();

    for (const template of getScopedTemplates()) {
      if (!holdsTemplateWidget(components, template)) {
        continue;
      }

      variables.forEach((variable: unknown, index: number): void => {
        const variableObject: JSONObject | undefined = asObject(variable);

        if (
          !variableObject ||
          variableObject["resourceScope"] !== undefined ||
          scopes.has(index)
        ) {
          return;
        }

        for (const signature of template.variables) {
          if (isTemplateVariable(variable, signature)) {
            scopes.set(index, signature.resourceScope);
            return;
          }
        }
      });
    }

    if (scopes.size === 0) {
      return null;
    }

    // A stored config is plain jsonb, so a JSON round trip is a full copy.
    const config: JSONObject = JSON.parse(JSON.stringify(configObject));
    const copiedVariables: Array<unknown> = config["variables"] as Array<unknown>;

    for (const [index, scope] of scopes) {
      const variable: JSONObject = copiedVariables[index] as JSONObject;
      (variable as unknown as DashboardVariable).resourceScope = scope;
    }

    return { config, scopedVariableCount: scopes.size };
  }
}
