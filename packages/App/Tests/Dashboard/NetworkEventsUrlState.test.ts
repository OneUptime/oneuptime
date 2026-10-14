import { describe, expect, test } from "@jest/globals";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Dictionary from "Common/Types/Dictionary";
import NetworkEventType, {
  NetworkEventKind,
} from "Common/Types/NetworkEvent/NetworkEventType";
import TimeRange from "Common/Types/Time/TimeRange";
import { NetworkEventsScope } from "../../FeatureSet/Dashboard/src/Components/NetworkEvents/NetworkEventsModel";
import {
  NETWORK_EVENTS_DEFAULT_RANGE,
  NETWORK_EVENTS_URL_PARAMS,
  NetworkEventsViewState,
  getDefaultNetworkEventsView,
  hasNetworkEventsFilters,
  readNetworkEventsView,
  toNetworkEventsUrlParams,
} from "../../FeatureSet/Dashboard/src/Components/NetworkEvents/NetworkEventsUrlState";

/*
 * What an Events page is showing, kept in the URL: a link to the page lands
 * on exactly that view, and a reload keeps it.
 *
 * The query string is whatever somebody typed or pasted, so most of this is
 * about what is NOT read: a kind the vocabulary does not have, an event name
 * that is no name, a range that ends before it starts.
 */

const NETWORK: NetworkEventsScope = { kind: "network" };
const DEVICE: NetworkEventsScope = {
  kind: "device",
  networkDeviceId: "84858d6c-0000-4000-8000-000000000001",
};

function reader(query: Dictionary<string>): (name: string) => string | null {
  return (name: string): string | null => {
    return Object.prototype.hasOwnProperty.call(query, name)
      ? (query[name] as string)
      : null;
  };
}

function read(
  query: Dictionary<string>,
  scope: NetworkEventsScope = NETWORK,
): NetworkEventsViewState {
  return readNetworkEventsView(reader(query), scope);
}

// What the page would read back from the address bar it wrote.
function roundTrip(
  view: NetworkEventsViewState,
  scope: NetworkEventsScope = NETWORK,
): NetworkEventsViewState {
  const written: Dictionary<string> = toNetworkEventsUrlParams(view);
  const present: Dictionary<string> = {};

  // An empty value takes the parameter out of the URL.
  for (const name of Object.keys(written)) {
    if (written[name]) {
      present[name] = written[name] as string;
    }
  }

  return read(present, scope);
}

describe("a page opened with nothing in its URL", () => {
  test("shows the past day, with no filter", () => {
    expect(read({})).toEqual({
      range: { range: TimeRange.PAST_ONE_DAY },
      filters: {},
    });
    expect(read({})).toEqual(getDefaultNetworkEventsView());
    expect(NETWORK_EVENTS_DEFAULT_RANGE).toBe(TimeRange.PAST_ONE_DAY);
  });

  test("and writes nothing into it", () => {
    const params: Dictionary<string> = toNetworkEventsUrlParams(
      getDefaultNetworkEventsView(),
    );

    expect(Object.keys(params).sort()).toEqual(
      [...NETWORK_EVENTS_URL_PARAMS].sort(),
    );
    expect(
      Object.values(params).every((value: string): boolean => {
        return value === "";
      }),
    ).toBe(true);
  });
});

describe("the time range", () => {
  test.each(
    Object.values(TimeRange)
      .filter((range: TimeRange): boolean => {
        return range !== TimeRange.CUSTOM;
      })
      .map((range: TimeRange): [TimeRange] => {
        return [range];
      }),
  )("%s is read as written", (range: TimeRange) => {
    expect(read({ range: range }).range).toEqual({ range: range });
    expect(roundTrip({ range: { range: range }, filters: {} }).range).toEqual({
      range: range,
    });
  });

  test("the default range is left out of the URL; any other is written", () => {
    expect(
      toNetworkEventsUrlParams({
        range: { range: TimeRange.PAST_ONE_DAY },
        filters: {},
      })["range"],
    ).toBe("");
    expect(
      toNetworkEventsUrlParams({
        range: { range: TimeRange.PAST_ONE_WEEK },
        filters: {},
      })["range"],
    ).toBe(TimeRange.PAST_ONE_WEEK);
  });

  test("a custom range is its two moments", () => {
    const start: Date = new Date("2026-10-12T08:00:00.000Z");
    const end: Date = new Date("2026-10-12T09:30:00.000Z");
    const view: NetworkEventsViewState = {
      range: {
        range: TimeRange.CUSTOM,
        startAndEndDate: new InBetween<Date>(start, end),
      },
      filters: {},
    };

    expect(toNetworkEventsUrlParams(view)).toMatchObject({
      range: TimeRange.CUSTOM,
      start: "2026-10-12T08:00:00.000Z",
      end: "2026-10-12T09:30:00.000Z",
    });

    const back: NetworkEventsViewState = roundTrip(view);

    expect(back.range.range).toBe(TimeRange.CUSTOM);
    expect(back.range.startAndEndDate?.startValue).toEqual(start);
    expect(back.range.startAndEndDate?.endValue).toEqual(end);
  });

  test("a preset range leaves no stale start or end behind", () => {
    const params: Dictionary<string> = toNetworkEventsUrlParams({
      range: { range: TimeRange.PAST_ONE_HOUR },
      filters: {},
    });

    expect(params["start"]).toBe("");
    expect(params["end"]).toBe("");
  });

  test.each([
    ["no moments at all", { range: TimeRange.CUSTOM }],
    [
      "a start that is no date",
      {
        range: TimeRange.CUSTOM,
        start: "yesterday-ish",
        end: "2026-10-12T09:30:00.000Z",
      },
    ],
    [
      "an end that is no date",
      {
        range: TimeRange.CUSTOM,
        start: "2026-10-12T08:00:00.000Z",
        end: "",
      },
    ],
    [
      "an end before its start",
      {
        range: TimeRange.CUSTOM,
        start: "2026-10-12T09:30:00.000Z",
        end: "2026-10-12T08:00:00.000Z",
      },
    ],
    [
      "a start and an end that are the same moment",
      {
        range: TimeRange.CUSTOM,
        start: "2026-10-12T08:00:00.000Z",
        end: "2026-10-12T08:00:00.000Z",
      },
    ],
  ])(
    "a custom range with %s is the past day",
    (_name: string, query: Dictionary<string>) => {
      expect(read(query).range).toEqual({ range: TimeRange.PAST_ONE_DAY });
    },
  );

  test.each([
    ["a range nobody offers"],
    ["PAST_ONE_DAY"],
    ["past 1 day"],
    ["__proto__"],
    ["constructor"],
    [""],
  ])("%j is not a range: the past day", (range: string) => {
    expect(read({ range: range }).range).toEqual({
      range: TimeRange.PAST_ONE_DAY,
    });
  });

  test("a custom range with no moments to write is not written at all", () => {
    /*
     * The picker commits a custom range only with both of its ends, so
     * this is not a view the page makes - but "Custom" alone in the
     * address bar would be a range nothing can read back.
     */
    expect(
      toNetworkEventsUrlParams({
        range: { range: TimeRange.CUSTOM },
        filters: {},
      }),
    ).toMatchObject({ range: "", start: "", end: "" });
    expect(
      roundTrip({ range: { range: TimeRange.CUSTOM }, filters: {} }).range,
    ).toEqual({ range: TimeRange.PAST_ONE_DAY });
  });
});

describe("the filters", () => {
  test("kind, event and device are read as written", () => {
    const view: NetworkEventsViewState = {
      range: { range: TimeRange.PAST_ONE_DAY },
      filters: {
        kind: NetworkEventKind.Problem,
        event: NetworkEventType.InterfaceDown,
        device: "Core Switch",
      },
    };

    expect(toNetworkEventsUrlParams(view)).toMatchObject({
      kind: "problem",
      event: "interface.down",
      device: "Core Switch",
    });
    expect(roundTrip(view)).toEqual(view);
  });

  test.each(
    Object.values(NetworkEventKind).map(
      (kind: NetworkEventKind): [NetworkEventKind] => {
        return [kind];
      },
    ),
  )("the kind %s", (kind: NetworkEventKind) => {
    expect(read({ kind: kind }).filters).toEqual({ kind: kind });
  });

  test.each([
    ["catastrophe"],
    ["Problem"],
    ["PROBLEM"],
    ["all"],
    ["__proto__"],
    [""],
  ])("%j is no kind: every kind is shown", (kind: string) => {
    expect(read({ kind: kind }).filters).toEqual({});
  });

  test("an event a project named in a pipeline is a filter too", () => {
    expect(read({ event: "ups.on_battery" }).filters).toEqual({
      event: "ups.on_battery",
    });
  });

  test.each([
    ["interface down"],
    ["Interface.Down"],
    ["interface.down; DROP TABLE"],
    ["<script>alert(1)</script>"],
    ["."],
    ["interface..down"],
    [".interface"],
    ["interface."],
    ["a".repeat(300)],
    [""],
  ])("%j is no event name: every event is shown", (event: string) => {
    expect(read({ event: event }).filters).toEqual({});
  });

  test("a device is whatever it is called - a name with spaces, an address - up to a length", () => {
    expect(read({ device: "Core Switch (rack 2)" }).filters).toEqual({
      device: "Core Switch (rack 2)",
    });
    expect(read({ device: "2001:db8::1" }).filters).toEqual({
      device: "2001:db8::1",
    });
    expect(read({ device: "x".repeat(256) }).filters).toEqual({
      device: "x".repeat(256),
    });
    expect(read({ device: "x".repeat(257) }).filters).toEqual({});
    expect(read({ device: "   " }).filters).toEqual({});
  });

  test("what is written around a value is trimmed off", () => {
    expect(
      read({
        kind: " problem ",
        event: " interface.down ",
        device: "  Core Switch ",
      }).filters,
    ).toEqual({
      kind: NetworkEventKind.Problem,
      event: "interface.down",
      device: "Core Switch",
    });
  });

  test("one device's page is that device's already: a device in its URL is not read", () => {
    expect(
      read({ device: "Somebody Else", kind: "problem" }, DEVICE).filters,
    ).toEqual({ kind: NetworkEventKind.Problem });
  });

  test("a filter taken off is taken out of the URL", () => {
    expect(
      toNetworkEventsUrlParams({
        range: { range: TimeRange.PAST_ONE_DAY },
        filters: { kind: NetworkEventKind.Recovery },
      }),
    ).toMatchObject({ kind: "recovery", event: "", device: "" });
  });

  test("one unreadable value does not take the readable ones with it", () => {
    expect(
      read({
        range: "nonsense",
        kind: "catastrophe",
        event: "vpn.tunnel_down",
        device: "Branch Firewall",
      }),
    ).toEqual({
      range: { range: TimeRange.PAST_ONE_DAY },
      filters: { event: "vpn.tunnel_down", device: "Branch Firewall" },
    });
  });
});

describe("whether anything is filtered", () => {
  test("no filter", () => {
    expect(hasNetworkEventsFilters({})).toBe(false);
    expect(
      hasNetworkEventsFilters({
        kind: undefined,
        event: undefined,
        device: undefined,
      }),
    ).toBe(false);
  });

  test.each([
    [{ kind: NetworkEventKind.Info }],
    [{ event: "interface.down" }],
    [{ device: "Core Switch" }],
  ])("%j is a filter", (filters: Dictionary<string>) => {
    expect(hasNetworkEventsFilters(filters)).toBe(true);
  });
});
