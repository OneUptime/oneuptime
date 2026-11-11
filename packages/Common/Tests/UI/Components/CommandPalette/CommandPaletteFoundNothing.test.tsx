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
 * A search that found nothing (issue #6830): the palette tells
 * onSearchFoundNothing once the list has settled empty - nothing left
 * searching, for SEARCH_FOUND_NOTHING_SETTLE_MS - or when it is closed on
 * an empty list. Once per search: the words typed on the way to one are
 * not searches of their own, and a search that finds something is not
 * reported at all.
 */

const COMMANDS: Array<PaletteCommand> = [
  {
    id: "go-monitors",
    title: "Monitors",
    category: "Pages",
    onSelect: (): void => {},
  },
];

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

const SETTLED: number =
  PROVIDER_SEARCH_DEBOUNCE_MS + SEARCH_FOUND_NOTHING_SETTLE_MS + 50;

describe("CommandPalette: a search that found nothing", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    resetPageScrollLockForTesting();
  });

  afterEach(() => {
    cleanup();
    jest.useRealTimers();
    resetPageScrollLockForTesting();
  });

  test("is reported once, with its words, after the list settles empty", async () => {
    const foundNothing: jest.Mock = jest.fn();

    render(
      <CommandPalette
        commands={COMMANDS}
        isOpen={true}
        onClose={(): void => {}}
        onSearchFoundNothing={foundNothing}
      />,
    );

    typeQuery("zzzz");
    await advance(SEARCH_FOUND_NOTHING_SETTLE_MS - 100);
    expect(foundNothing).not.toHaveBeenCalled();

    await advance(200);
    expect(foundNothing).toHaveBeenCalledTimes(1);
    expect(foundNothing).toHaveBeenCalledWith("zzzz");
    expect(screen.getByTestId("command-palette-empty")).toBeInTheDocument();

    await advance(SETTLED * 3);
    expect(foundNothing).toHaveBeenCalledTimes(1);
  });

  test("the words typed on the way to a search are not searches of their own", async () => {
    const foundNothing: jest.Mock = jest.fn();

    render(
      <CommandPalette
        commands={COMMANDS}
        isOpen={true}
        onClose={(): void => {}}
        onSearchFoundNothing={foundNothing}
      />,
    );

    for (const words of ["qx", "qxz", "qxzw"]) {
      typeQuery(words);
      await advance(300);
    }

    await advance(SETTLED);

    expect(foundNothing.mock.calls).toEqual([["qxzw"]]);
  });

  test("a search that finds a page, and one too short to search, are not reported", async () => {
    const foundNothing: jest.Mock = jest.fn();

    render(
      <CommandPalette
        commands={COMMANDS}
        isOpen={true}
        onClose={(): void => {}}
        onSearchFoundNothing={foundNothing}
      />,
    );

    typeQuery("monitors");
    await advance(SETTLED);
    typeQuery("z");
    await advance(SETTLED);

    expect(foundNothing).not.toHaveBeenCalled();
  });

  test("nothing is reported while a provider is still searching, and a provider's result is something found", async () => {
    const foundNothing: jest.Mock = jest.fn();
    let answer: (results: Array<PaletteSearchResult>) => void = (): void => {};
    const provider: PaletteSearchProvider = {
      id: "incidents",
      title: "Incidents",
      search: (): Promise<Array<PaletteSearchResult>> => {
        return new Promise<Array<PaletteSearchResult>>(
          (resolve: (results: Array<PaletteSearchResult>) => void) => {
            answer = resolve;
          },
        );
      },
    };

    render(
      <CommandPalette
        commands={COMMANDS}
        searchProviders={[provider]}
        isOpen={true}
        onClose={(): void => {}}
        onSearchFoundNothing={foundNothing}
      />,
    );

    typeQuery("database outage");
    await advance(SETTLED * 2);
    expect(foundNothing).not.toHaveBeenCalled();

    await act(async () => {
      answer([
        { id: "i-1", title: "Database outage", onSelect: (): void => {} },
      ]);
    });
    await advance(SETTLED);

    expect(foundNothing).not.toHaveBeenCalled();
  });

  test("a provider that answers with nothing is a search that found nothing", async () => {
    const foundNothing: jest.Mock = jest.fn();
    const provider: PaletteSearchProvider = {
      id: "incidents",
      title: "Incidents",
      search: (): Promise<Array<PaletteSearchResult>> => {
        return Promise.resolve([]);
      },
    };

    render(
      <CommandPalette
        commands={COMMANDS}
        searchProviders={[provider]}
        isOpen={true}
        onClose={(): void => {}}
        onSearchFoundNothing={foundNothing}
      />,
    );

    typeQuery("nothing like this");
    await advance(SETTLED);

    expect(foundNothing.mock.calls).toEqual([["nothing like this"]]);
  });

  test("closing the palette on an empty list reports that search at once", async () => {
    const foundNothing: jest.Mock = jest.fn();

    const view: ReturnType<typeof render> = render(
      <CommandPalette
        commands={COMMANDS}
        isOpen={true}
        onClose={(): void => {}}
        onSearchFoundNothing={foundNothing}
      />,
    );

    typeQuery("zzzz");
    await advance(100);
    expect(foundNothing).not.toHaveBeenCalled();

    view.rerender(
      <CommandPalette
        commands={COMMANDS}
        isOpen={false}
        onClose={(): void => {}}
        onSearchFoundNothing={foundNothing}
      />,
    );

    expect(foundNothing.mock.calls).toEqual([["zzzz"]]);
  });

  test("without a listener nothing happens, and a listener that throws never breaks the palette", async () => {
    render(
      <CommandPalette
        commands={COMMANDS}
        isOpen={true}
        onClose={(): void => {}}
        onSearchFoundNothing={(): void => {
          throw new Error("analytics is down");
        }}
      />,
    );

    typeQuery("zzzz");
    await advance(SETTLED);

    expect(screen.getByTestId("command-palette-empty")).toBeInTheDocument();

    cleanup();

    render(
      <CommandPalette
        commands={COMMANDS}
        isOpen={true}
        onClose={(): void => {}}
      />,
    );

    typeQuery("zzzz");
    await advance(SETTLED);

    expect(screen.getByTestId("command-palette-empty")).toBeInTheDocument();
  });
});
