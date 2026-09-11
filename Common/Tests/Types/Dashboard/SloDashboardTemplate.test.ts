import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import {
  DashboardTemplate,
  DashboardTemplateCategory,
  DashboardTemplates,
  DashboardTemplateType,
  getDashboardTemplatesByCategory,
  getTemplateConfig,
} from "../../../Types/Dashboard/DashboardTemplates";
import IconProp from "../../../Types/Icon/IconProp";
import { ObjectType } from "../../../Types/JSON";

type WidgetArguments = Record<string, unknown>;

function getConfig(): DashboardViewConfig {
  const config: DashboardViewConfig | null = getTemplateConfig(
    DashboardTemplateType.Slo,
  );

  expect(config).not.toBeNull();
  return config as DashboardViewConfig;
}

function argumentsOf(component: DashboardBaseComponent): WidgetArguments {
  return (component.arguments as WidgetArguments | undefined) || {};
}

function componentOfType(
  config: DashboardViewConfig,
  type: DashboardComponentType,
): DashboardBaseComponent {
  const matches: Array<DashboardBaseComponent> = config.components.filter(
    (component: DashboardBaseComponent): boolean => {
      return component.componentType === type;
    },
  );

  expect(matches).toHaveLength(1);
  return matches[0] as DashboardBaseComponent;
}

describe("SLO dashboard template", () => {
  describe("catalog registration", () => {
    test("registers one SLO Dashboard in Monitoring & APM", () => {
      const entries: Array<DashboardTemplate> = DashboardTemplates.filter(
        (template: DashboardTemplate): boolean => {
          return template.type === DashboardTemplateType.Slo;
        },
      );

      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        name: "SLO Dashboard",
        icon: IconProp.Percent,
        category: DashboardTemplateCategory.Monitoring,
      });
    });

    test("describes the fleet-wide reliability signals the overview renders", () => {
      const entry: DashboardTemplate = DashboardTemplates.find(
        (template: DashboardTemplate): boolean => {
          return template.type === DashboardTemplateType.Slo;
        },
      ) as DashboardTemplate;

      expect(entry.description).toContain("Fleet-wide");
      expect(entry.description).toContain("SLI");
      expect(entry.description).toContain("error budget");
      expect(entry.description).toContain("burn rates");
    });

    test("is returned by the Monitoring category used by the template modal", () => {
      const types: Array<DashboardTemplateType> =
        getDashboardTemplatesByCategory(
          DashboardTemplateCategory.Monitoring,
        ).map((template: DashboardTemplate): DashboardTemplateType => {
          return template.type;
        });

      expect(types).toContain(DashboardTemplateType.Slo);
      expect(types.indexOf(DashboardTemplateType.Slo)).toBe(
        types.indexOf(DashboardTemplateType.Monitor) + 1,
      );
    });

    test("accepts the raw wire value DashboardService receives", () => {
      const wireValue: string = "Slo";

      expect(DashboardTemplateType.Slo).toBe(wireValue);
      expect(
        getTemplateConfig(wireValue as DashboardTemplateType),
      ).not.toBeNull();
    });
  });

  describe("zero-configuration fleet overview", () => {
    test("contains only a title and one SLO fleet list", () => {
      const config: DashboardViewConfig = getConfig();

      expect(config.components).toHaveLength(2);
      expect(
        config.components.map(
          (component: DashboardBaseComponent): DashboardComponentType => {
            return component.componentType;
          },
        ),
      ).toEqual([DashboardComponentType.Text, DashboardComponentType.SloList]);
    });

    test("uses a full-width heading above the overview", () => {
      const heading: DashboardBaseComponent = componentOfType(
        getConfig(),
        DashboardComponentType.Text,
      );

      expect(heading).toMatchObject({
        _type: ObjectType.DashboardComponent,
        topInDashboardUnits: 0,
        leftInDashboardUnits: 0,
        widthInDashboardUnits: 12,
        heightInDashboardUnits: 1,
      });
      expect(argumentsOf(heading)).toMatchObject({
        text: "Service Level Objectives Dashboard",
        isBold: true,
      });
    });

    test("gives the fleet list the full canvas beneath the heading", () => {
      const list: DashboardBaseComponent = componentOfType(
        getConfig(),
        DashboardComponentType.SloList,
      );

      expect(list).toMatchObject({
        _type: ObjectType.DashboardComponent,
        topInDashboardUnits: 1,
        leftInDashboardUnits: 0,
        widthInDashboardUnits: 12,
        heightInDashboardUnits: 8,
        minWidthInDashboardUnits: 6,
        minHeightInDashboardUnits: 4,
      });
    });

    test("shows a useful fleet title and up to fifty SLOs out of the box", () => {
      const list: DashboardBaseComponent = componentOfType(
        getConfig(),
        DashboardComponentType.SloList,
      );

      expect(argumentsOf(list)).toEqual({
        title: "SLO Fleet Overview",
        maxRows: 50,
      });
    });

    test("does not bake a project, SLO, monitor, label, or status into the template", () => {
      const listArguments: WidgetArguments = argumentsOf(
        componentOfType(getConfig(), DashboardComponentType.SloList),
      );

      expect(listArguments["projectId"]).toBeUndefined();
      expect(listArguments["serviceLevelObjectiveId"]).toBeUndefined();
      expect(listArguments["monitorIds"]).toBeUndefined();
      expect(listArguments["labelIds"]).toBeUndefined();
      expect(listArguments["labelVariableId"]).toBeUndefined();
      expect(listArguments["sloStatuses"]).toBeUndefined();
    });

    test("needs no dashboard variable before it can list the project fleet", () => {
      expect(getConfig().variables).toEqual([]);
    });

    test("declares enough dashboard height to contain every component", () => {
      const config: DashboardViewConfig = getConfig();
      const greatestBottomEdge: number = Math.max(
        ...config.components.map(
          (component: DashboardBaseComponent): number => {
            return (
              component.topInDashboardUnits + component.heightInDashboardUnits
            );
          },
        ),
      );

      expect(config.heightInDashboardUnits).toBeGreaterThanOrEqual(
        greatestBottomEdge,
      );
    });
  });

  describe("persisted dashboard safety", () => {
    test("assigns a unique component id to every widget", () => {
      const ids: Array<string> = getConfig().components.map(
        (component: DashboardBaseComponent): string => {
          return component.componentId.toString();
        },
      );

      expect(new Set(ids).size).toBe(ids.length);
    });

    test("generates fresh component ids for every dashboard creation", () => {
      const firstIds: Set<string> = new Set(
        getConfig().components.map(
          (component: DashboardBaseComponent): string => {
            return component.componentId.toString();
          },
        ),
      );
      const secondIds: Array<string> = getConfig().components.map(
        (component: DashboardBaseComponent): string => {
          return component.componentId.toString();
        },
      );

      expect(
        secondIds.filter((id: string): boolean => firstIds.has(id)),
      ).toEqual([]);
    });

    test("survives the JSON round trip used by the dashboard JSONB column", () => {
      const stored: DashboardViewConfig = JSON.parse(
        JSON.stringify(getConfig()),
      ) as DashboardViewConfig;

      expect(stored._type).toBe(ObjectType.DashboardViewConfig);
      expect(stored.components).toHaveLength(2);
      expect(stored.components[1]?.componentType).toBe(
        DashboardComponentType.SloList,
      );
      expect(
        argumentsOf(stored.components[1] as DashboardBaseComponent),
      ).toEqual({
        title: "SLO Fleet Overview",
        maxRows: 50,
      });
    });
  });
});
