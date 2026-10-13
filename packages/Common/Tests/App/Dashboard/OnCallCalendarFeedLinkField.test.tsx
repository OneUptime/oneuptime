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
  waitFor,
} from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A calendar link as one field: the link, Show / Hide and Copy link.
 *
 * It replaced a grey "Click to reveal >" chip with a separate Copy link
 * button beside it. The URL is the credential - anyone who has it can read
 * the shifts - so what these tests pin first is that it never reaches the
 * page until the reader asks: hidden, the field shows the host, dots and the
 * four characters the status already names, and never anything else of the
 * token. Then: Show and Hide, a revealed link selected on focus, Copy link
 * copying without revealing, saying so on the button and to screen readers,
 * and - where the browser refuses the clipboard, as a plain-http self-hosted
 * install does - the link shown and selected, with how to copy it by hand,
 * instead of a button that silently does nothing.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

import FeedLinkField, {
  COPIED_FEEDBACK_MILLISECONDS,
  MASKED_ADDRESS_CLASS_NAME,
  MASKED_DOTS_CLASS_NAME,
  MASKED_HINT_CLASS_NAME,
  MASKED_LINK_CLASS_NAME,
  MASKED_SECRET_CLASS_NAME,
  SWAPPING_LABEL_HIDDEN_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/FeedLinkField";
import { MASK_CHARACTER } from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/CalendarFeedUtil";

const TOKEN: string = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";
const URL_WITH_TOKEN: string = `https://oneuptime.example.com/api/on-call-calendar/user/${TOKEN}/shifts.ics`;
const HINT: string = "DEFG";

let writeText: MockFunction = getJestMockFunction();

function setClipboard(available: boolean): void {
  writeText = getJestMockFunction();

  if (available) {
    writeText.mockResolvedValue(undefined);
  } else {
    writeText.mockRejectedValue(new Error("Document is not focused."));
  }

  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
}

/*
 * The legacy copy path Clipboard falls back to; refused here, as it is where
 * the async API is.
 */
function refuseExecCommand(): void {
  Object.defineProperty(document, "execCommand", {
    value: (): boolean => {
      return false;
    },
    configurable: true,
  });
}

function maskedParts(idPrefix: string = "feed"): Array<string> {
  return Array.from(
    screen
      .getByTestId(`${idPrefix}-link-masked`)
      .querySelectorAll("span[aria-hidden='true']"),
  ).map((part: Element): string => {
    return part.textContent || "";
  });
}

/*
 * Copy link's two words share one place (the longer one sets the width):
 * the one in view, and the one kept invisible and away from screen readers.
 */
function copyLabels(idPrefix: string = "feed"): {
  shown: Array<string>;
  hidden: Array<string>;
} {
  const words: Array<HTMLElement> = Array.from(
    screen.getByTestId(`${idPrefix}-copy-label`).children,
  ) as Array<HTMLElement>;

  return {
    shown: words
      .filter((word: HTMLElement): boolean => {
        return word.getAttribute("data-shown") === "true";
      })
      .map((word: HTMLElement): string => {
        return word.textContent || "";
      }),
    hidden: words
      .filter((word: HTMLElement): boolean => {
        return word.getAttribute("data-shown") === "false";
      })
      .map((word: HTMLElement): string => {
        return word.textContent || "";
      }),
  };
}

function renderField(
  url: string = URL_WITH_TOKEN,
  tokenHint: string | null = HINT,
): ReturnType<typeof render> {
  return render(
    <FeedLinkField url={url} tokenHint={tokenHint} idPrefix="feed" />,
  );
}

describe("FeedLinkField", () => {
  beforeEach(() => {
    setClipboard(true);
    refuseExecCommand();
  });

  afterEach(() => {
    cleanup();
    jest.useRealTimers();
  });

  describe("hidden, as it starts", () => {
    test("shows the host, dots and the token's last four characters - and nothing else of the token", () => {
      renderField();

      expect(maskedParts()).toEqual([
        "oneuptime.example.com/",
        `${MASK_CHARACTER.repeat(10)}${HINT}`,
      ]);

      const field: HTMLElement = screen.getByTestId("feed-copy");

      expect(field.textContent).not.toContain(TOKEN);
      expect(field.textContent).not.toContain(TOKEN.slice(0, 8));
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    });

    test("tells a screen reader what is there without reading out the dots", () => {
      renderField();

      const masked: HTMLElement = screen.getByTestId("feed-link-masked");

      expect(masked.querySelector(".sr-only")).toHaveTextContent(
        "Calendar link, hidden",
      );

      for (const part of Array.from(
        masked.querySelectorAll("span:not(.sr-only)"),
      )) {
        expect(part.closest("[aria-hidden='true']")).not.toBeNull();
      }
    });

    /*
     * The dots are decoration and stay faint; the four characters after them
     * tell this link from another - the status names them - so they are as
     * legible as the host. Each span sets the monospace font itself: the
     * Dashboard sets a font on every element, which beats inheriting one.
     */
    test("the four characters are drawn as legibly as the host, the dots faint, all monospaced", () => {
      renderField();

      const dots: HTMLElement = screen.getByTestId("feed-link-mask-dots");
      const hint: HTMLElement = screen.getByTestId("feed-link-mask-hint");

      expect(dots).toHaveTextContent(MASK_CHARACTER.repeat(10));
      expect(hint.textContent).toBe(HINT);
      expect(dots.className).toContain("text-gray-400");
      expect(hint.className).toContain("text-gray-500");

      for (const span of Array.from(
        screen
          .getByTestId("feed-link-masked")
          .querySelectorAll("span:not(.sr-only)"),
      )) {
        expect(span.className).toContain("font-mono");
      }
    });

    test("without a hint there are only dots, and nothing after them", () => {
      renderField(URL_WITH_TOKEN, null);

      expect(screen.getByTestId("feed-link-mask-dots")).toHaveTextContent(
        MASK_CHARACTER.repeat(10),
      );
      expect(screen.getByTestId("feed-link-mask-hint").textContent).toBe("");
    });

    test("without a hint it is dots alone, and a link it cannot parse loses its host rather than breaking", () => {
      const { rerender } = renderField(URL_WITH_TOKEN, null);

      expect(maskedParts()).toEqual([
        "oneuptime.example.com/",
        MASK_CHARACTER.repeat(10),
      ]);

      rerender(
        <FeedLinkField url="not a url" tokenHint={HINT} idPrefix="feed" />,
      );

      expect(maskedParts()).toEqual([
        "",
        `${MASK_CHARACTER.repeat(10)}${HINT}`,
      ]);
    });

    /*
     * Short of room - a phone, a language whose "Copy link" is long - the
     * hidden link gives way in order: the host first (it shrinks a thousand
     * times faster), then the dots, from their left; the four characters
     * stay whole. The field clips what does not fit, so nothing is drawn
     * over the Show button: in German at 390px the dots kept their width
     * and ran under it.
     */
    test("short of room the host gives way first, then the dots; the four characters never do", () => {
      renderField();

      const masked: HTMLElement = screen.getByTestId("feed-link-masked");
      const [address, secret] = Array.from(
        masked.querySelectorAll("span[aria-hidden='true']"),
      ) as Array<HTMLElement>;
      const tokensOf: (className: string) => Array<string> = (
        className: string,
      ): Array<string> => {
        return className.split(" ");
      };

      expect(masked.className).toBe(MASKED_LINK_CLASS_NAME);
      expect(tokensOf(MASKED_LINK_CLASS_NAME)).toEqual(
        expect.arrayContaining(["min-w-0", "flex-1", "overflow-hidden"]),
      );
      // The text area around it clips too, lock and all.
      expect(tokensOf(masked.parentElement!.className)).toEqual(
        expect.arrayContaining(["min-w-0", "overflow-hidden"]),
      );

      expect(address!.className).toBe(MASKED_ADDRESS_CLASS_NAME);
      expect(tokensOf(MASKED_ADDRESS_CLASS_NAME)).toEqual(
        expect.arrayContaining(["min-w-0", "truncate", "shrink-[1000]"]),
      );

      expect(secret!.className).toBe(MASKED_SECRET_CLASS_NAME);
      expect(tokensOf(MASKED_SECRET_CLASS_NAME)).toContain("min-w-0");
      expect(tokensOf(MASKED_SECRET_CLASS_NAME)).not.toContain("flex-none");

      expect(screen.getByTestId("feed-link-mask-dots").className).toBe(
        MASKED_DOTS_CLASS_NAME,
      );
      expect(tokensOf(MASKED_DOTS_CLASS_NAME)).toEqual(
        expect.arrayContaining([
          "min-w-0",
          "overflow-hidden",
          "whitespace-nowrap",
          "[direction:rtl]",
        ]),
      );

      expect(screen.getByTestId("feed-link-mask-hint").className).toBe(
        MASKED_HINT_CLASS_NAME,
      );
      expect(tokensOf(MASKED_HINT_CLASS_NAME)).toContain("flex-none");
      expect(tokensOf(MASKED_HINT_CLASS_NAME)).not.toContain("truncate");
    });
  });

  describe("Show and Hide", () => {
    /*
     * Its name says what it does next - Show link, then Hide link - so it
     * is not also a pressed / unpressed toggle: a toggle whose name changes
     * as well is read out as "Hide link, pressed".
     */
    test("Show is a button named for what it does next, not a pressed toggle", () => {
      renderField();

      const show: HTMLElement = screen.getByTestId("feed-reveal");

      expect(show.tagName).toBe("BUTTON");
      expect(show).toHaveAttribute("type", "button");
      expect(show).not.toHaveAttribute("aria-pressed");
      expect(show).toHaveAccessibleName("Show link");
      expect(show).toHaveTextContent("Show");
    });

    test("Show puts the https link in a read-only field; Hide takes it away again", () => {
      renderField();

      fireEvent.click(screen.getByRole("button", { name: "Show link" }));

      const value: HTMLElement = screen.getByTestId("feed-link-value");

      expect(value.tagName).toBe("INPUT");
      expect(value).toHaveValue(URL_WITH_TOKEN);
      expect(value).toHaveAttribute("readonly");
      expect(value).toHaveAccessibleName("Calendar link");
      expect(screen.queryByTestId("feed-link-masked")).not.toBeInTheDocument();

      const hide: HTMLElement = screen.getByRole("button", {
        name: "Hide link",
      });

      expect(hide).not.toHaveAttribute("aria-pressed");
      expect(hide).toHaveTextContent("Hide");

      fireEvent.click(hide);

      expect(screen.queryByTestId("feed-link-value")).not.toBeInTheDocument();
      expect(screen.getByTestId("feed-link-masked")).toBeInTheDocument();
    });

    test("the revealed link is selected whole when the field takes focus", () => {
      renderField();

      fireEvent.click(screen.getByRole("button", { name: "Show link" }));

      const value: HTMLInputElement = screen.getByTestId(
        "feed-link-value",
      ) as HTMLInputElement;

      fireEvent.focus(value);

      expect(value.selectionStart).toBe(0);
      expect(value.selectionEnd).toBe(URL_WITH_TOKEN.length);
    });

    test("a new link - after Regenerate link - starts hidden again", () => {
      const { rerender } = renderField();

      fireEvent.click(screen.getByRole("button", { name: "Show link" }));
      expect(screen.getByTestId("feed-link-value")).toBeInTheDocument();

      const newUrl: string = URL_WITH_TOKEN.replace(TOKEN, "z".repeat(43));

      rerender(<FeedLinkField url={newUrl} tokenHint="zzzz" idPrefix="feed" />);

      expect(screen.queryByTestId("feed-link-value")).not.toBeInTheDocument();
      expect(maskedParts()[1]).toBe(`${MASK_CHARACTER.repeat(10)}zzzz`);
    });

    test("on a phone the button keeps its eye and its name, and drops the word", () => {
      renderField();

      const word: Element | null = screen
        .getByTestId("feed-reveal")
        .querySelector("span");

      expect(word).toHaveTextContent("Show");
      expect(word!.className).toBe("max-sm:sr-only");
      expect(screen.getByTestId("feed-reveal")).toHaveAccessibleName(
        "Show link",
      );
    });
  });

  describe("Copy link", () => {
    test("is named by the words on it, and says what it copies on hover", () => {
      renderField();

      const copy: HTMLElement = screen.getByTestId("feed-copy-button");

      expect(copy.tagName).toBe("BUTTON");
      expect(copy).toHaveAccessibleName("Copy link");
      expect(copy).toHaveAttribute("title", "Copy https link");
      expect(copyLabels()).toEqual({
        shown: ["Copy link"],
        hidden: ["Copied!"],
      });
    });

    /*
     * "Copied!" is shorter than "Copy link" ("Kopiert!" five letters shorter
     * than "Link kopieren"). Both words share one grid cell, the one not in
     * view invisible, so the button is as wide as the longer word in every
     * language and the hidden link beside it does not jump for two seconds.
     */
    test("keeps both words in one place, so the button never changes width", () => {
      renderField();

      const label: HTMLElement = screen.getByTestId("feed-copy-label");

      expect(label.className).toContain("grid");
      expect(label.className).toContain("justify-items-start");

      const words: Array<HTMLElement> = Array.from(
        label.children,
      ) as Array<HTMLElement>;

      expect(words).toHaveLength(2);

      for (const word of words) {
        expect(word.className).toContain("col-start-1");
        expect(word.className).toContain("row-start-1");
      }

      const hidden: HTMLElement = words.find((word: HTMLElement): boolean => {
        return word.getAttribute("data-shown") === "false";
      }) as HTMLElement;

      expect(hidden.className).toContain(SWAPPING_LABEL_HIDDEN_CLASS_NAME);
      expect(hidden).toHaveAttribute("aria-hidden", "true");
      expect(SWAPPING_LABEL_HIDDEN_CLASS_NAME).toBe("invisible");
    });

    test("copies the https link without showing it, and says so on the button and to screen readers", async () => {
      renderField();

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
      });

      expect(writeText).toHaveBeenCalledTimes(1);
      expect(writeText).toHaveBeenCalledWith(URL_WITH_TOKEN);

      // Still hidden: copying is not showing.
      expect(screen.queryByTestId("feed-link-value")).not.toBeInTheDocument();
      expect(screen.getByTestId("feed-copy-button")).toHaveAccessibleName(
        "Copied!",
      );
      expect(copyLabels()).toEqual({
        shown: ["Copied!"],
        hidden: ["Copy link"],
      });
      expect(screen.getByRole("status")).toHaveTextContent("Link copied.");
    });

    test("'Copied!' goes back to 'Copy link' after a moment", async () => {
      jest.useFakeTimers();
      renderField();

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
      });

      expect(screen.getByTestId("feed-copy-button")).toHaveAccessibleName(
        "Copied!",
      );

      act(() => {
        jest.advanceTimersByTime(COPIED_FEEDBACK_MILLISECONDS - 1);
      });

      expect(screen.getByTestId("feed-copy-button")).toHaveAccessibleName(
        "Copied!",
      );

      act(() => {
        jest.advanceTimersByTime(1);
      });

      expect(screen.getByTestId("feed-copy-button")).toHaveAccessibleName(
        "Copy link",
      );
      expect(copyLabels()).toEqual({
        shown: ["Copy link"],
        hidden: ["Copied!"],
      });
      expect(screen.getByRole("status")).toHaveTextContent("");
    });

    test("a browser that refuses the clipboard gets the link shown and selected, with how to copy it", async () => {
      setClipboard(false);
      renderField();

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
      });

      const value: HTMLInputElement = (await screen.findByTestId(
        "feed-link-value",
      )) as HTMLInputElement;

      expect(value).toHaveValue(URL_WITH_TOKEN);

      await waitFor(() => {
        expect(document.activeElement).toBe(value);
      });
      expect(value.selectionStart).toBe(0);
      expect(value.selectionEnd).toBe(URL_WITH_TOKEN.length);

      expect(screen.getByTestId("feed-copy-blocked")).toHaveTextContent(
        "This browser did not let the page copy the link, so it is shown and selected above. Copy it with Ctrl+C, or Cmd+C on a Mac.",
      );
      // Never a "Copied!" that is not true.
      expect(screen.getByTestId("feed-copy-button")).toHaveAccessibleName(
        "Copy link",
      );
      expect(copyLabels().shown).toEqual(["Copy link"]);
    });

    test("the blocked note goes once the reader hides the link again", async () => {
      setClipboard(false);
      renderField();

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
      });

      await screen.findByTestId("feed-copy-blocked");

      fireEvent.click(screen.getByRole("button", { name: "Hide link" }));

      expect(screen.queryByTestId("feed-copy-blocked")).not.toBeInTheDocument();
      expect(screen.queryByTestId("feed-link-value")).not.toBeInTheDocument();
    });
  });

  test("the three parts share one bordered field, Show and Copy link ruled off inside it", () => {
    renderField();

    const field: HTMLElement = screen.getByTestId("feed-copy");

    expect(field.className).toContain("rounded-md");
    expect(field.className).toContain("border");
    expect(screen.getByTestId("feed-reveal").className).toContain("border-l");
    expect(screen.getByTestId("feed-copy-button").className).toContain(
      "border-l",
    );
    expect(screen.getByTestId("feed-copy-button").className).toContain(
      "rounded-r-md",
    );
  });

  test("idPrefix namespaces every test id", () => {
    render(
      <FeedLinkField url={URL_WITH_TOKEN} tokenHint={HINT} idPrefix="shared" />,
    );

    for (const id of [
      "shared-copy",
      "shared-link-masked",
      "shared-reveal",
      "shared-copy-button",
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }

    expect(screen.queryByTestId("feed-copy")).not.toBeInTheDocument();
  });
});
