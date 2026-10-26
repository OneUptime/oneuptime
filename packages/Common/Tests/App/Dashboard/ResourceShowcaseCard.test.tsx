import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  RenderHookResult,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import IconProp from "../../../Types/Icon/IconProp";
import Permission from "../../../Types/Permission";
import PermissionUtil from "../../../UI/Utils/Permission";
import User from "../../../UI/Utils/User";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import DatabaseServer from "../../../Models/DatabaseModels/DatabaseServer";
import VMwareVCenter from "../../../Models/DatabaseModels/VMwareVCenter";
import MessageQueue from "../../../Models/DatabaseModels/MessageQueue";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import ResourceShowcaseCard, {
  RESOURCE_SHOWCASE_ADD_BUTTON_TEST_ID,
  RESOURCE_SHOWCASE_CHART_TEST_ID,
  RESOURCE_SHOWCASE_EXAMPLE_DESCRIPTION,
  RESOURCE_SHOWCASE_EXAMPLE_LABEL,
  RESOURCE_SHOWCASE_FEATURES_TITLE,
  RESOURCE_SHOWCASE_PREVIEW_TEST_ID,
  RESOURCE_SHOWCASE_TEST_ID,
  getShowcaseAlertStatus,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceShowcase/ResourceShowcaseCard";
import {
  ResourceShowcase,
  SHOWCASE_CHART_INSET,
  ShowcaseChartPaths,
  ShowcaseFeature,
  ShowcaseRow,
  ShowcaseStatus,
  getShowcaseChartPaths,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceShowcase/ResourceShowcase";
import useShowcaseCreateForm, {
  ShowcaseCreateForm,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceShowcase/UseShowcaseCreateForm";
import {
  RESOURCE_SHOWCASE_CASES,
  ResourceShowcaseCase,
} from "./ResourceShowcaseCases";

/*
 * What an empty resource list shows under its table: the showcase
 * (Components/ResourceShowcase) - the pitch with the list's Add button, an
 * example of a connected one, and what comes with it - drawn for a made-up
 * resource and then for every resource the product has. The example's
 * chart is a pure function, held to its box for any values; the button a
 * form-added list shows is held to the table's own Create button.
 */

const SHOWCASE: ResourceShowcase = {
  icon: IconProp.Kubernetes,
  eyebrow: "Widget monitoring",
  title: "See every widget in one place",
  description: "Install the widget agent and every widget shows up on its own.",
  highlights: ["One command", "Data in about a minute", "No code changes"],
  features: [
    {
      icon: IconProp.Layers,
      title: "Every widget, mapped",
      description: "Widgets and their gears, found by the agent.",
    },
    {
      icon: IconProp.ChartBar,
      title: "Metrics",
      description: "Spin rate and wobble for each widget.",
    },
    {
      icon: IconProp.Logs,
      title: "Logs",
      description: "What each widget said, next to its metrics.",
    },
    {
      icon: IconProp.BellRinging,
      title: "Alerts",
      description: "A wobbling widget opens an incident.",
    },
    {
      icon: IconProp.FlowDiagram,
      title: "Topology",
      description: "Which widget turns which.",
    },
    {
      icon: IconProp.Sparkles,
      title: "Insights",
      description: "What changed before it broke.",
    },
  ],
  preview: {
    name: "widget-prod",
    subtitle: "Widget 2.0 · 3 gears",
    stats: [
      { label: "Gears", value: "3" },
      { label: "Spins", value: "1,204" },
      { label: "Wobble", value: "2%" },
      { label: "Heat", value: "41°C" },
    ],
    chart: { label: "Spin rate", values: [1, 3, 2, 5, 4, 6] },
    rows: [
      {
        name: "gear-a",
        detail: "Gear · front",
        status: ShowcaseStatus.Healthy,
        statusText: "Turning",
      },
      {
        name: "gear-b",
        detail: "Gear · back",
        status: ShowcaseStatus.Critical,
        statusText: "Stuck",
      },
      {
        name: "gear-c",
        detail: "Gear · side",
        status: ShowcaseStatus.Healthy,
        statusText: "Turning",
      },
    ],
    alert: {
      title: "Incident created",
      description: "gear-b stopped turning.",
    },
  },
};

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("the showcase", () => {
  test("says what the product gives: the eyebrow, the title as the heading, the pitch and the three facts", () => {
    render(<ResourceShowcaseCard showcase={SHOWCASE} />);

    const showcase: HTMLElement = screen.getByTestId(RESOURCE_SHOWCASE_TEST_ID);

    expect(showcase.tagName).toBe("SECTION");
    expect(
      within(showcase).getByRole("heading", {
        level: 2,
        name: SHOWCASE.title,
      }),
    ).toBeInTheDocument();
    // The section is named by its title.
    expect(
      screen.getByRole("region", { name: SHOWCASE.title }),
    ).toBeInTheDocument();
    expect(within(showcase).getByText(SHOWCASE.eyebrow)).toBeInTheDocument();
    expect(
      within(showcase).getByText(SHOWCASE.description),
    ).toBeInTheDocument();

    for (const highlight of SHOWCASE.highlights) {
      expect(within(showcase).getByText(highlight)).toBeInTheDocument();
    }
  });

  test("lists what comes with it under one heading, each feature with its words", () => {
    render(<ResourceShowcaseCard showcase={SHOWCASE} />);

    expect(
      screen.getByRole("heading", {
        level: 3,
        name: RESOURCE_SHOWCASE_FEATURES_TITLE,
      }),
    ).toBeInTheDocument();

    const features: Array<HTMLElement> = screen.getAllByTestId(
      "resource-showcase-feature",
    );

    expect(features).toHaveLength(SHOWCASE.features.length);
    SHOWCASE.features.forEach((feature: ShowcaseFeature, index: number) => {
      expect(features[index]).toHaveTextContent(feature.title);
      expect(features[index]).toHaveTextContent(feature.description);
    });
  });

  test("draws an example of a connected one, which says it is an example", () => {
    render(<ResourceShowcaseCard showcase={SHOWCASE} />);

    const preview: HTMLElement = screen.getByTestId(
      RESOURCE_SHOWCASE_PREVIEW_TEST_ID,
    );

    expect(preview).toHaveTextContent(RESOURCE_SHOWCASE_EXAMPLE_LABEL);
    expect(preview).toHaveTextContent(SHOWCASE.preview.name);
    expect(preview).toHaveTextContent(SHOWCASE.preview.subtitle);
    expect(preview).toHaveTextContent("Connected");
    for (const stat of SHOWCASE.preview.stats) {
      expect(preview).toHaveTextContent(stat.label);
      expect(preview).toHaveTextContent(stat.value);
    }
    expect(preview).toHaveTextContent(SHOWCASE.preview.chart.label);
    for (const row of SHOWCASE.preview.rows) {
      expect(preview).toHaveTextContent(row.name);
      expect(preview).toHaveTextContent(row.detail);
      expect(preview).toHaveTextContent(row.statusText);
    }
    expect(preview).toHaveTextContent(SHOWCASE.preview.alert!.title);
    expect(preview).toHaveTextContent(SHOWCASE.preview.alert!.description);
    // The chart is drawn: a line and the area under it.
    expect(
      within(preview)
        .getByTestId(RESOURCE_SHOWCASE_CHART_TEST_ID)
        .querySelectorAll("path"),
    ).toHaveLength(2);
  });

  test("a screen reader hears one sentence for the example, not its made-up numbers", () => {
    render(<ResourceShowcaseCard showcase={SHOWCASE} />);

    const example: HTMLElement = screen.getByRole("img", {
      name: RESOURCE_SHOWCASE_EXAMPLE_DESCRIPTION,
    });

    expect(example).toBe(screen.getByTestId(RESOURCE_SHOWCASE_PREVIEW_TEST_ID));
    // Its chart is decoration inside it.
    expect(
      within(example).getByTestId(RESOURCE_SHOWCASE_CHART_TEST_ID),
    ).toHaveAttribute("aria-hidden", "true");
  });

  test("two showcases on one page each fill their chart with a gradient of their own", () => {
    render(
      <>
        <ResourceShowcaseCard showcase={SHOWCASE} />
        <ResourceShowcaseCard showcase={SHOWCASE} />
      </>,
    );

    const ids: Array<string> = Array.from(
      document.querySelectorAll("linearGradient"),
    ).map((gradient: Element): string => {
      return gradient.getAttribute("id") || "";
    });

    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) {
      // Usable in url(#...) as it is.
      expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(document.querySelector(`path[fill="url(#${id})"]`)).not.toBeNull();
    }
  });

  test("an example without an alert draws none", () => {
    render(
      <ResourceShowcaseCard
        showcase={{
          ...SHOWCASE,
          preview: { ...SHOWCASE.preview, alert: undefined },
        }}
      />,
    );

    expect(screen.queryByText(SHOWCASE.preview.alert!.title)).toBeNull();
  });
});

describe("the showcase's Add button", () => {
  test("says what the list's button says, and opens what it opens", () => {
    const onClick: MockFunction = getJestMockFunction();

    render(
      <ResourceShowcaseCard
        showcase={SHOWCASE}
        addButton={{ title: "Add Widget", onClick: onClick }}
      />,
    );

    const button: HTMLElement = screen.getByTestId(
      RESOURCE_SHOWCASE_ADD_BUTTON_TEST_ID,
    );

    expect(button).toHaveTextContent("Add Widget");
    expect(button).toBeEnabled();

    fireEvent.click(button);

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test("a locked one is drawn locked, with why as its tooltip", () => {
    const onClick: MockFunction = getJestMockFunction();

    render(
      <ResourceShowcaseCard
        showcase={SHOWCASE}
        addButton={{
          title: "Add Widget",
          onClick: onClick,
          disabled: true,
          tooltip: "You need the Create Widget permission.",
        }}
      />,
    );

    expect(
      screen.getByTestId(RESOURCE_SHOWCASE_ADD_BUTTON_TEST_ID),
    ).toBeDisabled();
    // Hoverable, so the tooltip can say why.
    expect(
      screen.getByTestId(
        `${RESOURCE_SHOWCASE_ADD_BUTTON_TEST_ID}-disabled-wrapper`,
      ),
    ).toBeInTheDocument();
  });

  test("none where the viewer has no way to add one", () => {
    render(<ResourceShowcaseCard showcase={SHOWCASE} />);

    expect(
      screen.queryByTestId(RESOURCE_SHOWCASE_ADD_BUTTON_TEST_ID),
    ).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("the alert under the example", () => {
  const row: (status: ShowcaseStatus) => ShowcaseRow = (
    status: ShowcaseStatus,
  ): ShowcaseRow => {
    return { name: status, detail: "", status, statusText: status };
  };

  test("is red when a row is down, amber when one is only degraded", () => {
    expect(
      getShowcaseAlertStatus([
        row(ShowcaseStatus.Healthy),
        row(ShowcaseStatus.Warning),
        row(ShowcaseStatus.Critical),
      ]),
    ).toBe(ShowcaseStatus.Critical);
    expect(
      getShowcaseAlertStatus([
        row(ShowcaseStatus.Healthy),
        row(ShowcaseStatus.Warning),
      ]),
    ).toBe(ShowcaseStatus.Warning);
  });
});

describe("the example's chart", () => {
  const WIDTH: number = 320;
  const HEIGHT: number = 64;

  // Every coordinate pair of a path, in order.
  const pointsOf: (path: string) => Array<[number, number]> = (
    path: string,
  ): Array<[number, number]> => {
    const numbers: Array<number> = (path.match(/-?\d+(?:\.\d+)?/g) || []).map(
      Number,
    );
    const points: Array<[number, number]> = [];
    for (let index: number = 0; index + 1 < numbers.length; index += 2) {
      points.push([numbers[index]!, numbers[index + 1]!]);
    }
    return points;
  };

  // The points the line passes through: each segment's end.
  const throughPointsOf: (path: string) => Array<[number, number]> = (
    path: string,
  ): Array<[number, number]> => {
    const points: Array<[number, number]> = pointsOf(path);
    return points.filter((_point: [number, number], index: number): boolean => {
      // M x y, then C c1 c2 end: every third point after the first.
      return index === 0 || index % 3 === 0;
    });
  };

  test("no values draw nothing", () => {
    expect(
      getShowcaseChartPaths({ values: [], width: WIDTH, height: HEIGHT }),
    ).toEqual({ line: "", area: "" });
    expect(
      getShowcaseChartPaths({
        values: [Number.NaN, Number.POSITIVE_INFINITY],
        width: WIDTH,
        height: HEIGHT,
      }),
    ).toEqual({ line: "", area: "" });
  });

  test("the line runs across the whole box, its highest value at the top and its lowest at the bottom", () => {
    const paths: ShowcaseChartPaths = getShowcaseChartPaths({
      values: [5, 1, 9, 3],
      width: WIDTH,
      height: HEIGHT,
    });
    const through: Array<[number, number]> = throughPointsOf(paths.line);

    expect(paths.line.startsWith("M0 ")).toBe(true);
    expect(through).toHaveLength(4);
    expect(through[0]![0]).toBe(0);
    expect(through[3]![0]).toBe(WIDTH);
    // 9 is the highest, 1 the lowest.
    expect(through[2]![1]).toBe(SHOWCASE_CHART_INSET);
    expect(through[1]![1]).toBe(HEIGHT - SHOWCASE_CHART_INSET);
  });

  test("a flat line, or a single value, runs through the middle", () => {
    for (const values of [[4, 4, 4], [7]]) {
      const paths: ShowcaseChartPaths = getShowcaseChartPaths({
        values,
        width: WIDTH,
        height: HEIGHT,
      });

      for (const point of pointsOf(paths.line)) {
        expect(point[1]).toBe(HEIGHT / 2);
      }
      expect(throughPointsOf(paths.line).pop()![0]).toBe(WIDTH);
    }
  });

  test("the area is the line, closed along the bottom of the box", () => {
    const paths: ShowcaseChartPaths = getShowcaseChartPaths({
      values: [2, 6, 3],
      width: WIDTH,
      height: HEIGHT,
    });

    expect(paths.area).toBe(`${paths.line} L${WIDTH} ${HEIGHT} L0 ${HEIGHT} Z`);
  });

  test("any values stay inside the box, as finite numbers", () => {
    const random: SeededRandom = seededRandom(20261026);

    for (let run: number = 0; run < 200; run++) {
      const length: number = 1 + random(30);
      const values: Array<number> = [];
      for (let index: number = 0; index < length; index++) {
        values.push((random() - 0.5) * 10 ** random(7));
      }

      const paths: ShowcaseChartPaths = getShowcaseChartPaths({
        values,
        width: WIDTH,
        height: HEIGHT,
      });

      for (const [x, y] of pointsOf(paths.line)) {
        expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
        expect(x).toBeGreaterThanOrEqual(-WIDTH);
        expect(x).toBeLessThanOrEqual(2 * WIDTH);
        expect(y).toBeGreaterThanOrEqual(SHOWCASE_CHART_INSET);
        expect(y).toBeLessThanOrEqual(HEIGHT - SHOWCASE_CHART_INSET);
      }
      expect(paths.area).not.toContain("NaN");
    }
  });
});

describe("every resource's showcase", () => {
  test.each(RESOURCE_SHOWCASE_CASES)(
    "$label draws whole",
    (showcaseCase: ResourceShowcaseCase) => {
      const showcase: ResourceShowcase = showcaseCase.showcase;
      render(
        <ResourceShowcaseCard
          showcase={showcase}
          addButton={{ title: "Add", onClick: () => {} }}
        />,
      );

      expect(
        screen.getByRole("heading", { level: 2, name: showcase.title }),
      ).toBeInTheDocument();
      expect(screen.getAllByTestId("resource-showcase-feature")).toHaveLength(
        showcase.features.length,
      );
      expect(
        screen.getByRole("img", {
          name: RESOURCE_SHOWCASE_EXAMPLE_DESCRIPTION,
        }),
      ).toHaveTextContent(showcase.preview.name);
      expect(
        screen.getByTestId(RESOURCE_SHOWCASE_ADD_BUTTON_TEST_ID),
      ).toBeEnabled();
    },
  );
});

describe("the button of a list whose Add is its table's create form", () => {
  let held: Array<Permission> = [];

  beforeEach(() => {
    held = [];
    PermissionGate.clearPermissionPropsCache();
    jest.spyOn(User, "isMasterAdmin").mockReturnValue(false);
    jest.spyOn(PermissionUtil, "getAllPermissions").mockImplementation(() => {
      return held;
    });
    jest.spyOn(PermissionUtil, "getProjectPermissions").mockReturnValue(null);
  });

  interface HookProps {
    modelType: { new (): DatabaseServer | VMwareVCenter | MessageQueue };
    createVerb?: string | undefined;
    singularName?: string | undefined;
  }

  const renderCreateForm: (
    props: HookProps,
  ) => RenderHookResult<ShowcaseCreateForm, HookProps> = (
    props: HookProps,
  ): RenderHookResult<ShowcaseCreateForm, HookProps> => {
    return renderHook(
      (hookProps: HookProps): ShowcaseCreateForm => {
        return useShowcaseCreateForm(hookProps);
      },
      { initialProps: props },
    );
  };

  test("says what the table's Create button says", () => {
    held = [Permission.ProjectOwner];

    expect(
      renderCreateForm({ modelType: DatabaseServer }).result.current.addButton
        ?.title,
    ).toBe("Create Database");
    expect(
      renderCreateForm({ modelType: MessageQueue, singularName: "Queue" })
        .result.current.addButton?.title,
    ).toBe("Create Queue");
    expect(
      renderCreateForm({ modelType: VMwareVCenter, createVerb: "Connect" })
        .result.current.addButton?.title,
    ).toBe("Connect vCenter");
  });

  test("opens the table's form, and opens it again after it was closed", async () => {
    jest.useFakeTimers();
    held = [Permission.ProjectOwner];

    const { result } = renderCreateForm({ modelType: DatabaseServer });

    expect(result.current.showCreateForm).toBe(false);
    expect(result.current.addButton?.disabled).toBe(false);

    act(() => {
      result.current.addButton!.onClick();
    });
    await act(async () => {
      jest.runAllTimers();
    });
    expect(result.current.showCreateForm).toBe(true);

    // The table's effect runs on the change: off, then on again.
    act(() => {
      result.current.addButton!.onClick();
    });
    expect(result.current.showCreateForm).toBe(false);
    await act(async () => {
      jest.runAllTimers();
    });
    expect(result.current.showCreateForm).toBe(true);
  });

  test("is locked, saying why, for someone who may not create one", async () => {
    jest.useFakeTimers();
    held = [Permission.Public];

    const { result } = renderCreateForm({ modelType: DatabaseServer });

    expect(result.current.addButton?.disabled).toBe(true);
    expect(result.current.addButton?.tooltip).toBeTruthy();

    act(() => {
      result.current.addButton!.onClick();
    });
    await act(async () => {
      jest.runAllTimers();
    });
    expect(result.current.showCreateForm).toBe(false);
  });

  test("is not drawn before the permissions are known, as the table's own is not", () => {
    held = [];

    expect(
      renderCreateForm({ modelType: DatabaseServer }).result.current.addButton,
    ).toBeUndefined();
  });
});
