import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";

// The chart measures its parent, which jsdom cannot do: its frame is under test.
jest.mock("../../../../UI/Components/Charts/Line/LineChart", () => {
  return {
    __esModule: true,
    default: (): ReactElement => {
      return React.createElement("div", { "data-testid": "line-chart" });
    },
  };
});

import ChartGroup, {
  ChartType,
} from "../../../../UI/Components/Charts/ChartGroup/ChartGroup";
import { ComponentProps as LineChartProps } from "../../../../UI/Components/Charts/Line/LineChart";
import { LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME } from "../../../../UI/Utils/LineDirection";

/*
 * A chart's title is its metric's, often in English, cut short to the
 * card's line: on a Persian page it lost its start (#5453). The title and
 * the description under it now read the way they are written where the
 * page reads the other way - cut short at their own end - and still start
 * where the page's lines do.
 */

const TITLE: string = "http.server.request.duration (p99, checkout-api)";
const DESCRIPTION: string = "How long the checkout API takes to answer.";

const instances: Record<string, i18n> = {};

beforeAll(async () => {
  for (const language of ["en", "fa"]) {
    const instance: i18n = createInstance();

    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: { en: { translation: {} }, fa: { translation: {} } },
      interpolation: { escapeValue: false },
    });

    instances[language] = instance;
  }
});

afterEach(() => {
  cleanup();
});

const draw: (data: {
  language: string;
  hideCard: boolean;
  title?: string | undefined;
}) => void = (data: {
  language: string;
  hideCard: boolean;
  title?: string | undefined;
}): void => {
  render(
    <I18nextProvider i18n={instances[data.language]!}>
      <ChartGroup
        hideCard={data.hideCard}
        charts={[
          {
            id: "duration",
            title: data.title || TITLE,
            description: DESCRIPTION,
            type: ChartType.LINE,
            props: {} as unknown as LineChartProps,
          },
        ]}
      />
    </I18nextProvider>,
  );
};

describe("on a Persian page", () => {
  test("a card's English title and description read left to right, lined up as the page's lines", () => {
    draw({ language: "fa", hideCard: false });

    const title: HTMLElement = screen.getByText(TITLE);
    const description: HTMLElement = screen.getByText(DESCRIPTION);

    expect(title).toHaveAttribute("dir", "ltr");
    expect(title).toHaveClass("truncate", LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);
    expect(description).toHaveAttribute("dir", "ltr");
    expect(description).toHaveClass(
      "truncate",
      LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME,
    );
  });

  test("a chart of a stack without its card: the same", () => {
    draw({ language: "fa", hideCard: true });

    expect(screen.getByText(TITLE)).toHaveAttribute("dir", "ltr");
    expect(screen.getByText(DESCRIPTION)).toHaveAttribute("dir", "ltr");
  });

  test("a Persian title reads as the page does", () => {
    draw({ language: "fa", hideCard: false, title: "زمان پاسخ پرداخت" });

    expect(screen.getByText("زمان پاسخ پرداخت")).not.toHaveAttribute("dir");
  });
});

describe("on an English page", () => {
  test("an English title is drawn as before", () => {
    draw({ language: "en", hideCard: false });

    const title: HTMLElement = screen.getByText(TITLE);

    expect(title).not.toHaveAttribute("dir");
    expect(title).not.toHaveClass(LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);
  });
});

/*
 * Each chart's heading carried a card's id, card-details-heading: the same
 * on every chart, repeated on every page with two (#7594). Nothing pointed
 * at it, and a chart's heading has no id now.
 */
describe("two charts' headings", () => {
  test("repeat no id", () => {
    render(
      <I18nextProvider i18n={instances["en"]!}>
        <ChartGroup
          charts={[
            {
              id: "duration",
              title: TITLE,
              description: DESCRIPTION,
              type: ChartType.LINE,
              props: {} as unknown as LineChartProps,
            },
            {
              id: "errors",
              title: "http.server.errors (checkout-api)",
              description: "How often the checkout API fails.",
              type: ChartType.LINE,
              props: {} as unknown as LineChartProps,
            },
          ]}
        />
      </I18nextProvider>,
    );

    const ids: Array<string> = Array.from(
      document.querySelectorAll("[id]"),
    ).map((element: Element): string => {
      return element.id;
    });

    expect(screen.getAllByTestId("card-details-heading")).toHaveLength(2);
    expect(
      ids.filter((id: string, index: number): boolean => {
        return ids.indexOf(id) !== index;
      }),
    ).toEqual([]);
  });
});
