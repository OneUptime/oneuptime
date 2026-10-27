import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Mock } from "jest-mock";
import React from "react";
import {
  ERROR_SCREEN_CSS,
  OFFLINE_ICON_PATH,
} from "../../../../UI/Components/ErrorScreen/ErrorScreenStyle";
import PageScreenCard, {
  PageScreenTone,
  getScreenLanguage,
} from "../../../../UI/Components/ErrorScreen/PageScreenCard";
import { Translator } from "../../../../UI/Utils/TranslateTemplate";

/*
 * The card a page shows in its own place while it cannot be shown - a new
 * version loading, offline, the server not answering, a page that could not
 * be loaded - from ChunkLoadRecovery and from the MasterPage's offline
 * screen alike, so every frontend says these things one way. It is drawn
 * with the error screens' own stylesheet (the app's may be what did not
 * arrive), and it says which language its words are in.
 */

afterEach(() => {
  cleanup();
});

describe("PageScreenCard", () => {
  test.each<[PageScreenTone, string]>([
    [PageScreenTone.Info, "oueb-badge oueb-badge-info"],
    [PageScreenTone.Neutral, "oueb-badge oueb-badge-neutral"],
    [PageScreenTone.Alert, "oueb-badge"],
  ])("tone %s: its badge", (tone: PageScreenTone, className: string) => {
    const { container } = render(
      <PageScreenCard
        dataTestId="screen"
        titleTestId="screen-title"
        tone={tone}
        iconPath={OFFLINE_ICON_PATH}
        title="You're offline"
        message="This page will come back as soon as you're online again."
      />,
    );

    const badge: Element = container.querySelector(".oueb-badge")!;

    expect(badge.getAttribute("class")).toBe(className);
    expect(badge).toHaveAttribute("aria-hidden", "true");
    expect(badge.querySelector("svg path")).toHaveAttribute(
      "d",
      OFFLINE_ICON_PATH,
    );
  });

  test("with no icon, the badge spins (a new version loading)", () => {
    const { container } = render(
      <PageScreenCard
        dataTestId="screen"
        titleTestId="screen-title"
        tone={PageScreenTone.Info}
        title="Updating to the new version"
        message="This page will open in the new version in a moment."
      />,
    );

    expect(
      container.querySelector(".oueb-badge .oueb-spinner"),
    ).toBeInTheDocument();
    expect(container.querySelector(".oueb-badge svg")).toBeNull();
  });

  test("its title, its message and its own stylesheet", () => {
    const { container } = render(
      <PageScreenCard
        dataTestId="screen"
        titleTestId="screen-title"
        tone={PageScreenTone.Neutral}
        title="You're offline"
        message="It will come back."
      />,
    );

    expect(screen.getByTestId("screen")).toHaveClass(
      "oneuptime-error-boundary",
    );
    expect(screen.getByTestId("screen-title").tagName).toBe("H1");
    expect(screen.getByTestId("screen-title")).toHaveTextContent(
      "You're offline",
    );
    expect(screen.getByText("It will come back.")).toHaveClass("oueb-message");
    expect(container.querySelector("style")!.textContent).toBe(
      ERROR_SCREEN_CSS,
    );
  });

  test("says what it says politely, or at once when it is an alert", () => {
    const { rerender } = render(
      <PageScreenCard
        dataTestId="screen"
        titleTestId="screen-title"
        tone={PageScreenTone.Neutral}
        title="You're offline"
        message="It will come back."
      />,
    );

    expect(screen.getByRole("status")).toContainElement(
      screen.getByTestId("screen-title"),
    );

    rerender(
      <PageScreenCard
        dataTestId="screen"
        titleTestId="screen-title"
        tone={PageScreenTone.Alert}
        title="This page couldn't be loaded"
        message="Try reloading in a moment."
        isAlert={true}
      />,
    );

    expect(screen.getByRole("alert")).toContainElement(
      screen.getByTestId("screen-title"),
    );
  });

  test("no actions: no row of buttons", () => {
    const { container } = render(
      <PageScreenCard
        dataTestId="screen"
        titleTestId="screen-title"
        tone={PageScreenTone.Info}
        title="Updating to the new version"
        message="In a moment."
      />,
    );

    expect(container.querySelector(".oueb-actions")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("each action is a primary button with its reload icon", () => {
    const tryAgain: Mock<() => void> = jest.fn<() => void>();
    const reload: Mock<() => void> = jest.fn<() => void>();

    render(
      <PageScreenCard
        dataTestId="screen"
        titleTestId="screen-title"
        tone={PageScreenTone.Neutral}
        title="Can't reach the server"
        message="It may be restarting."
        actions={[
          { title: "Try now", dataTestId: "try-now", onClick: tryAgain },
          { title: "Reload page", dataTestId: "reload", onClick: reload },
        ]}
      />,
    );

    const button: HTMLElement = screen.getByTestId("try-now");

    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveClass("oueb-button", "oueb-button-primary");
    expect(button).toHaveTextContent("Try now");
    expect(button.querySelector("svg")).toBeInTheDocument();
    expect(button).not.toHaveAttribute("aria-busy");

    fireEvent.click(button);
    fireEvent.click(screen.getByTestId("reload"));

    expect(tryAgain).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  test("a busy action spins where its icon was, and a press waits for it", () => {
    const tryAgain: Mock<() => void> = jest.fn<() => void>();

    render(
      <PageScreenCard
        dataTestId="screen"
        titleTestId="screen-title"
        tone={PageScreenTone.Neutral}
        title="You're offline"
        message="It will come back."
        actions={[
          {
            title: "Try again",
            dataTestId: "try-again",
            onClick: tryAgain,
            isBusy: true,
          },
        ]}
      />,
    );

    const button: HTMLElement = screen.getByTestId("try-again");

    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button.querySelector(".oueb-spinner")).toBeInTheDocument();
    expect(button.querySelector("svg")).toBeNull();
    // Still the button it was, words and all: a busy button never fades.
    expect(button).toHaveTextContent("Try again");
    expect(button).not.toBeDisabled();

    fireEvent.click(button);

    expect(tryAgain).not.toHaveBeenCalled();
  });

  test.each<[string, string]>([
    ["fa", "rtl"],
    ["de", "ltr"],
    ["en", "ltr"],
  ])(
    "says its words are in %s, and reads that way (%s)",
    (language: string, direction: string) => {
      render(
        <PageScreenCard
          dataTestId="screen"
          titleTestId="screen-title"
          tone={PageScreenTone.Neutral}
          title="Title"
          message="Message"
          language={language}
        />,
      );

      expect(screen.getByTestId("screen")).toHaveAttribute("lang", language);
      expect(screen.getByTestId("screen")).toHaveAttribute("dir", direction);
    },
  );

  test("with no language given it says nothing of one: the page's own holds", () => {
    render(
      <PageScreenCard
        dataTestId="screen"
        titleTestId="screen-title"
        tone={PageScreenTone.Neutral}
        title="Title"
        message="Message"
      />,
    );

    expect(screen.getByTestId("screen")).not.toHaveAttribute("lang");
    expect(screen.getByTestId("screen")).not.toHaveAttribute("dir");
  });

  test("names the screen and its step for the page's own tests", () => {
    render(
      <PageScreenCard
        dataTestId="chunk-load-recovery"
        titleTestId="chunk-load-recovery-title"
        tone={PageScreenTone.Neutral}
        title="Title"
        message="Message"
        dataAttributes={{ "data-step": "offline", "data-variant": "page" }}
      />,
    );

    expect(screen.getByTestId("chunk-load-recovery")).toHaveAttribute(
      "data-step",
      "offline",
    );
    expect(screen.getByTestId("chunk-load-recovery")).toHaveAttribute(
      "data-variant",
      "page",
    );
  });
});

describe("getScreenLanguage", () => {
  const translator: (
    language: string,
    translated: Array<string>,
  ) => Translator = (
    language: string,
    translated: Array<string>,
  ): Translator => {
    return {
      language: language,
      hasTranslation: (text: string): boolean => {
        return translated.includes(text);
      },
    } as unknown as Translator;
  };

  test("the reader's language when it words the screen", () => {
    expect(
      getScreenLanguage(translator("fa", ["You're offline"]), "You're offline"),
    ).toBe("fa");
  });

  test("English when the screen falls back to it, so a Persian page's English words read left to right", () => {
    expect(getScreenLanguage(translator("fa", []), "You're offline")).toBe(
      "en",
    );
  });
});

/*
 * The card is dark on a dark page even when the app's stylesheet - which
 * holds the dark theme's colours - is the file that did not arrive, or the
 * app never started (Common/Server/Views/Partials/EntryLoadFailure.ejs):
 * every colour the card uses is given again for html.dark, with the dark
 * theme's own value to fall back on.
 */
describe("the card's stylesheet in dark mode", () => {
  const BASE_RULE_START: string = ".oneuptime-error-boundary,\n.oueb-part {";
  const DARK_RULE_START: string =
    "html.dark .oneuptime-error-boundary,\nhtml.dark .oueb-part {";
  const VARIABLE_REGEX: RegExp = /(--oueb-[a-z-]+)\s*:\s*([^;]+);/g;

  const variablesOf: (ruleStart: string) => Map<string, string> = (
    ruleStart: string,
  ): Map<string, string> => {
    const start: number = ERROR_SCREEN_CSS.indexOf(ruleStart);
    const end: number = ERROR_SCREEN_CSS.indexOf("}", start);

    expect(start).toBeGreaterThan(-1);

    const variables: Map<string, string> = new Map<string, string>();

    for (const match of ERROR_SCREEN_CSS.slice(start, end).matchAll(
      VARIABLE_REGEX,
    )) {
      variables.set(match[1]!, match[2]!.trim());
    }

    return variables;
  };

  test("every colour of the light card is given again for dark", () => {
    const light: Map<string, string> = variablesOf(BASE_RULE_START);
    const dark: Map<string, string> = variablesOf(DARK_RULE_START);

    expect(light.size).toBeGreaterThan(15);
    expect(
      Array.from(light.keys()).filter((name: string): boolean => {
        return !dark.has(name);
      }),
    ).toEqual([]);
  });

  test.each<[string, string]>([
    ["--oueb-surface", "#172033"],
    ["--oueb-surface-muted", "#1e293b"],
    ["--oueb-border", "#475569"],
    ["--oueb-text", "#f8fafc"],
    ["--oueb-text-muted", "#cbd5e1"],
  ])(
    "%s follows the dark theme, falling back to its own value (%s)",
    (name: string, fallback: string) => {
      const dark: Map<string, string> = variablesOf(DARK_RULE_START);

      expect(dark.get(name)).toContain(fallback);
      expect(dark.get(name)!.startsWith("var(--ou-")).toBe(true);
    },
  );
});
