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
  screen,
  within,
} from "@testing-library/react";
import React from "react";
import HistoryChartBarColorPreview, {
  BAR_COLOR_PREVIEW_NOTE_TEST_ID,
  BAR_COLOR_PREVIEW_SWATCH_TEST_ID,
  BAR_COLOR_PREVIEW_TEST_ID,
  BAR_COLOR_PREVIEW_WARNING_TEST_ID,
  ComponentProps,
  PREVIEW_VISIONS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/HistoryChartBarColorPreview";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import { Green, Red, Yellow } from "../../../Types/BrandColors";
import Color, { RGB } from "../../../Types/Color";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import { parseColor } from "../../../Utils/ColorContrast";
import { ColorVision, simulateColorVision } from "../../../Utils/ColorVision";
import {
  HistoryChartBarColorRuleInput,
  NO_DATA_BAR_CLASS_NAME,
  RECOMMENDED_HISTORY_CHART_BAR_COLOR_RULES,
} from "../../../Utils/StatusPage/HistoryChartBarColors";

/*
 * Bar Color Preview (issue #486): under a status page's bar color rules on
 * its Branding page, every colour a day of the uptime history can take,
 * named, as most people see it and as people with red-green colour
 * blindness see it - and what is wrong with them. Without rules a day takes
 * its most severe status's colour, so the project's statuses are drawn, the
 * card says so, and offers the recommended rules.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

function status(name: string, color: Color, priority: number): MonitorStatus {
  const model: MonitorStatus = new MonitorStatus();
  model.name = name;
  model.color = color;
  model.priority = priority;
  return model;
}

const DEFAULT_STATUSES: Array<MonitorStatus> = [
  status("Offline", Red, 3),
  status("Operational", Green, 1),
  status("Degraded", Yellow, 2),
];

type GetListSpy = ReturnType<typeof jest.spyOn>;

function answerStatuses(statuses: Array<MonitorStatus>): GetListSpy {
  return jest.spyOn(ModelAPI, "getList").mockResolvedValue({
    data: statuses,
    count: statuses.length,
    skip: 0,
    limit: statuses.length,
  } as never) as unknown as GetListSpy;
}

async function renderPreview(
  props: Partial<ComponentProps> = {},
): Promise<void> {
  await act(async () => {
    render(
      <HistoryChartBarColorPreview
        projectId={PROJECT_ID}
        rules={null}
        {...props}
      />,
    );
  });
}

function preview(): HTMLElement {
  return screen.getByTestId(BAR_COLOR_PREVIEW_TEST_ID);
}

function columnLabels(): Array<string | null> {
  return within(preview())
    .getAllByRole("columnheader")
    .map((header: HTMLElement) => {
      return header.textContent;
    });
}

function rowLabels(): Array<string | null> {
  return within(preview())
    .getAllByRole("rowheader")
    .map((header: HTMLElement) => {
      return header.textContent;
    });
}

function swatchesOf(vision: ColorVision): Array<HTMLElement> {
  return within(preview())
    .getAllByTestId(BAR_COLOR_PREVIEW_SWATCH_TEST_ID)
    .filter((swatch: HTMLElement): boolean => {
      return swatch.getAttribute("data-vision") === vision;
    });
}

function seen(hex: string, vision: ColorVision): string {
  const rgb: RGB = parseColor(hex)!;
  return Color.rgbToColor(simulateColorVision(rgb, vision))
    .toString()
    .toLowerCase();
}

function warnings(): Array<string | null> {
  return within(preview())
    .queryAllByTestId(BAR_COLOR_PREVIEW_WARNING_TEST_ID)
    .map((warning: HTMLElement) => {
      return warning.textContent;
    });
}

function notes(): Array<string | null> {
  return within(preview())
    .queryAllByTestId(BAR_COLOR_PREVIEW_NOTE_TEST_ID)
    .map((note: HTMLElement) => {
      return note.textContent;
    });
}

beforeEach(() => {
  answerStatuses([]);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("Bar Color Preview, with the recommended rules", () => {
  const rules: Array<HistoryChartBarColorRuleInput> = [
    ...RECOMMENDED_HISTORY_CHART_BAR_COLOR_RULES,
  ];

  test("is a card that says what it shows", async () => {
    await renderPreview({ rules: rules, fallbackColor: Green });

    expect(
      screen.getByRole("heading", { name: "Bar Color Preview" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "How each kind of day looks on your status page: as most people see it, and as people with red-green color blindness see it.",
      ),
    ).toBeInTheDocument();
  });

  test("names each kind of day by its rule, then no data", async () => {
    await renderPreview({ rules: rules, fallbackColor: Green });

    expect(columnLabels()).toEqual([
      "100%",
      "99% or more",
      "95% or more",
      "0% or more",
      "No data",
    ]);
  });

  test("draws them as most people see them, then as the two kinds of red-green colour blindness see them", async () => {
    await renderPreview({ rules: rules, fallbackColor: Green });

    expect(rowLabels()).toEqual([
      "Full color vision",
      "Deuteranopia (red-green)",
      "Protanopia (red-green)",
    ]);
    expect(
      PREVIEW_VISIONS.map((row: { vision: ColorVision }) => {
        return row.vision;
      }),
    ).toEqual([
      ColorVision.Full,
      ColorVision.Deuteranopia,
      ColorVision.Protanopia,
    ]);

    const colors: Array<string> = [
      "#22c55e",
      "#fde047",
      "#c2410c",
      "#7f1d1d",
      "#9ca3af",
    ];

    for (const row of PREVIEW_VISIONS) {
      const swatches: Array<HTMLElement> = swatchesOf(row.vision);

      expect(swatches).toHaveLength(5);

      swatches.forEach((swatch: HTMLElement, index: number) => {
        expect(swatch).toHaveStyle({
          backgroundColor: seen(colors[index]!, row.vision),
        });
      });
    }
  });

  test("the no-data swatch is hatched, as the bar it names is", async () => {
    await renderPreview({ rules: rules, fallbackColor: Green });

    for (const row of PREVIEW_VISIONS) {
      const swatches: Array<HTMLElement> = swatchesOf(row.vision);

      expect(swatches[4]).toHaveClass(NO_DATA_BAR_CLASS_NAME);

      for (const swatch of swatches.slice(0, 4)) {
        expect(swatch).not.toHaveClass(NO_DATA_BAR_CLASS_NAME);
      }
    }
  });

  test("has nothing to warn about and nothing to offer", async () => {
    const onUseRecommendedRules: jest.Mock = jest.fn();

    await renderPreview({
      rules: rules,
      fallbackColor: Green,
      onUseRecommendedRules: onUseRecommendedRules as () => void,
    });

    expect(warnings()).toEqual([]);
    expect(notes()).toEqual([]);
    expect(
      screen.queryByRole("button", { name: "Use Recommended Rules" }),
    ).not.toBeInTheDocument();
    // The rules are on the page already: nothing to look up.
    expect(ModelAPI.getList).not.toHaveBeenCalled();
  });
});

describe("Bar Color Preview, with rules of the operator's own", () => {
  test("rules in the statuses' green and red are said to look alike", async () => {
    await renderPreview({
      rules: [
        { uptimePercentGreaterThanOrEqualTo: 99.9, barColor: Green },
        { uptimePercentGreaterThanOrEqualTo: 0, barColor: Red },
      ],
    });

    expect(columnLabels()).toEqual(["99.9% or more", "0% or more", "No data"]);
    expect(warnings()).toEqual([
      "99.9% or more and 0% or more look alike to people with red-green color blindness.",
    ]);
  });

  test("days below every rule are drawn in the default bar colour, and said", async () => {
    await renderPreview({
      rules: [
        { uptimePercentGreaterThanOrEqualTo: 99, barColor: "#22c55e" },
        { uptimePercentGreaterThanOrEqualTo: 95, barColor: "#fde047" },
      ],
      fallbackColor: new Color("#7f1d1d"),
    });

    expect(columnLabels()).toEqual([
      "99% or more",
      "95% or more",
      "Under 95%",
      "No data",
    ]);
    expect(swatchesOf(ColorVision.Full)[2]).toHaveStyle({
      backgroundColor: "#7f1d1d",
    });
    expect(notes()).toEqual([
      "A day under 95% uptime matches no rule, so it takes the default bar color.",
    ]);
  });

  /*
   * The trap a page with the recommended rules is one step from: a new rule
   * goes to the end of the list, under the 0% rule that matches every day.
   */
  test("a rule under the 0% one is said never to colour a day, and drawn faded", async () => {
    await renderPreview({
      rules: [
        ...RECOMMENDED_HISTORY_CHART_BAR_COLOR_RULES,
        { uptimePercentGreaterThanOrEqualTo: 99.95, barColor: "#0000ff" },
      ],
      fallbackColor: Green,
    });

    expect(warnings()).toEqual([
      "The 99.95% rule never colors a day: a rule above it already matches every day it would. Drag it higher.",
    ]);
    expect(swatchesOf(ColorVision.Full)[4]).toHaveClass("opacity-40");
    expect(swatchesOf(ColorVision.Full)[0]).not.toHaveClass("opacity-40");
  });
});

describe("Bar Color Preview, without rules", () => {
  test("says how a day is colored without rules, and draws the project's statuses, least severe first", async () => {
    const getList: GetListSpy = answerStatuses(DEFAULT_STATUSES);

    await renderPreview({ rules: [] });

    expect(getList).toHaveBeenCalledTimes(1);
    expect(
      (getList.mock.calls[0]![0] as { query: { projectId: ObjectID } }).query
        .projectId,
    ).toBe(PROJECT_ID);
    expect(notes()).toEqual([
      "Without rules, a day takes the color of the most severe monitor status it had, even if only for a minute.",
    ]);
    expect(columnLabels()).toEqual([
      "Operational",
      "Degraded",
      "Offline",
      "No data",
    ]);
  });

  // Issue #486, as the operator of every existing page will see it.
  test("warns that the Operational green and Offline red look alike", async () => {
    answerStatuses(DEFAULT_STATUSES);

    await renderPreview({ rules: [] });

    expect(warnings()).toEqual([
      "Operational and Offline look alike to people with red-green color blindness.",
    ]);
  });

  test("offers the recommended rules, once", async () => {
    answerStatuses(DEFAULT_STATUSES);
    const onUseRecommendedRules: jest.Mock = jest.fn();

    await renderPreview({
      rules: [],
      onUseRecommendedRules: onUseRecommendedRules as () => void,
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Use Recommended Rules" }),
    );

    expect(onUseRecommendedRules).toHaveBeenCalledTimes(1);
  });

  test("while the rules are being made, a second click does nothing", async () => {
    answerStatuses(DEFAULT_STATUSES);
    const onUseRecommendedRules: jest.Mock = jest.fn();

    await renderPreview({
      rules: [],
      onUseRecommendedRules: onUseRecommendedRules as () => void,
      isAddingRecommendedRules: true,
    });

    const buttons: Array<HTMLElement> = screen.queryAllByRole("button", {
      name: "Use Recommended Rules",
    });

    for (const button of buttons) {
      fireEvent.click(button);
    }

    expect(onUseRecommendedRules).not.toHaveBeenCalled();
  });

  test("statuses that cannot be read are said, and read again on retry", async () => {
    const getList: jest.SpiedFunction<typeof ModelAPI.getList> = jest
      .spyOn(ModelAPI, "getList")
      .mockRejectedValueOnce(new Error("Server Error. Please try again"))
      .mockResolvedValueOnce({
        data: DEFAULT_STATUSES,
        count: 3,
        skip: 0,
        limit: 3,
      } as never);

    await renderPreview({ rules: [] });

    expect(preview()).toHaveTextContent("Server Error. Please try again");

    await act(async () => {
      fireEvent.click(within(preview()).getByRole("button"));
    });

    expect(getList).toHaveBeenCalledTimes(2);
    expect(columnLabels()).toEqual([
      "Operational",
      "Degraded",
      "Offline",
      "No data",
    ]);
  });
});

describe("Bar Color Preview, before the rules have loaded", () => {
  test("waits, and reads nothing", async () => {
    await renderPreview({ rules: null });

    expect(
      within(preview()).queryAllByTestId(BAR_COLOR_PREVIEW_SWATCH_TEST_ID),
    ).toHaveLength(0);
    expect(ModelAPI.getList).not.toHaveBeenCalled();
  });
});
