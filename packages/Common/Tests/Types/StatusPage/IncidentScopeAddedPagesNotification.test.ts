import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import IncidentCreatedRenotify from "../../../Types/StatusPage/IncidentCreatedRenotify";
import IncidentScopeAddedPagesNotification, {
  IncidentScopeAddedPagesNotificationAction,
  IncidentScopeAddedPagesNotificationState,
  StatusPageScopeChange,
} from "../../../Types/StatusPage/IncidentScopeAddedPagesNotification";
import StatusPageSubscriberNotificationStatus from "../../../Types/StatusPage/StatusPageSubscriberNotificationStatus";
import SubscriberUpdateNotification from "../../../Types/StatusPage/SubscriberUpdateNotification";
import { describe, expect, test } from "@jest/globals";

/*
 * Adding status pages to an incident's scope can send them the incident's
 * 'created' notification. This file decides, for the dashboard and the server
 * alike, when the editor asked for it, which pages an edit adds and removes,
 * and what that does to the notification. A false positive here emails every
 * subscriber of a status page about a "new" incident; a false negative leaves
 * a site that was just added to an outage without a word.
 */

const PAGE_A: string = "0b5e0c8e-1f53-4f55-9a52-6a0c1e0f0a01";
const PAGE_B: string = "0b5e0c8e-1f53-4f55-9a52-6a0c1e0f0a02";
const PAGE_C: string = "0b5e0c8e-1f53-4f55-9a52-6a0c1e0f0a03";

function statusPage(id: string): StatusPage {
  const page: StatusPage = new StatusPage();
  page._id = id;
  return page;
}

describe("IncidentScopeAddedPagesNotification.isRequested", () => {
  test("uses a stable misc data key the dashboard and the API share", () => {
    expect(IncidentScopeAddedPagesNotification.miscDataKey).toBe(
      "notifyAddedStatusPagesOfIncidentCreated",
    );
  });

  test("does not reuse another notification's key, so the asks cannot be confused", () => {
    expect(IncidentScopeAddedPagesNotification.miscDataKey).not.toBe(
      IncidentCreatedRenotify.miscDataKey,
    );
    expect(IncidentScopeAddedPagesNotification.miscDataKey).not.toBe(
      SubscriberUpdateNotification.miscDataKey,
    );
  });

  test("is true for the boolean the dashboard form sends", () => {
    expect(
      IncidentScopeAddedPagesNotification.isRequested({
        notifyAddedStatusPagesOfIncidentCreated: true,
      }),
    ).toBe(true);
  });

  test('is true for the string "true" a hand-written API request may send', () => {
    expect(
      IncidentScopeAddedPagesNotification.isRequested({
        notifyAddedStatusPagesOfIncidentCreated: "true",
      }),
    ).toBe(true);
  });

  test.each([
    ["false", false],
    ['the string "false"', "false"],
    ["1", 1],
    ['the string "1"', "1"],
    ["null", null],
    ["an object", { yes: true }],
  ])("is false for %s", (_label: string, value: unknown) => {
    expect(
      IncidentScopeAddedPagesNotification.isRequested({
        notifyAddedStatusPagesOfIncidentCreated: value,
      } as JSONObject),
    ).toBe(false);
  });

  test("is false without misc data, or when only another key is sent", () => {
    expect(IncidentScopeAddedPagesNotification.isRequested(undefined)).toBe(
      false,
    );
    expect(IncidentScopeAddedPagesNotification.isRequested(null)).toBe(false);
    expect(IncidentScopeAddedPagesNotification.isRequested({})).toBe(false);
    expect(
      IncidentScopeAddedPagesNotification.isRequested(
        IncidentCreatedRenotify.getMiscDataProps(),
      ),
    ).toBe(false);
  });

  test("round-trips the misc data props it builds, in a fresh object each time", () => {
    const first: JSONObject =
      IncidentScopeAddedPagesNotification.getMiscDataProps();

    expect(IncidentScopeAddedPagesNotification.isRequested(first)).toBe(true);

    first[IncidentScopeAddedPagesNotification.miscDataKey] = false;

    expect(
      IncidentScopeAddedPagesNotification.isRequested(
        IncidentScopeAddedPagesNotification.getMiscDataProps(),
      ),
    ).toBe(true);
  });
});

describe("IncidentScopeAddedPagesNotification.normalizeStatusPageIds", () => {
  test("reads every shape a status page list arrives in", () => {
    expect(
      IncidentScopeAddedPagesNotification.normalizeStatusPageIds([
        statusPage(PAGE_A),
        { _id: PAGE_B },
        new ObjectID(PAGE_C),
      ]),
    ).toEqual([PAGE_A, PAGE_B, PAGE_C]);

    expect(
      IncidentScopeAddedPagesNotification.normalizeStatusPageIds([
        PAGE_A,
        { id: PAGE_B },
        { _type: "ObjectID", value: PAGE_C },
      ]),
    ).toEqual([PAGE_A, PAGE_B, PAGE_C]);
  });

  test("lower-cases ids, as the database reads uuids back, and drops duplicates", () => {
    expect(
      IncidentScopeAddedPagesNotification.normalizeStatusPageIds([
        PAGE_A.toUpperCase(),
        PAGE_A,
        { _id: ` ${PAGE_A} ` },
        PAGE_B,
      ]),
    ).toEqual([PAGE_A, PAGE_B]);
  });

  test("accepts a single entry that is not in a list", () => {
    expect(
      IncidentScopeAddedPagesNotification.normalizeStatusPageIds(PAGE_A),
    ).toEqual([PAGE_A]);
  });

  test("ignores entries without an id", () => {
    expect(
      IncidentScopeAddedPagesNotification.normalizeStatusPageIds([
        "",
        "   ",
        null,
        undefined,
        0,
        {},
        { _id: { nested: true } },
        new StatusPage(),
        PAGE_A,
      ]),
    ).toEqual([PAGE_A]);
  });

  test("is empty for no list at all", () => {
    expect(
      IncidentScopeAddedPagesNotification.normalizeStatusPageIds(undefined),
    ).toEqual([]);
    expect(
      IncidentScopeAddedPagesNotification.normalizeStatusPageIds(null),
    ).toEqual([]);
    expect(
      IncidentScopeAddedPagesNotification.normalizeStatusPageIds([]),
    ).toEqual([]);
  });
});

describe("IncidentScopeAddedPagesNotification.getScopeChange", () => {
  test("names the pages added and removed", () => {
    expect(
      IncidentScopeAddedPagesNotification.getScopeChange({
        before: [statusPage(PAGE_A), statusPage(PAGE_B)],
        after: [PAGE_B, PAGE_C],
      }),
    ).toEqual({
      addedStatusPageIds: [PAGE_C],
      removedStatusPageIds: [PAGE_A],
    } as StatusPageScopeChange);
  });

  test("scoping an unscoped incident adds every selected page", () => {
    expect(
      IncidentScopeAddedPagesNotification.getScopeChange({
        before: [],
        after: [PAGE_A, PAGE_B],
      }),
    ).toEqual({
      addedStatusPageIds: [PAGE_A, PAGE_B],
      removedStatusPageIds: [],
    });
  });

  test("clearing the scope removes every page", () => {
    expect(
      IncidentScopeAddedPagesNotification.getScopeChange({
        before: [statusPage(PAGE_A)],
        after: [],
      }),
    ).toEqual({
      addedStatusPageIds: [],
      removedStatusPageIds: [PAGE_A],
    });
  });

  test("re-saving the same pages, in another order or case, changes nothing", () => {
    expect(
      IncidentScopeAddedPagesNotification.getScopeChange({
        before: [statusPage(PAGE_A), statusPage(PAGE_B)],
        after: [PAGE_B.toUpperCase(), { _id: PAGE_A }],
      }),
    ).toEqual({
      addedStatusPageIds: [],
      removedStatusPageIds: [],
    });
  });

  test("a stored list that was never loaded counts as empty", () => {
    expect(
      IncidentScopeAddedPagesNotification.getScopeChange({
        before: undefined,
        after: [PAGE_A],
      }).addedStatusPageIds,
    ).toEqual([PAGE_A]);
  });
});

describe("IncidentScopeAddedPagesNotification.getAction", () => {
  function eligible(
    status: StatusPageSubscriberNotificationStatus | undefined | null,
    overrides: Partial<IncidentScopeAddedPagesNotificationState> = {},
  ): IncidentScopeAddedPagesNotificationState {
    return {
      subscriberNotificationStatusOnIncidentCreated: status,
      shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: true,
      isVisibleOnStatusPage: true,
      isPrivate: false,
      ...overrides,
    };
  }

  test.each([
    [
      StatusPageSubscriberNotificationStatus.Success,
      IncidentScopeAddedPagesNotificationAction.Queue,
    ],
    [
      StatusPageSubscriberNotificationStatus.Skipped,
      IncidentScopeAddedPagesNotificationAction.Queue,
    ],
    [
      StatusPageSubscriberNotificationStatus.Failed,
      IncidentScopeAddedPagesNotificationAction.Queue,
    ],
    [
      StatusPageSubscriberNotificationStatus.Pending,
      IncidentScopeAddedPagesNotificationAction.AlreadyQueued,
    ],
    [
      StatusPageSubscriberNotificationStatus.InProgress,
      IncidentScopeAddedPagesNotificationAction.Reject,
    ],
  ])(
    "adding a page while the notification is %s: %s",
    (
      status: StatusPageSubscriberNotificationStatus,
      action: IncidentScopeAddedPagesNotificationAction,
    ) => {
      expect(
        IncidentScopeAddedPagesNotification.getAction({
          addedStatusPageIds: [PAGE_A],
          incident: eligible(status),
        }),
      ).toBe(action);
    },
  );

  test("a missing status, which would otherwise never be sent, is queued", () => {
    expect(
      IncidentScopeAddedPagesNotification.getAction({
        addedStatusPageIds: [PAGE_A],
        incident: eligible(undefined),
      }),
    ).toBe(IncidentScopeAddedPagesNotificationAction.Queue);
    expect(
      IncidentScopeAddedPagesNotification.getAction({
        addedStatusPageIds: [PAGE_A],
        incident: eligible(null),
      }),
    ).toBe(IncidentScopeAddedPagesNotificationAction.Queue);
  });

  test.each(Object.values(StatusPageSubscriberNotificationStatus))(
    "no page added: nothing, even while %s",
    (status: StatusPageSubscriberNotificationStatus) => {
      expect(
        IncidentScopeAddedPagesNotification.getAction({
          addedStatusPageIds: [],
          incident: eligible(status),
        }),
      ).toBe(IncidentScopeAddedPagesNotificationAction.None);
    },
  );

  test.each([
    [
      "notifying on creation is off",
      { shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: false },
    ],
    [
      "notifying on creation is unknown",
      { shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: null },
    ],
    [
      "the incident is hidden from status pages",
      { isVisibleOnStatusPage: false },
    ],
    [
      "the incident's visibility is null, which the job treats as hidden",
      { isVisibleOnStatusPage: null },
    ],
    ["the incident is private", { isPrivate: true }],
  ])(
    "nothing, whatever the status, when %s",
    (
      _label: string,
      overrides: Partial<IncidentScopeAddedPagesNotificationState>,
    ) => {
      for (const status of Object.values(
        StatusPageSubscriberNotificationStatus,
      )) {
        expect(
          IncidentScopeAddedPagesNotification.getAction({
            addedStatusPageIds: [PAGE_A, PAGE_B],
            incident: eligible(status, overrides),
          }),
        ).toBe(IncidentScopeAddedPagesNotificationAction.None);
      }
    },
  );
});

describe("IncidentScopeAddedPagesNotification copy", () => {
  test("the dashboard label matches the product wording", () => {
    expect(IncidentScopeAddedPagesNotification.formFieldTitle).toBe(
      "Send the incident-created notification to newly added pages",
    );
  });

  test("the rejection tells the editor how to get the edit through", () => {
    expect(
      IncidentScopeAddedPagesNotification.rejectedWhileSendingMessage,
    ).toContain(IncidentScopeAddedPagesNotification.formFieldTitle);
  });
});
