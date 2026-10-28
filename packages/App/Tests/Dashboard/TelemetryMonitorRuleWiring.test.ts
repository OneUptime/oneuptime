import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * How a Logs, Traces, Exceptions or Metrics monitor is set up as one rule,
 * pinned where App's node tests can see it: the source. The behaviour
 * behind every pin is rendered for real in Common/Tests/App/Dashboard:
 *
 *   TelemetryRuleEditor.test.tsx         (When to alert, What happens)
 *   TelemetryRuleCreateSeeding.test.tsx  (recipes, type changes, links)
 *   TelemetryRuleCriteriaPage.test.tsx   (the monitor's Criteria page)
 *   TelemetryRulePreview.test.tsx        (what the rule would have caught)
 *   TelemetryMonitorLink.test.ts         (Create monitor from the data)
 *
 * What is pinned here is the wiring a refactor could drop without any of
 * those failing: which monitor types get the rule editor, the entry points
 * that link to Create Monitor and the parameter they agree on, and that
 * Create Monitor tells its steps it is creating (not a template).
 */

const APP: string = path.join(__dirname, "..", "..");
const DASHBOARD: string = path.join(APP, "FeatureSet", "Dashboard", "src");

function read(relative: string): string {
  return fs.readFileSync(path.join(DASHBOARD, relative), "utf8");
}

function readSquashed(relative: string): string {
  return read(relative).replace(/\s+/g, " ");
}

const MONITOR_STEP_FORM: string = "Components/Form/Monitor/MonitorStep.tsx";
const MONITOR_STEPS_FORM: string = "Components/Form/Monitor/MonitorSteps.tsx";
const CREATE_PAGE: string = "Pages/Monitor/Create.tsx";
const LINK: string = "Utils/Form/Monitor/TelemetryRule/TelemetryMonitorLink.ts";

describe("the rule editor", () => {
  test("is drawn for the four rule monitor types, and the full criteria editor for every other", () => {
    const source: string = readSquashed(MONITOR_STEP_FORM);

    expect(source).toContain(
      "const isRuleMonitorType: boolean = TelemetryAlertRuleUtil.isRuleMonitorType( props.monitorType, );",
    );
    expect(source).toContain("{isRuleMonitorType ? ( <TelemetryRuleEditor");
    // The full editor is the rule editor's fallback, and every other type's.
    expect(source).toContain("customCriteria={criteriaElement}");
    expect(source).toContain('title="Monitor Criteria"');
  });

  test("the four types are the ones TelemetryAlertRule reads", () => {
    const rule: string = fs
      .readFileSync(
        path.join(
          APP,
          "..",
          "Common",
          "Types",
          "Monitor",
          "TelemetryAlertRule.ts",
        ),
        "utf8",
      )
      .replace(/\s+/g, " ");

    expect(rule).toContain(
      "public static readonly RULE_MONITOR_TYPES: ReadonlyArray<MonitorType> = [ MonitorType.Logs, MonitorType.Traces, MonitorType.Exceptions, MonitorType.Metrics, ];",
    );
  });

  test("the recipes are offered only to a new monitor, from the steps form", () => {
    const step: string = readSquashed(MONITOR_STEP_FORM);
    const steps: string = readSquashed(MONITOR_STEPS_FORM);

    expect(step).toContain(
      "{isRuleMonitorType && props.offerRecipes && recipes.length > 0 ? ( <TelemetryRuleRecipePicker",
    );
    expect(steps).toContain("offerRecipes={isNewMonitor}");
    expect(steps).toContain(
      "const [isNewMonitor] = React.useState<boolean>( props.isCreating ?? !props.initialValue, );",
    );
  });

  test("the step's query cards say what they hold, the window left to the rule", () => {
    const source: string = read(MONITOR_STEP_FORM);

    for (const title of [
      "Logs to watch",
      "Spans to watch",
      "Exceptions to watch",
      "Metric to watch",
    ]) {
      expect(source).toContain(`title="${title}"`);
    }

    // The filters forms never set the window: the step keeps the rule's.
    expect(readSquashed(MONITOR_STEP_FORM)).toContain(
      "lastXSecondsOfLogs: TelemetryAlertRuleUtil.getWindowInSeconds({",
    );
  });
});

describe("Create Monitor", () => {
  test("reads a link's query for the type it names, and hands it to the steps with that type", () => {
    const source: string = readSquashed(CREATE_PAGE);

    expect(source).toContain(
      "if (isTelemetryMonitorLinkType(monitorTypeParam)) {",
    );
    expect(source).toContain(
      "readTelemetryMonitorLinkQuery( Navigation.getQueryStringByName(TELEMETRY_MONITOR_QUERY_PARAM), );",
    );
    expect(source).toContain(
      "monitorType: monitorTypeParam as MonitorType, query: linkQuery,",
    );
    expect(source).toContain("seedQuery={seedQuery}");
  });

  test("tells its steps it is creating a monitor, unless from a template", () => {
    expect(readSquashed(CREATE_PAGE)).toContain(
      "isCreating={!monitorTemplateId}",
    );
  });

  test("the link and Create Monitor agree on the parameters' names", () => {
    const link: string = read(LINK);

    expect(link).toContain(
      'export const TELEMETRY_MONITOR_TYPE_QUERY_PARAM: string = "monitorType";',
    );
    expect(link).toContain(
      'export const TELEMETRY_MONITOR_QUERY_PARAM: string = "telemetryQuery";',
    );
    // The type parameter is the one Create Monitor has always read.
    expect(read(CREATE_PAGE)).toContain(
      'Navigation.getQueryStringByName("monitorType")',
    );
  });
});

describe("Create monitor from where the data is", () => {
  test.each([
    [
      "the logs explorer",
      "Components/Logs/LogsViewer.tsx",
      "monitorType: MonitorType.Logs, query: getLogsFilterLinkQuery(",
    ],
    [
      "the traces explorer",
      "Components/Traces/TracesViewer.tsx",
      "monitorType: MonitorType.Traces, query: getTracesFilterLinkQuery(",
    ],
    [
      "an exception's page",
      "Components/Exceptions/ExceptionExplorer.tsx",
      "monitorType: MonitorType.Exceptions, query: {",
    ],
  ])(
    "%s links to Create Monitor with what it shows, for a reader who may create a monitor",
    (_name: string, file: string, linkCall: string) => {
      const source: string = readSquashed(file);

      expect(source).toContain("getTelemetryMonitorLinkParams({");
      expect(source).toContain(linkCall);
      expect(source).toContain("PermissionGate.check(");
      expect(source).toContain("new Monitor(), ModelAction.Create");
      expect(source).toContain("PageMap.MONITOR_CREATE");
    },
  );

  test("the Logs and Traces pages turn it on; other logs and traces views do not", () => {
    expect(readSquashed("Pages/Logs/Index.tsx")).toContain(
      "offersCreateMonitor={true}",
    );
    expect(readSquashed("Pages/Traces/Index.tsx")).toContain(
      "offersCreateMonitor={true}",
    );

    const logs: string = readSquashed("Components/Logs/LogsViewer.tsx");
    expect(logs).toContain(
      "onCreateMonitor={ props.offersCreateMonitor && canCreateMonitor ? navigateToCreateMonitor : undefined }",
    );

    const traces: string = readSquashed("Components/Traces/TracesViewer.tsx");
    expect(traces).toContain(
      "{props.offersCreateMonitor && canCreateMonitor ? (",
    );
  });

  test("an exception's page offers it beside its triage actions", () => {
    const source: string = readSquashed(
      "Components/Exceptions/ExceptionExplorer.tsx",
    );

    expect(source).toContain('dataTestId="exception-create-monitor"');
    expect(source).toContain("{canCreateMonitor ? ( <Button");
  });
});

// Every .tsx file under a folder, by its path from the Dashboard's src.
function tsxFilesUnder(relative: string): Array<string> {
  const found: Array<string> = [];
  const walk: (folder: string) => void = (folder: string): void => {
    for (const entry of fs.readdirSync(path.join(DASHBOARD, folder), {
      withFileTypes: true,
    })) {
      const child: string = path.join(folder, entry.name);

      if (entry.isDirectory()) {
        walk(child);
      } else if (entry.name.endsWith(".tsx")) {
        found.push(child);
      }
    }
  };

  walk(relative);

  return found;
}

describe("a Metrics monitor's red line", () => {
  test("its chart stretches the value axis to the rule's line, and only its chart does", () => {
    // The form asks for it ...
    expect(
      readSquashed(
        "Components/Form/Monitor/MetricMonitor/MetricMonitorStepForm.tsx",
      ),
    ).toContain("thresholdLinesExtendAxis={true}");

    // ... the view hands it to its charts ...
    expect(readSquashed("Components/Metrics/MetricView.tsx")).toContain(
      "thresholdLinesExtendAxis={props.thresholdLinesExtendAxis}",
    );

    // ... which give it to every query's and every formula's lines.
    const charts: string = readSquashed("Components/Metrics/MetricCharts.tsx");
    expect(
      charts.split("extendsDomain: props.thresholdLinesExtendAxis,").length - 1,
    ).toBe(2);

    /*
     * Nothing else turns it on: a dashboard's or the explorer's axis
     * follows its data, a threshold far above it never squeezing it flat.
     */
    const askers: Array<string> = tsxFilesUnder(".").filter(
      (file: string): boolean => {
        return read(file).includes("thresholdLinesExtendAxis={true}");
      },
    );

    expect(askers).toEqual([
      path.join(
        "Components",
        "Form",
        "Monitor",
        "MetricMonitor",
        "MetricMonitorStepForm.tsx",
      ),
    ]);
  });
});
