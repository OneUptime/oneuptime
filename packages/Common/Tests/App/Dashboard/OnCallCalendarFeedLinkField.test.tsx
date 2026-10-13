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
        expect(part).toHaveAttribute("aria-hidden", "true");
      }
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

    test("the host may be cut short; the dots and the four characters never are", () => {
      renderField();

      const [address, secret] = Array.from(
        screen
          .getByTestId("feed-link-masked")
          .querySelectorAll("span[aria-hidden='true']"),
      ) as Array<HTMLElement>;

      expect(address!.className).toContain("truncate");
      expect(address!.className).toContain("min-w-0");
      expect(secret!.className).toContain("flex-none");
      expect(secret!.className).not.toContain("truncate");
    });
  });

  describe("Show and Hide", () => {
    test("Show is a toggle button named for what it does", () => {
      renderField();

      const show: HTMLElement = screen.getByTestId("feed-reveal");

      expect(show.tagName).toBe("BUTTON");
      expect(show).toHaveAttribute("type", "button");
      expect(show).toHaveAttribute("aria-pressed", "false");
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

      expect(hide).toHaveAttribute("aria-pressed", "true");
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
      expect(screen.getByTestId("feed-copy-button")).toHaveTextContent(
        "Copied!",
      );
      expect(screen.getByRole("status")).toHaveTextContent("Link copied.");
    });

    test("'Copied!' goes back to 'Copy link' after a moment", async () => {
      jest.useFakeTimers();
      renderField();

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
      });

      expect(screen.getByTestId("feed-copy-button")).toHaveTextContent(
        "Copied!",
      );

      act(() => {
        jest.advanceTimersByTime(COPIED_FEEDBACK_MILLISECONDS - 1);
      });

      expect(screen.getByTestId("feed-copy-button")).toHaveTextContent(
        "Copied!",
      );

      act(() => {
        jest.advanceTimersByTime(1);
      });

      expect(screen.getByTestId("feed-copy-button")).toHaveTextContent(
        "Copy link",
      );
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
      expect(screen.getByTestId("feed-copy-button")).toHaveTextContent(
        "Copy link",
      );
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
