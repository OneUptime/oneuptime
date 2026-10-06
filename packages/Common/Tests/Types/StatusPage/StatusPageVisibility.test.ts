import IncidentCreatedRenotify from "../../../Types/StatusPage/IncidentCreatedRenotify";
import IncidentPostmortemPublication from "../../../Types/StatusPage/IncidentPostmortemPublication";
import IncidentScopeAddedPagesNotification, {
  IncidentScopeAddedPagesNotificationAction,
} from "../../../Types/StatusPage/IncidentScopeAddedPagesNotification";
import StatusPageSubscriberNotificationStatus from "../../../Types/StatusPage/StatusPageSubscriberNotificationStatus";
import StatusPageVisibility, {
  PRIVATE_COLUMN,
  StatusPageVisibilitySwitches,
  VISIBLE_ON_STATUS_PAGE_COLUMN,
} from "../../../Types/StatusPage/StatusPageVisibility";
import { describe, expect, test } from "@jest/globals";

/*
 * StatusPageVisibility is the one rule that decides whether a status page
 * shows an incident or an incident episode: Visible on Status Page on, and
 * not private. Every status page read, subscriber job and write goes by it,
 * so a mistake here puts a private record in front of status page visitors
 * and their subscribers. These pin the rule, the literals a write may carry
 * (as Postgres stores them), and the write rule that keeps the two switches
 * in step.
 */

describe("StatusPageVisibility's columns", () => {
  test("are the incident's and the episode's two switches", () => {
    expect(VISIBLE_ON_STATUS_PAGE_COLUMN).toBe("isVisibleOnStatusPage");
    expect(PRIVATE_COLUMN).toBe("isPrivate");
    expect(StatusPageVisibility.columns).toEqual([
      "isVisibleOnStatusPage",
      "isPrivate",
    ]);
  });
});

describe("StatusPageVisibility.toStoredBoolean", () => {
  /*
   * What Postgres stores for a value written to a boolean column (boolin):
   * the API passes a value through as it is sent.
   */
  test.each([
    ["true", true],
    ['"true"', "true"],
    ['"TRUE" with spaces around it', "  TRUE "],
    ['"t"', "t"],
    ['"tr"', "tr"],
    ['"tru"', "tru"],
    ['"yes"', "yes"],
    ['"Y"', "Y"],
    ['"ye"', "ye"],
    ['"on"', "on"],
    ['"ON"', "ON"],
    ['"1"', "1"],
    ["the number 1", 1],
  ] as Array<[string, unknown]>)("%s is stored as true", (_label: string, value: unknown) => {
    expect(StatusPageVisibility.toStoredBoolean(value)).toBe(true);
  });

  test.each([
    ["false", false],
    ['"false"', "false"],
    ['"FALSE"', " FALSE"],
    ['"f"', "f"],
    ['"fa"', "fa"],
    ['"fals"', "fals"],
    ['"no"', "no"],
    ['"n"', "n"],
    ['"off"', "off"],
    ['"of"', "of"],
    ['"0"', "0"],
    ["the number 0", 0],
  ] as Array<[string, unknown]>)("%s is stored as false", (_label: string, value: unknown) => {
    expect(StatusPageVisibility.toStoredBoolean(value)).toBe(false);
  });

  test.each([
    ["null", null],
    ["undefined", undefined],
    ['""', ""],
    ['" "', " "],
    ['"o" (on or off: refused)', "o"],
    ['"truex"', "truex"],
    ['"yess"', "yess"],
    ['"onn"', "onn"],
    ['"01"', "01"],
    ['"10"', "10"],
    ['"2"', "2"],
    ["the number 2", 2],
    ["the number 0.5", 0.5],
    ["an object", { value: true }],
    ["an array", [true]],
  ] as Array<[string, unknown]>)(
    "%s is left as it is (null, or a value the database refuses)",
    (_label: string, value: unknown) => {
      expect(StatusPageVisibility.toStoredBoolean(value)).toBe(value);
    },
  );
});

describe("StatusPageVisibility.isPrivate", () => {
  test.each([
    ["true", true],
    ['a hand-written "true"', "true"],
    ['"yes"', "yes"],
    ["the number 1", 1],
    ["a value the database would refuse", "maybe"],
  ] as Array<[string, unknown]>)("%s is private", (_label: string, value: unknown) => {
    expect(StatusPageVisibility.isPrivate({ isPrivate: value })).toBe(true);
  });

  test.each([
    ["false", false],
    ['"false"', "false"],
    ["null (never set)", null],
    ["not read", undefined],
  ] as Array<[string, unknown]>)("%s is not", (_label: string, value: unknown) => {
    expect(StatusPageVisibility.isPrivate({ isPrivate: value })).toBe(false);
  });

  test("nothing read is not private", () => {
    expect(StatusPageVisibility.isPrivate(null)).toBe(false);
    expect(StatusPageVisibility.isPrivate(undefined)).toBe(false);
    expect(StatusPageVisibility.isPrivate({})).toBe(false);
  });
});

describe("StatusPageVisibility.isShown", () => {
  test("a record switched on and not private is shown", () => {
    for (const record of [
      { isVisibleOnStatusPage: true, isPrivate: false },
      { isVisibleOnStatusPage: true, isPrivate: null },
      { isVisibleOnStatusPage: true },
      { isVisibleOnStatusPage: "true", isPrivate: "false" },
    ] as Array<StatusPageVisibilitySwitches>) {
      expect(StatusPageVisibility.isShown(record)).toBe(true);
    }
  });

  test.each([
    [
      "private, whatever its switch says",
      { isVisibleOnStatusPage: true, isPrivate: true },
    ],
    [
      'private as a hand-written "true"',
      { isVisibleOnStatusPage: true, isPrivate: "true" },
    ],
    ["switched off", { isVisibleOnStatusPage: false, isPrivate: false }],
    ["never set (null)", { isVisibleOnStatusPage: null }],
    ["not read", {}],
    ["switched off and private", { isVisibleOnStatusPage: false, isPrivate: true }],
  ] as Array<[string, StatusPageVisibilitySwitches]>)(
    "a record %s is not",
    (_label: string, record: StatusPageVisibilitySwitches) => {
      expect(StatusPageVisibility.isShown(record)).toBe(false);
    },
  );

  test("nothing read is not shown", () => {
    expect(StatusPageVisibility.isShown(null)).toBe(false);
    expect(StatusPageVisibility.isShown(undefined)).toBe(false);
  });
});

describe("StatusPageVisibility.normalizeWrite", () => {
  test("a write that makes the record private switches Visible on Status Page off with it", () => {
    const data: Record<string, unknown> = { isPrivate: true };

    StatusPageVisibility.normalizeWrite(data);

    expect(data).toEqual({ isPrivate: true, isVisibleOnStatusPage: false });
  });

  test("private wins over a Visible on Status Page written with it (the Settings form's save)", () => {
    const data: Record<string, unknown> = {
      isVisibleOnStatusPage: true,
      isPrivate: true,
    };

    StatusPageVisibility.normalizeWrite(data);

    expect(data).toEqual({ isVisibleOnStatusPage: false, isPrivate: true });
  });

  test.each([
    ['"true"', "true"],
    ['"yes"', "yes"],
    ['"on"', "on"],
    ["1", 1],
  ] as Array<[string, unknown]>)(
    "a Private written as %s is stored as true, and hides the record",
    (_label: string, value: unknown) => {
      const data: Record<string, unknown> = {
        isVisibleOnStatusPage: "true",
        isPrivate: value,
      };

      StatusPageVisibility.normalizeWrite(data);

      expect(data).toEqual({ isVisibleOnStatusPage: false, isPrivate: true });
    },
  );

  test("both switches are stored as the booleans the database stores", () => {
    const data: Record<string, unknown> = {
      isVisibleOnStatusPage: "yes",
      isPrivate: "no",
    };

    StatusPageVisibility.normalizeWrite(data);

    expect(data).toEqual({ isVisibleOnStatusPage: true, isPrivate: false });
  });

  test("a record made not private keeps the Visible on Status Page the write gives it", () => {
    for (const visible of [true, false]) {
      const data: Record<string, unknown> = {
        isVisibleOnStatusPage: visible,
        isPrivate: false,
      };

      StatusPageVisibility.normalizeWrite(data);

      expect(data).toEqual({ isVisibleOnStatusPage: visible, isPrivate: false });
    }
  });

  test("a Private written as null (never set) is not private", () => {
    const data: Record<string, unknown> = {
      isVisibleOnStatusPage: true,
      isPrivate: null,
    };

    StatusPageVisibility.normalizeWrite(data);

    expect(data).toEqual({ isVisibleOnStatusPage: true, isPrivate: null });
  });

  test("a write of neither switch is left alone, and no switch is added", () => {
    const data: Record<string, unknown> = { title: "Renamed" };

    StatusPageVisibility.normalizeWrite(data);

    expect(data).toEqual({ title: "Renamed" });
  });

  test("a switch sent as undefined writes nothing and stays undefined", () => {
    const data: Record<string, unknown> = {
      isVisibleOnStatusPage: undefined,
      isPrivate: undefined,
    };

    StatusPageVisibility.normalizeWrite(data);

    expect(data["isVisibleOnStatusPage"]).toBeUndefined();
    expect(data["isPrivate"]).toBeUndefined();
  });

  test("a Private the database would refuse still hides the record, rather than showing it", () => {
    const data: Record<string, unknown> = {
      isVisibleOnStatusPage: true,
      isPrivate: "maybe",
    };

    StatusPageVisibility.normalizeWrite(data);

    expect(data["isVisibleOnStatusPage"]).toBe(false);
    // Left for the database to refuse, as it always was.
    expect(data["isPrivate"]).toBe("maybe");
  });

  test("no write is nothing to do", () => {
    expect(() => {
      StatusPageVisibility.normalizeWrite(undefined);
      StatusPageVisibility.normalizeWrite(null);
    }).not.toThrow();
  });
});

describe("StatusPageVisibility.needsStoredPrivacy", () => {
  test("a write that turns Visible on Status Page on and leaves Private as it is needs the stored privacy", () => {
    for (const visible of [true, "true", "yes", 1] as Array<unknown>) {
      expect(
        StatusPageVisibility.needsStoredPrivacy({
          isVisibleOnStatusPage: visible,
        }),
      ).toBe(true);
    }

    expect(
      StatusPageVisibility.needsStoredPrivacy({
        isVisibleOnStatusPage: true,
        title: "Renamed",
      }),
    ).toBe(true);
  });

  test.each([
    ["Private written with it", { isVisibleOnStatusPage: true, isPrivate: false }],
    ["Private written as true", { isVisibleOnStatusPage: true, isPrivate: true }],
    ["Private written as null", { isVisibleOnStatusPage: true, isPrivate: null }],
    ["Visible on Status Page written off", { isVisibleOnStatusPage: false }],
    ["Visible on Status Page written as null", { isVisibleOnStatusPage: null }],
    ["neither switch", { title: "Renamed" }],
  ] as Array<[string, Record<string, unknown>]>)(
    "a write with %s does not",
    (_label: string, data: Record<string, unknown>) => {
      expect(StatusPageVisibility.needsStoredPrivacy(data)).toBe(false);
    },
  );

  test("no write needs nothing", () => {
    expect(StatusPageVisibility.needsStoredPrivacy(undefined)).toBe(false);
    expect(StatusPageVisibility.needsStoredPrivacy(null)).toBe(false);
  });
});

describe("StatusPageVisibility.isPrivateAfterWrite", () => {
  test("a write that writes Private decides it", () => {
    expect(
      StatusPageVisibility.isPrivateAfterWrite({
        written: { isPrivate: true },
        stored: { isPrivate: false },
      }),
    ).toBe(true);
    expect(
      StatusPageVisibility.isPrivateAfterWrite({
        written: { isPrivate: false },
        stored: { isPrivate: true },
      }),
    ).toBe(false);
  });

  test("a write that leaves Private as it is leaves the record as stored", () => {
    expect(
      StatusPageVisibility.isPrivateAfterWrite({
        written: { isVisibleOnStatusPage: true },
        stored: { isPrivate: true },
      }),
    ).toBe(true);
    expect(
      StatusPageVisibility.isPrivateAfterWrite({
        written: { isVisibleOnStatusPage: true },
        stored: { isPrivate: false },
      }),
    ).toBe(false);
  });

  test("a record the read did not see is not private", () => {
    expect(
      StatusPageVisibility.isPrivateAfterWrite({
        written: { isVisibleOnStatusPage: true },
      }),
    ).toBe(false);
  });
});

/*
 * The helpers that decided it for themselves before read the rule now, so
 * the status page, the subscriber jobs and the dashboard cannot drift apart.
 */
describe("the helpers that read the rule", () => {
  test("IncidentPostmortemPublication.isIncidentShown is the rule", () => {
    for (const record of [
      { isVisibleOnStatusPage: true, isPrivate: false },
      { isVisibleOnStatusPage: true, isPrivate: true },
      { isVisibleOnStatusPage: true, isPrivate: "true" },
      { isVisibleOnStatusPage: false },
      { isVisibleOnStatusPage: null },
      {},
    ] as Array<StatusPageVisibilitySwitches>) {
      expect(IncidentPostmortemPublication.isIncidentShown(record as never)).toBe(
        StatusPageVisibility.isShown(record),
      );
    }
  });

  test("publishing a private incident never offers to announce it", () => {
    for (const isPrivate of [true, "true", "yes"] as Array<unknown>) {
      expect(
        IncidentCreatedRenotify.canRenotifyOnPublish({
          isVisibleOnStatusPage: false,
          isPrivate: isPrivate as boolean,
          shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: true,
          subscriberNotificationStatusOnIncidentCreated:
            StatusPageSubscriberNotificationStatus.Skipped,
        }),
      ).toBe(false);
    }

    expect(
      IncidentCreatedRenotify.canRenotifyOnPublish({
        isVisibleOnStatusPage: false,
        isPrivate: false,
        shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: true,
        subscriberNotificationStatusOnIncidentCreated:
          StatusPageSubscriberNotificationStatus.Skipped,
      }),
    ).toBe(true);
  });

  test("adding status pages to a private incident tells none of them it was created", () => {
    for (const isPrivate of [true, "true"] as Array<unknown>) {
      expect(
        IncidentScopeAddedPagesNotification.getAction({
          addedStatusPageIds: ["b0000000-0000-4000-8000-00000000000a"],
          incident: {
            isVisibleOnStatusPage: true,
            isPrivate: isPrivate as boolean,
            shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: true,
            subscriberNotificationStatusOnIncidentCreated:
              StatusPageSubscriberNotificationStatus.Success,
            statusPagesNotifiedOnCreation: [],
          },
        }),
      ).toBe(IncidentScopeAddedPagesNotificationAction.None);
    }

    expect(
      IncidentScopeAddedPagesNotification.getAction({
        addedStatusPageIds: ["b0000000-0000-4000-8000-00000000000a"],
        incident: {
          isVisibleOnStatusPage: true,
          isPrivate: false,
          shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: true,
          subscriberNotificationStatusOnIncidentCreated:
            StatusPageSubscriberNotificationStatus.Success,
          statusPagesNotifiedOnCreation: [],
        },
      }),
    ).toBe(IncidentScopeAddedPagesNotificationAction.Queue);
  });
});
