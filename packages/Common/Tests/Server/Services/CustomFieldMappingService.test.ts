import { afterEach, describe, expect, test } from "@jest/globals";
import CustomFieldMappingSourceResource from "../../../Types/CustomField/CustomFieldMappingSourceResource";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertCustomField from "../../../Models/DatabaseModels/AlertCustomField";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentCustomField from "../../../Models/DatabaseModels/IncidentCustomField";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import AlertService from "../../../Server/Services/AlertService";
import AlertCustomFieldService from "../../../Server/Services/AlertCustomFieldService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentCustomFieldService from "../../../Server/Services/IncidentCustomFieldService";
import MonitorService from "../../../Server/Services/MonitorService";
import ScheduledMaintenanceService from "../../../Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceCustomFieldService from "../../../Server/Services/ScheduledMaintenanceCustomFieldService";
import CustomFieldMappingService from "../../../Server/Services/CustomFieldMappingService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";

/*
 * The engine behind "copy this custom field's value from the monitor"
 * (OneUptime/oneuptime#3549).
 *
 * Two properties matter more than any individual behaviour and are asserted
 * from several directions below:
 *
 *   1. It never destroys a value. No source record, no source definition and
 *      an empty source value all mean "leave the target alone". The scenario
 *      this guards is the natural first action after the feature ships —
 *      turning a mapping on for a field a project has been typing in by hand,
 *      before any monitor has a value for it.
 *
 *   2. It writes derived data as derived data: hook-free, compare-and-set
 *      against the bag it resolved from, and without touching `updatedAt`.
 *      Otherwise one monitor edit fires a workflow POST, a realtime emit and
 *      an audit insert per alert, and restamps `updatedAt` across years of
 *      resolved alerts.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const OTHER_MONITOR_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const ALERT_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const INCIDENT_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

interface DefinitionFixture {
  name: string;
  customFieldType?: CustomFieldType | undefined;
  mapFromResourceType?: string | undefined;
  mapFromCustomFieldName?: string | undefined;
}

type BuildDefinitionsFunction = (
  fixtures: Array<DefinitionFixture>,
) => Array<AlertCustomField>;

const buildDefinitions: BuildDefinitionsFunction = (
  fixtures: Array<DefinitionFixture>,
): Array<AlertCustomField> => {
  return fixtures.map((fixture: DefinitionFixture): AlertCustomField => {
    /*
     * Assigned through Object.assign because `exactOptionalPropertyTypes`
     * rejects writing an explicit `undefined` into an optional model property,
     * and "this fixture leaves the field unset" is exactly what several cases
     * below are testing.
     */
    return Object.assign(new AlertCustomField(), fixture);
  });
};

type BuildMonitorFunction = (
  id: ObjectID,
  customFields?: JSONObject | undefined,
) => Monitor;

const buildMonitor: BuildMonitorFunction = (
  id: ObjectID,
  customFields?: JSONObject | undefined,
): Monitor => {
  const monitor: Monitor = new Monitor();
  monitor._id = id.toString();

  /*
   * Only set when the caller has one. A monitor read WITHOUT its customFields
   * must not look like a monitor whose bag is empty — that distinction is what
   * decides whether the resolver can use the payload or has to query.
   */
  if (customFields) {
    monitor.customFields = customFields;
  }

  return monitor;
};

const VENDOR_MAPPING: Array<DefinitionFixture> = [
  {
    name: "Vendor",
    customFieldType: CustomFieldType.Text,
    mapFromResourceType: CustomFieldMappingSourceResource.Monitor,
    mapFromCustomFieldName: "Vendor",
  },
];

type StubAlertDefinitionsFunction = (
  fixtures: Array<DefinitionFixture>,
) => jest.SpyInstance;

const stubAlertDefinitions: StubAlertDefinitionsFunction = (
  fixtures: Array<DefinitionFixture>,
): jest.SpyInstance => {
  return jest
    .spyOn(AlertCustomFieldService, "findBy")
    .mockResolvedValue(buildDefinitions(fixtures) as never);
};

type BuildAlertCreateByFunction = (data: Partial<Alert>) => CreateBy<Alert>;

const buildAlertCreateBy: BuildAlertCreateByFunction = (
  data: Partial<Alert>,
): CreateBy<Alert> => {
  const alert: Alert = new Alert();
  Object.assign(alert, data);

  return {
    data: alert,
    props: { isRoot: true, tenantId: PROJECT_ID },
  } as CreateBy<Alert>;
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("CustomFieldMappingService.applyMappingsToCreate", () => {
  test("stamps the monitor's value onto a new alert", async () => {
    stubAlertDefinitions(VENDOR_MAPPING);
    jest
      .spyOn(MonitorService, "findBy")
      .mockResolvedValue([
        buildMonitor(MONITOR_ID, { Vendor: "Acme" }),
      ] as never);

    const createBy: CreateBy<Alert> = buildAlertCreateBy({
      monitorId: MONITOR_ID,
    });

    await CustomFieldMappingService.applyMappingsToCreate({
      definitionModelType: AlertCustomField,
      createBy: createBy,
    });

    expect(createBy.data.customFields).toEqual({ Vendor: "Acme" });
  });

  /*
   * The hottest creation path in the product is a monitor criterion opening an
   * alert, and it assigns the whole Monitor — already read with its
   * customFields for metric attributes. Taking the bag from there is what
   * keeps the ingest path free of an extra query per alert.
   */
  test("uses a monitor already hydrated on the payload instead of querying", async () => {
    stubAlertDefinitions(VENDOR_MAPPING);
    const findMonitors: jest.SpyInstance = jest
      .spyOn(MonitorService, "findBy")
      .mockResolvedValue([] as never);

    const createBy: CreateBy<Alert> = buildAlertCreateBy({
      monitor: buildMonitor(MONITOR_ID, { Vendor: "Acme" }),
    });

    await CustomFieldMappingService.applyMappingsToCreate({
      definitionModelType: AlertCustomField,
      createBy: createBy,
    });

    expect(createBy.data.customFields).toEqual({ Vendor: "Acme" });
    expect(findMonitors).not.toHaveBeenCalled();
  });

  /*
   * A monitor supplied as a bare id stub carries no bag. Treating its missing
   * customFields as "empty" instead of "unknown" skips the lookup and silently
   * inherits nothing — which is what an earlier `hasOwnProperty` check did,
   * because every model class initialises its columns in the class body and so
   * a bare `new Monitor()` already owns the property.
   */
  test("looks the monitor up when the payload carries only an id stub", async () => {
    stubAlertDefinitions(VENDOR_MAPPING);
    const findMonitors: jest.SpyInstance = jest
      .spyOn(MonitorService, "findBy")
      .mockResolvedValue([
        buildMonitor(MONITOR_ID, { Vendor: "Acme" }),
      ] as never);

    const stub: Monitor = new Monitor();
    stub._id = MONITOR_ID.toString();

    const createBy: CreateBy<Alert> = buildAlertCreateBy({ monitor: stub });

    await CustomFieldMappingService.applyMappingsToCreate({
      definitionModelType: AlertCustomField,
      createBy: createBy,
    });

    expect(findMonitors).toHaveBeenCalled();
    expect(createBy.data.customFields).toEqual({ Vendor: "Acme" });
  });

  /*
   * The other side of that distinction: a monitor read WITH its customFields
   * whose column is NULL in Postgres arrives with the property set to null.
   * That is a real answer — the monitor has no value — and must not trigger a
   * second lookup that would return the same nothing.
   */
  test("treats a monitor read with an empty bag as answered, without querying", async () => {
    stubAlertDefinitions(VENDOR_MAPPING);
    const findMonitors: jest.SpyInstance = jest
      .spyOn(MonitorService, "findBy")
      .mockResolvedValue([] as never);

    const readButEmpty: Monitor = new Monitor();
    readButEmpty._id = MONITOR_ID.toString();
    readButEmpty.customFields = null as unknown as JSONObject;

    const createBy: CreateBy<Alert> = buildAlertCreateBy({
      monitor: readButEmpty,
      customFields: { Vendor: "Typed by hand" },
    });

    await CustomFieldMappingService.applyMappingsToCreate({
      definitionModelType: AlertCustomField,
      createBy: createBy,
    });

    expect(findMonitors).not.toHaveBeenCalled();
    expect(createBy.data.customFields).toEqual({ Vendor: "Typed by hand" });
  });

  test("leaves the bag alone when the project has no mappings", async () => {
    stubAlertDefinitions([
      { name: "Vendor", customFieldType: CustomFieldType.Text },
    ]);
    const findMonitors: jest.SpyInstance = jest
      .spyOn(MonitorService, "findBy")
      .mockResolvedValue([] as never);

    const createBy: CreateBy<Alert> = buildAlertCreateBy({
      monitorId: MONITOR_ID,
      customFields: { Vendor: "Typed by hand" },
    });

    await CustomFieldMappingService.applyMappingsToCreate({
      definitionModelType: AlertCustomField,
      createBy: createBy,
    });

    expect(createBy.data.customFields).toEqual({ Vendor: "Typed by hand" });
    expect(findMonitors).not.toHaveBeenCalled();
  });

  /*
   * SLO burn-rate alerts, security-event alerts and network-site rollup alerts
   * are all created with no monitor at all.
   */
  test("leaves the bag alone when the alert has no monitor", async () => {
    stubAlertDefinitions(VENDOR_MAPPING);

    const createBy: CreateBy<Alert> = buildAlertCreateBy({
      customFields: { Vendor: "Typed by hand" },
    });

    await CustomFieldMappingService.applyMappingsToCreate({
      definitionModelType: AlertCustomField,
      createBy: createBy,
    });

    expect(createBy.data.customFields).toEqual({ Vendor: "Typed by hand" });
  });

  test("leaves the bag alone when the monitor holds no value for the source field", async () => {
    stubAlertDefinitions(VENDOR_MAPPING);
    jest
      .spyOn(MonitorService, "findBy")
      .mockResolvedValue([buildMonitor(MONITOR_ID, { Other: "x" })] as never);

    const createBy: CreateBy<Alert> = buildAlertCreateBy({
      monitorId: MONITOR_ID,
      customFields: { Vendor: "Typed by hand" },
    });

    await CustomFieldMappingService.applyMappingsToCreate({
      definitionModelType: AlertCustomField,
      createBy: createBy,
    });

    expect(createBy.data.customFields).toEqual({ Vendor: "Typed by hand" });
  });

  test("does not touch custom fields the mapping does not own", async () => {
    stubAlertDefinitions(VENDOR_MAPPING);
    jest
      .spyOn(MonitorService, "findBy")
      .mockResolvedValue([
        buildMonitor(MONITOR_ID, { Vendor: "Acme" }),
      ] as never);

    const createBy: CreateBy<Alert> = buildAlertCreateBy({
      monitorId: MONITOR_ID,
      customFields: { Owner: "kate" },
    });

    await CustomFieldMappingService.applyMappingsToCreate({
      definitionModelType: AlertCustomField,
      createBy: createBy,
    });

    expect(createBy.data.customFields).toEqual({
      Owner: "kate",
      Vendor: "Acme",
    });
  });

  test("a mapping pointing at a field the monitor never defined writes nothing", async () => {
    stubAlertDefinitions([
      {
        name: "Vendor",
        customFieldType: CustomFieldType.Text,
        mapFromResourceType: CustomFieldMappingSourceResource.Monitor,
        mapFromCustomFieldName: "Supplier",
      },
    ]);
    jest
      .spyOn(MonitorService, "findBy")
      .mockResolvedValue([
        buildMonitor(MONITOR_ID, { Vendor: "Acme" }),
      ] as never);

    const createBy: CreateBy<Alert> = buildAlertCreateBy({
      monitorId: MONITOR_ID,
    });

    await CustomFieldMappingService.applyMappingsToCreate({
      definitionModelType: AlertCustomField,
      createBy: createBy,
    });

    expect(createBy.data.customFields).toBeUndefined();
  });

  /*
   * A failure to inherit a custom field must never stop an alert being opened,
   * so the whole path is written not to throw.
   */
  test("swallows a failure reading the definitions", async () => {
    jest
      .spyOn(AlertCustomFieldService, "findBy")
      .mockRejectedValue(new Error("database is down") as never);

    const createBy: CreateBy<Alert> = buildAlertCreateBy({
      monitorId: MONITOR_ID,
    });

    await expect(
      CustomFieldMappingService.applyMappingsToCreate({
        definitionModelType: AlertCustomField,
        createBy: createBy,
      }),
    ).resolves.toBeUndefined();
  });
});

describe("CustomFieldMappingService.applyMappingsToCreate for many-source resources", () => {
  type BuildIncidentCreateByFunction = (
    monitors: Array<Monitor>,
  ) => CreateBy<Incident>;

  const buildIncidentCreateBy: BuildIncidentCreateByFunction = (
    monitors: Array<Monitor>,
  ): CreateBy<Incident> => {
    const incident: Incident = new Incident();
    incident.monitors = monitors;

    return {
      data: incident,
      props: { isRoot: true, tenantId: PROJECT_ID },
    } as CreateBy<Incident>;
  };

  const INCIDENT_VENDOR_MAPPING: Array<IncidentCustomField> = [
    Object.assign(new IncidentCustomField(), {
      name: "Vendor",
      customFieldType: CustomFieldType.Text,
      mapFromResourceType: CustomFieldMappingSourceResource.Monitor,
      mapFromCustomFieldName: "Vendor",
    }),
  ];

  test("uses the value every attached monitor agrees on", async () => {
    jest
      .spyOn(IncidentCustomFieldService, "findBy")
      .mockResolvedValue(INCIDENT_VENDOR_MAPPING as never);
    jest
      .spyOn(MonitorService, "findBy")
      .mockResolvedValue([
        buildMonitor(MONITOR_ID, { Vendor: "Acme" }),
        buildMonitor(OTHER_MONITOR_ID, { Vendor: "Acme" }),
      ] as never);

    const createBy: CreateBy<Incident> = buildIncidentCreateBy([
      buildMonitor(MONITOR_ID),
      buildMonitor(OTHER_MONITOR_ID),
    ]);

    await CustomFieldMappingService.applyMappingsToCreate({
      definitionModelType: IncidentCustomField,
      createBy: createBy,
    });

    expect(createBy.data.customFields).toEqual({ Vendor: "Acme" });
  });

  /*
   * The monitors relation carries no ORDER BY, so "the first one" is not a
   * stable answer — choosing a winner would make the value flip on its own.
   */
  test("writes nothing when the attached monitors disagree", async () => {
    jest
      .spyOn(IncidentCustomFieldService, "findBy")
      .mockResolvedValue(INCIDENT_VENDOR_MAPPING as never);
    jest
      .spyOn(MonitorService, "findBy")
      .mockResolvedValue([
        buildMonitor(MONITOR_ID, { Vendor: "Acme" }),
        buildMonitor(OTHER_MONITOR_ID, { Vendor: "Globex" }),
      ] as never);

    const createBy: CreateBy<Incident> = buildIncidentCreateBy([
      buildMonitor(MONITOR_ID),
      buildMonitor(OTHER_MONITOR_ID),
    ]);

    await CustomFieldMappingService.applyMappingsToCreate({
      definitionModelType: IncidentCustomField,
      createBy: createBy,
    });

    expect(createBy.data.customFields).toBeUndefined();
  });

  test("an incident with no monitors inherits nothing", async () => {
    jest
      .spyOn(IncidentCustomFieldService, "findBy")
      .mockResolvedValue(INCIDENT_VENDOR_MAPPING as never);
    const findMonitors: jest.SpyInstance = jest
      .spyOn(MonitorService, "findBy")
      .mockResolvedValue([] as never);

    const createBy: CreateBy<Incident> = buildIncidentCreateBy([]);

    await CustomFieldMappingService.applyMappingsToCreate({
      definitionModelType: IncidentCustomField,
      createBy: createBy,
    });

    expect(createBy.data.customFields).toBeUndefined();
    expect(findMonitors).not.toHaveBeenCalled();
  });
});

describe("CustomFieldMappingService.applyMappingsToUpdate", () => {
  type BuildAlertUpdateByFunction = (data: JSONObject) => UpdateBy<Alert>;

  const buildAlertUpdateBy: BuildAlertUpdateByFunction = (
    data: JSONObject,
  ): UpdateBy<Alert> => {
    return {
      query: { _id: ALERT_ID.toString() },
      data: data,
      props: { isRoot: true, tenantId: PROJECT_ID },
      limit: 1,
      skip: 0,
    } as unknown as UpdateBy<Alert>;
  };

  type StubAffectedAlertFunction = (alert: Partial<Alert>) => jest.SpyInstance;

  const stubAffectedAlert: StubAffectedAlertFunction = (
    alert: Partial<Alert>,
  ): jest.SpyInstance => {
    const model: Alert = new Alert();
    model._id = ALERT_ID.toString();
    model.projectId = PROJECT_ID;
    Object.assign(model, alert);

    return jest
      .spyOn(AlertService, "findBy")
      .mockResolvedValue([model] as never);
  };

  /*
   * The Custom Fields modal replaces the WHOLE bag — it has no server-side
   * merge — so saving an unrelated field would otherwise drop the mapped one.
   */
  test("restores a mapped value the caller's payload dropped", async () => {
    stubAlertDefinitions(VENDOR_MAPPING);
    stubAffectedAlert({
      monitorId: MONITOR_ID,
      customFields: { Vendor: "Acme", Owner: "kate" },
    });
    jest
      .spyOn(MonitorService, "findBy")
      .mockResolvedValue([
        buildMonitor(MONITOR_ID, { Vendor: "Acme" }),
      ] as never);

    const updateBy: UpdateBy<Alert> = buildAlertUpdateBy({
      customFields: { Owner: "raj" },
    });

    await CustomFieldMappingService.applyMappingsToUpdate({
      definitionModelType: AlertCustomField,
      updateBy: updateBy,
    });

    expect((updateBy.data as JSONObject)["customFields"]).toEqual({
      Owner: "raj",
      Vendor: "Acme",
    });
  });

  /*
   * Re-pointing an alert at another monitor changes what the mapped field
   * should hold, and the payload — not the stored row — is the new truth.
   */
  test("recomputes from the new monitor when the alert is repointed", async () => {
    stubAlertDefinitions(VENDOR_MAPPING);
    stubAffectedAlert({
      monitorId: MONITOR_ID,
      customFields: { Vendor: "Acme" },
    });
    jest
      .spyOn(MonitorService, "findBy")
      .mockResolvedValue([
        buildMonitor(OTHER_MONITOR_ID, { Vendor: "Globex" }),
      ] as never);

    const updateBy: UpdateBy<Alert> = buildAlertUpdateBy({
      monitorId: OTHER_MONITOR_ID,
    });

    await CustomFieldMappingService.applyMappingsToUpdate({
      definitionModelType: AlertCustomField,
      updateBy: updateBy,
    });

    expect((updateBy.data as JSONObject)["customFields"]).toEqual({
      Vendor: "Globex",
    });
  });

  test("recognises the relation-object spelling the dashboard posts", async () => {
    stubAlertDefinitions(VENDOR_MAPPING);
    stubAffectedAlert({ monitorId: MONITOR_ID, customFields: {} });
    jest
      .spyOn(MonitorService, "findBy")
      .mockResolvedValue([
        buildMonitor(OTHER_MONITOR_ID, { Vendor: "Globex" }),
      ] as never);

    const updateBy: UpdateBy<Alert> = buildAlertUpdateBy({
      monitor: { _id: OTHER_MONITOR_ID.toString() },
    });

    await CustomFieldMappingService.applyMappingsToUpdate({
      definitionModelType: AlertCustomField,
      updateBy: updateBy,
    });

    expect((updateBy.data as JSONObject)["customFields"]).toEqual({
      Vendor: "Globex",
    });
  });

  test("ignores an update that touches neither the bag nor the relation", async () => {
    const definitions: jest.SpyInstance = stubAlertDefinitions(VENDOR_MAPPING);
    const findAlerts: jest.SpyInstance = jest
      .spyOn(AlertService, "findBy")
      .mockResolvedValue([] as never);

    const updateBy: UpdateBy<Alert> = buildAlertUpdateBy({ title: "New" });

    await CustomFieldMappingService.applyMappingsToUpdate({
      definitionModelType: AlertCustomField,
      updateBy: updateBy,
    });

    expect((updateBy.data as JSONObject)["customFields"]).toBeUndefined();
    expect(findAlerts).not.toHaveBeenCalled();
    expect(definitions).not.toHaveBeenCalled();
  });

  /*
   * One payload is shared by every row a query-based update matches, and two
   * alerts can have different monitors — so there is no single correct
   * customFields to fold in. Those rows are re-resolved individually instead.
   */
  test("leaves the payload alone when the update matches more than one row", async () => {
    stubAlertDefinitions(VENDOR_MAPPING);

    const first: Alert = new Alert();
    first._id = ALERT_ID.toString();
    const second: Alert = new Alert();
    second._id = OTHER_MONITOR_ID.toString();

    jest
      .spyOn(AlertService, "findBy")
      .mockResolvedValue([first, second] as never);

    const updateBy: UpdateBy<Alert> = buildAlertUpdateBy({
      customFields: { Owner: "raj" },
    });

    await CustomFieldMappingService.applyMappingsToUpdate({
      definitionModelType: AlertCustomField,
      updateBy: updateBy,
    });

    expect((updateBy.data as JSONObject)["customFields"]).toEqual({
      Owner: "raj",
    });
  });

  test("does not restore a mapped value on an alert with no monitor", async () => {
    stubAlertDefinitions(VENDOR_MAPPING);
    stubAffectedAlert({ customFields: { Vendor: "Typed by hand" } });

    const updateBy: UpdateBy<Alert> = buildAlertUpdateBy({
      customFields: { Vendor: "Still typed by hand" },
    });

    await CustomFieldMappingService.applyMappingsToUpdate({
      definitionModelType: AlertCustomField,
      updateBy: updateBy,
    });

    expect((updateBy.data as JSONObject)["customFields"]).toEqual({
      Vendor: "Still typed by hand",
    });
  });
});

describe("CustomFieldMappingService.propagateFromSourceRecord", () => {
  type StubTargetsFunction = (alerts: Array<Alert>) => void;

  const stubTargets: StubTargetsFunction = (alerts: Array<Alert>): void => {
    jest.spyOn(AlertService, "findBy").mockResolvedValue(alerts as never);
    jest.spyOn(IncidentService, "findBy").mockResolvedValue([] as never);
    jest
      .spyOn(ScheduledMaintenanceService, "findBy")
      .mockResolvedValue([] as never);
  };

  /*
   * A monitor change fans out to all three target resources; these tests are
   * about the Alert leg, so the other two are configured with no mappings.
   */
  type StubOtherTargetsHaveNoMappingsFunction = () => void;

  const stubOtherTargetsHaveNoMappings: StubOtherTargetsHaveNoMappingsFunction =
    (): void => {
      jest
        .spyOn(IncidentCustomFieldService, "findBy")
        .mockResolvedValue([] as never);
      jest
        .spyOn(ScheduledMaintenanceCustomFieldService, "findBy")
        .mockResolvedValue([] as never);
    };

  type BuildAlertFunction = (id: ObjectID, customFields: JSONObject) => Alert;

  const buildAlert: BuildAlertFunction = (
    id: ObjectID,
    customFields: JSONObject,
  ): Alert => {
    const alert: Alert = new Alert();
    alert._id = id.toString();
    alert.projectId = PROJECT_ID;
    alert.monitorId = MONITOR_ID;
    alert.customFields = customFields;
    return alert;
  };

  /*
   * The full update pipeline would fire a workflow POST, a realtime emit and
   * an audit insert for every alert on the monitor. Derived data goes through
   * the hook-free write instead, with a compare-and-set on the bag it was
   * resolved from and without touching `updatedAt`.
   */
  test("writes through the hook-free path with a compare-and-set and no updatedAt bump", async () => {
    stubAlertDefinitions(VENDOR_MAPPING);
    stubOtherTargetsHaveNoMappings();

    stubTargets([buildAlert(ALERT_ID, { Vendor: "Old", Owner: "kate" })]);
    jest
      .spyOn(MonitorService, "findBy")
      .mockResolvedValue([
        buildMonitor(MONITOR_ID, { Vendor: "Acme" }),
      ] as never);

    const write: jest.SpyInstance = jest
      .spyOn(AlertService, "updateColumnsByIdWithoutHooks")
      .mockResolvedValue(undefined as never);

    await CustomFieldMappingService.propagateFromSourceRecord({
      resource: CustomFieldMappingSourceResource.Monitor,
      sourceId: MONITOR_ID,
      projectId: PROJECT_ID,
    });

    expect(write).toHaveBeenCalledTimes(1);

    const call: JSONObject = write.mock.calls[0]![0] as JSONObject;

    expect((call["data"] as JSONObject)["customFields"]).toEqual({
      Vendor: "Acme",
      Owner: "kate",
    });
    expect((call["expectedData"] as JSONObject)["customFields"]).toEqual({
      Vendor: "Old",
      Owner: "kate",
    });
    expect(call["skipUpdateDateColumn"]).toBe(true);
  });

  test("does not write a row that already holds the right value", async () => {
    stubAlertDefinitions(VENDOR_MAPPING);
    stubOtherTargetsHaveNoMappings();

    stubTargets([buildAlert(ALERT_ID, { Vendor: "Acme" })]);
    jest
      .spyOn(MonitorService, "findBy")
      .mockResolvedValue([
        buildMonitor(MONITOR_ID, { Vendor: "Acme" }),
      ] as never);

    const write: jest.SpyInstance = jest
      .spyOn(AlertService, "updateColumnsByIdWithoutHooks")
      .mockResolvedValue(undefined as never);

    await CustomFieldMappingService.propagateFromSourceRecord({
      resource: CustomFieldMappingSourceResource.Monitor,
      sourceId: MONITOR_ID,
      projectId: PROJECT_ID,
    });

    expect(write).not.toHaveBeenCalled();
  });

  /*
   * The single most dangerous thing this feature could do. Clearing the
   * monitor's Vendor must not clear it on every alert that ever inherited it.
   */
  test("clearing the source does not clear the copies", async () => {
    stubAlertDefinitions(VENDOR_MAPPING);
    stubOtherTargetsHaveNoMappings();

    stubTargets([buildAlert(ALERT_ID, { Vendor: "Acme" })]);
    jest
      .spyOn(MonitorService, "findBy")
      .mockResolvedValue([buildMonitor(MONITOR_ID, {})] as never);

    const write: jest.SpyInstance = jest
      .spyOn(AlertService, "updateColumnsByIdWithoutHooks")
      .mockResolvedValue(undefined as never);

    await CustomFieldMappingService.propagateFromSourceRecord({
      resource: CustomFieldMappingSourceResource.Monitor,
      sourceId: MONITOR_ID,
      projectId: PROJECT_ID,
    });

    expect(write).not.toHaveBeenCalled();
  });

  test("a propagation failure for one resource does not stop the others", async () => {
    jest
      .spyOn(AlertCustomFieldService, "findBy")
      .mockRejectedValue(new Error("boom") as never);
    const incidentDefinitions: jest.SpyInstance = jest
      .spyOn(IncidentCustomFieldService, "findBy")
      .mockResolvedValue([] as never);
    jest
      .spyOn(ScheduledMaintenanceCustomFieldService, "findBy")
      .mockResolvedValue([] as never);

    await expect(
      CustomFieldMappingService.propagateFromSourceRecord({
        resource: CustomFieldMappingSourceResource.Monitor,
        sourceId: MONITOR_ID,
        projectId: PROJECT_ID,
      }),
    ).resolves.toBeUndefined();

    expect(incidentDefinitions).toHaveBeenCalled();
  });
});

describe("CustomFieldMappingService.restampAfterMultiRowUpdate", () => {
  test("does nothing for a single-row update, which the before-hook already handled", () => {
    const definitions: jest.SpyInstance = stubAlertDefinitions(VENDOR_MAPPING);

    CustomFieldMappingService.restampAfterMultiRowUpdate({
      definitionModelType: AlertCustomField,
      updateBy: {
        query: {},
        data: { customFields: {} },
        props: { isRoot: true, tenantId: PROJECT_ID },
      } as unknown as UpdateBy<Alert>,
      updatedItemIds: [ALERT_ID],
    });

    expect(definitions).not.toHaveBeenCalled();
  });

  test("does nothing when the update cannot have changed a mapped value", () => {
    const definitions: jest.SpyInstance = stubAlertDefinitions(VENDOR_MAPPING);

    CustomFieldMappingService.restampAfterMultiRowUpdate({
      definitionModelType: AlertCustomField,
      updateBy: {
        query: {},
        data: { title: "New" },
        props: { isRoot: true, tenantId: PROJECT_ID },
      } as unknown as UpdateBy<Alert>,
      updatedItemIds: [ALERT_ID, INCIDENT_ID],
    });

    expect(definitions).not.toHaveBeenCalled();
  });
});
