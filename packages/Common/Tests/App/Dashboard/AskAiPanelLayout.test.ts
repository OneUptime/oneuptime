import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import RememberedChoice from "../../../UI/Utils/RememberedChoice";
import { seededRandom } from "../../Helpers/SeededRandom";
import {
  ASK_AI_DOCK_MIN_WINDOW_WIDTH,
  ASK_AI_PAGE_MIN_WIDTH,
  ASK_AI_PANEL_DEFAULT_WIDTH,
  ASK_AI_PANEL_MAX_WIDTH,
  ASK_AI_PANEL_MIN_WIDTH,
  ASK_AI_PANEL_WIDTH_KEY,
  canDockAskAi,
  clampAskAiPanelWidth,
  forgetAskAiPanelWidth,
  getAskAiPanelMaxWidth,
  readAskAiPanelWidth,
  rememberAskAiPanelWidth,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/AskAiPanelLayout";

/*
 * Where Ask AI sits and how wide it is (issue #5597): docked beside the page
 * on a window with room for both, and a sheet on one without; as wide as the
 * person dragged it, and never so wide that the page has no room left.
 */

describe("whether the window has room for both", () => {
  test.each([
    [390, false],
    [768, false],
    [1023, false],
    [1024, true],
    [1280, true],
    [1920, true],
  ])("a window %i wide docks: %s", (width: number, docks: boolean) => {
    expect(canDockAskAi(width)).toBe(docks);
  });

  test("where it docks, the page keeps its room with the panel at its narrowest", () => {
    expect(
      ASK_AI_DOCK_MIN_WINDOW_WIDTH - ASK_AI_PANEL_MIN_WIDTH,
    ).toBeGreaterThanOrEqual(ASK_AI_PAGE_MIN_WIDTH);
  });

  test("the width it opens at can be had on a laptop, with room to spare", () => {
    expect(clampAskAiPanelWidth(ASK_AI_PANEL_DEFAULT_WIDTH, 1280)).toBe(
      ASK_AI_PANEL_DEFAULT_WIDTH,
    );
    expect(1280 - ASK_AI_PANEL_DEFAULT_WIDTH).toBeGreaterThan(
      ASK_AI_PAGE_MIN_WIDTH,
    );
  });
});

describe("how wide the panel can be", () => {
  test("as wide as asked, when the window has room", () => {
    expect(clampAskAiPanelWidth(500, 1600)).toBe(500);
  });

  test("never narrower than its composer and a table can use", () => {
    expect(clampAskAiPanelWidth(10, 1600)).toBe(ASK_AI_PANEL_MIN_WIDTH);
    expect(clampAskAiPanelWidth(-100, 1600)).toBe(ASK_AI_PANEL_MIN_WIDTH);
  });

  test("never wider than it reads well, however wide the window", () => {
    expect(clampAskAiPanelWidth(5000, 3840)).toBe(ASK_AI_PANEL_MAX_WIDTH);
    expect(getAskAiPanelMaxWidth(3840)).toBe(ASK_AI_PANEL_MAX_WIDTH);
  });

  test("the page keeps its room: a narrow window narrows the panel", () => {
    // 1024 - 640: the width it opens at does not fit here.
    expect(getAskAiPanelMaxWidth(1024)).toBe(384);
    expect(clampAskAiPanelWidth(ASK_AI_PANEL_DEFAULT_WIDTH, 1024)).toBe(384);
    expect(clampAskAiPanelWidth(700, 1280)).toBe(640);
  });

  test("a whole number of pixels, so the page and the panel meet exactly", () => {
    expect(clampAskAiPanelWidth(433.6, 1600)).toBe(434);
  });

  test("whatever is asked, on any window that docks: the panel fits and the page keeps its room", () => {
    const random: (limit?: number) => number = seededRandom(5597);

    for (let run: number = 0; run < 500; run++) {
      const windowWidth: number = ASK_AI_DOCK_MIN_WINDOW_WIDTH + random(3000);
      const asked: number = random(6000) - 1000;
      const width: number = clampAskAiPanelWidth(asked, windowWidth);

      expect({
        windowWidth,
        asked,
        fits: width >= ASK_AI_PANEL_MIN_WIDTH,
      }).toEqual({ windowWidth, asked, fits: true });
      expect({
        windowWidth,
        asked,
        fits: width <= ASK_AI_PANEL_MAX_WIDTH,
      }).toEqual({ windowWidth, asked, fits: true });
      expect({
        windowWidth,
        asked,
        roomLeft: windowWidth - width >= ASK_AI_PAGE_MIN_WIDTH,
      }).toEqual({ windowWidth, asked, roomLeft: true });
    }
  });
});

describe("the width this browser keeps", () => {
  beforeEach(() => {
    window.localStorage.clear();
    RememberedChoice.clearHeldForThisPage();
  });

  afterEach(() => {
    window.localStorage.clear();
    RememberedChoice.clearHeldForThisPage();
  });

  test("none kept: the width it opens at", () => {
    expect(readAskAiPanelWidth()).toBe(ASK_AI_PANEL_DEFAULT_WIDTH);
  });

  test("a width dragged to is the width it opens at next time", () => {
    rememberAskAiPanelWidth(612);

    expect(window.localStorage.getItem(ASK_AI_PANEL_WIDTH_KEY)).toBe("612");
    expect(readAskAiPanelWidth()).toBe(612);
  });

  test("kept as a whole number", () => {
    rememberAskAiPanelWidth(612.4);

    expect(readAskAiPanelWidth()).toBe(612);
  });

  test("forgotten, it is back at the default", () => {
    rememberAskAiPanelWidth(612);
    forgetAskAiPanelWidth();

    expect(window.localStorage.getItem(ASK_AI_PANEL_WIDTH_KEY)).toBeNull();
    expect(readAskAiPanelWidth()).toBe(ASK_AI_PANEL_DEFAULT_WIDTH);
  });

  test.each(["wide", "12px", "-400", "4.5", "", "1e3", "999999", "NaN"])(
    "%j, which no version wrote, reads as no choice",
    (value: string) => {
      window.localStorage.setItem(ASK_AI_PANEL_WIDTH_KEY, value);

      expect(readAskAiPanelWidth()).toBe(ASK_AI_PANEL_DEFAULT_WIDTH);
    },
  );

  test("a browser that keeps nothing still holds the width while the page is open", () => {
    const setItem: Storage["setItem"] = Storage.prototype.setItem;

    Storage.prototype.setItem = (): void => {
      throw new Error("The quota is full.");
    };

    try {
      rememberAskAiPanelWidth(555);

      expect(readAskAiPanelWidth()).toBe(555);
    } finally {
      Storage.prototype.setItem = setItem;
    }
  });
});
