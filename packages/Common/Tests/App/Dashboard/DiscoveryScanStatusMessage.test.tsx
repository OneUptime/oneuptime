import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  RenderResult,
  screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Mock, SpyInstance } from "jest-mock";
import React, { act } from "react";
import DiscoveryScanStatusMessage, {
  COLLAPSED_LINE_COUNT,
  isMessageTallerThanPreview,
  MessageBoxMetrics,
  readMessageBoxMetrics,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveryScanStatusMessage";
import {
  installTextClampLayout,
  LINE_HEIGHT_IN_PIXELS,
  TextClampLayout,
} from "./TextClampLayoutHarness";

/*
 * OneUptime issue #3842: on Network > Discovery Scans, "Show details" and
 * "Hide details" showed the same information. The toggle was always there,
 * the collapsed state was the message clamped to two lines, and the expanded
 * state was the same message in full — so for any message that fits in two
 * lines, which the probe's summary of a healthy sweep does, the two states
 * were identical and clicking only moved the link.
 *
 * These tests hold the fix: the message is rendered once; the toggle exists
 * only when the two-line preview really cuts it short; and when it exists the
 * two states differ.
 */

// The message from the report, verbatim.
const REPORTED_MESSAGE: string =
  "Swept 15360 hosts: 2906 answered ICMP ping, 2888 answered SNMP.";

// The other row in the report's recording.
const REPORTED_ROUTER_MESSAGE: string =
  "Swept 2560 hosts: 917 answered ICMP ping, 460 answered SNMP.";

// A summary carrying diagnostics — the shape the preview has to cut short.
const LONG_MESSAGE: string =
  "Swept 254 hosts: 41 answered ICMP ping, 3 answered SNMP. 12 host(s) replied with an SNMP error rather than silence; most common: Authentication failure (incorrect password, community or key). Answered by credentials: Core v3 on 3. No host answered: Legacy v2c community.";

// A running sweep's message, which a poll replaces every ten seconds.
const PROGRESS_MESSAGE: string =
  "Scan in progress: 6,144 of 15,360 addresses swept so far. Checking SNMP credentials (176 of 256). 3 answered ICMP ping, 2 answered SNMP. These results update as the sweep continues.";

const SCAN_LABEL: string =
  "Switch Discovery - WBHQ Unit/Core Switches (10.240-249.0-255.220-225)";

/*
 * The width the reporter's recording was taken at: "Swept 15360 hosts: 2906
 * answered ICMP ping, 2888" is the first of its two lines.
 */
const DESKTOP_CHARACTERS_PER_LINE: number = 48;

let layout: TextClampLayout | null = null;

function installLayout(
  charactersPerLine: number = DESKTOP_CHARACTERS_PER_LINE,
  withResizeObserver: boolean = true,
): TextClampLayout {
  layout = installTextClampLayout({
    charactersPerLine: charactersPerLine,
    withResizeObserver: withResizeObserver,
  });
  return layout;
}

afterEach(() => {
  cleanup();
  layout?.restore();
  layout = null;
  jest.restoreAllMocks();
});

function renderMessage(
  message: string,
  scanLabel: string = SCAN_LABEL,
): RenderResult {
  return render(
    <DiscoveryScanStatusMessage message={message} scanLabel={scanLabel} />,
  );
}

function messageParagraph(container: HTMLElement): HTMLParagraphElement {
  const paragraph: HTMLParagraphElement | null =
    container.querySelector("p[id]");

  if (!paragraph) {
    throw new Error("The status message paragraph was not rendered");
  }

  return paragraph;
}

function toggle(): HTMLButtonElement {
  return screen.getByRole("button", {
    name: /details for/,
  }) as HTMLButtonElement;
}

function queryToggle(): HTMLElement | null {
  return screen.queryByRole("button", { name: /details for/ });
}

/*
 * user-event dispatches through its own copy of @testing-library/dom, which
 * is not configured to wrap events in React's act() the way the copy inside
 * @testing-library/react is — so its interactions are wrapped here.
 */
async function asUser(interaction: () => Promise<unknown>): Promise<void> {
  await act(async () => {
    await interaction();
  });
}

function paintedLines(paragraph: HTMLElement): number {
  return paragraph.clientHeight / LINE_HEIGHT_IN_PIXELS;
}

function metrics(
  scrollHeight: number,
  clientHeight: number,
  lineHeight: string = "20px",
): MessageBoxMetrics {
  return {
    scrollHeight: scrollHeight,
    clientHeight: clientHeight,
    lineHeight: lineHeight,
  };
}

describe("isMessageTallerThanPreview", () => {
  test("the preview is two lines, matching the line-clamp-2 class the component applies", () => {
    expect(COLLAPSED_LINE_COUNT).toBe(2);
  });

  test.each([
    ["one line", 20, false],
    ["exactly two lines", 40, false],
    ["three lines", 60, true],
    ["ten lines", 200, true],
  ])(
    "%s of text at a 20px line height (scrollHeight %i) needs a toggle: %s",
    (_label: string, scrollHeight: number, expected: boolean) => {
      expect(isMessageTallerThanPreview(metrics(scrollHeight, 40), false)).toBe(
        expected,
      );
    },
  );

  test.each([true, false])(
    "with a known line height the answer does not depend on whether the message is expanded (expanded: %s)",
    (isExpanded: boolean) => {
      /*
       * An expanded box is exactly as tall as its text, so clientHeight equals
       * scrollHeight there. The answer must not change because of it —
       * otherwise expanding a message would remove its own "Hide details".
       */
      expect(isMessageTallerThanPreview(metrics(60, 60), isExpanded)).toBe(
        true,
      );
      expect(isMessageTallerThanPreview(metrics(60, 40), isExpanded)).toBe(
        true,
      );
      expect(isMessageTallerThanPreview(metrics(40, 40), isExpanded)).toBe(
        false,
      );
    },
  );

  test.each([
    [41, false],
    [49, false],
    [50, false],
    [51, true],
  ])(
    "a height rounded near the two-line limit is judged at half a line past it (scrollHeight %i: %s)",
    (scrollHeight: number, expected: boolean) => {
      expect(isMessageTallerThanPreview(metrics(scrollHeight, 40), false)).toBe(
        expected,
      );
    },
  );

  test("a fractional line height is read as a number, not rounded away", () => {
    // 18.4px lines: two are 36.8px (rounded to 37), three are 55.2px (55).
    expect(isMessageTallerThanPreview(metrics(37, 37, "18.4px"), false)).toBe(
      false,
    );
    expect(isMessageTallerThanPreview(metrics(55, 37, "18.4px"), false)).toBe(
      true,
    );
  });

  test("a larger line height moves the limit with it", () => {
    expect(isMessageTallerThanPreview(metrics(56, 56, "28px"), false)).toBe(
      false,
    );
    expect(isMessageTallerThanPreview(metrics(84, 56, "28px"), false)).toBe(
      true,
    );
  });

  test("a different preview length can be asked about", () => {
    expect(isMessageTallerThanPreview(metrics(60, 60), false, 3)).toBe(false);
    expect(isMessageTallerThanPreview(metrics(80, 60), false, 3)).toBe(true);
    expect(isMessageTallerThanPreview(metrics(20, 20), false, 1)).toBe(false);
    expect(isMessageTallerThanPreview(metrics(40, 20), false, 1)).toBe(true);
  });

  test.each(["normal", "", "0px", "-4px", "inherit"])(
    "without a usable line height (%p) a clamped box is judged by whether its text is taller than it",
    (lineHeight: string) => {
      expect(
        isMessageTallerThanPreview(metrics(60, 40, lineHeight), false),
      ).toBe(true);
      expect(
        isMessageTallerThanPreview(metrics(40, 40, lineHeight), false),
      ).toBe(false);
      // One pixel of rounding is not a hidden line.
      expect(
        isMessageTallerThanPreview(metrics(41, 40, lineHeight), false),
      ).toBe(false);
    },
  );

  test.each(["normal", "", "0px"])(
    "without a usable line height (%p) an expanded box cannot say, so the answer is unknown",
    (lineHeight: string) => {
      expect(
        isMessageTallerThanPreview(metrics(120, 120, lineHeight), true),
      ).toBeUndefined();
      expect(
        isMessageTallerThanPreview(metrics(20, 20, lineHeight), true),
      ).toBeUndefined();
    },
  );

  test.each([
    ["with a line height", "20px"],
    ["without a line height", "normal"],
  ])(
    "a box with no size (not displayed) never asks for a toggle, %s",
    (_label: string, lineHeight: string) => {
      expect(isMessageTallerThanPreview(metrics(0, 0, lineHeight), false)).toBe(
        false,
      );
    },
  );
});

describe("readMessageBoxMetrics", () => {
  test("reads the text height, the painted height and the computed line height", () => {
    installLayout(10);
    const { container } = renderMessage("x".repeat(35));
    const paragraph: HTMLParagraphElement = messageParagraph(container);

    // Four lines of text, clamped to two.
    expect(readMessageBoxMetrics(paragraph)).toEqual({
      scrollHeight: 80,
      clientHeight: 40,
      lineHeight: "20px",
    });
  });

  test("returns what jsdom reports when nothing is laid out", () => {
    const paragraph: HTMLParagraphElement = document.createElement("p");

    expect(readMessageBoxMetrics(paragraph)).toEqual({
      scrollHeight: 0,
      clientHeight: 0,
      lineHeight: expect.any(String),
    });
  });
});

describe("a message that fits in the preview has no toggle (issue #3842)", () => {
  test("the reported message is shown in full, with neither Show details nor Hide details", () => {
    installLayout();
    const { container } = renderMessage(REPORTED_MESSAGE);

    expect(paintedLines(messageParagraph(container))).toBe(2);
    expect(messageParagraph(container)).toHaveTextContent(REPORTED_MESSAGE);
    expect(queryToggle()).not.toBeInTheDocument();
    expect(screen.queryByText("Show details")).not.toBeInTheDocument();
    expect(screen.queryByText("Hide details")).not.toBeInTheDocument();
    expect(container.textContent).toBe(REPORTED_MESSAGE);
  });

  test("the other row in the report has no toggle either", () => {
    installLayout();
    renderMessage(REPORTED_ROUTER_MESSAGE);

    expect(screen.getByText(REPORTED_ROUTER_MESSAGE)).toBeInTheDocument();
    expect(queryToggle()).not.toBeInTheDocument();
  });

  test("a one-line message has no toggle", () => {
    installLayout();
    const { container } = renderMessage("Scan complete.");

    expect(paintedLines(messageParagraph(container))).toBe(1);
    expect(queryToggle()).not.toBeInTheDocument();
  });

  test("a message of exactly two full lines has no toggle", () => {
    installLayout();
    renderMessage("y".repeat(DESKTOP_CHARACTERS_PER_LINE * 2));

    expect(queryToggle()).not.toBeInTheDocument();
  });

  test("one character past two full lines is a third line, and gets the toggle", () => {
    installLayout();
    renderMessage("y".repeat(DESKTOP_CHARACTERS_PER_LINE * 2 + 1));

    expect(toggle()).toHaveTextContent("Show details");
  });

  test("with no layout at all (jsdom's zero sizes) nothing is offered", () => {
    renderMessage(LONG_MESSAGE);

    expect(screen.getByText(LONG_MESSAGE)).toBeInTheDocument();
    expect(queryToggle()).not.toBeInTheDocument();
  });

  test("a hidden message offers nothing until it is laid out", () => {
    const harness: TextClampLayout = installLayout();
    harness.setHidden(true);
    renderMessage(LONG_MESSAGE);

    expect(queryToggle()).not.toBeInTheDocument();

    harness.setHidden(false);
    harness.resize();

    expect(toggle()).toHaveAttribute("aria-expanded", "false");
  });

  test.each(["", " ", "\n\t "])(
    "an empty message (%p) renders nothing and observes nothing",
    (message: string) => {
      const harness: TextClampLayout = installLayout();
      const { container } = renderMessage(message);

      expect(container).toBeEmptyDOMElement();
      expect(harness.createdObserverCount()).toBe(0);
    },
  );
});

describe("a message longer than the preview has two distinct states (issue #3842)", () => {
  test("collapsed, it shows a two-line preview and offers Show details", () => {
    installLayout();
    const { container } = renderMessage(LONG_MESSAGE);
    const paragraph: HTMLParagraphElement = messageParagraph(container);

    expect(paragraph).toHaveClass("line-clamp-2");
    expect(paintedLines(paragraph)).toBe(2);
    expect(paragraph.scrollHeight).toBeGreaterThan(paragraph.clientHeight);
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(toggle()).toHaveTextContent(/^Show details/);
  });

  test("expanded, it shows the whole message and offers Hide details", async () => {
    installLayout();
    const { container } = renderMessage(LONG_MESSAGE);
    const paragraph: HTMLParagraphElement = messageParagraph(container);

    await asUser(() => {
      return userEvent.click(toggle());
    });

    expect(paragraph).not.toHaveClass("line-clamp-2");
    expect(paintedLines(paragraph)).toBe(
      Math.ceil(LONG_MESSAGE.length / DESKTOP_CHARACTERS_PER_LINE),
    );
    expect(paragraph.clientHeight).toBe(paragraph.scrollHeight);
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    expect(toggle()).toHaveTextContent(/^Hide details/);
  });

  test("the two states do not display the same thing", async () => {
    installLayout();
    const { container } = renderMessage(LONG_MESSAGE);
    const paragraph: HTMLParagraphElement = messageParagraph(container);

    const collapsed: { lines: number; label: string; clamped: boolean } = {
      lines: paintedLines(paragraph),
      label: toggle().textContent || "",
      clamped: paragraph.classList.contains("line-clamp-2"),
    };

    await asUser(() => {
      return userEvent.click(toggle());
    });

    const expanded: { lines: number; label: string; clamped: boolean } = {
      lines: paintedLines(paragraph),
      label: toggle().textContent || "",
      clamped: paragraph.classList.contains("line-clamp-2"),
    };

    expect(expanded.lines).toBeGreaterThan(collapsed.lines);
    expect(expanded.label).not.toBe(collapsed.label);
    expect(expanded.clamped).not.toBe(collapsed.clamped);
  });

  test("Hide details returns to the same preview", async () => {
    installLayout();
    const { container } = renderMessage(LONG_MESSAGE);
    const paragraph: HTMLParagraphElement = messageParagraph(container);

    await asUser(() => {
      return userEvent.click(toggle());
    });
    await asUser(() => {
      return userEvent.click(toggle());
    });

    expect(paragraph).toHaveClass("line-clamp-2");
    expect(paintedLines(paragraph)).toBe(2);
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(toggle()).toHaveTextContent(/^Show details/);
  });

  test("repeated toggling alternates cleanly, with the toggle present throughout", () => {
    installLayout();
    const { container } = renderMessage(LONG_MESSAGE);
    const paragraph: HTMLParagraphElement = messageParagraph(container);

    for (let click: number = 1; click <= 6; click++) {
      fireEvent.click(toggle());
      const isExpanded: boolean = click % 2 === 1;

      expect(toggle()).toHaveAttribute("aria-expanded", String(isExpanded));
      expect(paragraph.classList.contains("line-clamp-2")).toBe(!isExpanded);
      expect(paintedLines(paragraph)).toBe(isExpanded ? 6 : 2);
    }
  });

  test.each([
    ["collapsed", 0],
    ["expanded", 1],
    ["collapsed again", 2],
  ])(
    "the message is rendered exactly once while %s",
    (_state: string, clicks: number) => {
      installLayout();
      const { container } = renderMessage(LONG_MESSAGE);

      for (let click: number = 0; click < clicks; click++) {
        fireEvent.click(toggle());
      }

      expect(screen.getAllByText(LONG_MESSAGE)).toHaveLength(1);
      expect(container.querySelectorAll("p")).toHaveLength(1);
      expect(container.textContent?.split(LONG_MESSAGE)).toHaveLength(2);
    },
  );

  test("the toggle follows the message rather than leading it", async () => {
    installLayout();
    const { container } = renderMessage(LONG_MESSAGE);
    const paragraph: HTMLParagraphElement = messageParagraph(container);

    for (let click: number = 0; click < 2; click++) {
      expect(
        paragraph.compareDocumentPosition(toggle()) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      await asUser(() => {
        return userEvent.click(toggle());
      });
    }
  });

  test("it is a plain button, not a native details disclosure", () => {
    installLayout();
    const { container } = renderMessage(LONG_MESSAGE);

    expect(container.querySelector("details")).toBeNull();
    expect(container.querySelector("summary")).toBeNull();
    expect(toggle().tagName).toBe("BUTTON");
    expect(toggle()).toHaveAttribute("type", "button");
  });

  test("inside a form, toggling never submits it", async () => {
    installLayout();
    const onSubmit: Mock<(event: React.FormEvent) => void> = jest.fn(
      (event: React.FormEvent) => {
        event.preventDefault();
      },
    );

    render(
      <form onSubmit={onSubmit}>
        <DiscoveryScanStatusMessage
          message={LONG_MESSAGE}
          scanLabel={SCAN_LABEL}
        />
      </form>,
    );

    await asUser(() => {
      return userEvent.click(toggle());
    });
    await asUser(() => {
      return userEvent.click(toggle());
    });

    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("the toggle is accessible", () => {
  test("its name is the visible words plus the scan they belong to", async () => {
    installLayout();
    renderMessage(LONG_MESSAGE);

    expect(
      screen.getByRole("button", { name: `Show details for ${SCAN_LABEL}` }),
    ).toBeInTheDocument();

    await asUser(() => {
      return userEvent.click(toggle());
    });

    expect(
      screen.getByRole("button", { name: `Hide details for ${SCAN_LABEL}` }),
    ).toBeInTheDocument();
  });

  test("the scan's name is for assistive technology only; the visible words stay short", () => {
    installLayout();
    renderMessage(LONG_MESSAGE);

    const hidden: HTMLElement | null = toggle().querySelector(".sr-only");

    expect(hidden).not.toBeNull();
    expect(hidden?.textContent).toBe(` for ${SCAN_LABEL}`);
    expect(toggle().textContent?.replace(hidden?.textContent || "", "")).toBe(
      "Show details",
    );
  });

  test("it controls the message paragraph", () => {
    installLayout();
    const { container } = renderMessage(LONG_MESSAGE);
    const paragraph: HTMLParagraphElement = messageParagraph(container);

    expect(paragraph.id).not.toBe("");
    expect(toggle()).toHaveAttribute("aria-controls", paragraph.id);
    expect(document.getElementById(paragraph.id)).toBe(paragraph);
  });

  test("two messages on one page control their own paragraphs", async () => {
    installLayout();
    const { container } = render(
      <>
        <DiscoveryScanStatusMessage
          message={LONG_MESSAGE}
          scanLabel="First scan"
        />
        <DiscoveryScanStatusMessage
          message={PROGRESS_MESSAGE}
          scanLabel="Second scan"
        />
      </>,
    );
    const paragraphs: Array<HTMLParagraphElement> = Array.from(
      container.querySelectorAll("p[id]"),
    );
    const first: HTMLElement = screen.getByRole("button", {
      name: "Show details for First scan",
    });
    const second: HTMLElement = screen.getByRole("button", {
      name: "Show details for Second scan",
    });

    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0]!.id).not.toBe(paragraphs[1]!.id);
    expect(first).toHaveAttribute("aria-controls", paragraphs[0]!.id);
    expect(second).toHaveAttribute("aria-controls", paragraphs[1]!.id);

    // Opening one leaves the other alone.
    await asUser(() => {
      return userEvent.click(first);
    });

    expect(paragraphs[0]).not.toHaveClass("line-clamp-2");
    expect(paragraphs[1]).toHaveClass("line-clamp-2");
    expect(second).toHaveAttribute("aria-expanded", "false");
  });

  test("it is reachable and operable from the keyboard", async () => {
    installLayout();
    const { container } = renderMessage(LONG_MESSAGE);
    const paragraph: HTMLParagraphElement = messageParagraph(container);

    await asUser(() => {
      return userEvent.tab();
    });
    expect(toggle()).toHaveFocus();

    await asUser(() => {
      return userEvent.keyboard("{Enter}");
    });
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    expect(paragraph).not.toHaveClass("line-clamp-2");
    expect(toggle()).toHaveFocus();

    await asUser(() => {
      return userEvent.keyboard(" ");
    });
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(paragraph).toHaveClass("line-clamp-2");
  });

  test("the whole message stays readable to a screen reader while the preview is clamped", () => {
    installLayout();
    const { container } = renderMessage(LONG_MESSAGE);

    // line-clamp hides text visually only; the paragraph still holds all of it.
    expect(messageParagraph(container).textContent).toBe(LONG_MESSAGE);
    expect(screen.getByText(LONG_MESSAGE)).toBeVisible();
  });

  test("a message with no toggle leaves no focusable control behind", async () => {
    installLayout();
    renderMessage(REPORTED_MESSAGE);

    await asUser(() => {
      return userEvent.tab();
    });

    expect(document.body).toHaveFocus();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});

describe("the toggle follows the column's width", () => {
  test("a message that fits on a wide column gets the toggle when the column narrows", () => {
    const harness: TextClampLayout = installLayout();
    renderMessage(REPORTED_MESSAGE);

    expect(queryToggle()).not.toBeInTheDocument();

    // A phone-width column: the same sentence now needs three lines.
    harness.setCharactersPerLine(24);
    harness.resize();

    expect(toggle()).toHaveAttribute("aria-expanded", "false");
  });

  test("and loses it again when the column widens", () => {
    const harness: TextClampLayout = installLayout(24);
    renderMessage(REPORTED_MESSAGE);

    expect(toggle()).toBeInTheDocument();

    harness.setCharactersPerLine(DESKTOP_CHARACTERS_PER_LINE);
    harness.resize();

    expect(queryToggle()).not.toBeInTheDocument();
  });

  test("a message opened on a narrow column closes when widening leaves nothing to hide", async () => {
    const harness: TextClampLayout = installLayout(24);
    const { container } = renderMessage(REPORTED_MESSAGE);
    const paragraph: HTMLParagraphElement = messageParagraph(container);

    await asUser(() => {
      return userEvent.click(toggle());
    });
    expect(toggle()).toHaveAttribute("aria-expanded", "true");

    harness.setCharactersPerLine(DESKTOP_CHARACTERS_PER_LINE);
    harness.resize();

    expect(queryToggle()).not.toBeInTheDocument();
    expect(paragraph).toHaveClass("line-clamp-2");

    // Narrowing again offers the preview, not a leftover "Hide details".
    harness.setCharactersPerLine(24);
    harness.resize();

    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(toggle()).toHaveTextContent(/^Show details/);
  });

  test("an open message that still overflows after a resize stays open", async () => {
    const harness: TextClampLayout = installLayout();
    const { container } = renderMessage(LONG_MESSAGE);

    await asUser(() => {
      return userEvent.click(toggle());
    });

    harness.setCharactersPerLine(64);
    harness.resize();

    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    expect(messageParagraph(container)).not.toHaveClass("line-clamp-2");
  });

  test("it watches the message paragraph itself", () => {
    const harness: TextClampLayout = installLayout();
    const { container } = renderMessage(LONG_MESSAGE);

    expect(harness.observedElements()).toEqual([messageParagraph(container)]);
  });

  test("one observer is connected at a time, however often the message is toggled", () => {
    const harness: TextClampLayout = installLayout();
    renderMessage(LONG_MESSAGE);

    for (let click: number = 0; click < 5; click++) {
      fireEvent.click(toggle());
      expect(harness.connectedObserverCount()).toBe(1);
    }
  });

  test("the observer is disconnected on unmount", () => {
    const harness: TextClampLayout = installLayout();
    const { unmount } = renderMessage(LONG_MESSAGE);

    expect(harness.connectedObserverCount()).toBe(1);

    unmount();

    expect(harness.connectedObserverCount()).toBe(0);
    expect(harness.observedElements()).toEqual([]);
  });

  test("without ResizeObserver, a window resize re-measures", () => {
    const harness: TextClampLayout = installLayout(
      DESKTOP_CHARACTERS_PER_LINE,
      false,
    );
    renderMessage(REPORTED_MESSAGE);

    expect(typeof window.ResizeObserver).toBe("undefined");
    expect(queryToggle()).not.toBeInTheDocument();

    harness.setCharactersPerLine(24);
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    expect(toggle()).toHaveAttribute("aria-expanded", "false");

    harness.setCharactersPerLine(DESKTOP_CHARACTERS_PER_LINE);
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    expect(queryToggle()).not.toBeInTheDocument();
  });

  test("without ResizeObserver, the window listener is removed on unmount", () => {
    installLayout(DESKTOP_CHARACTERS_PER_LINE, false);
    const added: SpyInstance<typeof window.addEventListener> = jest.spyOn(
      window,
      "addEventListener",
    );
    const removed: SpyInstance<typeof window.removeEventListener> = jest.spyOn(
      window,
      "removeEventListener",
    );

    const { unmount } = renderMessage(LONG_MESSAGE);

    const resizeListeners: Array<unknown> = added.mock.calls
      .filter((call: Array<unknown>): boolean => {
        return call[0] === "resize";
      })
      .map((call: Array<unknown>): unknown => {
        return call[1];
      });

    expect(resizeListeners.length).toBeGreaterThan(0);

    unmount();

    for (const listener of resizeListeners) {
      expect(removed).toHaveBeenCalledWith("resize", listener);
    }
  });
});

describe("live updates to the message", () => {
  test("a short message replaced by a long one gains the toggle, collapsed", () => {
    installLayout();
    const { rerender } = renderMessage(REPORTED_MESSAGE);

    expect(queryToggle()).not.toBeInTheDocument();

    rerender(
      <DiscoveryScanStatusMessage
        message={LONG_MESSAGE}
        scanLabel={SCAN_LABEL}
      />,
    );

    expect(toggle()).toHaveAttribute("aria-expanded", "false");
  });

  test("an open message replaced by one that fits loses the toggle and its open state", async () => {
    installLayout();
    const { container, rerender } = renderMessage(PROGRESS_MESSAGE);

    await asUser(() => {
      return userEvent.click(toggle());
    });

    rerender(
      <DiscoveryScanStatusMessage
        message={REPORTED_MESSAGE}
        scanLabel={SCAN_LABEL}
      />,
    );

    expect(queryToggle()).not.toBeInTheDocument();
    expect(messageParagraph(container)).toHaveClass("line-clamp-2");
    expect(messageParagraph(container)).toHaveTextContent(REPORTED_MESSAGE);

    // The next long message arrives as a preview, not already open.
    rerender(
      <DiscoveryScanStatusMessage
        message={LONG_MESSAGE}
        scanLabel={SCAN_LABEL}
      />,
    );

    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(messageParagraph(container)).toHaveClass("line-clamp-2");
  });

  test("a poll that brings a different long message leaves an open message open", async () => {
    installLayout();
    const { container, rerender } = renderMessage(PROGRESS_MESSAGE);

    await asUser(() => {
      return userEvent.click(toggle());
    });

    const nextProgress: string = PROGRESS_MESSAGE.replace(
      "6,144 of 15,360",
      "12,288 of 15,360",
    ).replace("176 of 256", "200 of 256");

    rerender(
      <DiscoveryScanStatusMessage
        message={nextProgress}
        scanLabel={SCAN_LABEL}
      />,
    );

    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    expect(messageParagraph(container)).toHaveTextContent(nextProgress);
    expect(messageParagraph(container)).not.toHaveClass("line-clamp-2");
  });

  test("a poll that brings the same message changes nothing", async () => {
    const harness: TextClampLayout = installLayout();
    const { rerender } = renderMessage(LONG_MESSAGE);

    await asUser(() => {
      return userEvent.click(toggle());
    });

    for (let poll: number = 0; poll < 3; poll++) {
      rerender(
        <DiscoveryScanStatusMessage
          message={LONG_MESSAGE}
          scanLabel={SCAN_LABEL}
        />,
      );
      expect(toggle()).toHaveAttribute("aria-expanded", "true");
      expect(harness.connectedObserverCount()).toBe(1);
    }
  });

  test("a renamed scan renames its toggle", () => {
    installLayout();
    const { rerender } = renderMessage(LONG_MESSAGE, "Old name");

    expect(
      screen.getByRole("button", { name: "Show details for Old name" }),
    ).toBeInTheDocument();

    rerender(
      <DiscoveryScanStatusMessage
        message={LONG_MESSAGE}
        scanLabel="New name"
      />,
    );

    expect(
      screen.getByRole("button", { name: "Show details for New name" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Show details for Old name" }),
    ).not.toBeInTheDocument();
  });
});

describe("when the page reports no usable line height", () => {
  test("an overflowing preview still offers the toggle", () => {
    const harness: TextClampLayout = installLayout();
    harness.setLineHeight("normal");
    renderMessage(LONG_MESSAGE);

    expect(toggle()).toHaveAttribute("aria-expanded", "false");
  });

  test("expanding keeps Hide details rather than flickering back to the preview", async () => {
    const harness: TextClampLayout = installLayout();
    harness.setLineHeight("normal");
    const { container } = renderMessage(LONG_MESSAGE);

    await asUser(() => {
      return userEvent.click(toggle());
    });

    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    expect(messageParagraph(container)).not.toHaveClass("line-clamp-2");

    // Nor does a later reflow, which cannot tell from an open box either.
    harness.resize();

    expect(toggle()).toHaveAttribute("aria-expanded", "true");

    await asUser(() => {
      return userEvent.click(toggle());
    });

    expect(toggle()).toHaveAttribute("aria-expanded", "false");
  });

  test("a preview that fits still offers nothing", () => {
    const harness: TextClampLayout = installLayout();
    harness.setLineHeight("normal");
    renderMessage(REPORTED_MESSAGE);

    expect(queryToggle()).not.toBeInTheDocument();
  });

  test("a message that starts fitting while collapsed drops the toggle", () => {
    const harness: TextClampLayout = installLayout(24);
    harness.setLineHeight("normal");
    renderMessage(REPORTED_MESSAGE);

    expect(toggle()).toBeInTheDocument();

    harness.setCharactersPerLine(DESKTOP_CHARACTERS_PER_LINE);
    harness.resize();

    expect(queryToggle()).not.toBeInTheDocument();
  });
});
