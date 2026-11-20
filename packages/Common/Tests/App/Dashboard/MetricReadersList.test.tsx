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
  getMetricReaderRoute,
  isMetricReaderGroupShown,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Readers/MetricReadersList";
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
    // The dashboard is the link; its widgets are named, not linked again.
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
