import {
  AddedPagesNotificationIncident,
  getAddedStatusPageIds,
  getIdsFromFormValue,
  getNamedStatusPages,
  getNotifiedStatusPagesBeingRemoved,
  isClearingScope,
  isScopedToDeletedStatusPages,
  joinStatusPageNames,
  NamedStatusPage,
  wouldQueueAddedPagesNotification,
} from "../../FeatureSet/Dashboard/src/Components/Incident/IncidentStatusPageScopeForm";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
import ObjectID from "Common/Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * The React-free half of editing an incident's status page scope: reading ids
 * out of form values in every shape the form holds them, and working out what
 * an edit adds, removes and clears. The Settings tab's warnings and its
 * added-pages checkbox are only as right as these.
 */

const SITE_03: string = "b0000000-0000-4000-8000-000000000003";
const SITE_05: string = "b0000000-0000-4000-8000-000000000005";
const SITE_07: string = "b0000000-0000-4000-8000-000000000007";

function page(id: string, name: string): StatusPage {
  const statusPage: StatusPage = new StatusPage();
  statusPage._id = id;
  statusPage.name = name;
  return statusPage;
}

describe("getIdsFromFormValue", () => {
  test("empty values are no ids", () => {
    expect(getIdsFromFormValue(undefined)).toEqual([]);
    expect(getIdsFromFormValue(null)).toEqual([]);
    expect(getIdsFromFormValue("")).toEqual([]);
    expect(getIdsFromFormValue([])).toEqual([]);
  });

  test("bare id strings, as the entity dropdown holds them", () => {
    expect(getIdsFromFormValue([SITE_03, SITE_07])).toEqual([SITE_03, SITE_07]);
  });

  test("ObjectIDs, models and {_id, name} objects", () => {
    expect(
      getIdsFromFormValue([
        new ObjectID(SITE_03),
        page(SITE_05, "Site 05"),
        { _id: SITE_07, name: "Site 07" },
      ]),
    ).toEqual([SITE_03, SITE_05, SITE_07]);
  });

  test("{value, label} dropdown options", () => {
    expect(
      getIdsFromFormValue([
        { value: SITE_03, label: "Site 03" },
        { value: SITE_07, label: "Site 07" },
      ]),
    ).toEqual([SITE_03, SITE_07]);
  });

  test("a single value that is not a list", () => {
    expect(getIdsFromFormValue(SITE_03)).toEqual([SITE_03]);
  });

  test("lower-cased and without duplicates, in the order first seen", () => {
    expect(
      getIdsFromFormValue([SITE_07.toUpperCase(), SITE_03, SITE_07]),
    ).toEqual([SITE_07, SITE_03]);
  });
});

describe("getNamedStatusPages", () => {
  test("reads id and name off loaded models", () => {
    expect(
      getNamedStatusPages([page(SITE_03, " Site 03 "), page(SITE_07, "")]),
    ).toEqual([
      { id: SITE_03, name: "Site 03" },
      { id: SITE_07, name: "" },
    ]);
  });

  test("nothing loaded is no pages", () => {
    expect(getNamedStatusPages(undefined)).toEqual([]);
    expect(getNamedStatusPages(null)).toEqual([]);
  });

  test("a page listed twice is listed once", () => {
    expect(
      getNamedStatusPages([page(SITE_03, "Site 03"), page(SITE_03, "Again")]),
    ).toEqual([{ id: SITE_03, name: "Site 03" }]);
  });
});

describe("getAddedStatusPageIds", () => {
  test("the pages the edit adds, whatever shape either side is in", () => {
    expect(
      getAddedStatusPageIds({
        before: [page(SITE_03, "Site 03")],
        after: [SITE_03, SITE_05, SITE_07],
      }),
    ).toEqual([SITE_05, SITE_07]);
  });

  test("removing pages adds none", () => {
    expect(
      getAddedStatusPageIds({
        before: [SITE_03, SITE_07],
        after: [SITE_03],
      }),
    ).toEqual([]);
  });

  test("scoping an unscoped incident adds every page picked", () => {
    expect(
      getAddedStatusPageIds({ before: undefined, after: [SITE_05] }),
    ).toEqual([SITE_05]);
  });
});

describe("getNotifiedStatusPagesBeingRemoved", () => {
  const loaded: Array<NamedStatusPage> = [
    { id: SITE_03, name: "Site 03" },
    { id: SITE_05, name: "Site 05" },
    { id: SITE_07, name: "Site 07" },
  ];

  test("only pages that were told and are being removed", () => {
    expect(
      getNotifiedStatusPagesBeingRemoved({
        loadedStatusPages: loaded,
        notifiedStatusPageIds: [SITE_03, SITE_05],
        formValue: [SITE_05],
      }),
    ).toEqual([{ id: SITE_03, name: "Site 03" }]);
  });

  test("removing a page that was never told needs no warning", () => {
    expect(
      getNotifiedStatusPagesBeingRemoved({
        loadedStatusPages: loaded,
        notifiedStatusPageIds: [SITE_03],
        formValue: [SITE_03],
      }),
    ).toEqual([]);
  });

  test("nobody told yet: no warning", () => {
    expect(
      getNotifiedStatusPagesBeingRemoved({
        loadedStatusPages: loaded,
        notifiedStatusPageIds: null,
        formValue: [],
      }),
    ).toEqual([]);
  });

  test("the record's ids match whatever their case", () => {
    expect(
      getNotifiedStatusPagesBeingRemoved({
        loadedStatusPages: loaded,
        notifiedStatusPageIds: [SITE_07.toUpperCase()],
        formValue: [],
      }),
    ).toEqual([{ id: SITE_07, name: "Site 07" }]);
  });
});

describe("isClearingScope", () => {
  test("a scoped incident edited down to no pages", () => {
    expect(isClearingScope({ isScoped: true, formValue: [] })).toBe(true);
    expect(isClearingScope({ isScoped: true, formValue: undefined })).toBe(
      true,
    );
  });

  test("keeping a page, or an incident that was never scoped", () => {
    expect(isClearingScope({ isScoped: true, formValue: [SITE_03] })).toBe(
      false,
    );
    expect(isClearingScope({ isScoped: false, formValue: [] })).toBe(false);
    expect(isClearingScope({ isScoped: undefined, formValue: [] })).toBe(false);
  });
});

describe("isScopedToDeletedStatusPages", () => {
  test("scoped with no pages left: every page it was limited to is gone", () => {
    expect(
      isScopedToDeletedStatusPages({
        isScopedToStatusPages: true,
        statusPages: [],
      }),
    ).toBe(true);
  });

  test("scoped with pages, or not scoped", () => {
    expect(
      isScopedToDeletedStatusPages({
        isScopedToStatusPages: true,
        statusPages: [page(SITE_03, "Site 03")],
      }),
    ).toBe(false);
    expect(
      isScopedToDeletedStatusPages({
        isScopedToStatusPages: false,
        statusPages: [],
      }),
    ).toBe(false);
    expect(isScopedToDeletedStatusPages({})).toBe(false);
  });
});

/*
 * The added-pages checkbox is offered exactly when ticking it would send
 * something: the edit adds a page the incident has no record of telling, and
 * the server would queue the notification for it.
 */
describe("wouldQueueAddedPagesNotification", () => {
  // Scoped to Site 03, which was told; visible, set to notify.
  function toldIncident(
    overrides: Partial<AddedPagesNotificationIncident> = {},
  ): AddedPagesNotificationIncident {
    return {
      statusPages: [page(SITE_03, "Site 03")],
      statusPagesNotifiedOnCreation: [SITE_03],
      subscriberNotificationStatusOnIncidentCreated:
        StatusPageSubscriberNotificationStatus.Success,
      shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: true,
      isVisibleOnStatusPage: true,
      isPrivate: false,
      ...overrides,
    };
  }

  test("adding a page that was not told: offered", () => {
    expect(
      wouldQueueAddedPagesNotification({
        incident: toldIncident(),
        formValue: [SITE_03, SITE_07],
      }),
    ).toBe(true);
  });

  test("no page added: not offered", () => {
    expect(
      wouldQueueAddedPagesNotification({
        incident: toldIncident(),
        formValue: [SITE_03],
      }),
    ).toBe(false);
    expect(
      wouldQueueAddedPagesNotification({
        incident: toldIncident(),
        formValue: [],
      }),
    ).toBe(false);
  });

  test("narrowing an unscoped incident to pages it told: not offered, it would send nothing", () => {
    expect(
      wouldQueueAddedPagesNotification({
        incident: toldIncident({
          statusPages: [],
          statusPagesNotifiedOnCreation: [SITE_03, SITE_05, SITE_07],
        }),
        formValue: [SITE_03, SITE_07],
      }),
    ).toBe(false);
  });

  test("adding back a page that was told before: not offered", () => {
    expect(
      wouldQueueAddedPagesNotification({
        incident: toldIncident({
          statusPagesNotifiedOnCreation: [SITE_03, SITE_07],
        }),
        formValue: [SITE_03, SITE_07],
      }),
    ).toBe(false);
  });

  test.each([
    StatusPageSubscriberNotificationStatus.Success,
    StatusPageSubscriberNotificationStatus.Failed,
  ])(
    "an incident told (%s) before the record existed: not offered",
    (status: StatusPageSubscriberNotificationStatus) => {
      expect(
        wouldQueueAddedPagesNotification({
          incident: toldIncident({
            statusPages: [],
            statusPagesNotifiedOnCreation: null,
            subscriberNotificationStatusOnIncidentCreated: status,
          }),
          formValue: [SITE_03, SITE_07],
        }),
      ).toBe(false);
    },
  );

  test("an incident that was never announced (Skipped, no record): offered for the pages added", () => {
    expect(
      wouldQueueAddedPagesNotification({
        incident: toldIncident({
          statusPagesNotifiedOnCreation: null,
          subscriberNotificationStatusOnIncidentCreated:
            StatusPageSubscriberNotificationStatus.Skipped,
        }),
        formValue: [SITE_03, SITE_07],
      }),
    ).toBe(true);
  });

  test.each([
    StatusPageSubscriberNotificationStatus.Pending,
    StatusPageSubscriberNotificationStatus.InProgress,
  ])(
    "while the notification is %s: not offered, it reaches the added pages anyway",
    (status: StatusPageSubscriberNotificationStatus) => {
      expect(
        wouldQueueAddedPagesNotification({
          incident: toldIncident({
            subscriberNotificationStatusOnIncidentCreated: status,
          }),
          formValue: [SITE_03, SITE_07],
        }),
      ).toBe(false);
    },
  );

  test.each([
    [
      "declared with notifications off",
      { shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: false },
    ],
    ["hidden from status pages", { isVisibleOnStatusPage: false }],
    ["private", { isPrivate: true }],
  ])(
    "not when %s",
    (_name: string, overrides: Partial<AddedPagesNotificationIncident>) => {
      expect(
        wouldQueueAddedPagesNotification({
          incident: toldIncident(overrides),
          formValue: [SITE_03, SITE_07],
        }),
      ).toBe(false);
    },
  );

  test("not for an incident that was not loaded", () => {
    expect(
      wouldQueueAddedPagesNotification({
        incident: {},
        formValue: [SITE_03],
      }),
    ).toBe(false);
  });

  test("reads the form value in any shape the picker holds it", () => {
    expect(
      wouldQueueAddedPagesNotification({
        incident: toldIncident(),
        formValue: [
          { value: SITE_03, label: "Site 03" },
          { value: SITE_07.toUpperCase(), label: "Site 07" },
        ],
      }),
    ).toBe(true);
  });
});

describe("joinStatusPageNames", () => {
  test("names in order, blank ones left out", () => {
    expect(
      joinStatusPageNames([
        { name: "Site 03" },
        { name: " " },
        { name: "Site 07 " },
      ]),
    ).toBe("Site 03, Site 07");
  });
});
