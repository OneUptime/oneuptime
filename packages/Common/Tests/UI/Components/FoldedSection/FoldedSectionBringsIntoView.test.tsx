import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import React, { ReactElement, useState } from "react";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import FoldedSection, {
  FOLDED_SECTION_TEST_ID,
} from "../../../../UI/Components/FoldedSection/FoldedSection";
import { MORE_FIELDS_SECTION_TITLE } from "../../../../UI/Components/FoldedSection/FoldedSectionTitles";

/*
 * A FOLD THE READER OPENS COMES INTO VIEW.
 *
 * The maintainer's follow-ups: "A folded section does not scroll a revealed
 * field into view". More fields sits at the bottom of a dialog: opening it
 * drew its fields below the dialog's edge, and the press seemed to do
 * nothing. Opened by the reader, the fold is brought into view
 * (Utils/BringIntoView) by as little as it takes - block "nearest" - so a
 * fold already in sight does not move and one taller than the view keeps
 * its header at the top. Folding it, or a fold opened by the page itself,
 * moves nothing. Under prefers-reduced-motion it jumps instead of gliding.
 */

interface ScrollCall {
  element: Element;
  options: ScrollIntoViewOptions | undefined;
}

let calls: Array<ScrollCall> = [];
let reducedMotion: boolean = false;
const originalScrollIntoView: unknown = Element.prototype.scrollIntoView;
const originalMatchMedia: unknown = window.matchMedia;

beforeEach(() => {
  calls = [];
  reducedMotion = false;
  Element.prototype.scrollIntoView = function (
    this: Element,
    options?: boolean | ScrollIntoViewOptions,
  ): void {
    calls.push({
      element: this,
      options: typeof options === "object" ? options : undefined,
    });
  };
  window.matchMedia = ((query: string): MediaQueryList => {
    return {
      matches: query.includes("prefers-reduced-motion") && reducedMotion,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => {
        return false;
      },
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
});

afterEach(() => {
  Element.prototype.scrollIntoView =
    originalScrollIntoView as typeof Element.prototype.scrollIntoView;
  window.matchMedia = originalMatchMedia as typeof window.matchMedia;
  cleanup();
});

function header(): HTMLElement {
  return screen.getByTestId("folded-section-header");
}

async function press(): Promise<void> {
  await act(async () => {
    fireEvent.click(header());
  });
}

describe.each(["line", "card"])("a %s fold", (variant: string) => {
  const title: string =
    variant === "line" ? MORE_FIELDS_SECTION_TITLE : "Subscriber Notifications";

  test("opened by the reader, is brought into view - the whole fold, by as little as it takes", async () => {
    render(
      <FoldedSection title={title}>
        <input data-testid="inside" />
      </FoldedSection>,
    );

    await press();

    expect(header()).toHaveAttribute("aria-expanded", "true");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.element).toBe(screen.getByTestId(FOLDED_SECTION_TEST_ID));
    expect(calls[0]!.options).toEqual({
      block: "nearest",
      inline: "nearest",
      behavior: "smooth",
    });
  });

  test("folded again by the reader, moves nothing", async () => {
    render(
      <FoldedSection title={title}>
        <input data-testid="inside" />
      </FoldedSection>,
    );

    await press();
    calls = [];
    await press();

    expect(header()).toHaveAttribute("aria-expanded", "false");
    expect(calls).toEqual([]);
  });

  test("drawn open, or opened by the page, moves nothing", async () => {
    const Controlled: () => ReactElement = (): ReactElement => {
      const [isCollapsed, setIsCollapsed] = useState<boolean>(true);

      return (
        <>
          <button
            type="button"
            onClick={() => {
              setIsCollapsed(false);
            }}
          >
            Open it for the reader
          </button>
          <FoldedSection
            title={title}
            isCollapsed={isCollapsed}
            onToggle={setIsCollapsed}
          >
            <input data-testid="inside" />
          </FoldedSection>
        </>
      );
    };

    render(<Controlled />);
    expect(calls).toEqual([]);

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Open it for the reader" }),
      );
    });

    expect(header()).toHaveAttribute("aria-expanded", "true");
    expect(calls).toEqual([]);
  });

  test("controlled, a press is drawn in the same render the host answers it in, and brought into view", async () => {
    const Controlled: () => ReactElement = (): ReactElement => {
      const [isCollapsed, setIsCollapsed] = useState<boolean>(true);

      return (
        <FoldedSection
          title={title}
          isCollapsed={isCollapsed}
          onToggle={setIsCollapsed}
        >
          <input data-testid="inside" />
        </FoldedSection>
      );
    };

    render(<Controlled />);
    await press();

    expect(header()).toHaveAttribute("aria-expanded", "true");
    expect(calls).toHaveLength(1);
  });

  test("a reader who asks for less motion is jumped there, not glided", async () => {
    reducedMotion = true;

    render(
      <FoldedSection title={title}>
        <input data-testid="inside" />
      </FoldedSection>,
    );

    await press();

    expect(calls[0]!.options).toMatchObject({ behavior: "auto" });
  });
});

describe("a fold whose host keeps it shut", () => {
  test("is drawn as the host says, whatever was pressed", async () => {
    render(
      <FoldedSection title="Locked" isCollapsed={true} onToggle={() => {}}>
        <input data-testid="inside" />
      </FoldedSection>,
    );

    await press();

    expect(header()).toHaveAttribute("aria-expanded", "false");
    expect(calls).toEqual([]);
  });
});
