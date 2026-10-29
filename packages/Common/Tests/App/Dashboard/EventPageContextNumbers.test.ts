import PageContextUtil, {
  DashboardPageContext,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/PageContext";
import Alert from "../../../Models/DatabaseModels/Alert";
import Incident from "../../../Models/DatabaseModels/Incident";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import AIChatPageContextType, {
  AIChatPageContextHelper,
} from "../../../Types/AI/AIChatPageContext";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * ASK AI NAMES THE EVENT ON SCREEN AS ITS PAGE DOES.
 *
 * Opened from an incident, Ask AI's composer says what it will answer about
 * ("This incident · ..."), and the server folds that title into what the
 * question is about. It said "#18 Manually declared" for INC-18 - the bare
 * number, which the project's own numbering never shows - and named a
 * maintenance event by its title alone, so two events of one title were
 * one chip. Now each is named by the number its page leads with, then its
 * title: "INC-18 Manually declared" (Utils/Project/RecordNumber).
 */

const ENTITY_ID: string = "20000000-0000-4000-8000-000000000018";

function contextOf(
  type: AIChatPageContextType,
  noun: string,
): DashboardPageContext {
  return {
    type,
    entityId: ENTITY_ID,
    noun,
    chipLabel: `This ${noun}`,
    icon: IconProp.Alert,
    isEntity: true,
  };
}

const INCIDENT_CONTEXT: DashboardPageContext = contextOf(
  AIChatPageContextType.Incident,
  "incident",
);
const ALERT_CONTEXT: DashboardPageContext = contextOf(
  AIChatPageContextType.Alert,
  "alert",
);
const MAINTENANCE_CONTEXT: DashboardPageContext = contextOf(
  AIChatPageContextType.ScheduledMaintenanceEvent,
  "maintenance event",
);

function mockItem(item: unknown): ReturnType<typeof jest.spyOn> {
  return jest.spyOn(ModelAPI, "getItem").mockResolvedValue(item as never);
}

function selectOf(getItem: ReturnType<typeof jest.spyOn>): JSONObject {
  return (getItem.mock.calls[0]![0] as { select: JSONObject }).select;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("an incident's title in Ask AI", () => {
  test("its number as the project gave it, then its title", async () => {
    const incident: Incident = new Incident();
    incident.title = "Manually declared";
    incident.incidentNumber = 18;
    incident.incidentNumberWithPrefix = "INC-18";
    const getItem: ReturnType<typeof jest.spyOn> = mockItem(incident);

    expect(await PageContextUtil.resolveEntityTitle(INCIDENT_CONTEXT)).toBe(
      "INC-18 Manually declared",
    );
    expect(getItem).toHaveBeenCalledWith({
      modelType: Incident,
      id: new ObjectID(ENTITY_ID),
      select: {
        title: true,
        incidentNumber: true,
        incidentNumberWithPrefix: true,
      },
    });
  });

  test("a prefix of the project's own, exactly as the incident carries it", async () => {
    const incident: Incident = new Incident();
    incident.title = "Manually declared";
    incident.incidentNumber = 18;
    incident.incidentNumberWithPrefix = "OPS/SEV:18";
    mockItem(incident);

    expect(await PageContextUtil.resolveEntityTitle(INCIDENT_CONTEXT)).toBe(
      "OPS/SEV:18 Manually declared",
    );
  });

  test("one numbered before numbers kept their prefix: #18", async () => {
    const incident: Incident = new Incident();
    incident.title = "Manually declared";
    incident.incidentNumber = 18;
    mockItem(incident);

    expect(await PageContextUtil.resolveEntityTitle(INCIDENT_CONTEXT)).toBe(
      "#18 Manually declared",
    );
  });

  test("one without a number: its title alone", async () => {
    const incident: Incident = new Incident();
    incident.title = "Manually declared";
    mockItem(incident);

    expect(await PageContextUtil.resolveEntityTitle(INCIDENT_CONTEXT)).toBe(
      "Manually declared",
    );
  });

  test.each([
    ["no incident", null],
    ["an incident with no title", new Incident()],
  ])("%s leaves the plain label", async (_name: string, item: unknown) => {
    mockItem(item);

    expect(
      await PageContextUtil.resolveEntityTitle(INCIDENT_CONTEXT),
    ).toBeNull();
  });

  test("an incident the viewer cannot read leaves the plain label", async () => {
    jest
      .spyOn(ModelAPI, "getItem")
      .mockRejectedValue(new Error("Read access denied"));

    expect(
      await PageContextUtil.resolveEntityTitle(INCIDENT_CONTEXT),
    ).toBeNull();
  });
});

describe("an alert's title in Ask AI", () => {
  test("its number as the project gave it, then its title", async () => {
    const alert: Alert = new Alert();
    alert.title = "CPU high on web-1";
    alert.alertNumber = 7;
    alert.alertNumberWithPrefix = "ALT-7";
    const getItem: ReturnType<typeof jest.spyOn> = mockItem(alert);

    expect(await PageContextUtil.resolveEntityTitle(ALERT_CONTEXT)).toBe(
      "ALT-7 CPU high on web-1",
    );
    expect(selectOf(getItem)).toEqual({
      title: true,
      alertNumber: true,
      alertNumberWithPrefix: true,
    });
  });

  test("one numbered before numbers kept their prefix: #7", async () => {
    const alert: Alert = new Alert();
    alert.title = "CPU high on web-1";
    alert.alertNumber = 7;
    mockItem(alert);

    expect(await PageContextUtil.resolveEntityTitle(ALERT_CONTEXT)).toBe(
      "#7 CPU high on web-1",
    );
  });
});

describe("a maintenance event's title in Ask AI", () => {
  test("its number before its title, as its page is headed", async () => {
    const event: ScheduledMaintenance = new ScheduledMaintenance();
    event.title = "Primary database failover drill";
    event.scheduledMaintenanceNumber = 3;
    event.scheduledMaintenanceNumberWithPrefix = "SM-3";
    const getItem: ReturnType<typeof jest.spyOn> = mockItem(event);

    expect(await PageContextUtil.resolveEntityTitle(MAINTENANCE_CONTEXT)).toBe(
      "SM-3 Primary database failover drill",
    );
    expect(selectOf(getItem)).toEqual({
      title: true,
      scheduledMaintenanceNumber: true,
      scheduledMaintenanceNumberWithPrefix: true,
    });
  });

  test("two events of one title are two chips that read differently", async () => {
    const titles: Array<string | null> = [];

    for (const number of [3, 4]) {
      const event: ScheduledMaintenance = new ScheduledMaintenance();
      event.title = "Primary database failover drill";
      event.scheduledMaintenanceNumber = number;
      event.scheduledMaintenanceNumberWithPrefix = `SM-${number}`;
      jest.spyOn(ModelAPI, "getItem").mockResolvedValueOnce(event as never);
      titles.push(await PageContextUtil.resolveEntityTitle(MAINTENANCE_CONTEXT));
    }

    expect(titles).toEqual([
      "SM-3 Primary database failover drill",
      "SM-4 Primary database failover drill",
    ]);
  });

  test("one with no title leaves the plain label", async () => {
    const event: ScheduledMaintenance = new ScheduledMaintenance();
    event.scheduledMaintenanceNumber = 3;
    event.scheduledMaintenanceNumberWithPrefix = "SM-3";
    mockItem(event);

    expect(
      await PageContextUtil.resolveEntityTitle(MAINTENANCE_CONTEXT),
    ).toBeNull();
  });
});

describe("what is sent to the server", () => {
  test("the numbered title, which the server accepts as it is", () => {
    const payload: JSONObject = PageContextUtil.toRequestPayload({
      ...INCIDENT_CONTEXT,
      entityTitle: "INC-18 Manually declared",
    });

    expect(payload).toEqual({
      type: AIChatPageContextType.Incident,
      entityId: ENTITY_ID,
      entityTitle: "INC-18 Manually declared",
    });
    expect(AIChatPageContextHelper.sanitize(payload)).toEqual(payload);
  });
});
