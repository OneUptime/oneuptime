import React from "react";
import { AccessibilityInfo, Animated } from "react-native";
import { render, screen, waitFor } from "@testing-library/react-native";
import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";
import SkeletonCard from "./SkeletonCard";

/*
 * The placeholder shown while a list or a detail screen is still fetching.
 *
 * Two things about it are worth pinning down. The first is that it announces
 * itself as loading rather than sitting there as a wall of grey boxes a screen
 * reader reads out as nothing at all. The second - the reason most of this
 * file exists - is that its pulse must stop for a reader who has asked the OS
 * to reduce motion. That request is not a preference about taste: the people
 * who set it are the ones for whom a looping fade is a migraine, a bout of
 * vertigo, or in the worst case a seizure. An app that asks the OS and then
 * animates anyway is worse than one that never asked, because the OS-level
 * setting is the only lever those readers have.
 *
 * The question is asynchronous, which is the whole difficulty: the answer
 * lands a tick AFTER the first render, so every test here has to let the
 * promise settle before it can assert anything about what the pulse did.
 */

type Rendered = ReturnType<typeof screen.getByLabelText>;
type Style = Record<string, unknown>;

const LOADING_LABEL: string = "Loading content";

function loadingView(): Rendered {
  return screen.getByLabelText(LOADING_LABEL);
}

function opacityOf(element: Rendered): unknown {
  return (element.props.style as Style).opacity;
}

/**
 * The grey bars that stand in for lines of text.
 *
 * They are picked out by the shape the component gives them - a fixed height
 * and a percentage width - because they carry no text and no label of their
 * own, so there is nothing else to hold on to. Counting them is the only way
 * to tell whether the `lines` prop was honoured.
 */
function textLineCount(): number {
  return screen.container.queryAll((node: Rendered) => {
    const style: Style | undefined = node.props.style as Style | undefined;

    if (!style) {
      return false;
    }

    return style.height === 12 && typeof style.width === "string";
  }).length;
}

function answerReduceMotionWith(enabled: boolean): void {
  jest
    .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
    .mockResolvedValue(enabled);
}

describe("Announcing that something is loading", () => {
  beforeEach(() => {
    answerReduceMotionWith(false);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the card variant is a labelled progress indicator", async () => {
    await render(<SkeletonCard />);

    expect(loadingView().props.accessibilityRole).toBe("progressbar");
  });

  test("the detail variant is one too", async () => {
    await render(<SkeletonCard variant="detail" />);

    expect(loadingView().props.accessibilityRole).toBe("progressbar");
  });

  test("the compact variant is one too", async () => {
    await render(<SkeletonCard variant="compact" />);

    expect(loadingView().props.accessibilityRole).toBe("progressbar");
  });

  test("each variant announces itself exactly once, not once per grey box", async () => {
    /*
     * A screen renders three of these at a time. If the announcement were on
     * every box inside one card, a reader swiping through the list would hear
     * "loading content" a dozen times before reaching anything real.
     */
    await render(<SkeletonCard variant="detail" />);

    expect(screen.getAllByLabelText(LOADING_LABEL)).toHaveLength(1);
  });
});

describe("How many lines the card stands in for", () => {
  beforeEach(() => {
    answerReduceMotionWith(false);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the default card stands in for a title and two lines of body", async () => {
    await render(<SkeletonCard />);

    expect(textLineCount()).toBe(2);
  });

  test("asking for more lines draws more of them", async () => {
    await render(<SkeletonCard lines={5} />);

    expect(textLineCount()).toBe(4);
  });

  test("asking for a single line still draws one", async () => {
    /*
     * lines - 1 is zero here, and a card with no body bars at all reads as a
     * rendering fault rather than as a placeholder. The floor is what keeps
     * that from happening.
     */
    await render(<SkeletonCard lines={1} />);

    expect(textLineCount()).toBe(1);
  });

  test("asking for none of them still draws one", async () => {
    await render(<SkeletonCard lines={0} />);

    expect(textLineCount()).toBe(1);
  });

  test("the compact variant ignores the line count, by design", async () => {
    /*
     * It is the placeholder for a one-line row. Honouring `lines` there would
     * make it taller than the card it is standing in for, and the list would
     * jump when the data arrived.
     */
    await render(<SkeletonCard variant="compact" lines={6} />);

    expect(textLineCount()).toBe(0);
  });
});

describe("The pulse and the reduce-motion setting", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("it pulses for a reader who has not asked for less motion", async () => {
    answerReduceMotionWith(false);
    const loop: jest.SpyInstance = jest.spyOn(Animated, "loop");

    await render(<SkeletonCard />);

    await waitFor(() => {
      expect(loop).toHaveBeenCalled();
    });
  });

  test("it does not pulse for a reader who has", async () => {
    /*
     * The regression this guards: the setting used to be read into a ref
     * inside an effect that had already run, so the branch that honours it
     * could never be reached and the loop started for everybody.
     */
    answerReduceMotionWith(true);
    const loop: jest.SpyInstance = jest.spyOn(Animated, "loop");

    await render(<SkeletonCard />);

    await waitFor(() => {
      expect(opacityOf(loadingView())).toBe(0.5);
    });

    expect(loop).not.toHaveBeenCalled();
  });

  test("and it holds the placeholder at a steady, readable opacity instead", async () => {
    /*
     * Not the 0.3 it starts at. Stillness is the point, but a placeholder that
     * is also barely visible is a different accessibility problem.
     */
    answerReduceMotionWith(true);

    await render(<SkeletonCard variant="detail" />);

    await waitFor(() => {
      expect(opacityOf(loadingView())).toBe(0.5);
    });
  });

  test("nothing moves until the OS has actually answered", async () => {
    /*
     * The answer arrives a tick after mount. Starting the loop before it lands
     * and stopping it afterwards would still flash motion at the reader who
     * asked for none, which for a photosensitive reader is the harm itself
     * rather than a cosmetic slip.
     */
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockReturnValue(
      new Promise<boolean>(() => {
        /* Deliberately never settles: this is the window before the answer. */
      }),
    );
    const loop: jest.SpyInstance = jest.spyOn(Animated, "loop");

    await render(<SkeletonCard />);

    expect(loop).not.toHaveBeenCalled();
  });

  test("a setting the OS refuses to report is treated as reduce motion", async () => {
    /*
     * The rejection used to be dropped on the floor - an unhandled promise
     * rejection, and a component left believing motion was fine. Erring
     * towards stillness costs a reader who wanted the shimmer nothing they
     * will notice; erring the other way costs the reader this setting exists
     * for a great deal.
     */
    jest
      .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
      .mockRejectedValue(new Error("Accessibility manager unavailable"));
    const loop: jest.SpyInstance = jest.spyOn(Animated, "loop");

    await render(<SkeletonCard />);

    await waitFor(() => {
      expect(opacityOf(loadingView())).toBe(0.5);
    });

    expect(loop).not.toHaveBeenCalled();
  });

  test("the placeholder still renders when the setting cannot be read", async () => {
    jest
      .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
      .mockRejectedValue(new Error("Accessibility manager unavailable"));

    await render(<SkeletonCard lines={3} />);

    await waitFor(() => {
      expect(textLineCount()).toBe(2);
    });
  });
});
