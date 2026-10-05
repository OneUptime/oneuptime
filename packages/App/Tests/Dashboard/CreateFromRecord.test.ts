import {
  CREATE_FROM_RECORD_KINDS,
  CREATE_PAGES,
  CreateFromRecordAddress,
  CreateFromRecordCrumb,
  CreateFromRecordField,
  CreateFromRecordKind,
  CreateFromRecordKindDefinition,
  CreatedRecordKind,
  PROJECT_CRUMB_TITLE,
  RecordFieldValue,
  RecordTab,
  RecordToCreateFrom,
  getCreateFromRecordDefinition,
  getCreateFromRecordField,
  getCreateFromRecordKinds,
  getCreateFromRecordQuery,
  getCreateFromRecordTrail,
  pickRecordToCreateFrom,
  readCreateFromRecord,
  readCreateFromRecordId,
  readRecordIds,
} from "../../FeatureSet/Dashboard/src/Components/CreateFromRecord/CreateFromRecord";
import PageMap from "../../FeatureSet/Dashboard/src/Utils/PageMap";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * Creating from a record's own tab keeps that record picked
 * (Components/CreateFromRecord): which records a create page can be opened
 * from, the address that carries one, how the page reads it back, where the
 * form picks it, and the trail back through its tab. The tabs and the
 * create pages are drawn for real in Common's
 * Tests/App/Dashboard/CreateFromRecordPages.test.tsx and
 * CreateFromRecordLinks.test.tsx; CreateFromRecordGuard.test.ts holds every
 * tab and page to it.
 */

const MONITOR_ID: string = "0193c0de-1111-4aaa-8bbb-000000000001";
const HOST_ID: string = "0193c0de-1111-4aaa-8bbb-000000000002";
const OTHER_HOST_ID: string = "0193c0de-1111-4aaa-8bbb-000000000003";
const STATUS_PAGE_ID: string = "0193c0de-1111-4aaa-8bbb-000000000004";
const TEMPLATE_STATUS_PAGE_ID: string = "0193c0de-1111-4aaa-8bbb-000000000005";

const ALL_KINDS: Array<CreateFromRecordKind> = Object.values(
  CreateFromRecordKind,
) as Array<CreateFromRecordKind>;

const ALL_CREATED: Array<CreatedRecordKind> = Object.values(
  CreatedRecordKind,
) as Array<CreatedRecordKind>;

// The resource kinds an incident and an alert both carry.
const INCIDENT_AND_ALERT_RESOURCES: Array<CreateFromRecordKind> = [
  CreateFromRecordKind.Monitor,
  CreateFromRecordKind.Host,
  CreateFromRecordKind.KubernetesCluster,
  CreateFromRecordKind.DockerHost,
  CreateFromRecordKind.PodmanHost,
  CreateFromRecordKind.ProxmoxCluster,
  CreateFromRecordKind.VMwareVCenter,
  CreateFromRecordKind.CephCluster,
  CreateFromRecordKind.StorageArray,
  CreateFromRecordKind.DockerSwarmCluster,
  CreateFromRecordKind.IoTFleet,
  CreateFromRecordKind.DatabaseServer,
  CreateFromRecordKind.Service,
];

const record: (
  kind: CreateFromRecordKind,
  id: string,
  name?: string,
) => RecordToCreateFrom = (
  kind: CreateFromRecordKind,
  id: string,
  name?: string,
): RecordToCreateFrom => {
  return { kind: kind, id: id, name: name || "Checkout API" };
};

const addressReader: (
  query: Dictionary<string>,
) => (name: string) => string | null = (
  query: Dictionary<string>,
): ((name: string) => string | null) => {
  return (name: string): string | null => {
    return query[name] || null;
  };
};

describe("the records a create page can be opened from", () => {
  test("every kind is defined once, with a parameter of its own", () => {
    expect(
      CREATE_FROM_RECORD_KINDS.map(
        (definition: CreateFromRecordKindDefinition): CreateFromRecordKind => {
          return definition.kind;
        },
      ),
    ).toEqual(ALL_KINDS);

    const params: Array<string> = CREATE_FROM_RECORD_KINDS.map(
      (definition: CreateFromRecordKindDefinition): string => {
        return definition.queryParam;
      },
    );

    expect(new Set(params).size).toBe(params.length);

    for (const param of params) {
      // An ID's parameter, named for the record: monitorId, hostId, ...
      expect(param).toMatch(/^[a-z][A-Za-z]*Id$/);
    }
  });

  test("keeps the parameters links and bookmarks already carry", () => {
    expect(
      getCreateFromRecordDefinition(CreateFromRecordKind.StatusPage).queryParam,
    ).toBe("statusPageId");
    expect(
      getCreateFromRecordDefinition(CreateFromRecordKind.Monitor).queryParam,
    ).toBe("monitorId");
  });

  test("each kind's trail and field are spelled out, and each lists something it can create", () => {
    for (const definition of CREATE_FROM_RECORD_KINDS) {
      expect(definition.listTitle.length).toBeGreaterThan(0);
      expect(definition.viewTitle.length).toBeGreaterThan(0);
      expect(Object.values(PageMap)).toContain(definition.listPage);
      expect(Object.values(PageMap)).toContain(definition.viewPage);
      expect(definition.field.key.length).toBeGreaterThan(0);

      const tabs: Array<RecordTab> = Object.values(
        definition.tabs,
      ) as Array<RecordTab>;

      expect(tabs.length).toBeGreaterThan(0);

      for (const tab of tabs) {
        expect(Object.values(PageMap)).toContain(tab.page);
        expect(tab.title.length).toBeGreaterThan(0);
      }
    }
  });

  test("Declare Incident and Create Alert open from every resource an incident and an alert carry", () => {
    expect(getCreateFromRecordKinds(CreatedRecordKind.Incident)).toEqual(
      INCIDENT_AND_ALERT_RESOURCES,
    );
    expect(getCreateFromRecordKinds(CreatedRecordKind.Alert)).toEqual(
      INCIDENT_AND_ALERT_RESOURCES,
    );
  });

  test("maintenance opens from every resource with a Scheduled Maintenance tab - network sites too, monitors not", () => {
    const kinds: Array<CreateFromRecordKind> = getCreateFromRecordKinds(
      CreatedRecordKind.ScheduledMaintenance,
    );

    expect(kinds).toContain(CreateFromRecordKind.NetworkSite);
    expect(kinds).not.toContain(CreateFromRecordKind.Monitor);
    expect(kinds).not.toContain(CreateFromRecordKind.StatusPage);
    expect(kinds).toEqual([
      CreateFromRecordKind.Host,
      CreateFromRecordKind.KubernetesCluster,
      CreateFromRecordKind.DockerHost,
      CreateFromRecordKind.PodmanHost,
      CreateFromRecordKind.ProxmoxCluster,
      CreateFromRecordKind.VMwareVCenter,
      CreateFromRecordKind.CephCluster,
      CreateFromRecordKind.StorageArray,
      CreateFromRecordKind.DockerSwarmCluster,
      CreateFromRecordKind.IoTFleet,
      CreateFromRecordKind.DatabaseServer,
      CreateFromRecordKind.NetworkSite,
      CreateFromRecordKind.Service,
    ]);
  });

  test("an announcement opens from a status page, and nothing else does", () => {
    expect(getCreateFromRecordKinds(CreatedRecordKind.Announcement)).toEqual([
      CreateFromRecordKind.StatusPage,
    ]);

    for (const created of [
      CreatedRecordKind.Incident,
      CreatedRecordKind.Alert,
      CreatedRecordKind.ScheduledMaintenance,
    ]) {
      expect(getCreateFromRecordKinds(created)).not.toContain(
        CreateFromRecordKind.StatusPage,
      );
    }
  });

  test("a network site carries maintenance only: incidents and alerts have no site", () => {
    expect(getCreateFromRecordKinds(CreatedRecordKind.Incident)).not.toContain(
      CreateFromRecordKind.NetworkSite,
    );
    expect(getCreateFromRecordKinds(CreatedRecordKind.Alert)).not.toContain(
      CreateFromRecordKind.NetworkSite,
    );
  });
});

describe("the address a tab's create button opens", () => {
  test("names the record", () => {
    expect(
      getCreateFromRecordQuery(CreatedRecordKind.Incident, {
        kind: CreateFromRecordKind.Monitor,
        id: new ObjectID(MONITOR_ID),
      }),
    ).toEqual({ monitorId: MONITOR_ID });
    expect(
      getCreateFromRecordQuery(CreatedRecordKind.ScheduledMaintenance, {
        kind: CreateFromRecordKind.NetworkSite,
        id: HOST_ID,
      }),
    ).toEqual({ networkSiteId: HOST_ID });
    expect(
      getCreateFromRecordQuery(CreatedRecordKind.Announcement, {
        kind: CreateFromRecordKind.StatusPage,
        id: ` ${STATUS_PAGE_ID} `,
      }),
    ).toEqual({ statusPageId: STATUS_PAGE_ID });
  });

  test("names nothing from the project's lists", () => {
    for (const created of ALL_CREATED) {
      expect(getCreateFromRecordQuery(created, undefined)).toEqual({});
      expect(getCreateFromRecordQuery(created, null)).toEqual({});
    }
  });

  test("names nothing the page could not use: an ID that is not one, or a kind it has no field for", () => {
    expect(
      getCreateFromRecordQuery(CreatedRecordKind.Incident, {
        kind: CreateFromRecordKind.Monitor,
        id: "javascript:alert(1)",
      }),
    ).toEqual({});
    expect(
      getCreateFromRecordQuery(CreatedRecordKind.Incident, {
        kind: CreateFromRecordKind.Monitor,
        id: "",
      }),
    ).toEqual({});
    expect(
      getCreateFromRecordQuery(CreatedRecordKind.Incident, {
        kind: CreateFromRecordKind.NetworkSite,
        id: HOST_ID,
      }),
    ).toEqual({});
    expect(
      getCreateFromRecordQuery(CreatedRecordKind.ScheduledMaintenance, {
        kind: CreateFromRecordKind.Monitor,
        id: MONITOR_ID,
      }),
    ).toEqual({});
  });
});

describe("the create page reads its record off the address", () => {
  test("a real ID, trimmed, and nothing else", () => {
    expect(readCreateFromRecordId(MONITOR_ID)).toBe(MONITOR_ID);
    expect(readCreateFromRecordId(`  ${MONITOR_ID}\n`)).toBe(MONITOR_ID);
    expect(readCreateFromRecordId(`${MONITOR_ID}x`)).toBeNull();
    expect(readCreateFromRecordId("monitor")).toBeNull();
    expect(readCreateFromRecordId("")).toBeNull();
    expect(readCreateFromRecordId(null)).toBeNull();
    expect(readCreateFromRecordId(undefined)).toBeNull();
  });

  test("finds the record by its own parameter", () => {
    expect(
      readCreateFromRecord(
        CreatedRecordKind.Incident,
        addressReader({ hostId: HOST_ID }),
      ),
    ).toEqual({ kind: CreateFromRecordKind.Host, id: HOST_ID });
    expect(
      readCreateFromRecord(
        CreatedRecordKind.Alert,
        addressReader({ iotFleetId: HOST_ID }),
      ),
    ).toEqual({ kind: CreateFromRecordKind.IoTFleet, id: HOST_ID });
    expect(
      readCreateFromRecord(
        CreatedRecordKind.ScheduledMaintenance,
        addressReader({ networkSiteId: HOST_ID }),
      ),
    ).toEqual({ kind: CreateFromRecordKind.NetworkSite, id: HOST_ID });
  });

  test("reads every kind it can be opened from, by that kind's parameter", () => {
    for (const created of ALL_CREATED) {
      for (const kind of getCreateFromRecordKinds(created)) {
        const param: string = getCreateFromRecordDefinition(kind).queryParam;

        expect(
          readCreateFromRecord(created, addressReader({ [param]: HOST_ID })),
        ).toEqual({ kind: kind, id: HOST_ID });
      }
    }
  });

  test("ignores a forged ID and a parameter the page has no use for", () => {
    expect(
      readCreateFromRecord(
        CreatedRecordKind.Incident,
        addressReader({ monitorId: "<script>" }),
      ),
    ).toBeNull();
    expect(
      readCreateFromRecord(
        CreatedRecordKind.Incident,
        addressReader({ networkSiteId: HOST_ID, statusPageId: HOST_ID }),
      ),
    ).toBeNull();
    expect(
      readCreateFromRecord(
        CreatedRecordKind.ScheduledMaintenance,
        addressReader({ monitorId: MONITOR_ID }),
      ),
    ).toBeNull();
    expect(
      readCreateFromRecord(CreatedRecordKind.Alert, addressReader({})),
    ).toBeNull();
  });

  test("takes the first kind, in its order, when an address carries two", () => {
    expect(
      readCreateFromRecord(
        CreatedRecordKind.Incident,
        addressReader({ hostId: HOST_ID, monitorId: MONITOR_ID }),
      ),
    ).toEqual({ kind: CreateFromRecordKind.Monitor, id: MONITOR_ID });
    // A forged first one does not hide a real second one.
    expect(
      readCreateFromRecord(
        CreatedRecordKind.Incident,
        addressReader({ monitorId: "nope", hostId: HOST_ID }),
      ),
    ).toEqual({ kind: CreateFromRecordKind.Host, id: HOST_ID });
  });

  test("what a tab writes, the page reads back", () => {
    for (const created of ALL_CREATED) {
      for (const kind of getCreateFromRecordKinds(created)) {
        const address: CreateFromRecordAddress = { kind: kind, id: HOST_ID };

        expect(
          readCreateFromRecord(
            created,
            addressReader(getCreateFromRecordQuery(created, address)),
          ),
        ).toEqual(address);
      }
    }
  });
});

describe("where the form picks the record", () => {
  test("in the resource picker, by its relation, for every kind an incident and an event carry", () => {
    for (const created of [
      CreatedRecordKind.Incident,
      CreatedRecordKind.ScheduledMaintenance,
    ]) {
      for (const kind of getCreateFromRecordKinds(created)) {
        const field: CreateFromRecordField | null = getCreateFromRecordField(
          kind,
          created,
        );

        expect(field).toEqual(getCreateFromRecordDefinition(kind).field);
        expect(field!.holds).toBe(RecordFieldValue.NamedRecords);
      }
    }

    expect(
      getCreateFromRecordField(
        CreateFromRecordKind.Monitor,
        CreatedRecordKind.Incident,
      ),
    ).toEqual({ key: "monitors", holds: RecordFieldValue.NamedRecords });
    expect(
      getCreateFromRecordField(
        CreateFromRecordKind.NetworkSite,
        CreatedRecordKind.ScheduledMaintenance,
      ),
    ).toEqual({ key: "networkSites", holds: RecordFieldValue.NamedRecords });
  });

  test("an alert takes its one monitor in its Monitor dropdown, and the rest in the picker", () => {
    expect(
      getCreateFromRecordField(
        CreateFromRecordKind.Monitor,
        CreatedRecordKind.Alert,
      ),
    ).toEqual({ key: "monitor", holds: RecordFieldValue.RecordId });
    expect(
      getCreateFromRecordField(
        CreateFromRecordKind.Host,
        CreatedRecordKind.Alert,
      ),
    ).toEqual({ key: "hosts", holds: RecordFieldValue.NamedRecords });
  });

  test("an announcement takes its status page among its status pages, by ID", () => {
    expect(
      getCreateFromRecordField(
        CreateFromRecordKind.StatusPage,
        CreatedRecordKind.Announcement,
      ),
    ).toEqual({ key: "statusPages", holds: RecordFieldValue.RecordIds });
  });

  test("nowhere, for a kind the page cannot be opened from", () => {
    expect(
      getCreateFromRecordField(
        CreateFromRecordKind.NetworkSite,
        CreatedRecordKind.Incident,
      ),
    ).toBeNull();
    expect(
      getCreateFromRecordField(
        CreateFromRecordKind.Monitor,
        CreatedRecordKind.ScheduledMaintenance,
      ),
    ).toBeNull();
  });
});

describe("the form's starting values", () => {
  test("pick the record, named, so the picker shows it at once", () => {
    expect(
      pickRecordToCreateFrom({
        values: {},
        record: record(CreateFromRecordKind.Host, HOST_ID, "web-01"),
        created: CreatedRecordKind.Incident,
      }),
    ).toEqual({ hosts: [{ _id: HOST_ID, name: "web-01" }] });
  });

  test("put it first, ahead of a template's, and once", () => {
    const values: JSONObject = {
      title: "Checkout is down",
      hosts: [
        { _id: OTHER_HOST_ID, name: "web-02" },
        { _id: HOST_ID, name: "web-01 (as the template knew it)" },
      ],
      monitors: [{ _id: MONITOR_ID, name: "API" }],
    };

    expect(
      pickRecordToCreateFrom({
        values: values,
        record: record(CreateFromRecordKind.Host, HOST_ID, "web-01"),
        created: CreatedRecordKind.Incident,
      }),
    ).toEqual({
      title: "Checkout is down",
      hosts: [
        { _id: HOST_ID, name: "web-01" },
        { _id: OTHER_HOST_ID, name: "web-02" },
      ],
      monitors: [{ _id: MONITOR_ID, name: "API" }],
    });

    // The values handed in are left as they were.
    expect(values["hosts"]).toHaveLength(2);
  });

  test("recognise the record however the list holds it: IDs, ObjectIDs or records", () => {
    const monitor: Monitor = new Monitor();
    monitor._id = MONITOR_ID;

    for (const asHeld of [MONITOR_ID, new ObjectID(MONITOR_ID), monitor]) {
      expect(
        pickRecordToCreateFrom({
          values: { monitors: [asHeld] as unknown as Array<JSONObject> },
          record: record(CreateFromRecordKind.Monitor, MONITOR_ID, "API"),
          created: CreatedRecordKind.Incident,
        })["monitors"],
      ).toEqual([{ _id: MONITOR_ID, name: "API" }]);
    }
  });

  test("give an alert its monitor, unless something already chose one", () => {
    expect(
      pickRecordToCreateFrom({
        values: {},
        record: record(CreateFromRecordKind.Monitor, MONITOR_ID),
        created: CreatedRecordKind.Alert,
      }),
    ).toEqual({ monitor: MONITOR_ID });
    expect(
      pickRecordToCreateFrom({
        values: { monitor: HOST_ID },
        record: record(CreateFromRecordKind.Monitor, MONITOR_ID),
        created: CreatedRecordKind.Alert,
      }),
    ).toEqual({ monitor: HOST_ID });
  });

  test("give an announcement its status page by ID, ahead of the template's", () => {
    expect(
      pickRecordToCreateFrom({
        values: {
          statusPages: [TEMPLATE_STATUS_PAGE_ID, STATUS_PAGE_ID],
        },
        record: record(
          CreateFromRecordKind.StatusPage,
          STATUS_PAGE_ID,
          "Acme Status",
        ),
        created: CreatedRecordKind.Announcement,
      }),
    ).toEqual({ statusPages: [STATUS_PAGE_ID, TEMPLATE_STATUS_PAGE_ID] });
  });

  test("are what they were without a record, or with one the page cannot pick", () => {
    const values: JSONObject = { title: "Checkout is down" };

    expect(
      pickRecordToCreateFrom({
        values: values,
        record: null,
        created: CreatedRecordKind.Incident,
      }),
    ).toBe(values);
    expect(
      pickRecordToCreateFrom({
        values: values,
        record: record(CreateFromRecordKind.NetworkSite, HOST_ID),
        created: CreatedRecordKind.Incident,
      }),
    ).toBe(values);
  });

  test("read the IDs of a list, each once", () => {
    const monitor: Monitor = new Monitor();
    monitor._id = HOST_ID;

    expect(
      readRecordIds([
        MONITOR_ID,
        new ObjectID(OTHER_HOST_ID),
        monitor,
        { id: STATUS_PAGE_ID },
        MONITOR_ID,
        null,
        "",
        {},
      ]),
    ).toEqual([MONITOR_ID, OTHER_HOST_ID, HOST_ID, STATUS_PAGE_ID]);
    expect(readRecordIds(undefined)).toEqual([]);
    expect(readRecordIds({ _id: MONITOR_ID })).toEqual([]);
  });
});

describe("the trail back through the record's tab", () => {
  test("Project > the list > the record > its tab > this page", () => {
    expect(
      getCreateFromRecordTrail(
        { kind: CreateFromRecordKind.Host, id: new ObjectID(HOST_ID) },
        CreatedRecordKind.Incident,
      ),
    ).toEqual([
      { title: PROJECT_CRUMB_TITLE, page: PageMap.HOME },
      { title: "Hosts", page: PageMap.HOSTS },
      { title: "View Host", page: PageMap.HOST_VIEW, modelId: HOST_ID },
      {
        title: "Incidents",
        page: PageMap.HOST_VIEW_INCIDENTS,
        modelId: HOST_ID,
      },
      { title: "Declare New Incident", page: PageMap.INCIDENT_CREATE },
    ]);
  });

  test("ends on the page it is drawn on, for every kind of record created", () => {
    expect(CREATE_PAGES[CreatedRecordKind.Incident].page).toBe(
      PageMap.INCIDENT_CREATE,
    );
    expect(CREATE_PAGES[CreatedRecordKind.Alert].page).toBe(
      PageMap.ALERT_CREATE,
    );
    expect(CREATE_PAGES[CreatedRecordKind.ScheduledMaintenance].page).toBe(
      PageMap.SCHEDULED_MAINTENANCE_EVENT_CREATE,
    );
    expect(CREATE_PAGES[CreatedRecordKind.Announcement].page).toBe(
      PageMap.ANNOUNCEMENT_CREATE,
    );

    for (const created of ALL_CREATED) {
      expect(CREATE_PAGES[created].created).toBe(created);

      for (const kind of getCreateFromRecordKinds(created)) {
        const trail: Array<CreateFromRecordCrumb> | null =
          getCreateFromRecordTrail({ kind: kind, id: HOST_ID }, created);

        expect(trail).toHaveLength(5);
        expect(trail![0]).toEqual({
          title: PROJECT_CRUMB_TITLE,
          page: PageMap.HOME,
        });
        expect(trail![3]!.page).toBe(
          getCreateFromRecordDefinition(kind).tabs[created]!.page,
        );
        // The record's own pages carry its ID; the lists and this page do not.
        expect(
          trail!.map((crumb: CreateFromRecordCrumb): boolean => {
            return crumb.modelId === HOST_ID;
          }),
        ).toEqual([false, false, true, true, false]);
        expect(trail![4]).toEqual({
          title: CREATE_PAGES[created].title,
          page: CREATE_PAGES[created].page,
        });
      }
    }
  });

  test("goes through the monitor's Alerts tab for an alert, and a status page's Announcements tab for an announcement", () => {
    expect(
      getCreateFromRecordTrail(
        { kind: CreateFromRecordKind.Monitor, id: MONITOR_ID },
        CreatedRecordKind.Alert,
      )!.map((crumb: CreateFromRecordCrumb): string => {
        return crumb.title;
      }),
    ).toEqual([
      "Project",
      "Monitors",
      "View Monitor",
      "Alerts",
      "Create Alert",
    ]);
    expect(
      getCreateFromRecordTrail(
        { kind: CreateFromRecordKind.StatusPage, id: STATUS_PAGE_ID },
        CreatedRecordKind.Announcement,
      )!.map((crumb: CreateFromRecordCrumb): string => {
        return crumb.title;
      }),
    ).toEqual([
      "Project",
      "Status Pages",
      "View Status Page",
      "Announcements",
      "Create Announcement",
    ]);
  });

  test("is none for a kind the page cannot be opened from", () => {
    expect(
      getCreateFromRecordTrail(
        { kind: CreateFromRecordKind.NetworkSite, id: HOST_ID },
        CreatedRecordKind.Alert,
      ),
    ).toBeNull();
  });
});
