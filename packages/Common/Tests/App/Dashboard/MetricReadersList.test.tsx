import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import fs from "fs";
import path from "path";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import MetricReadersList, {
  MAX_METRIC_READERS_SHOWN,
  MAX_READER_WIDGETS_SHOWN,
  MetricReaderListGroup,
  MetricReaderListKind,
  MetricReaderListReader,
  MetricReaderListWidget,
  getMetricReaderRoute,
  getOutputReaderGroups,
  isMetricReaderGroupShown,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Readers/MetricReadersList";
import { getDashboardWidgetRoute } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/DashboardWidgetRoute";
import {
  getEmptyMetricOutputReaders,
  MetricOutputReaders,
} from "../../../Types/Metrics/MetricOutputReaders";
import { getMetricRecordingRulesRoute } from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/RecordingRule/RecordingRulesRoute";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";

/*
 * #10107: ONE LIST OF WHAT READS A METRIC.
 *
 * Drop This Metric and More Metrics' Remove both say what reads a metric
 * before it goes, from the one lookup, and both list it with this one
 * component, so they look and behave alike: kind by kind, each kind's line,
 * each record a link (a recording rule's to its filtered list), the first
 * few and then "and N more", a dashboard's widgets by title or kind, and
 * the ones the reader cannot open counted, never named.
 */

function id(n: number): string {
  return `7a7a7a7a-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function readersOf(
  count: number,
  prefix: string,
  extra: Partial<MetricReaderListReader> = {},
): Array<MetricReaderListReader> {
  return Array.from(
    { length: count },
    (_: unknown, index: number): MetricReaderListReader => {
      return { id: id(index + 1), name: `${prefix} ${index}`, ...extra };
    },
  );
}

function group(
  kind: MetricReaderListKind,
  overrides: Partial<MetricReaderListGroup> = {},
): MetricReaderListGroup {
  return {
    kind,
    readers: [],
    hidden: 0,
    isChecked: true,
    words: {
      consequence: `What happens to the ${kind} readers.`,
      unchecked: `Whether a ${kind} reads it could not be checked.`,
    },
    dataTestId: `readers-${kind}`,
    ...overrides,
  };
}

function draw(
  groups: Array<MetricReaderListGroup>,
  props: { untitledWidget?: string } = {},
): HTMLElement {
  const { container } = render(
    <MemoryRouter>
      <MetricReadersList
        groups={groups}
        widgetsDataTestId="readers-widgets"
        {...props}
      />
    </MemoryRouter>,
  );

  return container;
}

function viewRoute(page: PageMap, modelId: string): string {
  return RouteUtil.populateRouteParams(RouteMap[page] as Route, {
    modelId: new ObjectID(modelId),
  }).toString();
}

afterEach(() => {
  cleanup();
});

describe("what reads a metric, listed the one way", () => {
  test("none: nothing listed, not even a kind's title", () => {
    const container: HTMLElement = draw([
      group(MetricReaderListKind.Monitor),
      group(MetricReaderListKind.Dashboard),
      group(MetricReaderListKind.Slo),
      group(MetricReaderListKind.RecordingRule),
    ]);

    expect(container).toHaveTextContent("");
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(isMetricReaderGroupShown(group(MetricReaderListKind.Slo))).toBe(
      false,
    );
  });

  test("each kind under its title with its own line, each record a link to its page", () => {
    draw([
      group(MetricReaderListKind.Monitor, {
        readers: [{ id: id(1), name: "Orders swap" }],
      }),
      group(MetricReaderListKind.Dashboard, {
        readers: [{ id: id(2), name: "Databases" }],
      }),
      group(MetricReaderListKind.Slo, {
        readers: [{ id: id(3), name: "Orders budget" }],
      }),
      group(MetricReaderListKind.RecordingRule, {
        readers: [
          { id: id(4), name: "Swap rate", outputMetricName: "swap_rate" },
        ],
      }),
    ]);

    const monitors: HTMLElement = screen.getByTestId("readers-monitor");

    expect(monitors).toHaveTextContent("Monitors");
    expect(monitors).toHaveTextContent("What happens to the monitor readers.");
    expect(
      within(monitors).getByRole("link", { name: "Orders swap" }),
    ).toHaveAttribute("href", viewRoute(PageMap.MONITOR_VIEW, id(1)));
    expect(
      within(screen.getByTestId("readers-dashboard")).getByRole("link", {
        name: "Databases",
      }),
    ).toHaveAttribute("href", viewRoute(PageMap.DASHBOARD_VIEW, id(2)));
    expect(
      within(screen.getByTestId("readers-slo")).getByRole("link", {
        name: "Orders budget",
      }),
    ).toHaveAttribute("href", viewRoute(PageMap.SLO_VIEW, id(3)));

    // A recording rule has no page: its list, filtered to the metric it writes.
    const rules: HTMLElement = screen.getByTestId("readers-recordingRule");

    expect(rules).toHaveTextContent("Recording Rules");
    expect(
      within(rules).getByRole("link", { name: "Swap rate" }),
    ).toHaveAttribute(
      "href",
      getMetricRecordingRulesRoute("swap_rate").toString(),
    );
    expect(
      getMetricReaderRoute(MetricReaderListKind.RecordingRule, {
        id: id(4),
      }).toString(),
    ).toBe(getMetricRecordingRulesRoute().toString());
  });

  test("many: the first few named, each a link, the rest counted", () => {
    draw([
      group(MetricReaderListKind.Monitor, {
        readers: readersOf(MAX_METRIC_READERS_SHOWN + 3, "Monitor"),
      }),
    ]);

    const monitors: HTMLElement = screen.getByTestId("readers-monitor");

    expect(within(monitors).getAllByRole("link")).toHaveLength(
      MAX_METRIC_READERS_SHOWN,
    );
    expect(monitors).toHaveTextContent("and 3 more");
    expect(monitors).not.toHaveTextContent(
      `Monitor ${MAX_METRIC_READERS_SHOWN}`,
    );
    expect(monitors).not.toHaveTextContent("you can't see");
  });

  test("ones the reader can't open are counted, never named: after the ones they can, or on their own, the kind's line still said", () => {
    draw([
      group(MetricReaderListKind.Monitor, {
        readers: readersOf(1, "Monitor"),
        hidden: 2,
      }),
      group(MetricReaderListKind.Slo, { hidden: 4 }),
      group(MetricReaderListKind.Dashboard, { hidden: 1 }),
    ]);

    expect(screen.getByTestId("readers-monitor-hidden")).toHaveTextContent(
      "and 2 more you can't see",
    );
    expect(screen.getByTestId("readers-slo-hidden")).toHaveTextContent(
      "4 SLOs you can't see",
    );
    expect(screen.getByTestId("readers-dashboard-hidden")).toHaveTextContent(
      "1 dashboard you can't see",
    );
    expect(screen.getByTestId("readers-slo")).toHaveTextContent(
      "What happens to the slo readers.",
    );
    expect(
      within(screen.getByTestId("readers-slo")).queryAllByRole("link"),
    ).toHaveLength(0);
  });

  test("a dashboard's widgets: by title as written, untitled by kind, of an unknown kind by the dialog's word, the rest counted", () => {
    const widgets: Array<{ title: string; type: string }> = [
      { title: "", type: "Gauge" },
      { title: "p99 <checkout>", type: "Chart" },
      { title: "", type: "" },
      ...Array.from(
        { length: MAX_READER_WIDGETS_SHOWN },
        (_: unknown, index: number) => {
          return { title: `Widget ${index}`, type: "Chart" };
        },
      ),
    ];

    draw([
      group(MetricReaderListKind.Dashboard, {
        readers: [{ id: id(1), name: "Growth", widgets }],
      }),
    ]);

    expect(screen.getByTestId("readers-widgets")).toHaveTextContent(
      "Gauge, p99 <checkout>, Untitled, Widget 0, Widget 1, and 3 more",
    );
    // Named by an answer that gives no widget's id: the dashboard alone is a link.
    expect(screen.getAllByRole("link")).toHaveLength(1);

    cleanup();
    draw(
      [
        group(MetricReaderListKind.Dashboard, {
          readers: [
            {
              id: id(1),
              name: "Web apps",
              widgets: [{ title: "", type: "" }],
            },
          ],
        }),
      ],
      { untitledWidget: "Untitled widget" },
    );

    expect(screen.getByText("Untitled widget")).toBeInTheDocument();
  });

  test("a line of a record's own under its link; a record with no name by its id", () => {
    draw([
      group(MetricReaderListKind.Monitor, {
        readers: [
          { id: id(1), name: "Every database", note: "Reads it of every one" },
          { id: id(2), name: "" },
        ],
      }),
    ]);

    expect(screen.getByTestId("readers-monitor-note")).toHaveTextContent(
      "Reads it of every one",
    );
    expect(screen.getByRole("link", { name: id(2) })).toBeInTheDocument();
  });

  test("a kind that could not be checked says so where its dialog words it, never that none reads it", () => {
    draw([
      group(MetricReaderListKind.Monitor, { isChecked: false }),
      group(MetricReaderListKind.Slo, {
        isChecked: false,
        words: { consequence: "What happens to SLOs." },
      }),
      group(MetricReaderListKind.Dashboard),
    ]);

    expect(screen.getByTestId("readers-monitor-unchecked")).toHaveTextContent(
      "Whether a monitor reads it could not be checked.",
    );
    // No words for it: left to the dialog.
    expect(screen.queryByTestId("readers-slo-unchecked")).toBeNull();
    expect(screen.queryByTestId("readers-dashboard-unchecked")).toBeNull();
  });
});

/*
 * #10084: a widget the list names opens its dashboard at it - the
 * dashboard's page with ?widget=<the id the board draws it under> - so a
 * warning that names a widget is one click from the widget itself.
 */
describe("a dashboard's widgets, each a link to the dashboard opened at it", () => {
  test("each widget named opens its dashboard at it; the ones counted are not links", () => {
    const widgets: Array<MetricReaderListWidget> = [
      { id: id(11), title: "", type: "Gauge" },
      { id: id(12), title: "p99 <checkout>", type: "Chart" },
      ...Array.from(
        { length: MAX_READER_WIDGETS_SHOWN + 1 },
        (_: unknown, index: number): MetricReaderListWidget => {
          return {
            id: id(20 + index),
            title: `Widget ${index}`,
            type: "Chart",
          };
        },
      ),
    ];

    draw([
      group(MetricReaderListKind.Dashboard, {
        readers: [{ id: id(1), name: "Growth", widgets }],
      }),
    ]);

    const line: HTMLElement = screen.getByTestId("readers-widgets");
    const links: Array<HTMLElement> = within(line).getAllByRole("link");

    expect(
      links.map((link: HTMLElement): string => {
        return link.textContent || "";
      }),
    ).toEqual(["Gauge", "p99 <checkout>", "Widget 0", "Widget 1", "Widget 2"]);
    links.forEach((link: HTMLElement, index: number): void => {
      expect(link).toHaveAttribute(
        "href",
        `${viewRoute(PageMap.DASHBOARD_VIEW, id(1))}?widget=${widgets[index]!.id}`,
      );
    });
    expect(line).toHaveTextContent("and 3 more");
    expect(within(line).getByText("and 3 more").closest("a")).toBeNull();
    // The dashboard is a link of its own, to its top.
    expect(screen.getByRole("link", { name: "Growth" })).toHaveAttribute(
      "href",
      viewRoute(PageMap.DASHBOARD_VIEW, id(1)),
    );
  });

  test("a title read the way it is written, and an untitled widget by its kind, inside its link", () => {
    draw([
      group(MetricReaderListKind.Dashboard, {
        readers: [
          {
            id: id(1),
            name: "Growth",
            widgets: [
              { id: id(11), title: "مصرف حافظه", type: "Chart" },
              { id: id(12), title: "", type: "" },
            ],
          },
        ],
      }),
    ]);

    const [titled, untitled] = within(
      screen.getByTestId("readers-widgets"),
    ).getAllByRole("link") as [HTMLElement, HTMLElement];

    // A name set apart, so a link of it never turns the line round.
    expect(titled.querySelector("bdi")).toHaveAttribute("dir", "rtl");
    expect(untitled).toHaveTextContent("Untitled");
    expect(untitled.querySelector(".italic")).not.toBeNull();
  });

  test("the widget route: the dashboard's page, with ?widget= when a widget is named", () => {
    expect(
      getDashboardWidgetRoute({
        dashboardId: id(1),
        widgetId: id(11),
      }).toString(),
    ).toBe(`${viewRoute(PageMap.DASHBOARD_VIEW, id(1))}?widget=${id(11)}`);
    expect(
      getDashboardWidgetRoute({
        dashboardId: id(1),
        widgetId: id(11).toUpperCase(),
      }).toString(),
    ).toBe(`${viewRoute(PageMap.DASHBOARD_VIEW, id(1))}?widget=${id(11)}`);
    for (const widgetId of [undefined, null, "", "a b"]) {
      expect(
        getDashboardWidgetRoute({ dashboardId: id(1), widgetId }).toString(),
      ).toBe(viewRoute(PageMap.DASHBOARD_VIEW, id(1)));
    }
  });
});

/*
 * #10085: under a recording rule, what reads the metric it writes, which no
 * longer includes the one taken away - set in under the rule, kind by kind,
 * each record a link, on down the chain; counted where the reader can't
 * see it; what reads the outputs of rules they can't see under the rules'
 * count; and, past the depth followed, more said, never named.
 */
describe("what reads a recording rule's output metric, set in under the rule", () => {
  function readersOfOutput(
    overrides: Partial<MetricOutputReaders> = {},
  ): MetricOutputReaders {
    return { ...getEmptyMetricOutputReaders(), ...overrides };
  }

  function ruleGroup(
    reader: Partial<MetricReaderListReader>,
    overrides: Partial<MetricReaderListGroup> = {},
  ): MetricReaderListGroup {
    return group(MetricReaderListKind.RecordingRule, {
      readers: [
        {
          id: id(4),
          name: "Swap rate",
          outputMetricName: "swap_rate",
          ...reader,
        },
      ],
      ...overrides,
    });
  }

  test("kind by kind, each record a link, a dashboard's widgets to the dashboard at them, a step's rule on down the chain", () => {
    draw([
      ruleGroup({
        outputReaders: readersOfOutput({
          monitors: {
            readers: [{ id: id(5), name: "Swap rate alert" }],
            hidden: 0,
          },
          dashboards: {
            readers: [
              {
                id: id(6),
                name: "Rates",
                widgets: [{ id: id(16), title: "Swap rate", type: "Chart" }],
              },
            ],
            hidden: 0,
          },
          slos: { readers: [{ id: id(7), name: "Swap budget" }], hidden: 0 },
          recordingRules: {
            readers: [
              {
                id: id(8),
                name: "Swap rate daily",
                outputMetricName: "swap_rate_daily",
                outputReaders: readersOfOutput({
                  monitors: {
                    readers: [{ id: id(9), name: "Daily swap alert" }],
                    hidden: 0,
                  },
                }),
              },
            ],
            hidden: 0,
          },
        }),
      }),
    ]);

    const output: HTMLElement = screen.getByTestId(
      "readers-recordingRule-output",
    );

    // Said once, with the metric the rule writes, as code.
    expect(
      within(output).getAllByTestId("readers-recordingRule-output-heading")[0],
    ).toHaveTextContent("These read its output metric, swap_rate:");
    expect(output.querySelector("code")).toHaveTextContent("swap_rate");
    // Set in under the rule, from the reader's own start.
    expect(output.className).toContain("border-s-2");
    expect(output.className).toContain("ps-3");

    expect(
      within(
        within(output).getByTestId("readers-recordingRule-output-monitor"),
      ).getByRole("link", { name: "Swap rate alert" }),
    ).toHaveAttribute("href", viewRoute(PageMap.MONITOR_VIEW, id(5)));
    expect(
      within(
        within(output).getByTestId("readers-recordingRule-output-dashboard"),
      ).getByRole("link", { name: "Swap rate" }),
    ).toHaveAttribute(
      "href",
      `${viewRoute(PageMap.DASHBOARD_VIEW, id(6))}?widget=${id(16)}`,
    );
    expect(
      within(output).getByRole("link", { name: "Swap budget" }),
    ).toHaveAttribute("href", viewRoute(PageMap.SLO_VIEW, id(7)));

    // The rule a step leads to opens its list, with what reads its own output under it.
    const daily: HTMLElement = within(output).getByTestId(
      "readers-recordingRule-output-recordingRule",
    );

    expect(
      within(daily).getByRole("link", { name: "Swap rate daily" }),
    ).toHaveAttribute(
      "href",
      getMetricRecordingRulesRoute("swap_rate_daily").toString(),
    );
    expect(
      within(daily).getByTestId(
        "readers-recordingRule-output-recordingRule-output",
      ),
    ).toHaveTextContent(
      "These read its output metric, swap_rate_daily:MonitorsDaily swap alert",
    );
  });

  test("a step down the chain says no kind's line of its own: the list's top says it", () => {
    draw([
      ruleGroup({
        outputReaders: readersOfOutput({
          monitors: {
            readers: [{ id: id(5), name: "Swap rate alert" }],
            hidden: 0,
          },
        }),
      }),
    ]);

    const rules: HTMLElement = screen.getByTestId("readers-recordingRule");

    // The rules' own line once, at the top.
    expect(
      within(rules).getAllByText("What happens to the recordingRule readers."),
    ).toHaveLength(1);
    expect(
      screen.getByTestId("readers-recordingRule-output-monitor"),
    ).not.toHaveTextContent("What happens");
  });

  test("what reads it that the reader can't see is counted, never named; many, the first few named", () => {
    draw([
      ruleGroup({
        outputReaders: readersOfOutput({
          monitors: {
            readers: readersOf(MAX_METRIC_READERS_SHOWN + 2, "Alert"),
            hidden: 3,
          },
          slos: { readers: [], hidden: 2 },
        }),
      }),
    ]);

    const monitors: HTMLElement = screen.getByTestId(
      "readers-recordingRule-output-monitor",
    );

    expect(within(monitors).getAllByRole("link")).toHaveLength(
      MAX_METRIC_READERS_SHOWN,
    );
    expect(monitors).toHaveTextContent("and 2 more");
    expect(
      screen.getByTestId("readers-recordingRule-output-monitor-hidden"),
    ).toHaveTextContent("and 3 more you can't see");
    expect(
      screen.getByTestId("readers-recordingRule-output-slo-hidden"),
    ).toHaveTextContent("2 SLOs you can't see");
  });

  test("what reads the outputs of rules the reader can't see is under the rules' count, never naming them", () => {
    draw([
      group(MetricReaderListKind.RecordingRule, {
        hidden: 2,
        hiddenOutputReaders: readersOfOutput({
          monitors: {
            readers: [{ id: id(5), name: "Swap rate alert" }],
            hidden: 1,
          },
        }),
      }),
    ]);

    const hidden: HTMLElement = screen.getByTestId(
      "readers-recordingRule-hidden",
    );

    expect(hidden).toHaveTextContent("2 recording rules you can't see");

    const outputs: HTMLElement = within(hidden).getByTestId(
      "readers-recordingRule-hidden-output",
    );

    expect(outputs).toHaveTextContent(
      "These read the output metrics of the ones you can't see:",
    );
    expect(outputs.querySelector("code")).toBeNull();
    expect(
      within(outputs).getByRole("link", { name: "Swap rate alert" }),
    ).toBeInTheDocument();
    expect(
      within(outputs).getByTestId(
        "readers-recordingRule-hidden-output-monitor-hidden",
      ),
    ).toHaveTextContent("and 1 more you can't see");
  });

  test("past the depth the chain is followed: more said, never named", () => {
    draw([
      ruleGroup({
        outputReaders: readersOfOutput({ isPastDepth: true }),
      }),
      group(MetricReaderListKind.Monitor),
    ]);

    const output: HTMLElement = screen.getByTestId(
      "readers-recordingRule-output",
    );

    // No kind to list: no line that leads into one.
    expect(
      within(output).queryByTestId("readers-recordingRule-output-heading"),
    ).toBeNull();
    expect(
      within(output).getByTestId("readers-recordingRule-output-past-depth"),
    ).toHaveTextContent(
      "More read its output metric, swap_rate, further down the chain.",
    );

    cleanup();
    draw([
      group(MetricReaderListKind.RecordingRule, {
        hidden: 1,
        hiddenOutputReaders: readersOfOutput({ isPastDepth: true }),
      }),
    ]);

    expect(
      screen.getByTestId("readers-recordingRule-hidden-output-past-depth"),
    ).toHaveTextContent(
      "More read their output metrics further down the chain.",
    );
  });

  test("nothing reads its output: nothing set in under it", () => {
    draw([ruleGroup({}), ruleGroup({ outputReaders: readersOfOutput() })]);

    expect(screen.queryByTestId("readers-recordingRule-output")).toBeNull();
  });

  test("the answer's kinds as the list's groups, each under its own test id, a rule's hidden outputs with it", () => {
    const groups: Array<MetricReaderListGroup> = getOutputReaderGroups({
      readers: readersOfOutput({
        recordingRules: {
          readers: [],
          hidden: 1,
          hiddenOutputReaders: readersOfOutput({ isPastDepth: true }),
        },
      }),
      dataTestId: "x",
    });

    expect(
      groups.map((output: MetricReaderListGroup): string => {
        return output.dataTestId;
      }),
    ).toEqual(["x-monitor", "x-dashboard", "x-slo", "x-recordingRule"]);
    expect(groups[3]!.hidden).toBe(1);
    expect(groups[3]!.hiddenOutputReaders).toEqual(
      readersOfOutput({ isPastDepth: true }),
    );
    expect(groups[0]!.words.consequence).toBe("");
  });
});

/*
 * Both dialogs list their readers through this one component, and neither
 * draws a list of its own: the two cannot drift apart again.
 */
describe("both dialogs list what reads a metric through it", () => {
  const DASHBOARD: string = path.join(
    __dirname,
    "../../../../App/FeatureSet/Dashboard/src/Components",
  );

  for (const file of [
    "DataSecurity/DropMetricModal.tsx",
    "Cloud/ResourceMetrics/CloudRemoveMetricModal.tsx",
  ]) {
    test(`${file} draws MetricReadersList and no list of its own`, () => {
      const source: string = fs.readFileSync(
        path.join(DASHBOARD, file),
        "utf8",
      );

      expect(source).toContain("<MetricReadersList");
      expect(source).not.toMatch(/const (UsersOfKind|ReadersOfKind)\b/);
      expect(source).not.toContain("getWidgetTypeBadgeText");
    });
  }
});
