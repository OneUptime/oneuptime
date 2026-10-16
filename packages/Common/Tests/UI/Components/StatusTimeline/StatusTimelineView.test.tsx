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
import React, { FunctionComponent, ReactElement } from "react";
import StatusTimelineViewSwitch, {
  readStatusTimelineView,
  STATUS_TIMELINE_VIEW_STORAGE_KEY,
  StatusTimelineView,
  useStatusTimelineView,
} from "../../../../UI/Components/StatusTimeline/StatusTimelineView";
import IconProp from "../../../../Types/Icon/IconProp";
import { forgetStatusTimelineView } from "../../../Helpers/StatusTimelineViewChoice";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import {
  AA_TEXT_CONTRAST,
  contrastOfClasses,
  groundClassOf,
  PAGE_TEXT_CLASS,
  textClassOf,
  WrittenWords,
  wordsIn,
} from "../../../Helpers/TailwindContrast";
import { getGlyphOfIcon, getGlyphOfSvg } from "../MenuItemIcons";

/*
 * Timeline | Table: how a status timeline page shows its history.
 *
 * Every page opens on the timeline. The table it used to be is one click
 * away, for what only a table does (selecting rows to delete together,
 * filters, saved views, an export). The choice is the reader's, for every
 * status timeline - someone who works in the table works in it everywhere -
 * and it is remembered in their browser; when the browser will not store
 * it (a private window, blocked site data), it holds for the session.
 */

// A status timeline page: the switch in its header, and what it shows.
const Page: FunctionComponent<{ name: string }> = (props: {
  name: string;
}): ReactElement => {
  const [view, setView] = useStatusTimelineView();

  return (
    <section aria-label={props.name}>
      <StatusTimelineViewSwitch value={view} onChange={setView} />
      <p data-testid="shows">{view}</p>
    </section>
  );
};

const pageNamed: (name: string) => HTMLElement = (
  name: string,
): HTMLElement => {
  return screen.getByRole("region", { name: name });
};

const shownOn: (name: string) => string | null = (
  name: string,
): string | null => {
  return within(pageNamed(name)).getByTestId("shows").textContent;
};

const pick: (pageName: string, view: "Timeline" | "Table") => void = (
  pageName: string,
  view: "Timeline" | "Table",
): void => {
  act(() => {
    fireEvent.click(
      within(pageNamed(pageName)).getByRole("button", { name: view }),
    );
  });
};

// Storage's index signature hides its methods from jest.spyOn's typing.
interface StorageMethods {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

const stored: () => string | null = (): string | null => {
  return window.localStorage.getItem(STATUS_TIMELINE_VIEW_STORAGE_KEY);
};

beforeEach(() => {
  forgetStatusTimelineView();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  forgetStatusTimelineView();
});

describe("which view a page opens on", () => {
  test("the timeline, when the reader has not chosen", () => {
    render(<Page name="Monitor" />);

    expect(shownOn("Monitor")).toBe(StatusTimelineView.Timeline);
    expect(
      within(pageNamed("Monitor")).getByRole("button", { name: "Timeline" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      within(pageNamed("Monitor")).getByRole("button", { name: "Table" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  test("the reader's choice, on every status timeline: the next page opens on it", () => {
    const { unmount } = render(<Page name="Monitor" />);

    pick("Monitor", "Table");
    unmount();

    render(<Page name="Incident" />);

    expect(shownOn("Incident")).toBe(StatusTimelineView.Table);
  });

  test("a stored value this version does not know: the timeline", () => {
    window.localStorage.setItem(STATUS_TIMELINE_VIEW_STORAGE_KEY, "chart");

    render(<Page name="Monitor" />);

    expect(shownOn("Monitor")).toBe(StatusTimelineView.Timeline);
  });
});

describe("switching", () => {
  test("Table shows the table and remembers it; Timeline brings the timeline back", () => {
    render(<Page name="Monitor" />);

    pick("Monitor", "Table");

    expect(shownOn("Monitor")).toBe(StatusTimelineView.Table);
    expect(stored()).toBe(StatusTimelineView.Table);
    expect(
      within(pageNamed("Monitor")).getByRole("button", { name: "Table" }),
    ).toHaveAttribute("aria-pressed", "true");

    pick("Monitor", "Timeline");

    expect(shownOn("Monitor")).toBe(StatusTimelineView.Timeline);
    expect(stored()).toBe(StatusTimelineView.Timeline);
  });

  test("two status timelines on screen follow one choice", () => {
    render(
      <>
        <Page name="Monitor" />
        <Page name="Site" />
      </>,
    );

    pick("Monitor", "Table");

    expect(shownOn("Site")).toBe(StatusTimelineView.Table);
  });

  test("the view already shown: clicking it changes nothing", () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      <StatusTimelineViewSwitch
        value={StatusTimelineView.Timeline}
        onChange={onChange as unknown as (view: StatusTimelineView) => void}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Timeline" }));
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Table" }));
    expect(onChange).toHaveBeenCalledWith(StatusTimelineView.Table);
  });
});

describe("a browser that will not store the choice", () => {
  test("writes refused: the choice still holds for this session", () => {
    jest
      .spyOn(Storage.prototype as StorageMethods, "setItem")
      .mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });

    const { unmount } = render(<Page name="Monitor" />);

    pick("Monitor", "Table");

    expect(shownOn("Monitor")).toBe(StatusTimelineView.Table);

    unmount();
    render(<Page name="Incident" />);

    expect(shownOn("Incident")).toBe(StatusTimelineView.Table);
  });

  test("reads refused: the timeline, or this session's choice", () => {
    jest
      .spyOn(Storage.prototype as StorageMethods, "getItem")
      .mockImplementation(() => {
        throw new Error("SecurityError");
      });

    expect(readStatusTimelineView()).toBe(StatusTimelineView.Timeline);

    render(<Page name="Monitor" />);
    pick("Monitor", "Table");

    expect(readStatusTimelineView()).toBe(StatusTimelineView.Table);
  });
});

describe("for a screen reader and a keyboard", () => {
  test("one named group of two real buttons, the shown view pressed", () => {
    render(<Page name="Monitor" />);

    const group: HTMLElement = within(pageNamed("Monitor")).getByRole("group", {
      name: "Show the history as",
    });
    const buttons: Array<HTMLElement> = within(group).getAllByRole("button");

    expect(
      buttons.map((button: HTMLElement): string | null => {
        return button.textContent;
      }),
    ).toEqual(["Timeline", "Table"]);

    for (const button of buttons) {
      // A <button type="button">: Tab reaches it, Enter and Space press it.
      expect(button.tagName).toBe("BUTTON");
      expect(button).toHaveAttribute("type", "button");
      expect(button).not.toHaveAttribute("tabindex", "-1");
    }
  });

  test("the icons are not read out: only the view's name is", () => {
    render(<Page name="Monitor" />);

    expect(
      within(pageNamed("Monitor")).getByRole("button", { name: "Table" }),
    ).toHaveAccessibleName("Table");
  });
});

/*
 * Each option shows a picture of its view: the timeline's stretches of time
 * stepping along (IconProp.Timeline), the table's grid (TableCells). The
 * Timeline option used to show Heroicons' chart-bar - three upright bars, a
 * bar chart, which the timeline is not ("Timeline icon should be better and
 * more relevant", the maintainer).
 */
describe("each view's icon", () => {
  // What WCAG 2.1 (1.4.11) asks of a graphic that helps say what a control is.
  const NON_TEXT_CONTRAST: number = 3;

  const VIEWS: Array<"Timeline" | "Table"> = ["Timeline", "Table"];

  const svgOf: (view: "Timeline" | "Table") => SVGSVGElement = (
    view: "Timeline" | "Table",
  ): SVGSVGElement => {
    const svg: SVGSVGElement | null = screen
      .getByRole("button", { name: view })
      .querySelector("svg");

    expect(svg).not.toBeNull();

    return svg as SVGSVGElement;
  };

  const glyphOf: (view: "Timeline" | "Table") => string = (
    view: "Timeline" | "Table",
  ): string => {
    return getGlyphOfSvg(svgOf(view));
  };

  test.each([StatusTimelineView.Timeline, StatusTimelineView.Table])(
    "with %s shown, Timeline draws the timeline's icon and Table the table's grid",
    (view: StatusTimelineView) => {
      render(<StatusTimelineViewSwitch value={view} onChange={() => {}} />);

      expect(glyphOf("Timeline")).toBe(getGlyphOfIcon(IconProp.Timeline));
      expect(glyphOf("Table")).toBe(getGlyphOfIcon(IconProp.TableCells));
    },
  );

  test("Timeline is not drawn as a bar chart any more", () => {
    render(
      <StatusTimelineViewSwitch
        value={StatusTimelineView.Timeline}
        onChange={() => {}}
      />,
    );

    expect(glyphOf("Timeline")).not.toBe(getGlyphOfIcon(IconProp.ChartBar));
  });

  test("the two views look different at a glance: neither draws the other's icon", () => {
    render(
      <StatusTimelineViewSwitch
        value={StatusTimelineView.Timeline}
        onChange={() => {}}
      />,
    );

    expect(glyphOf("Timeline")).not.toBe("");
    expect(glyphOf("Table")).not.toBe("");
    expect(glyphOf("Timeline")).not.toBe(glyphOf("Table"));
  });

  test("switching views keeps each icon on its view; the shown view's turns indigo and the other takes its button's grey", () => {
    render(<Page name="Monitor" />);

    expect(svgOf("Timeline")).toHaveClass("text-indigo-600");
    expect(svgOf("Table")).not.toHaveClass("text-indigo-600");

    pick("Monitor", "Table");

    expect(glyphOf("Timeline")).toBe(getGlyphOfIcon(IconProp.Timeline));
    expect(glyphOf("Table")).toBe(getGlyphOfIcon(IconProp.TableCells));
    expect(svgOf("Table")).toHaveClass("text-indigo-600");
    expect(svgOf("Timeline")).not.toHaveClass("text-indigo-600");
    expect(textClassOf(svgOf("Timeline"))).toBe("text-gray-600");
  });

  test("each icon is 16px, ahead of its view's name, and left out of the name a screen reader hears", () => {
    render(
      <StatusTimelineViewSwitch
        value={StatusTimelineView.Timeline}
        onChange={() => {}}
      />,
    );

    for (const view of VIEWS) {
      const button: HTMLElement = screen.getByRole("button", { name: view });
      const svg: SVGSVGElement = svgOf(view);

      expect(svg).toHaveClass("h-4", "w-4");
      expect(svg).toHaveAttribute("aria-hidden", "true");
      // The icon comes first, then the name.
      expect(button.firstElementChild?.contains(svg)).toBe(true);
      expect(button).toHaveTextContent(view);
      expect(button).toHaveAccessibleName(view);
    }
  });

  test.each([StatusTimelineView.Timeline, StatusTimelineView.Table])(
    "with %s shown, both icons stand out from the switch at 3:1 or more (WCAG non-text contrast)",
    (view: StatusTimelineView) => {
      render(<StatusTimelineViewSwitch value={view} onChange={() => {}} />);

      for (const option of VIEWS) {
        const svg: SVGSVGElement = svgOf(option);
        const contrast: number = contrastOfClasses(
          textClassOf(svg, PAGE_TEXT_CLASS),
          groundClassOf(svg),
        );

        expect({
          option: option,
          standsOut: contrast >= NON_TEXT_CONTRAST,
        }).toEqual({ option: option, standsOut: true });
      }
    },
  );
});

describe("its words can be read", () => {
  test.each([StatusTimelineView.Timeline, StatusTimelineView.Table])(
    "with %s shown, each view's name reads at AA on the switch",
    (view: StatusTimelineView) => {
      render(<StatusTimelineViewSwitch value={view} onChange={() => {}} />);

      const words: Array<WrittenWords> = wordsIn(
        screen.getByTestId("status-timeline-view-switch"),
        PAGE_TEXT_CLASS,
      );

      expect(
        words.map((word: WrittenWords): string => {
          return word.words;
        }),
      ).toEqual(["Timeline", "Table"]);

      for (const word of words) {
        expect({
          words: word.words,
          isReadable: word.contrast >= AA_TEXT_CONTRAST,
        }).toEqual({ words: word.words, isReadable: true });
      }
    },
  );
});
