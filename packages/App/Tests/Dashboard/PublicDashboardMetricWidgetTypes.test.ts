import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import DashboardComponentType, {
  DataSourceComponentTypes,
  MetricComponentTypes,
} from "Common/Types/Dashboard/DashboardComponentType";

/*
 * Issue #6297: a public dashboard's metric routes allow only what the
 * widgets that chart metrics (MetricComponentTypes) can ask for, read as the
 * public page draws them. A widget type that starts reading metrics but is
 * not in that list would have every read refused on a public dashboard; a
 * type left in the list after it stops would unlock metrics for a widget
 * that charts none. What no behaviour test can see is that next widget, so
 * this reads the sources: the canvas's widget registry (WIDGET_BY_TYPE),
 * and in each widget's own component whether it reads metrics through
 * MetricUtil (Components/Metrics/Utils/Metrics), which is what sends a
 * public dashboard's reads to /metrics-aggregate and /metric-types.
 */

const COMPONENTS_DIRECTORY: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Components",
  "Dashboard",
  "Components",
);

const REGISTRY: string = path.join(
  COMPONENTS_DIRECTORY,
  "DashboardBaseComponent.tsx",
);

const READS_METRICS: RegExp = /from "(\.\.\/)+Metrics\/Utils\/Metrics"/;

interface RegisteredWidget {
  componentType: string;
  file: string;
}

// The widget types the canvas draws, each with its component's file.
function registeredWidgets(): Array<RegisteredWidget> {
  const registry: string = fs.readFileSync(REGISTRY, "utf8");
  const start: number = registry.indexOf("const WIDGET_BY_TYPE");

  expect(start).toBeGreaterThan(-1);

  const block: string = registry.slice(start, registry.indexOf("};", start));

  const imports: Map<string, string> = new Map<string, string>();

  for (const match of registry.matchAll(/import (\w+) from "\.\/(\w+)";/g)) {
    imports.set(match[1]!, match[2]!);
  }

  const widgets: Array<RegisteredWidget> = [];

  for (const match of block.matchAll(
    /\[DashboardComponentType\.(\w+)\]:\s*(\w+)/g,
  )) {
    const componentName: string = match[2]!;
    const fileName: string | undefined = imports.get(componentName);

    expect({ componentName, imported: Boolean(fileName) }).toEqual({
      componentName,
      imported: true,
    });

    widgets.push({
      componentType: match[1]!,
      file: path.join(COMPONENTS_DIRECTORY, `${fileName}.tsx`),
    });
  }

  return widgets;
}

describe("the widget types the public metric routes read are the ones that chart metrics (issue #6297)", () => {
  test("the registry is read: every widget type the canvas draws, each with its component", () => {
    const widgets: Array<RegisteredWidget> = registeredWidgets();

    expect(widgets.length).toBeGreaterThanOrEqual(50);
    expect(
      widgets.map((widget: RegisteredWidget): string => {
        return widget.componentType;
      }),
    ).toEqual(expect.arrayContaining([...MetricComponentTypes]));

    for (const widget of widgets) {
      expect({ widget: widget.file, exists: fs.existsSync(widget.file) }).toEqual(
        { widget: widget.file, exists: true },
      );
    }
  });

  test("a widget's component reads metrics exactly when its type is one that charts metrics", () => {
    const readingMetrics: Array<string> = registeredWidgets()
      .filter((widget: RegisteredWidget): boolean => {
        return READS_METRICS.test(fs.readFileSync(widget.file, "utf8"));
      })
      .map((widget: RegisteredWidget): string => {
        return widget.componentType;
      })
      .sort();

    /*
     * A widget type here that is not in MetricComponentTypes reads metrics
     * the public routes would refuse for it: add it to the list (Common/
     * Types/Dashboard/DashboardComponentType) - and to the public metric
     * route tests - once its reads are what its settings say.
     */
    expect(readingMetrics).toEqual([...MetricComponentTypes].sort());
  });

  test("no Data Source widget is among them: a public dashboard never draws one", () => {
    for (const componentType of MetricComponentTypes) {
      expect(DataSourceComponentTypes).not.toContain(componentType);
      expect(Object.values(DashboardComponentType)).toContain(componentType);
    }
  });
});
