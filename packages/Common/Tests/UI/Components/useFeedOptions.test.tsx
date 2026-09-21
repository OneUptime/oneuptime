/*
 * jest itself is the global one: @jest/globals types spyOn(Storage.prototype,
 * ...) as never, because Storage has a string index signature.
 */
import { afterEach, describe, expect, test } from "@jest/globals";
import {
  act,
  cleanup,
  renderHook,
  RenderHookResult,
} from "@testing-library/react";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import IconProp from "../../../Types/Icon/IconProp";
import {
  DEFAULT_FEED_OPTIONS,
  FeedEventTypeOption,
  FeedOptions,
  getFeedOptionsKey,
} from "../../../UI/Components/Feed/FeedOptions";
import useFeedOptions, {
  getSortOrderStorageKey,
  UseFeedOptionsProps,
  UseFeedOptionsResult,
} from "../../../UI/Components/Feed/useFeedOptions";

/*
 * A stand-in for a feed model's event type enum. It is declared out of label
 * order on purpose, so the tests can tell the feed's own order (what the
 * filter is sent in) apart from label order (what the checklist shows).
 */
enum TestFeedEventType {
  StateChanged = "StateChanged",
  OwnerUserAdded = "OwnerUserAdded",
  IncidentCreated = "IncidentCreated",
  AutoRemediation = "AutoRemediation",
}

const TEST_EVENT_TYPES: Array<string> = Object.values(TestFeedEventType);

const TEST_EVENT_TYPE_ICONS: Record<TestFeedEventType, IconProp> = {
  [TestFeedEventType.StateChanged]: IconProp.ArrowCircleRight,
  [TestFeedEventType.OwnerUserAdded]: IconProp.User,
  [TestFeedEventType.IncidentCreated]: IconProp.Alert,
  [TestFeedEventType.AutoRemediation]: IconProp.Wrench,
};

/*
 * Module-level, like the feeds' own helpers, so the functions keep their
 * identity across renders.
 */
const getTestEventTypeIcon: (eventType: string) => IconProp | undefined = (
  eventType: string,
): IconProp | undefined => {
  return TEST_EVENT_TYPE_ICONS[eventType as TestFeedEventType];
};

const getTestEventTypeLabel: (eventType: string) => string | undefined = (
  eventType: string,
): string | undefined => {
  return eventType === TestFeedEventType.StateChanged
    ? "Status Changed"
    : undefined;
};

const STORAGE_KEY: string = "monitor";
const STORED_SORT_ORDER_KEY: string = "feed-sort-order:monitor";

type FeedOptionsHook = RenderHookResult<
  UseFeedOptionsResult,
  UseFeedOptionsProps
>;

type RenderFeedOptions = (props: UseFeedOptionsProps) => FeedOptionsHook;

const renderFeedOptions: RenderFeedOptions = (
  props: UseFeedOptionsProps,
): FeedOptionsHook => {
  return renderHook(
    (hookProps: UseFeedOptionsProps): UseFeedOptionsResult => {
      return useFeedOptions(hookProps);
    },
    { initialProps: props },
  );
};

type SetFeedOptions = (hook: FeedOptionsHook, options: FeedOptions) => void;

// The same call FeedOptionsButton makes when the reader changes something.
const setFeedOptions: SetFeedOptions = (
  hook: FeedOptionsHook,
  options: FeedOptions,
): void => {
  act(() => {
    hook.result.current.setOptions(options);
  });
};

// What one render of the hook handed the feed page.
interface OptionsRender {
  resetKey: string | undefined;
  options: FeedOptions;
  optionsKey: string;
  isFiltered: boolean;
}

interface FeedOptionsHarness {
  hook: FeedOptionsHook;
  renders: Array<OptionsRender>;
}

type RenderFeedOptionsWithHistory = (
  props: UseFeedOptionsProps,
) => FeedOptionsHarness;

/*
 * Records every time the hook runs, including a render React throws away and
 * runs again because the hook adjusted its state while rendering. Asserting
 * over all of them proves that no render - committed or not - handed the page
 * options it could have built a request from that the reader never chose.
 */
const renderFeedOptionsWithHistory: RenderFeedOptionsWithHistory = (
  props: UseFeedOptionsProps,
): FeedOptionsHarness => {
  const renders: Array<OptionsRender> = [];

  const hook: FeedOptionsHook = renderHook(
    (hookProps: UseFeedOptionsProps): UseFeedOptionsResult => {
      const result: UseFeedOptionsResult = useFeedOptions(hookProps);

      renders.push({
        resetKey: hookProps.resetKey,
        options: result.options,
        optionsKey: result.optionsKey,
        isFiltered: result.isFiltered,
      });

      return result;
    },
    { initialProps: props },
  );

  return { hook: hook, renders: renders };
};

type GetUnfilteredRender = (
  resetKey: string | undefined,
  sortOrder: SortOrder,
) => OptionsRender;

const getUnfilteredRender: GetUnfilteredRender = (
  resetKey: string | undefined,
  sortOrder: SortOrder,
): OptionsRender => {
  const options: FeedOptions = { sortOrder: sortOrder, eventTypes: [] };

  return {
    resetKey: resetKey,
    options: options,
    optionsKey: getFeedOptionsKey(options),
    isFiltered: false,
  };
};

type ExpectEveryRender = (
  renders: Array<OptionsRender>,
  expected: OptionsRender,
) => void;

// Compared as a whole list, so a failure names the render that was wrong.
const expectEveryRender: ExpectEveryRender = (
  renders: Array<OptionsRender>,
  expected: OptionsRender,
): void => {
  expect(renders.length).toBeGreaterThan(0);
  expect(renders).toEqual(
    renders.map((): OptionsRender => {
      return expected;
    }),
  );
};

type RecordStorageWrites = () => Array<string>;

/*
 * Records every storage write instead of making it. Reads still reach the
 * real storage, so a value stored before the call is read back as usual.
 */
const recordStorageWrites: RecordStorageWrites = (): Array<string> => {
  const writes: Array<string> = [];

  jest
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation((key: string, value: string): void => {
      writes.push(`setItem ${key} ${value}`);
    });
  jest
    .spyOn(Storage.prototype, "removeItem")
    .mockImplementation((key: string): void => {
      writes.push(`removeItem ${key}`);
    });

  return writes;
};

type GetStoredKeys = () => Array<string>;

const getStoredKeys: GetStoredKeys = (): Array<string> => {
  const keys: Array<string> = [];

  for (let index: number = 0; index < window.localStorage.length; index++) {
    const key: string | null = window.localStorage.key(index);

    if (key !== null) {
      keys.push(key);
    }
  }

  return keys;
};

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.localStorage.clear();
});

describe("useFeedOptions defaults", () => {
  test("starts newest first with every event type shown", () => {
    const hook: FeedOptionsHook = renderFeedOptions({
      eventTypes: TEST_EVENT_TYPES,
      storageKey: STORAGE_KEY,
    });

    expect(hook.result.current.options).toEqual({
      sortOrder: SortOrder.Descending,
      eventTypes: [],
    });
    expect(hook.result.current.options).toEqual(DEFAULT_FEED_OPTIONS);
    expect(hook.result.current.isFiltered).toBe(false);
    expect(hook.result.current.optionsKey).toBe(
      getFeedOptionsKey(DEFAULT_FEED_OPTIONS),
    );
  });
});

describe("useFeedOptions event type options", () => {
  test("lists each event type once, labelled and with its icon, alphabetically by label", () => {
    const hook: FeedOptionsHook = renderFeedOptions({
      eventTypes: [...TEST_EVENT_TYPES, TestFeedEventType.IncidentCreated],
      getEventTypeLabel: getTestEventTypeLabel,
      getEventTypeIcon: getTestEventTypeIcon,
    });

    expect(hook.result.current.eventTypeOptions).toEqual([
      {
        value: TestFeedEventType.AutoRemediation,
        label: "Auto-Remediation",
        icon: IconProp.Wrench,
      },
      {
        value: TestFeedEventType.IncidentCreated,
        label: "Incident Created",
        icon: IconProp.Alert,
      },
      // The caller's own label wins over the generated "State Changed".
      {
        value: TestFeedEventType.StateChanged,
        label: "Status Changed",
        icon: IconProp.ArrowCircleRight,
      },
      {
        value: TestFeedEventType.OwnerUserAdded,
        label: "User Added as Owner",
        icon: IconProp.User,
      },
    ]);
  });

  /*
   * Every feed passes Object.values(its enum), a new array on each render. The
   * checklist must not be rebuilt - and the options must not change identity -
   * just because the parent re-rendered.
   */
  test("keeps the same list across re-renders when the caller passes a new array with the same values", () => {
    const hook: RenderHookResult<UseFeedOptionsResult, unknown> = renderHook(
      (): UseFeedOptionsResult => {
        return useFeedOptions({
          eventTypes: Object.values(TestFeedEventType),
          getEventTypeLabel: getTestEventTypeLabel,
          getEventTypeIcon: getTestEventTypeIcon,
        });
      },
    );

    const firstEventTypeOptions: Array<FeedEventTypeOption> =
      hook.result.current.eventTypeOptions;
    const firstOptions: FeedOptions = hook.result.current.options;
    const firstSetOptions: (options: FeedOptions) => void =
      hook.result.current.setOptions;

    hook.rerender();
    hook.rerender();

    expect(hook.result.current.eventTypeOptions).toBe(firstEventTypeOptions);
    expect(hook.result.current.options).toBe(firstOptions);
    expect(hook.result.current.setOptions).toBe(firstSetOptions);
  });

  test("rebuilds the list when the event types change", () => {
    const hook: FeedOptionsHook = renderFeedOptions({
      eventTypes: [
        TestFeedEventType.StateChanged,
        TestFeedEventType.IncidentCreated,
      ],
    });

    const firstEventTypeOptions: Array<FeedEventTypeOption> =
      hook.result.current.eventTypeOptions;

    hook.rerender({
      eventTypes: [
        TestFeedEventType.StateChanged,
        TestFeedEventType.IncidentCreated,
      ],
    });

    expect(hook.result.current.eventTypeOptions).toBe(firstEventTypeOptions);

    hook.rerender({
      eventTypes: [
        TestFeedEventType.StateChanged,
        TestFeedEventType.IncidentCreated,
        TestFeedEventType.AutoRemediation,
      ],
    });

    expect(hook.result.current.eventTypeOptions).not.toBe(
      firstEventTypeOptions,
    );
    expect(
      hook.result.current.eventTypeOptions.map(
        (option: FeedEventTypeOption): string => {
          return option.value;
        },
      ),
    ).toEqual([
      TestFeedEventType.AutoRemediation,
      TestFeedEventType.IncidentCreated,
      TestFeedEventType.StateChanged,
    ]);
  });
});

describe("useFeedOptions setOptions", () => {
  test("keeps only event types the feed has, once each, in the feed's own order", () => {
    const hook: FeedOptionsHook = renderFeedOptions({
      eventTypes: TEST_EVENT_TYPES,
    });

    setFeedOptions(hook, {
      sortOrder: SortOrder.Descending,
      eventTypes: [
        TestFeedEventType.AutoRemediation,
        "NotAFeedEventType",
        TestFeedEventType.StateChanged,
        TestFeedEventType.AutoRemediation,
      ],
    });

    const expectedOptions: FeedOptions = {
      sortOrder: SortOrder.Descending,
      eventTypes: [
        TestFeedEventType.StateChanged,
        TestFeedEventType.AutoRemediation,
      ],
    };

    expect(hook.result.current.options).toEqual(expectedOptions);
    expect(hook.result.current.isFiltered).toBe(true);
    expect(hook.result.current.optionsKey).toBe(
      getFeedOptionsKey(expectedOptions),
    );
  });

  test("a filter made only of event types the feed does not have is no filter", () => {
    const hook: FeedOptionsHook = renderFeedOptions({
      eventTypes: TEST_EVENT_TYPES,
    });

    setFeedOptions(hook, {
      sortOrder: SortOrder.Descending,
      eventTypes: ["NotAFeedEventType"],
    });

    expect(hook.result.current.options.eventTypes).toEqual([]);
    expect(hook.result.current.isFiltered).toBe(false);
    expect(hook.result.current.optionsKey).toBe(
      getFeedOptionsKey(DEFAULT_FEED_OPTIONS),
    );
  });

  test("falls back to newest first for a sort order it does not know", () => {
    const hook: FeedOptionsHook = renderFeedOptions({
      eventTypes: TEST_EVENT_TYPES,
      storageKey: STORAGE_KEY,
    });

    setFeedOptions(hook, { sortOrder: SortOrder.Ascending, eventTypes: [] });
    expect(window.localStorage.getItem(STORED_SORT_ORDER_KEY)).toBe(
      SortOrder.Ascending,
    );

    setFeedOptions(hook, {
      sortOrder: "sideways" as unknown as SortOrder,
      eventTypes: [],
    });

    expect(hook.result.current.options.sortOrder).toBe(SortOrder.Descending);
    expect(window.localStorage.getItem(STORED_SORT_ORDER_KEY)).toBeNull();
  });

  test("changes optionsKey on a sort change and on a filter change", () => {
    const hook: FeedOptionsHook = renderFeedOptions({
      eventTypes: TEST_EVENT_TYPES,
    });

    const defaultKey: string = hook.result.current.optionsKey;

    setFeedOptions(hook, { sortOrder: SortOrder.Ascending, eventTypes: [] });
    const oldestFirstKey: string = hook.result.current.optionsKey;
    expect(hook.result.current.isFiltered).toBe(false);

    setFeedOptions(hook, {
      sortOrder: SortOrder.Ascending,
      eventTypes: [TestFeedEventType.IncidentCreated],
    });
    const oneTypeKey: string = hook.result.current.optionsKey;
    expect(hook.result.current.isFiltered).toBe(true);

    setFeedOptions(hook, {
      sortOrder: SortOrder.Ascending,
      eventTypes: [
        TestFeedEventType.AutoRemediation,
        TestFeedEventType.IncidentCreated,
      ],
    });
    const twoTypesKey: string = hook.result.current.optionsKey;

    expect(
      new Set<string>([defaultKey, oldestFirstKey, oneTypeKey, twoTypesKey])
        .size,
    ).toBe(4);

    // Ticking the same boxes in another order is the same view.
    setFeedOptions(hook, {
      sortOrder: SortOrder.Ascending,
      eventTypes: [
        TestFeedEventType.IncidentCreated,
        TestFeedEventType.AutoRemediation,
      ],
    });
    expect(hook.result.current.optionsKey).toBe(twoTypesKey);

    setFeedOptions(hook, { sortOrder: SortOrder.Descending, eventTypes: [] });
    expect(hook.result.current.optionsKey).toBe(defaultKey);
    expect(hook.result.current.isFiltered).toBe(false);
  });

  test("drops a selected event type the feed no longer has", () => {
    const hook: FeedOptionsHook = renderFeedOptions({
      eventTypes: TEST_EVENT_TYPES,
    });

    setFeedOptions(hook, {
      sortOrder: SortOrder.Descending,
      eventTypes: [
        TestFeedEventType.IncidentCreated,
        TestFeedEventType.AutoRemediation,
      ],
    });

    hook.rerender({
      eventTypes: [
        TestFeedEventType.StateChanged,
        TestFeedEventType.IncidentCreated,
      ],
    });

    expect(hook.result.current.options.eventTypes).toEqual([
      TestFeedEventType.IncidentCreated,
    ]);
    expect(hook.result.current.optionsKey).toBe(
      getFeedOptionsKey({
        sortOrder: SortOrder.Descending,
        eventTypes: [TestFeedEventType.IncidentCreated],
      }),
    );
  });
});

describe("useFeedOptions sort order storage", () => {
  test("remembers oldest first under feed-sort-order:<storageKey>", () => {
    expect(getSortOrderStorageKey(STORAGE_KEY)).toBe(STORED_SORT_ORDER_KEY);

    const hook: FeedOptionsHook = renderFeedOptions({
      eventTypes: TEST_EVENT_TYPES,
      storageKey: STORAGE_KEY,
    });

    expect(window.localStorage.getItem(STORED_SORT_ORDER_KEY)).toBeNull();

    setFeedOptions(hook, { sortOrder: SortOrder.Ascending, eventTypes: [] });

    expect(window.localStorage.getItem(STORED_SORT_ORDER_KEY)).toBe(
      SortOrder.Ascending,
    );

    // A filter change on its own leaves the remembered order as it was.
    setFeedOptions(hook, {
      sortOrder: SortOrder.Ascending,
      eventTypes: [TestFeedEventType.IncidentCreated],
    });

    expect(window.localStorage.getItem(STORED_SORT_ORDER_KEY)).toBe(
      SortOrder.Ascending,
    );
  });

  test("forgets the stored order when the reader goes back to newest first", () => {
    const hook: FeedOptionsHook = renderFeedOptions({
      eventTypes: TEST_EVENT_TYPES,
      storageKey: STORAGE_KEY,
    });

    setFeedOptions(hook, { sortOrder: SortOrder.Ascending, eventTypes: [] });
    setFeedOptions(hook, { sortOrder: SortOrder.Descending, eventTypes: [] });

    expect(hook.result.current.options.sortOrder).toBe(SortOrder.Descending);
    expect(window.localStorage.getItem(STORED_SORT_ORDER_KEY)).toBeNull();
    expect(getStoredKeys()).toEqual([]);
  });

  test("restores the stored order on mount", () => {
    window.localStorage.setItem(STORED_SORT_ORDER_KEY, SortOrder.Ascending);

    const hook: FeedOptionsHook = renderFeedOptions({
      eventTypes: TEST_EVENT_TYPES,
      storageKey: STORAGE_KEY,
    });

    const expectedOptions: FeedOptions = {
      sortOrder: SortOrder.Ascending,
      eventTypes: [],
    };

    expect(hook.result.current.options).toEqual(expectedOptions);
    expect(hook.result.current.optionsKey).toBe(
      getFeedOptionsKey(expectedOptions),
    );
    expect(hook.result.current.isFiltered).toBe(false);

    // Going back to newest first from a restored order forgets it too.
    setFeedOptions(hook, { sortOrder: SortOrder.Descending, eventTypes: [] });

    expect(window.localStorage.getItem(STORED_SORT_ORDER_KEY)).toBeNull();
  });

  test.each([
    "sideways",
    "asc",
    "",
    "null",
    "42",
    '["ASC"]',
    '{"sortOrder":"ASC"}',
  ])(
    "ignores a stored value that is not a sort order: %p",
    (storedValue: string) => {
      window.localStorage.setItem(STORED_SORT_ORDER_KEY, storedValue);

      const hook: FeedOptionsHook = renderFeedOptions({
        eventTypes: TEST_EVENT_TYPES,
        storageKey: STORAGE_KEY,
      });

      expect(hook.result.current.options).toEqual(DEFAULT_FEED_OPTIONS);
      expect(hook.result.current.optionsKey).toBe(
        getFeedOptionsKey(DEFAULT_FEED_OPTIONS),
      );

      // The reader's next choice replaces whatever was there.
      setFeedOptions(hook, { sortOrder: SortOrder.Ascending, eventTypes: [] });

      expect(window.localStorage.getItem(STORED_SORT_ORDER_KEY)).toBe(
        SortOrder.Ascending,
      );
    },
  );

  test("falls back to newest first when reading storage throws, and still sorts", () => {
    jest
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation((): string | null => {
        throw new Error("SecurityError: storage is disabled");
      });

    const hook: FeedOptionsHook = renderFeedOptions({
      eventTypes: TEST_EVENT_TYPES,
      storageKey: STORAGE_KEY,
    });

    expect(hook.result.current.options).toEqual(DEFAULT_FEED_OPTIONS);

    setFeedOptions(hook, { sortOrder: SortOrder.Ascending, eventTypes: [] });

    expect(hook.result.current.options.sortOrder).toBe(SortOrder.Ascending);
  });

  test("still applies a sort order that storage refuses to save", () => {
    jest.spyOn(Storage.prototype, "setItem").mockImplementation((): void => {
      throw new Error("QuotaExceededError: storage is full");
    });

    const hook: FeedOptionsHook = renderFeedOptions({
      eventTypes: TEST_EVENT_TYPES,
      storageKey: STORAGE_KEY,
    });

    const expectedOptions: FeedOptions = {
      sortOrder: SortOrder.Ascending,
      eventTypes: [TestFeedEventType.IncidentCreated],
    };

    setFeedOptions(hook, expectedOptions);

    expect(hook.result.current.options).toEqual(expectedOptions);
    expect(hook.result.current.optionsKey).toBe(
      getFeedOptionsKey(expectedOptions),
    );
  });

  test("still goes back to newest first when storage refuses to forget the old order", () => {
    window.localStorage.setItem(STORED_SORT_ORDER_KEY, SortOrder.Ascending);

    jest.spyOn(Storage.prototype, "removeItem").mockImplementation((): void => {
      throw new Error("SecurityError: storage is disabled");
    });

    const hook: FeedOptionsHook = renderFeedOptions({
      eventTypes: TEST_EVENT_TYPES,
      storageKey: STORAGE_KEY,
    });

    expect(hook.result.current.options.sortOrder).toBe(SortOrder.Ascending);

    setFeedOptions(hook, { sortOrder: SortOrder.Descending, eventTypes: [] });

    expect(hook.result.current.options).toEqual(DEFAULT_FEED_OPTIONS);
    expect(hook.result.current.optionsKey).toBe(
      getFeedOptionsKey(DEFAULT_FEED_OPTIONS),
    );
  });

  test.each([undefined, ""])(
    "never touches storage when storageKey is %p",
    (storageKey: string | undefined) => {
      const storageCalls: Array<string> = [];

      jest
        .spyOn(Storage.prototype, "getItem")
        .mockImplementation((key: string): string | null => {
          storageCalls.push(`getItem ${key}`);
          return null;
        });
      jest
        .spyOn(Storage.prototype, "setItem")
        .mockImplementation((key: string): void => {
          storageCalls.push(`setItem ${key}`);
        });
      jest
        .spyOn(Storage.prototype, "removeItem")
        .mockImplementation((key: string): void => {
          storageCalls.push(`removeItem ${key}`);
        });

      const hook: FeedOptionsHook = renderFeedOptions({
        eventTypes: TEST_EVENT_TYPES,
        storageKey: storageKey,
      });

      setFeedOptions(hook, { sortOrder: SortOrder.Ascending, eventTypes: [] });
      setFeedOptions(hook, {
        sortOrder: SortOrder.Descending,
        eventTypes: [TestFeedEventType.IncidentCreated],
      });

      expect(hook.result.current.options).toEqual({
        sortOrder: SortOrder.Descending,
        eventTypes: [TestFeedEventType.IncidentCreated],
      });
      expect(storageCalls).toEqual([]);

      // The spies do see a feed with a storage key: the check is not vacuous.
      renderFeedOptions({
        eventTypes: TEST_EVENT_TYPES,
        storageKey: STORAGE_KEY,
      });

      expect(storageCalls).toEqual([`getItem ${STORED_SORT_ORDER_KEY}`]);
    },
  );

  /*
   * The filter narrows one investigation. Carried to the next page it would
   * read as a feed with missing events, so only the sort order survives.
   */
  test("does not remember the event type filter", () => {
    const firstVisit: FeedOptionsHook = renderFeedOptions({
      eventTypes: TEST_EVENT_TYPES,
      storageKey: STORAGE_KEY,
    });

    setFeedOptions(firstVisit, {
      sortOrder: SortOrder.Ascending,
      eventTypes: [TestFeedEventType.IncidentCreated],
    });

    expect(firstVisit.result.current.isFiltered).toBe(true);
    expect(getStoredKeys()).toEqual([STORED_SORT_ORDER_KEY]);

    firstVisit.unmount();

    const nextVisit: FeedOptionsHook = renderFeedOptions({
      eventTypes: TEST_EVENT_TYPES,
      storageKey: STORAGE_KEY,
    });

    expect(nextVisit.result.current.options).toEqual({
      sortOrder: SortOrder.Ascending,
      eventTypes: [],
    });
    expect(nextVisit.result.current.isFiltered).toBe(false);
  });

  test("keeps each storage key's order separate", () => {
    const incidentFeed: FeedOptionsHook = renderFeedOptions({
      eventTypes: TEST_EVENT_TYPES,
      storageKey: "incident",
    });
    const alertFeed: FeedOptionsHook = renderFeedOptions({
      eventTypes: TEST_EVENT_TYPES,
      storageKey: "alert",
    });

    setFeedOptions(incidentFeed, {
      sortOrder: SortOrder.Ascending,
      eventTypes: [],
    });

    expect(incidentFeed.result.current.options.sortOrder).toBe(
      SortOrder.Ascending,
    );
    expect(alertFeed.result.current.options.sortOrder).toBe(
      SortOrder.Descending,
    );
    expect(window.localStorage.getItem("feed-sort-order:incident")).toBe(
      SortOrder.Ascending,
    );
    expect(window.localStorage.getItem("feed-sort-order:alert")).toBeNull();

    incidentFeed.unmount();
    alertFeed.unmount();

    expect(
      renderFeedOptions({
        eventTypes: TEST_EVENT_TYPES,
        storageKey: "incident",
      }).result.current.options.sortOrder,
    ).toBe(SortOrder.Ascending);
    expect(
      renderFeedOptions({
        eventTypes: TEST_EVENT_TYPES,
        storageKey: "alert",
      }).result.current.options.sortOrder,
    ).toBe(SortOrder.Descending);
  });
});

/*
 * A type alias rather than an interface on purpose: jest's object-form
 * test.each is typed against Record<string, unknown>, which an interface does
 * not satisfy (it has no implicit index signature).
 */
type BatchedChangesCase = {
  name: string;
  storedBefore: SortOrder | null;
  first: FeedOptions;
  last: FeedOptions;
  storedAfter: SortOrder | null;
};

describe("useFeedOptions stored sort order follows what the page shows", () => {
  /*
   * One event handler can call setOptions twice. React renders once, with the
   * second call's options, so storage must end up with the second call's
   * order too - not the first's, or the next visit opens in an order the page
   * never showed.
   */
  test.each<BatchedChangesCase>([
    {
      name: "newest first -> oldest first -> newest first",
      storedBefore: null,
      first: { sortOrder: SortOrder.Ascending, eventTypes: [] },
      last: {
        sortOrder: SortOrder.Descending,
        eventTypes: [TestFeedEventType.IncidentCreated],
      },
      storedAfter: null,
    },
    {
      name: "oldest first -> newest first -> oldest first",
      storedBefore: SortOrder.Ascending,
      first: { sortOrder: SortOrder.Descending, eventTypes: [] },
      last: {
        sortOrder: SortOrder.Ascending,
        eventTypes: [TestFeedEventType.IncidentCreated],
      },
      storedAfter: SortOrder.Ascending,
    },
  ])(
    "two changes batched into one render leave storage matching the page: $name",
    (testCase: BatchedChangesCase) => {
      if (testCase.storedBefore !== null) {
        window.localStorage.setItem(
          STORED_SORT_ORDER_KEY,
          testCase.storedBefore,
        );
      }

      const hook: FeedOptionsHook = renderFeedOptions({
        eventTypes: TEST_EVENT_TYPES,
        storageKey: STORAGE_KEY,
      });

      act(() => {
        const setOptions: (options: FeedOptions) => void =
          hook.result.current.setOptions;

        setOptions(testCase.first);
        setOptions(testCase.last);
      });

      expect(hook.result.current.options).toEqual(testCase.last);
      expect(window.localStorage.getItem(STORED_SORT_ORDER_KEY)).toBe(
        testCase.storedAfter,
      );

      // So the next visit opens in the order the reader ended on.
      hook.unmount();

      expect(
        renderFeedOptions({
          eventTypes: TEST_EVENT_TYPES,
          storageKey: STORAGE_KEY,
        }).result.current.options.sortOrder,
      ).toBe(testCase.last.sortOrder);
    },
  );

  /*
   * The first run of the hook only reads what is stored: writing it straight
   * back would be a write on every page view of every feed. Nor is a
   * re-render or a filter-only change a sort change.
   */
  test.each<[string, SortOrder | null, SortOrder, string]>([
    [
      "nothing stored",
      null,
      SortOrder.Ascending,
      `setItem ${STORED_SORT_ORDER_KEY} ${SortOrder.Ascending}`,
    ],
    [
      "oldest first stored",
      SortOrder.Ascending,
      SortOrder.Descending,
      `removeItem ${STORED_SORT_ORDER_KEY}`,
    ],
  ])(
    "mounting writes nothing to storage (%s); only a sort change does",
    (
      _name: string,
      storedBefore: SortOrder | null,
      nextSortOrder: SortOrder,
      expectedWrite: string,
    ) => {
      if (storedBefore !== null) {
        window.localStorage.setItem(STORED_SORT_ORDER_KEY, storedBefore);
      }

      const writes: Array<string> = recordStorageWrites();

      const hook: FeedOptionsHook = renderFeedOptions({
        eventTypes: TEST_EVENT_TYPES,
        storageKey: STORAGE_KEY,
      });

      const mountedSortOrder: SortOrder = hook.result.current.options.sortOrder;

      expect(mountedSortOrder).toBe(storedBefore ?? SortOrder.Descending);
      expect(writes).toEqual([]);

      hook.rerender({
        eventTypes: [...TEST_EVENT_TYPES],
        storageKey: STORAGE_KEY,
      });
      setFeedOptions(hook, {
        sortOrder: mountedSortOrder,
        eventTypes: [TestFeedEventType.IncidentCreated],
      });

      expect(writes).toEqual([]);

      // The recorder does see this feed's writes: the checks above are not vacuous.
      setFeedOptions(hook, {
        sortOrder: nextSortOrder,
        eventTypes: [TestFeedEventType.IncidentCreated],
      });

      expect(hook.result.current.options.sortOrder).toBe(nextSortOrder);
      expect(writes).toEqual([expectedWrite]);
    },
  );

  test("a remount after choosing oldest first starts oldest first, without writing", () => {
    const firstVisit: FeedOptionsHook = renderFeedOptions({
      eventTypes: TEST_EVENT_TYPES,
      storageKey: STORAGE_KEY,
    });

    setFeedOptions(firstVisit, {
      sortOrder: SortOrder.Ascending,
      eventTypes: [],
    });
    firstVisit.unmount();

    const writes: Array<string> = recordStorageWrites();

    const nextVisit: FeedOptionsHook = renderFeedOptions({
      eventTypes: TEST_EVENT_TYPES,
      storageKey: STORAGE_KEY,
    });

    const expectedOptions: FeedOptions = {
      sortOrder: SortOrder.Ascending,
      eventTypes: [],
    };

    expect(nextVisit.result.current.options).toEqual(expectedOptions);
    expect(nextVisit.result.current.optionsKey).toBe(
      getFeedOptionsKey(expectedOptions),
    );
    expect(writes).toEqual([]);
  });
});

describe("useFeedOptions resetKey", () => {
  const FIRST_RESOURCE: string = "incident-1";
  const NEXT_RESOURCE: string = "incident-2";

  const FILTER_ON_FIRST_RESOURCE: FeedOptions = {
    sortOrder: SortOrder.Ascending,
    eventTypes: [TestFeedEventType.IncidentCreated],
  };

  type GetProps = (resetKey: string | undefined) => UseFeedOptionsProps;

  // A new event type array on every call, as the feed pages pass.
  const getProps: GetProps = (
    resetKey: string | undefined,
  ): UseFeedOptionsProps => {
    return {
      eventTypes: [...TEST_EVENT_TYPES],
      storageKey: STORAGE_KEY,
      resetKey: resetKey,
    };
  };

  /*
   * The dashboard moves from one incident to the next without remounting the
   * feed. Were the filter dropped only after a render, that render would
   * already have asked the API for the next incident's feed with the first
   * incident's filter.
   */
  test("the first render for the next resource already drops the filter, and keeps the sort order", () => {
    const feed: FeedOptionsHarness = renderFeedOptionsWithHistory(
      getProps(FIRST_RESOURCE),
    );

    setFeedOptions(feed.hook, FILTER_ON_FIRST_RESOURCE);

    expect(feed.hook.result.current.options).toEqual(FILTER_ON_FIRST_RESOURCE);
    expect(feed.hook.result.current.isFiltered).toBe(true);

    const writes: Array<string> = recordStorageWrites();
    const firstNextResourceRender: number = feed.renders.length;

    feed.hook.rerender(getProps(NEXT_RESOURCE));

    expectEveryRender(
      feed.renders.slice(firstNextResourceRender),
      getUnfilteredRender(NEXT_RESOURCE, SortOrder.Ascending),
    );

    // The same view as opening the next resource's feed from scratch.
    expect(feed.hook.result.current.optionsKey).toBe(
      renderFeedOptions(getProps(NEXT_RESOURCE)).result.current.optionsKey,
    );

    // The sort order is a preference: moving on neither changes nor rewrites it.
    expect(writes).toEqual([]);
    expect(window.localStorage.getItem(STORED_SORT_ORDER_KEY)).toBe(
      SortOrder.Ascending,
    );
  });

  test("going back to the first resource does not bring its filter back", () => {
    const feed: FeedOptionsHarness = renderFeedOptionsWithHistory(
      getProps(FIRST_RESOURCE),
    );

    setFeedOptions(feed.hook, FILTER_ON_FIRST_RESOURCE);
    feed.hook.rerender(getProps(NEXT_RESOURCE));

    const firstRenderBack: number = feed.renders.length;

    feed.hook.rerender(getProps(FIRST_RESOURCE));
    feed.hook.rerender(getProps(FIRST_RESOURCE));

    expectEveryRender(
      feed.renders.slice(firstRenderBack),
      getUnfilteredRender(FIRST_RESOURCE, SortOrder.Ascending),
    );
  });

  test("a filter chosen after the switch applies to the new resource and stays while it is shown", () => {
    const feed: FeedOptionsHarness = renderFeedOptionsWithHistory(
      getProps(FIRST_RESOURCE),
    );

    setFeedOptions(feed.hook, FILTER_ON_FIRST_RESOURCE);
    feed.hook.rerender(getProps(NEXT_RESOURCE));

    const filterOnNextResource: FeedOptions = {
      sortOrder: SortOrder.Descending,
      eventTypes: [TestFeedEventType.AutoRemediation],
    };

    setFeedOptions(feed.hook, filterOnNextResource);

    expect(feed.hook.result.current.options).toEqual(filterOnNextResource);
    expect(feed.hook.result.current.isFiltered).toBe(true);
    expect(feed.hook.result.current.optionsKey).toBe(
      getFeedOptionsKey(filterOnNextResource),
    );

    // Later renders for the same resource - a refresh, a parent update - keep it.
    feed.hook.rerender(getProps(NEXT_RESOURCE));

    expect(feed.hook.result.current.options).toEqual(filterOnNextResource);

    // And it belongs to that resource only.
    feed.hook.rerender(getProps(FIRST_RESOURCE));

    expect(feed.hook.result.current.options).toEqual({
      sortOrder: SortOrder.Descending,
      eventTypes: [],
    });
  });

  test.each([undefined, FIRST_RESOURCE])(
    "re-renders with the same resetKey (%p) keep the filter and the options object",
    (resetKey: string | undefined) => {
      const feed: FeedOptionsHarness = renderFeedOptionsWithHistory(
        getProps(resetKey),
      );

      setFeedOptions(feed.hook, FILTER_ON_FIRST_RESOURCE);

      const chosenOptions: FeedOptions = feed.hook.result.current.options;
      const firstRerender: number = feed.renders.length;

      feed.hook.rerender(getProps(resetKey));
      feed.hook.rerender(getProps(resetKey));

      expect(feed.hook.result.current.options).toBe(chosenOptions);
      expect(feed.hook.result.current.options).toEqual(
        FILTER_ON_FIRST_RESOURCE,
      );
      expectEveryRender(feed.renders.slice(firstRerender), {
        resetKey: resetKey,
        options: FILTER_ON_FIRST_RESOURCE,
        optionsKey: getFeedOptionsKey(FILTER_ON_FIRST_RESOURCE),
        isFiltered: true,
      });
    },
  );
});
