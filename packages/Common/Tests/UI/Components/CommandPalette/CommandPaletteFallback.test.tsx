import CommandPalette, {
  SEARCH_FOUND_NOTHING_SETTLE_MS,
} from "../../../../UI/Components/CommandPalette/CommandPalette";
import {
  PaletteCommand,
  PaletteSearchProvider,
  PaletteSearchResult,
} from "../../../../UI/Components/CommandPalette/Types";
import { PROVIDER_SEARCH_DEBOUNCE_MS } from "../../../../UI/Components/CommandPalette/UseProviderSearch";
import { resetPageScrollLockForTesting } from "../../../../UI/Utils/PageScrollLock";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * What a search offers when it found nothing (getFallbackCommands, #6816):
 * the Dashboard's "Ask AI: ..." for a question. It is listed in place of
 * "No results found." only once nothing matches and nothing is still
 * searching; the search still counts as one that found nothing; and it is
 * never remembered as recent, since it is made of the words typed.
 */

const COMMANDS: Array<PaletteCommand> = [
  {
    id: "go-monitors",
    title: "Monitors",
    category: "Pages",
    onSelect: (): void => {},
  },
];

const RECENTS_KEY: string = "fallback-test-recents";

async function advance(milliseconds: number): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(milliseconds);
  });
}

const typeQuery: (value: string) => void = (value: string): void => {
  fireEvent.change(screen.getByTestId("command-palette-input"), {
    target: { value },
  });
};

function askCommand(
  onSelect: () => void,
): (query: string) => Array<PaletteCommand> {
  return (query: string): Array<PaletteCommand> => {
    return [
      {
        id: "ask",
        title: `Ask: ${query}`,
        category: "Ask AI",
        onSelect: onSelect,
      },
    ];
  };
}

describe("CommandPalette: what a search that found nothing offers", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    resetPageScrollLockForTesting();
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    jest.useRealTimers();
    resetPageScrollLockForTesting();
  });

  test("is listed in place of No results found, under its own heading", async () => {
    render(
      <CommandPalette
        commands={COMMANDS}
        isOpen={true}
        onClose={(): void => {}}
        getFallbackCommands={askCommand((): void => {})}
      />,
    );

    typeQuery("zzzz");

    expect(screen.queryByTestId("command-palette-empty")).toBeNull();
    const offer: HTMLElement = screen.getByTestId(
      "command-palette-option-fallback-ask",
    );
    expect(offer).toHaveTextContent("Ask: zzzz");
    expect(
      screen.getByTestId("command-palette-section-fallback"),
    ).toHaveTextContent("Ask AI");
  });

  test("is not asked for while something matches", () => {
    const fallback: jest.Mock = jest.fn(askCommand((): void => {}));

    render(
      <CommandPalette
        commands={COMMANDS}
        isOpen={true}
        onClose={(): void => {}}
        getFallbackCommands={fallback}
      />,
    );

    typeQuery("monitors");

    expect(
      screen.getByTestId("command-palette-option-go-monitors"),
    ).toBeInTheDocument();
    expect(fallback).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId("command-palette-option-fallback-ask"),
    ).toBeNull();
  });

  test("waits for the records still being searched, and gives way when one is found", async () => {
    const provider: PaletteSearchProvider = {
      id: "things",
      title: "Things",
      search: (): Promise<Array<PaletteSearchResult>> => {
        return Promise.resolve([
          { id: "one", title: "The zzzz thing", onSelect: (): void => {} },
        ]);
      },
    };

    render(
      <CommandPalette
        commands={COMMANDS}
        searchProviders={[provider]}
        isOpen={true}
        onClose={(): void => {}}
        getFallbackCommands={askCommand((): void => {})}
      />,
    );

    typeQuery("zzzz");
    // Before the record search starts, nothing matched yet: offered.
    expect(
      screen.getByTestId("command-palette-option-fallback-ask"),
    ).toBeInTheDocument();

    await advance(PROVIDER_SEARCH_DEBOUNCE_MS + 10);

    expect(
      screen.getByTestId("command-palette-option-things-one"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("command-palette-option-fallback-ask"),
    ).toBeNull();
  });

  test("is the first in the keyboard's order: Enter runs it", () => {
    const asked: jest.Mock = jest.fn();

    render(
      <CommandPalette
        commands={COMMANDS}
        isOpen={true}
        onClose={(): void => {}}
        getFallbackCommands={askCommand(asked)}
      />,
    );

    typeQuery("zzzz");
    fireEvent.keyDown(screen.getByTestId("command-palette-input"), {
      key: "Enter",
    });

    expect(asked).toHaveBeenCalledTimes(1);
  });

  test("the search still counts as one that found nothing", async () => {
    const foundNothing: jest.Mock = jest.fn();

    render(
      <CommandPalette
        commands={COMMANDS}
        isOpen={true}
        onClose={(): void => {}}
        onSearchFoundNothing={foundNothing}
        getFallbackCommands={askCommand((): void => {})}
      />,
    );

    typeQuery("zzzz");
    await advance(SEARCH_FOUND_NOTHING_SETTLE_MS + 100);

    expect(foundNothing).toHaveBeenCalledTimes(1);
    expect(foundNothing).toHaveBeenCalledWith("zzzz");
  });

  test("an offer that is empty leaves No results found as it was", () => {
    render(
      <CommandPalette
        commands={COMMANDS}
        isOpen={true}
        onClose={(): void => {}}
        getFallbackCommands={(): Array<PaletteCommand> => {
          return [];
        }}
      />,
    );

    typeQuery("zzzz");

    expect(screen.getByTestId("command-palette-empty")).toBeInTheDocument();
  });

  test("an offer that throws leaves No results found, and the palette up", () => {
    render(
      <CommandPalette
        commands={COMMANDS}
        isOpen={true}
        onClose={(): void => {}}
        getFallbackCommands={(): Array<PaletteCommand> => {
          throw new Error("broken");
        }}
      />,
    );

    typeQuery("zzzz");

    expect(screen.getByTestId("command-palette-empty")).toBeInTheDocument();
    expect(screen.getByTestId("command-palette")).toBeInTheDocument();
  });

  test("is never remembered as a recent command", () => {
    render(
      <CommandPalette
        commands={COMMANDS}
        isOpen={true}
        onClose={(): void => {}}
        recentStorageKey={RECENTS_KEY}
        getFallbackCommands={askCommand((): void => {})}
      />,
    );

    typeQuery("zzzz");
    fireEvent.click(screen.getByTestId("command-palette-option-fallback-ask"));

    expect(window.localStorage.getItem(RECENTS_KEY) || "").not.toContain("ask");
  });

  test("browsing, with nothing typed, never asks for it", () => {
    const fallback: jest.Mock = jest.fn(askCommand((): void => {}));

    render(
      <CommandPalette
        commands={COMMANDS}
        isOpen={true}
        onClose={(): void => {}}
        getFallbackCommands={fallback}
      />,
    );

    expect(fallback).not.toHaveBeenCalled();
  });
});
