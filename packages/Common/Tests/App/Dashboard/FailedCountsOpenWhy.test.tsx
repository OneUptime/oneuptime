/**
 * @timezone UTC
 */
import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import i18next from "i18next";
import * as React from "react";
import { initReactI18next } from "react-i18next";

/*
 * A COUNT OF SOMETHING WRONG OPENS WHAT IT COUNTS, WHEREVER IT IS DRAWN.
 *
 * #9537 made a resource hero's counts open exactly what failed and why
 * (ResourceAttentionPill). The same counts sat in places that could not
 * take a press (#9594, #9595): an infrastructure tile's "1 down"
 * (GoldenMetricTile) and a stacked bar's "Failed (3)" (StackedProgressBar).
 * Each now opens the list - the tile through a pill under its value, the
 * bar through its legend entry - rendered for real here.
 */

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      navigate: (): void => {},
      isOnThisPage: (): boolean => {
        return false;
      },
      getQueryStringByName: (): null => {
        return null;
      },
    },
  };
});

import Route from "../../../Types/API/Route";
import IconProp from "../../../Types/Icon/IconProp";
import StackedProgressBar from "../../../UI/Components/StackedProgressBar/StackedProgressBar";
import GoldenMetricTile from "../../../../App/FeatureSet/Dashboard/src/Components/Infrastructure/GoldenMetricTile";
import {
  ResourceAttentionItem,
  ResourceAttentionSeverity,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourceAttention";

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {},
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterEach(() => {
  cleanup();
});

function downOsd(): ResourceAttentionItem {
  return {
    key: "Osd:osd.4",
    kind: "OSD",
    icon: IconProp.Disc,
    name: "osd.4",
    severity: ResourceAttentionSeverity.Critical,
    reasons: [{ text: "Down" }],
    route: new Route("/dashboard/ceph/osds/osd.4"),
  };
}

describe("an infrastructure tile's count of something wrong", () => {
  test("is a pill under the value that opens exactly those parts, each a step from its page", () => {
    render(
      <GoldenMetricTile
        title="OSDs Up"
        icon={IconProp.Disc}
        iconColor="emerald"
        value="5/6"
        sublabel="up and in"
        percent={83}
        description="OSDs that are up, of every OSD in the cluster."
        attention={{
          testId: "osds-down",
          label: "1 down",
          tone: "danger",
          hint: "Show which OSDs and why",
          dialog: {
            title: "1 OSD down",
            items: [downOsd()],
            emptyMessage: "Every OSD is up now.",
            showKind: false,
          },
        }}
      />,
    );

    // The value and the line under it still read as before.
    expect(screen.getByTestId("golden-metric-tile-value")).toHaveTextContent(
      "5/6",
    );
    expect(screen.getByTestId("golden-metric-tile-sublabel")).toHaveTextContent(
      "up and in",
    );

    const holder: HTMLElement = screen.getByTestId(
      "golden-metric-tile-attention",
    );
    const pill: HTMLElement = within(holder).getByTestId("osds-down");
    expect(pill.tagName).toBe("BUTTON");
    expect(pill).toHaveAttribute("data-tone", "danger");
    expect(pill).toHaveAttribute("aria-haspopup", "dialog");
    expect(pill).toHaveTextContent("1 down");

    fireEvent.click(pill);

    expect(screen.getByText("1 OSD down")).toBeInTheDocument();
    const row: HTMLElement = screen.getByTestId("osds-down-dialog-item");
    expect(within(row).getByTestId("osds-down-dialog-name")).toHaveTextContent(
      "osd.4",
    );
    expect(within(row).getByTestId("osds-down-dialog-view")).toHaveAttribute(
      "href",
      "/dashboard/ceph/osds/osd.4",
    );
  });

  test("the tile itself stays a tile: its (i) and the pill are the only controls, side by side", () => {
    const { container } = render(
      <GoldenMetricTile
        title="OSDs Up"
        icon={IconProp.Disc}
        iconColor="emerald"
        value="5/6"
        description="OSDs that are up."
        attention={{
          testId: "osds-down",
          label: "1 down",
          tone: "danger",
          hint: "Show which OSDs and why",
          dialog: {
            title: "1 OSD down",
            items: [downOsd()],
            emptyMessage: "Every OSD is up now.",
          },
        }}
      />,
    );

    const buttons: Array<HTMLButtonElement> = Array.from(
      container.querySelectorAll("button"),
    );
    // Neither button holds the other.
    for (const button of buttons) {
      expect(button.querySelector("button")).toBeNull();
    }
    expect(
      buttons.some((button: HTMLButtonElement): boolean => {
        return button.getAttribute("data-testid") === "osds-down";
      }),
    ).toBe(true);
  });

  test("a tile with nothing wrong to count has no pill", () => {
    render(
      <GoldenMetricTile
        title="OSDs Up"
        icon={IconProp.Disc}
        iconColor="emerald"
        value="6/6"
      />,
    );

    expect(screen.queryByTestId("golden-metric-tile-attention")).toBeNull();
  });
});

describe("a stacked bar's count of something wrong", () => {
  test("its legend entry is a button that opens what it counts; a fine count stays words", () => {
    const opened: Array<string> = [];

    render(
      <StackedProgressBar
        totalValue={10}
        segments={[
          { value: 6, color: "bg-emerald-500", label: "Running" },
          {
            value: 3,
            color: "bg-red-500",
            label: "Failed",
            onClick: () => {
              opened.push("failed");
            },
            clickHint: "Show which pods and why",
          },
          {
            value: 1,
            color: "bg-amber-500",
            label: "Pending",
            onClick: () => {
              opened.push("pending");
            },
          },
          // A count of none is not drawn at all.
          {
            value: 0,
            color: "bg-rose-700",
            label: "Can't run",
            onClick: () => {
              opened.push("cannotRun");
            },
          },
        ]}
      />,
    );

    const buttons: Array<HTMLElement> = screen.getAllByTestId(
      "stacked-progress-bar-legend-button",
    );
    expect(
      buttons.map((button: HTMLElement): string => {
        return button.textContent || "";
      }),
    ).toEqual(["Failed (3) Show which pods and why", "Pending (1)"]);

    const failed: HTMLElement = buttons[0]!;
    expect(failed.tagName).toBe("BUTTON");
    expect(failed).toHaveAttribute("type", "button");
    expect(failed).toHaveAttribute("aria-haspopup", "dialog");
    // What a press shows, on hover too.
    expect(failed).toHaveAttribute("title", "Show which pods and why");

    fireEvent.click(failed);
    fireEvent.click(buttons[1]!);
    expect(opened).toEqual(["failed", "pending"]);

    // Running is fine: a word and its count, nothing to press.
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByText("Running").closest("button")).toBeNull();
  });

  test("the bar's slivers stay a picture: only the legend is pressed", () => {
    const { container } = render(
      <StackedProgressBar
        totalValue={4}
        segments={[
          {
            value: 4,
            color: "bg-red-500",
            label: "Failed",
            onClick: () => {},
          },
        ]}
      />,
    );

    const bar: HTMLElement = container.querySelector(
      '[role="progressbar"]',
    ) as HTMLElement;
    expect(bar.querySelector("button")).toBeNull();
    expect(container.querySelectorAll("button")).toHaveLength(1);
  });

  test("without a legend there is nothing to press", () => {
    const { container } = render(
      <StackedProgressBar
        showLegend={false}
        segments={[
          {
            value: 4,
            color: "bg-red-500",
            label: "Failed",
            onClick: () => {},
          },
        ]}
      />,
    );

    expect(container.querySelectorAll("button")).toHaveLength(0);
  });
});
