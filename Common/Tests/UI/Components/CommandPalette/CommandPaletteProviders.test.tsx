import CommandPalette from "../../../../UI/Components/CommandPalette/CommandPalette";
import {
  PaletteCommand,
  PaletteSearchProvider,
  PaletteSearchResult,
} from "../../../../UI/Components/CommandPalette/Types";
import {
  PROVIDER_SEARCH_DEBOUNCE_MS,
  PROVIDER_SEARCH_MIN_QUERY_LENGTH,
} from "../../../../UI/Components/CommandPalette/UseProviderSearch";
import { resetPageScrollLockForTesting } from "../../../../UI/Utils/PageScrollLock";
/*
 * The main entry, not "/extend-expect": the latter no longer ships type
 * declarations, so every jest-dom matcher in this file fails to typecheck and
 * the whole suite is skipped before a single assertion runs.
 */
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
 * Async search-provider contract: debounce, minimum query length, parallel
 * dispatch, stale-response discard, per-provider error isolation, and the
 * pending indicator. Fake timers drive the debounce; deferred promises let
 * each test settle providers in whatever order it needs.
 */

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

type CreateDeferredFunction = <T>() => Deferred<T>;

const createDeferred: CreateDeferredFunction = <T,>(): Deferred<T> => {
  let resolveFunction: (value: T) => void = (): void => {};
  let rejectFunction: (error: Error) => void = (): void => {};
  const promise: Promise<T> = new Promise<T>(
    (resolve: (value: T) => void, reject: (error: Error) => void) => {
      resolveFunction = resolve;
      rejectFunction = reject;
    },
  );
  return { promise, resolve: resolveFunction, reject: rejectFunction };
};

type MakeResultFunction = (
  id: string,
  title: string,
  onSelect?: () => void,
) => PaletteSearchResult;

const makeResult: MakeResultFunction = (
  id: string,
  title: string,
  onSelect?: () => void,
): PaletteSearchResult => {
  return { id, title, onSelect: onSelect || ((): void => {}) };
};

const BASE_COMMANDS: Array<PaletteCommand> = [
  {
    id: "go-monitors",
    title: "Monitors",
    category: "Pages",
    onSelect: (): void => {},
  },
];

/*
 * Async on purpose: a provider that returns an already-resolved promise
 * settles on the microtask queue right after the timers fire, and awaiting
 * the act() keeps that state update wrapped.
 */
async function advance(milliseconds: number): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(milliseconds);
  });
}

type TypeQueryFunction = (value: string) => void;

const typeQuery: TypeQueryFunction = (value: string): void => {
  fireEvent.change(screen.getByTestId("command-palette-input"), {
    target: { value },
  });
};

describe("CommandPalette search providers", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    resetPageScrollLockForTesting();
  });

  afterEach(() => {
    cleanup();
    jest.useRealTimers();
    resetPageScrollLockForTesting();
  });

  test("does not search until the query reaches the minimum length", async () => {
    const search: jest.Mock = jest.fn(() => {
      return Promise.resolve([]);
    });
    const provider: PaletteSearchProvider = {
      id: "monitors",
      title: "Monitors",
      search,
    };
    render(
      <CommandPalette
        commands={BASE_COMMANDS}
        searchProviders={[provider]}
        isOpen={true}
        onClose={(): void => {}}
      />,
    );

    typeQuery("m");
    await advance(PROVIDER_SEARCH_DEBOUNCE_MS * 3);

    expect(search).not.toHaveBeenCalled();
    expect(PROVIDER_SEARCH_MIN_QUERY_LENGTH).toBeGreaterThan(1);
    expect(screen.queryByTestId("command-palette-section-monitors")).toBeNull();
  });

  test("debounces: a burst of keystrokes produces one search with the final text", async () => {
    const search: jest.Mock = jest.fn(() => {
      return Promise.resolve([]);
    });
    render(
      <CommandPalette
        commands={BASE_COMMANDS}
        searchProviders={[{ id: "monitors", title: "Monitors", search }]}
        isOpen={true}
        onClose={(): void => {}}
      />,
    );

    typeQuery("mo");
    await advance(PROVIDER_SEARCH_DEBOUNCE_MS - 100);
    typeQuery("mon");
    await advance(PROVIDER_SEARCH_DEBOUNCE_MS - 1);

    expect(search).not.toHaveBeenCalled();

    await advance(1);

    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith("mon");
  });

  test("shows a pending indicator per section while a provider is in flight", async () => {
    const deferred: Deferred<Array<PaletteSearchResult>> =
      createDeferred<Array<PaletteSearchResult>>();
    const search: jest.Mock = jest.fn(() => {
      return deferred.promise;
    });
    render(
      <CommandPalette
        commands={BASE_COMMANDS}
        searchProviders={[{ id: "monitors", title: "Monitors", search }]}
        isOpen={true}
        onClose={(): void => {}}
      />,
    );

    typeQuery("api");
    await advance(PROVIDER_SEARCH_DEBOUNCE_MS);

    expect(
      screen.getByTestId("command-palette-section-pending-monitors"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("command-palette-result-count"),
    ).toHaveTextContent("Searching…");

    await act(async () => {
      deferred.resolve([makeResult("mon-1", "API Monitor")]);
    });

    expect(
      screen.queryByTestId("command-palette-section-pending-monitors"),
    ).toBeNull();
    expect(
      screen.getByTestId("command-palette-option-monitors-mon-1"),
    ).toHaveTextContent("API Monitor");
    expect(
      screen.getByTestId("command-palette-result-count"),
    ).toHaveTextContent("1 result");
    expect(
      screen.getByTestId("command-palette-result-count"),
    ).not.toHaveTextContent("Searching…");
  });

  test("runs all providers in parallel and renders one section per provider", async () => {
    const monitorsDeferred: Deferred<Array<PaletteSearchResult>> =
      createDeferred<Array<PaletteSearchResult>>();
    const incidentsDeferred: Deferred<Array<PaletteSearchResult>> =
      createDeferred<Array<PaletteSearchResult>>();
    const monitorsSearch: jest.Mock = jest.fn(() => {
      return monitorsDeferred.promise;
    });
    const incidentsSearch: jest.Mock = jest.fn(() => {
      return incidentsDeferred.promise;
    });
    render(
      <CommandPalette
        commands={BASE_COMMANDS}
        searchProviders={[
          { id: "monitors", title: "Monitors", search: monitorsSearch },
          { id: "incidents", title: "Incidents", search: incidentsSearch },
        ]}
        isOpen={true}
        onClose={(): void => {}}
      />,
    );

    typeQuery("api");
    await advance(PROVIDER_SEARCH_DEBOUNCE_MS);

    // Both dispatched before either resolves — parallel, not sequential.
    expect(monitorsSearch).toHaveBeenCalledTimes(1);
    expect(incidentsSearch).toHaveBeenCalledTimes(1);

    await act(async () => {
      monitorsDeferred.resolve([makeResult("m1", "API Monitor")]);
      incidentsDeferred.resolve([makeResult("i1", "API outage")]);
    });

    expect(
      screen.getByTestId("command-palette-section-monitors"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("command-palette-section-incidents"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("command-palette-option-monitors-m1"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("command-palette-option-incidents-i1"),
    ).toBeInTheDocument();
  });

  test("discards a stale response that lands after a newer query was dispatched", async () => {
    const firstDeferred: Deferred<Array<PaletteSearchResult>> =
      createDeferred<Array<PaletteSearchResult>>();
    const secondDeferred: Deferred<Array<PaletteSearchResult>> =
      createDeferred<Array<PaletteSearchResult>>();
    const search: jest.Mock = jest
      .fn(() => {
        return secondDeferred.promise;
      })
      .mockImplementationOnce(() => {
        return firstDeferred.promise;
      });
    render(
      <CommandPalette
        commands={BASE_COMMANDS}
        searchProviders={[{ id: "monitors", title: "Monitors", search }]}
        isOpen={true}
        onClose={(): void => {}}
      />,
    );

    typeQuery("ap");
    await advance(PROVIDER_SEARCH_DEBOUNCE_MS);
    typeQuery("api");
    await advance(PROVIDER_SEARCH_DEBOUNCE_MS);

    expect(search).toHaveBeenCalledTimes(2);

    // The FIRST (now stale) response arrives after the second dispatch.
    await act(async () => {
      firstDeferred.resolve([makeResult("stale", "Stale Monitor")]);
    });

    expect(
      screen.queryByTestId("command-palette-option-monitors-stale"),
    ).toBeNull();
    // Still waiting on the current dispatch.
    expect(
      screen.getByTestId("command-palette-section-pending-monitors"),
    ).toBeInTheDocument();

    await act(async () => {
      secondDeferred.resolve([makeResult("fresh", "Fresh Monitor")]);
    });

    expect(
      screen.getByTestId("command-palette-option-monitors-fresh"),
    ).toHaveTextContent("Fresh Monitor");
  });

  test("shows pending feedback during debounce instead of briefly reporting no matches", () => {
    const search: jest.Mock = jest.fn(() => {
      return Promise.resolve([]);
    });
    render(
      <CommandPalette
        commands={BASE_COMMANDS}
        searchProviders={[{ id: "monitors", title: "Monitors", search }]}
        isOpen={true}
        onClose={(): void => {}}
      />,
    );

    typeQuery("api");

    expect(search).not.toHaveBeenCalled();
    expect(
      screen.getByTestId("command-palette-section-pending-monitors"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("command-palette-empty")).toBeNull();
    expect(
      screen.getByTestId("command-palette-result-count"),
    ).toHaveTextContent("Searching…");
  });

  test("removes settled results immediately when the query changes so Enter cannot select an old match", async () => {
    const onOldResultSelect: jest.Mock = jest.fn();
    const onClose: jest.Mock = jest.fn();
    const currentDeferred: Deferred<Array<PaletteSearchResult>> =
      createDeferred<Array<PaletteSearchResult>>();
    const search: jest.Mock = jest
      .fn(() => {
        return currentDeferred.promise;
      })
      .mockImplementationOnce(() => {
        return Promise.resolve([
          makeResult("old", "API Monitor", onOldResultSelect),
        ]);
      });
    render(
      <CommandPalette
        commands={BASE_COMMANDS}
        searchProviders={[{ id: "monitors", title: "Monitors", search }]}
        isOpen={true}
        onClose={onClose}
      />,
    );

    typeQuery("api");
    await advance(PROVIDER_SEARCH_DEBOUNCE_MS);
    expect(
      screen.getByTestId("command-palette-option-monitors-old"),
    ).toBeInTheDocument();

    typeQuery("database");
    expect(
      screen.queryByTestId("command-palette-option-monitors-old"),
    ).toBeNull();
    fireEvent.keyDown(screen.getByTestId("command-palette-input"), {
      key: "Enter",
    });
    expect(onOldResultSelect).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    await advance(PROVIDER_SEARCH_DEBOUNCE_MS);
    expect(
      screen.queryByTestId("command-palette-option-monitors-old"),
    ).toBeNull();
    await act(async () => {
      currentDeferred.resolve([makeResult("new", "Database Monitor")]);
    });
    expect(
      screen.getByTestId("command-palette-option-monitors-new"),
    ).toHaveTextContent("Database Monitor");
  });

  test("discards an old response arriving while the new query is still debouncing", async () => {
    const firstDeferred: Deferred<Array<PaletteSearchResult>> =
      createDeferred<Array<PaletteSearchResult>>();
    const secondDeferred: Deferred<Array<PaletteSearchResult>> =
      createDeferred<Array<PaletteSearchResult>>();
    const search: jest.Mock = jest
      .fn(() => {
        return secondDeferred.promise;
      })
      .mockImplementationOnce(() => {
        return firstDeferred.promise;
      });
    render(
      <CommandPalette
        commands={BASE_COMMANDS}
        searchProviders={[{ id: "monitors", title: "Monitors", search }]}
        isOpen={true}
        onClose={(): void => {}}
      />,
    );

    typeQuery("api");
    await advance(PROVIDER_SEARCH_DEBOUNCE_MS);
    typeQuery("database");
    await advance(PROVIDER_SEARCH_DEBOUNCE_MS - 1);
    await act(async () => {
      firstDeferred.resolve([makeResult("old", "API Monitor")]);
    });

    expect(search).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByTestId("command-palette-option-monitors-old"),
    ).toBeNull();
    expect(
      screen.getByTestId("command-palette-section-pending-monitors"),
    ).toBeInTheDocument();

    await advance(1);
    await act(async () => {
      secondDeferred.resolve([makeResult("new", "Database Monitor")]);
    });
    expect(
      screen.getByTestId("command-palette-option-monitors-new"),
    ).toBeInTheDocument();
  });

  test("an old rejection cannot clear the new query's pending feedback during debounce", async () => {
    const firstDeferred: Deferred<Array<PaletteSearchResult>> =
      createDeferred<Array<PaletteSearchResult>>();
    const secondDeferred: Deferred<Array<PaletteSearchResult>> =
      createDeferred<Array<PaletteSearchResult>>();
    const search: jest.Mock = jest
      .fn(() => {
        return secondDeferred.promise;
      })
      .mockImplementationOnce(() => {
        return firstDeferred.promise;
      });
    render(
      <CommandPalette
        commands={BASE_COMMANDS}
        searchProviders={[{ id: "monitors", title: "Monitors", search }]}
        isOpen={true}
        onClose={(): void => {}}
      />,
    );

    typeQuery("api");
    await advance(PROVIDER_SEARCH_DEBOUNCE_MS);
    typeQuery("database");
    await act(async () => {
      firstDeferred.reject(new Error("Old request failed"));
    });

    expect(
      screen.getByTestId("command-palette-section-pending-monitors"),
    ).toBeInTheDocument();
    expect(search).toHaveBeenCalledTimes(1);
    await advance(PROVIDER_SEARCH_DEBOUNCE_MS);
    await act(async () => {
      secondDeferred.resolve([makeResult("new", "Database Monitor")]);
    });
    expect(
      screen.getByTestId("command-palette-option-monitors-new"),
    ).toBeInTheDocument();
  });

  test("replacing a provider with the same id hides the previous provider's results", async () => {
    const replacementDeferred: Deferred<Array<PaletteSearchResult>> =
      createDeferred<Array<PaletteSearchResult>>();
    const oldSearch: jest.Mock = jest.fn(() => {
      return Promise.resolve([makeResult("old", "First project's API")]);
    });
    const replacementSearch: jest.Mock = jest.fn(() => {
      return replacementDeferred.promise;
    });
    const view: ReturnType<typeof render> = render(
      <CommandPalette
        commands={BASE_COMMANDS}
        searchProviders={[
          { id: "monitors", title: "Monitors", search: oldSearch },
        ]}
        isOpen={true}
        onClose={(): void => {}}
      />,
    );

    typeQuery("api");
    await advance(PROVIDER_SEARCH_DEBOUNCE_MS);
    expect(
      screen.getByTestId("command-palette-option-monitors-old"),
    ).toBeInTheDocument();

    view.rerender(
      <CommandPalette
        commands={BASE_COMMANDS}
        searchProviders={[
          { id: "monitors", title: "Monitors", search: replacementSearch },
        ]}
        isOpen={true}
        onClose={(): void => {}}
      />,
    );
    expect(
      screen.queryByTestId("command-palette-option-monitors-old"),
    ).toBeNull();
    expect(
      screen.getByTestId("command-palette-section-pending-monitors"),
    ).toBeInTheDocument();

    await advance(PROVIDER_SEARCH_DEBOUNCE_MS);
    await act(async () => {
      replacementDeferred.resolve([makeResult("new", "Second project's API")]);
    });
    expect(
      screen.getByTestId("command-palette-option-monitors-new"),
    ).toHaveTextContent("Second project's API");
  });

  test("removing and restoring providers cannot revive a result that arrived while they were absent", async () => {
    const firstDeferred: Deferred<Array<PaletteSearchResult>> =
      createDeferred<Array<PaletteSearchResult>>();
    const secondDeferred: Deferred<Array<PaletteSearchResult>> =
      createDeferred<Array<PaletteSearchResult>>();
    const search: jest.Mock = jest
      .fn(() => {
        return secondDeferred.promise;
      })
      .mockImplementationOnce(() => {
        return firstDeferred.promise;
      });
    const providers: Array<PaletteSearchProvider> = [
      { id: "monitors", title: "Monitors", search },
    ];
    const view: ReturnType<typeof render> = render(
      <CommandPalette
        commands={BASE_COMMANDS}
        searchProviders={providers}
        isOpen={true}
        onClose={(): void => {}}
      />,
    );

    typeQuery("api");
    await advance(PROVIDER_SEARCH_DEBOUNCE_MS);
    view.rerender(
      <CommandPalette
        commands={BASE_COMMANDS}
        searchProviders={[]}
        isOpen={true}
        onClose={(): void => {}}
      />,
    );
    await act(async () => {
      firstDeferred.resolve([makeResult("old", "Old API")]);
    });
    view.rerender(
      <CommandPalette
        commands={BASE_COMMANDS}
        searchProviders={providers}
        isOpen={true}
        onClose={(): void => {}}
      />,
    );

    expect(
      screen.queryByTestId("command-palette-option-monitors-old"),
    ).toBeNull();
    await advance(PROVIDER_SEARCH_DEBOUNCE_MS);
    await act(async () => {
      secondDeferred.resolve([makeResult("new", "Current API")]);
    });
    expect(
      screen.getByTestId("command-palette-option-monitors-new"),
    ).toHaveTextContent("Current API");
  });

  test("clearing a query discards an in-flight response and cancels pending feedback", async () => {
    const deferred: Deferred<Array<PaletteSearchResult>> =
      createDeferred<Array<PaletteSearchResult>>();
    const search: jest.Mock = jest.fn(() => {
      return deferred.promise;
    });
    render(
      <CommandPalette
        commands={BASE_COMMANDS}
        searchProviders={[{ id: "monitors", title: "Monitors", search }]}
        isOpen={true}
        onClose={(): void => {}}
      />,
    );

    typeQuery("api");
    await advance(PROVIDER_SEARCH_DEBOUNCE_MS);
    typeQuery("a");
    await act(async () => {
      deferred.resolve([makeResult("old", "API Monitor")]);
    });

    expect(
      screen.queryByTestId("command-palette-option-monitors-old"),
    ).toBeNull();
    expect(
      screen.queryByTestId("command-palette-section-pending-monitors"),
    ).toBeNull();
    await advance(PROVIDER_SEARCH_DEBOUNCE_MS);
    expect(search).toHaveBeenCalledTimes(1);
  });

  test("closing the palette cancels a debounced search", async () => {
    const search: jest.Mock = jest.fn(() => {
      return Promise.resolve([]);
    });
    const providers: Array<PaletteSearchProvider> = [
      { id: "monitors", title: "Monitors", search },
    ];
    const view: ReturnType<typeof render> = render(
      <CommandPalette
        commands={BASE_COMMANDS}
        searchProviders={providers}
        isOpen={true}
        onClose={(): void => {}}
      />,
    );

    typeQuery("api");
    view.rerender(
      <CommandPalette
        commands={BASE_COMMANDS}
        searchProviders={providers}
        isOpen={false}
        onClose={(): void => {}}
      />,
    );
    await advance(PROVIDER_SEARCH_DEBOUNCE_MS);
    expect(search).not.toHaveBeenCalled();
  });

  test("whitespace-only query changes retain results without repeating the search", async () => {
    const search: jest.Mock = jest.fn(() => {
      return Promise.resolve([makeResult("m1", "API Monitor")]);
    });
    render(
      <CommandPalette
        commands={BASE_COMMANDS}
        searchProviders={[{ id: "monitors", title: "Monitors", search }]}
        isOpen={true}
        onClose={(): void => {}}
      />,
    );

    typeQuery("api");
    await advance(PROVIDER_SEARCH_DEBOUNCE_MS);
    typeQuery("  api  ");
    expect(
      screen.getByTestId("command-palette-option-monitors-m1"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("command-palette-section-pending-monitors"),
    ).toBeNull();
    await advance(PROVIDER_SEARCH_DEBOUNCE_MS);
    expect(search).toHaveBeenCalledTimes(1);
  });

  test("a rejecting provider shows nothing while the others still render", async () => {
    const failingSearch: jest.Mock = jest.fn(() => {
      return Promise.reject(new Error("backend down"));
    });
    const workingDeferred: Deferred<Array<PaletteSearchResult>> =
      createDeferred<Array<PaletteSearchResult>>();
    const workingSearch: jest.Mock = jest.fn(() => {
      return workingDeferred.promise;
    });
    render(
      <CommandPalette
        commands={BASE_COMMANDS}
        searchProviders={[
          { id: "incidents", title: "Incidents", search: failingSearch },
          { id: "monitors", title: "Monitors", search: workingSearch },
        ]}
        isOpen={true}
        onClose={(): void => {}}
      />,
    );

    typeQuery("api");
    await advance(PROVIDER_SEARCH_DEBOUNCE_MS);

    await act(async () => {
      workingDeferred.resolve([makeResult("m1", "API Monitor")]);
    });

    // The failed provider's section vanished entirely — no error surface.
    expect(
      screen.queryByTestId("command-palette-section-incidents"),
    ).toBeNull();
    expect(
      screen.queryByTestId("command-palette-section-pending-incidents"),
    ).toBeNull();
    expect(
      screen.getByTestId("command-palette-option-monitors-m1"),
    ).toBeInTheDocument();
  });

  test("provider results join the flat keyboard order and Enter selects them", async () => {
    const onResultSelect: jest.Mock = jest.fn();
    const onClose: jest.Mock = jest.fn();
    const search: jest.Mock = jest.fn(() => {
      return Promise.resolve([makeResult("m1", "API Monitor", onResultSelect)]);
    });
    render(
      <CommandPalette
        commands={BASE_COMMANDS}
        searchProviders={[{ id: "monitors", title: "Monitors", search }]}
        isOpen={true}
        onClose={onClose}
        recentStorageKey="provider-recents-key"
      />,
    );

    typeQuery("monitors");
    await act(async () => {
      jest.advanceTimersByTime(PROVIDER_SEARCH_DEBOUNCE_MS);
    });

    const input: HTMLElement = screen.getByTestId("command-palette-input");

    // Flat order: the matching command first, then the provider row.
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(
      screen.getByTestId("command-palette-option-monitors-m1"),
    ).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(input, { key: "Enter" });

    expect(onResultSelect).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    // Provider results are not commands: nothing is recorded into recents.
    expect(window.localStorage.getItem("provider-recents-key")).toBeNull();
  });

  test("clearing the query below the minimum drops provider results", async () => {
    const search: jest.Mock = jest.fn(() => {
      return Promise.resolve([makeResult("m1", "API Monitor")]);
    });
    render(
      <CommandPalette
        commands={BASE_COMMANDS}
        searchProviders={[{ id: "monitors", title: "Monitors", search }]}
        isOpen={true}
        onClose={(): void => {}}
      />,
    );

    typeQuery("api");
    await act(async () => {
      jest.advanceTimersByTime(PROVIDER_SEARCH_DEBOUNCE_MS);
    });

    expect(
      screen.getByTestId("command-palette-option-monitors-m1"),
    ).toBeInTheDocument();

    typeQuery("");

    expect(
      screen.queryByTestId("command-palette-option-monitors-m1"),
    ).toBeNull();
    expect(screen.queryByTestId("command-palette-section-monitors")).toBeNull();
  });
});
