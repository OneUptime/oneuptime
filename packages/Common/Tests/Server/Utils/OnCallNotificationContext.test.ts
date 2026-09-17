/*
 * The alert/incident services reach the isolated-vm native addon through the
 * template renderer they import. Nothing under test here runs a sandbox, and
 * the prebuilt binary cannot always dlopen in the test environment - so stub
 * it out before anything imports it.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import Alert from "../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Project from "../../../Models/DatabaseModels/Project";
import ServiceModel from "../../../Models/DatabaseModels/Service";
import UserOnCallLogTimeline from "../../../Models/DatabaseModels/UserOnCallLogTimeline";
import AlertEpisodeService from "../../../Server/Services/AlertEpisodeService";
import AlertService from "../../../Server/Services/AlertService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import IncidentService from "../../../Server/Services/IncidentService";
import {
  DashboardPathByResourceType,
  MAX_DESCRIPTION_LENGTH,
  OnCallNotificationContext,
  OnCallNotificationDetail,
  OnCallNotificationResourceReference,
  OnCallNotificationResourceType,
  buildAlertContext,
  buildAlertEpisodeContext,
  buildIncidentContext,
  buildIncidentEpisodeContext,
  detailsToJSON,
  formatDate,
  getOnCallNotificationContext,
  getResourceReference,
  sanitizeColor,
  truncateDescription,
} from "../../../Server/Utils/OnCallNotificationContext";
import Color from "../../../Types/Color";
import { JSONArray } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Timezone from "../../../Types/Timezone";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * https://github.com/OneUptime/oneuptime/issues/3457 - the public acknowledge
 * page showed a title and a Yes button and nothing else. Somebody paged at 3am
 * had no way of knowing what they were acknowledging. These tests pin what the
 * page is now handed for each of the four things that can page someone.
 */

type LabelsOf = (details: Array<OnCallNotificationDetail>) => Array<string>;

const labelsOf: LabelsOf = (
  details: Array<OnCallNotificationDetail>,
): Array<string> => {
  return details.map((detail: OnCallNotificationDetail): string => {
    return detail.label;
  });
};

type ValueOf = (
  details: Array<OnCallNotificationDetail>,
  label: string,
) => string | undefined;

const valueOf: ValueOf = (
  details: Array<OnCallNotificationDetail>,
  label: string,
): string | undefined => {
  return details.find((detail: OnCallNotificationDetail): boolean => {
    return detail.label === label;
  })?.value;
};

type ColorOf = (
  details: Array<OnCallNotificationDetail>,
  label: string,
) => string | null | undefined;

const colorOf: ColorOf = (
  details: Array<OnCallNotificationDetail>,
  label: string,
): string | null | undefined => {
  return details.find((detail: OnCallNotificationDetail): boolean => {
    return detail.label === label;
  })?.color;
};

type NamedMonitor = (name: string) => Monitor;

const namedMonitor: NamedMonitor = (name: string): Monitor => {
  const monitor: Monitor = new Monitor();
  monitor.name = name;
  return monitor;
};

type NamedService = (name: string) => ServiceModel;

const namedService: NamedService = (name: string): ServiceModel => {
  const service: ServiceModel = new ServiceModel();
  service.name = name;
  return service;
};

type NamedProject = (name: string) => Project;

const namedProject: NamedProject = (name: string): Project => {
  const project: Project = new Project();
  project.name = name;
  return project;
};

const RAISED_AT: Date = new Date(Date.UTC(2026, 0, 15, 9, 30, 0));

describe("sanitizeColor", () => {
  test("accepts the six digit hex a severity actually stores", () => {
    expect(sanitizeColor("#ff0000")).toBe("#ff0000");
    expect(sanitizeColor("#AABBCC")).toBe("#AABBCC");
  });

  test("accepts the three digit shorthand", () => {
    expect(sanitizeColor("#fff")).toBe("#fff");
  });

  test("trims surrounding whitespace", () => {
    expect(sanitizeColor("  #123456  ")).toBe("#123456");
  });

  test("returns null for nothing", () => {
    expect(sanitizeColor(undefined)).toBeNull();
    expect(sanitizeColor(null)).toBeNull();
    expect(sanitizeColor("")).toBeNull();
    expect(sanitizeColor("   ")).toBeNull();
  });

  test("refuses anything that is not plainly a hex colour", () => {
    /*
     * The value is interpolated into a style attribute. EJS escapes it too,
     * but a colour that can carry a quote or a semicolon has no business
     * reaching the template in the first place - the project picked it, and
     * the project is not the same trust boundary as the page's own markup.
     */
    expect(sanitizeColor("red")).toBeNull();
    expect(sanitizeColor("rgb(255,0,0)")).toBeNull();
    expect(sanitizeColor("#12")).toBeNull();
    expect(sanitizeColor("#1234567")).toBeNull();
    expect(sanitizeColor('#fff" onload="alert(1)')).toBeNull();
    expect(sanitizeColor("#fff; background: url(http://evil)")).toBeNull();
    expect(sanitizeColor("expression(alert(1))")).toBeNull();
  });
});

describe("truncateDescription", () => {
  test("returns an empty string for nothing", () => {
    expect(truncateDescription(undefined)).toBe("");
    expect(truncateDescription(null)).toBe("");
    expect(truncateDescription("   ")).toBe("");
  });

  test("leaves a short description alone", () => {
    expect(truncateDescription("  Disk is filling up.  ")).toBe(
      "Disk is filling up.",
    );
  });

  test("leaves a description of exactly the limit alone", () => {
    const exact: string = "a".repeat(MAX_DESCRIPTION_LENGTH);

    expect(truncateDescription(exact)).toBe(exact);
    expect(truncateDescription(exact).endsWith("...")).toBe(false);
  });

  test("truncates the essay somebody pasted into the description", () => {
    const long: string = "b".repeat(MAX_DESCRIPTION_LENGTH + 250);

    const truncated: string = truncateDescription(long);

    expect(truncated.endsWith("...")).toBe(true);
    expect(truncated.length).toBe(MAX_DESCRIPTION_LENGTH + 3);
  });
});

describe("formatDate", () => {
  test("is empty when there is no date", () => {
    expect(formatDate(undefined)).toBe("");
    expect(formatDate(null)).toBe("");
  });

  test("renders in the recipient's timezone with the zone spelled out", () => {
    const formatted: string = formatDate(RAISED_AT, Timezone.AmericaNew_York);

    expect(formatted).toBe("Jan 15, 2026, 4:30 AM EST");
  });

  test("falls back to UTC when the recipient has not set a timezone", () => {
    /*
     * Not the container's zone: the page is rendered server-side, so "local
     * time" would mean whatever the deployment happens to run in.
     */
    expect(formatDate(RAISED_AT)).toBe("Jan 15, 2026, 9:30 AM UTC");
  });

  test("falls back to UTC rather than rendering 'Invalid date'", () => {
    /*
     * User.timezone is a text column, so a value moment does not recognise is
     * reachable. Showing UTC is a worse answer than the user's own zone and a
     * far better one than "Invalid date".
     */
    expect(formatDate(RAISED_AT, "Middle/Earth")).toBe(
      "Jan 15, 2026, 9:30 AM UTC",
    );
  });
});

describe("getResourceReference", () => {
  test("resolves an alert", () => {
    const alertId: ObjectID = ObjectID.generate();
    const timelineItem: UserOnCallLogTimeline = new UserOnCallLogTimeline();
    timelineItem.triggeredByAlertId = alertId;

    const reference: OnCallNotificationResourceReference | null =
      getResourceReference(timelineItem);

    expect(reference?.resourceType).toBe(OnCallNotificationResourceType.Alert);
    expect(reference?.dashboardPath).toBe("alerts");
    expect(reference?.resourceId.toString()).toBe(alertId.toString());
  });

  test("resolves an incident", () => {
    const incidentId: ObjectID = ObjectID.generate();
    const timelineItem: UserOnCallLogTimeline = new UserOnCallLogTimeline();
    timelineItem.triggeredByIncidentId = incidentId;

    const reference: OnCallNotificationResourceReference | null =
      getResourceReference(timelineItem);

    expect(reference?.resourceType).toBe(
      OnCallNotificationResourceType.Incident,
    );
    expect(reference?.dashboardPath).toBe("incidents");
    expect(reference?.resourceId.toString()).toBe(incidentId.toString());
  });

  test("resolves an alert episode", () => {
    const episodeId: ObjectID = ObjectID.generate();
    const timelineItem: UserOnCallLogTimeline = new UserOnCallLogTimeline();
    timelineItem.triggeredByAlertEpisodeId = episodeId;

    const reference: OnCallNotificationResourceReference | null =
      getResourceReference(timelineItem);

    expect(reference?.resourceType).toBe(
      OnCallNotificationResourceType.AlertEpisode,
    );
    expect(reference?.dashboardPath).toBe("alerts/episodes");
  });

  test("resolves an incident episode", () => {
    const episodeId: ObjectID = ObjectID.generate();
    const timelineItem: UserOnCallLogTimeline = new UserOnCallLogTimeline();
    timelineItem.triggeredByIncidentEpisodeId = episodeId;

    const reference: OnCallNotificationResourceReference | null =
      getResourceReference(timelineItem);

    expect(reference?.resourceType).toBe(
      OnCallNotificationResourceType.IncidentEpisode,
    );
    expect(reference?.dashboardPath).toBe("incidents/episodes");
  });

  test("is null when the notification points at nothing", () => {
    expect(getResourceReference(new UserOnCallLogTimeline())).toBeNull();
  });

  test("keeps the incident-first precedence the redirect already relied on", () => {
    /*
     * An alert that belongs to an episode carries both ids. The order here is
     * the order the acknowledge redirect has always used, and changing it
     * would silently send people to a different page than the one their
     * notification was about.
     */
    const timelineItem: UserOnCallLogTimeline = new UserOnCallLogTimeline();
    timelineItem.triggeredByIncidentId = ObjectID.generate();
    timelineItem.triggeredByIncidentEpisodeId = ObjectID.generate();
    timelineItem.triggeredByAlertEpisodeId = ObjectID.generate();
    timelineItem.triggeredByAlertId = ObjectID.generate();

    expect(getResourceReference(timelineItem)?.resourceType).toBe(
      OnCallNotificationResourceType.Incident,
    );
  });

  test("prefers an alert episode over the alert inside it", () => {
    const timelineItem: UserOnCallLogTimeline = new UserOnCallLogTimeline();
    timelineItem.triggeredByAlertEpisodeId = ObjectID.generate();
    timelineItem.triggeredByAlertId = ObjectID.generate();

    expect(getResourceReference(timelineItem)?.resourceType).toBe(
      OnCallNotificationResourceType.AlertEpisode,
    );
  });

  test("every resource type has a dashboard path", () => {
    for (const resourceType of Object.values(OnCallNotificationResourceType)) {
      expect([
        resourceType,
        Boolean(DashboardPathByResourceType[resourceType]),
      ]).toEqual([resourceType, true]);
    }
  });
});

describe("buildAlertContext", () => {
  type BuildAlert = () => Alert;

  const buildAlert: BuildAlert = (): Alert => {
    const alert: Alert = new Alert();
    alert.title = "CPU above 90% on prod-web-1";
    alert.description = "CPU has been pinned for fifteen minutes.";
    alert.createdAt = RAISED_AT;
    alert.alertNumberWithPrefix = "ALT-42";
    alert.project = namedProject("Acme Production");
    alert.monitor = namedMonitor("prod-web-1 CPU");
    alert.services = [namedService("Checkout"), namedService("Search")];

    const severity: AlertSeverity = new AlertSeverity();
    severity.name = "Critical";
    severity.color = new Color("#dc2626");
    alert.alertSeverity = severity;

    const state: AlertState = new AlertState();
    state.name = "Created";
    state.color = new Color("#f59e0b");
    alert.currentAlertState = state;

    return alert;
  };

  test("carries every field the issue asked for", () => {
    const context: OnCallNotificationContext = buildAlertContext({
      alert: buildAlert(),
      resourceId: ObjectID.generate(),
      timezone: Timezone.AmericaNew_York,
    });

    expect(context.resourceType).toBe(OnCallNotificationResourceType.Alert);
    expect(context.resourceNumber).toBe("ALT-42");
    expect(context.resourceTitle).toBe("CPU above 90% on prod-web-1");
    expect(context.resourceDescription).toBe(
      "CPU has been pinned for fifteen minutes.",
    );

    expect(labelsOf(context.details)).toEqual([
      "Severity",
      "Current State",
      "Project",
      "Monitor",
      "Services",
      "Raised At",
    ]);

    expect(valueOf(context.details, "Severity")).toBe("Critical");
    expect(valueOf(context.details, "Current State")).toBe("Created");
    expect(valueOf(context.details, "Project")).toBe("Acme Production");
    expect(valueOf(context.details, "Monitor")).toBe("prod-web-1 CPU");
    expect(valueOf(context.details, "Services")).toBe("Checkout, Search");
    expect(valueOf(context.details, "Raised At")).toBe(
      "Jan 15, 2026, 4:30 AM EST",
    );
  });

  test("keeps the severity and state swatch colours", () => {
    const context: OnCallNotificationContext = buildAlertContext({
      alert: buildAlert(),
      resourceId: ObjectID.generate(),
    });

    expect(colorOf(context.details, "Severity")).toBe("#dc2626");
    expect(colorOf(context.details, "Current State")).toBe("#f59e0b");
    expect(colorOf(context.details, "Project")).toBeNull();
  });

  test("drops a colour the project configured to something unrenderable", () => {
    const alert: Alert = buildAlert();
    alert.alertSeverity!.color = new Color("not-a-colour");

    const context: OnCallNotificationContext = buildAlertContext({
      alert: alert,
      resourceId: ObjectID.generate(),
    });

    expect(valueOf(context.details, "Severity")).toBe("Critical");
    expect(colorOf(context.details, "Severity")).toBeNull();
  });

  test("omits rows it has nothing to put in rather than rendering them blank", () => {
    const alert: Alert = new Alert();
    alert.title = "Something happened";
    alert.createdAt = RAISED_AT;

    const context: OnCallNotificationContext = buildAlertContext({
      alert: alert,
      resourceId: ObjectID.generate(),
    });

    expect(labelsOf(context.details)).toEqual(["Raised At"]);
    expect(context.resourceNumber).toBe("");
    expect(context.resourceDescription).toBe("");
  });

  test("skips a services row when every service is unnamed", () => {
    const alert: Alert = buildAlert();
    alert.services = [new ServiceModel(), new ServiceModel()];

    const context: OnCallNotificationContext = buildAlertContext({
      alert: alert,
      resourceId: ObjectID.generate(),
    });

    expect(labelsOf(context.details)).not.toContain("Services");
  });

  test("truncates a very long description", () => {
    const alert: Alert = buildAlert();
    alert.description = "z".repeat(MAX_DESCRIPTION_LENGTH + 100);

    const context: OnCallNotificationContext = buildAlertContext({
      alert: alert,
      resourceId: ObjectID.generate(),
    });

    expect(context.resourceDescription.endsWith("...")).toBe(true);
  });

  test("reports the id it was asked about", () => {
    const alertId: ObjectID = ObjectID.generate();

    const context: OnCallNotificationContext = buildAlertContext({
      alert: buildAlert(),
      resourceId: alertId,
    });

    expect(context.resourceId.toString()).toBe(alertId.toString());
    expect(context.dashboardPath).toBe("alerts");
  });
});

describe("buildIncidentContext", () => {
  type BuildIncident = () => Incident;

  const buildIncident: BuildIncident = (): Incident => {
    const incident: Incident = new Incident();
    incident.title = "Checkout is down";
    incident.description = "Customers cannot complete payment.";
    incident.createdAt = new Date(Date.UTC(2026, 0, 15, 8, 0, 0));
    incident.declaredAt = RAISED_AT;
    incident.incidentNumberWithPrefix = "INC-7";
    incident.project = namedProject("Acme Production");
    incident.monitors = [
      namedMonitor("Checkout API"),
      namedMonitor("Payments API"),
    ];
    incident.services = [namedService("Checkout")];

    const severity: IncidentSeverity = new IncidentSeverity();
    severity.name = "SEV1";
    severity.color = new Color("#b91c1c");
    incident.incidentSeverity = severity;

    const state: IncidentState = new IncidentState();
    state.name = "Investigating";
    state.color = new Color("#2563eb");
    incident.currentIncidentState = state;

    return incident;
  };

  test("carries severity, state, project, monitors, services and the declared time", () => {
    const context: OnCallNotificationContext = buildIncidentContext({
      incident: buildIncident(),
      resourceId: ObjectID.generate(),
      timezone: Timezone.AmericaNew_York,
    });

    expect(context.resourceType).toBe(OnCallNotificationResourceType.Incident);
    expect(context.resourceNumber).toBe("INC-7");
    expect(context.dashboardPath).toBe("incidents");

    expect(labelsOf(context.details)).toEqual([
      "Severity",
      "Current State",
      "Project",
      "Monitors",
      "Services",
      "Declared At",
    ]);

    expect(valueOf(context.details, "Severity")).toBe("SEV1");
    expect(valueOf(context.details, "Current State")).toBe("Investigating");
    expect(valueOf(context.details, "Monitors")).toBe(
      "Checkout API, Payments API",
    );
    expect(colorOf(context.details, "Severity")).toBe("#b91c1c");
  });

  test("prefers the declared time over the row's creation time", () => {
    /*
     * A retrospectively declared incident is created now and declared for when
     * the impact actually started. The page must show the latter.
     */
    const context: OnCallNotificationContext = buildIncidentContext({
      incident: buildIncident(),
      resourceId: ObjectID.generate(),
    });

    expect(valueOf(context.details, "Declared At")).toBe(
      "Jan 15, 2026, 9:30 AM UTC",
    );
  });

  test("falls back to the creation time when nothing was declared", () => {
    const incident: Incident = buildIncident();
    delete incident.declaredAt;

    const context: OnCallNotificationContext = buildIncidentContext({
      incident: incident,
      resourceId: ObjectID.generate(),
    });

    expect(valueOf(context.details, "Declared At")).toBe(
      "Jan 15, 2026, 8:00 AM UTC",
    );
  });

  test("survives an incident stripped of everything but a title", () => {
    const incident: Incident = new Incident();
    incident.title = "Unknown";

    const context: OnCallNotificationContext = buildIncidentContext({
      incident: incident,
      resourceId: ObjectID.generate(),
    });

    expect(context.details).toEqual([]);
    expect(context.resourceTitle).toBe("Unknown");
  });
});

describe("buildAlertEpisodeContext", () => {
  type BuildEpisode = () => AlertEpisode;

  const buildEpisode: BuildEpisode = (): AlertEpisode => {
    const episode: AlertEpisode = new AlertEpisode();
    episode.title = "Elevated error rate";
    episode.description = "Five alerts grouped by fingerprint.";
    episode.createdAt = RAISED_AT;
    episode.lastAlertAddedAt = new Date(Date.UTC(2026, 0, 15, 10, 15, 0));
    episode.alertCount = 5;
    episode.episodeNumberWithPrefix = "AEP-3";
    episode.project = namedProject("Acme Production");

    const severity: AlertSeverity = new AlertSeverity();
    severity.name = "High";
    severity.color = new Color("#ea580c");
    episode.alertSeverity = severity;

    const state: AlertState = new AlertState();
    state.name = "Created";
    episode.currentAlertState = state;

    return episode;
  };

  test("carries the episode's own numbers and timestamps", () => {
    const context: OnCallNotificationContext = buildAlertEpisodeContext({
      alertEpisode: buildEpisode(),
      resourceId: ObjectID.generate(),
    });

    expect(context.resourceType).toBe(
      OnCallNotificationResourceType.AlertEpisode,
    );
    expect(context.dashboardPath).toBe("alerts/episodes");
    expect(context.resourceNumber).toBe("AEP-3");

    expect(labelsOf(context.details)).toEqual([
      "Severity",
      "Current State",
      "Project",
      "Alerts In Episode",
      "Started At",
      "Last Alert At",
    ]);

    expect(valueOf(context.details, "Alerts In Episode")).toBe("5");
    expect(valueOf(context.details, "Started At")).toBe(
      "Jan 15, 2026, 9:30 AM UTC",
    );
    expect(valueOf(context.details, "Last Alert At")).toBe(
      "Jan 15, 2026, 10:15 AM UTC",
    );
  });

  test("shows a zero count rather than dropping the row", () => {
    /*
     * Zero is falsy, and the row is built from a string, so this is the case
     * a naive truthiness check silently loses.
     */
    const episode: AlertEpisode = buildEpisode();
    episode.alertCount = 0;

    const context: OnCallNotificationContext = buildAlertEpisodeContext({
      alertEpisode: episode,
      resourceId: ObjectID.generate(),
    });

    expect(valueOf(context.details, "Alerts In Episode")).toBe("0");
  });

  test("omits the count when the episode does not carry one", () => {
    const episode: AlertEpisode = buildEpisode();
    delete episode.alertCount;

    const context: OnCallNotificationContext = buildAlertEpisodeContext({
      alertEpisode: episode,
      resourceId: ObjectID.generate(),
    });

    expect(labelsOf(context.details)).not.toContain("Alerts In Episode");
  });

  test("omits the last alert row before a second alert lands", () => {
    const episode: AlertEpisode = buildEpisode();
    delete episode.lastAlertAddedAt;

    const context: OnCallNotificationContext = buildAlertEpisodeContext({
      alertEpisode: episode,
      resourceId: ObjectID.generate(),
    });

    expect(labelsOf(context.details)).not.toContain("Last Alert At");
    expect(labelsOf(context.details)).toContain("Started At");
  });
});

describe("buildIncidentEpisodeContext", () => {
  type BuildEpisode = () => IncidentEpisode;

  const buildEpisode: BuildEpisode = (): IncidentEpisode => {
    const episode: IncidentEpisode = new IncidentEpisode();
    episode.title = "Payments degradation";
    episode.description = "Two incidents grouped together.";
    episode.createdAt = new Date(Date.UTC(2026, 0, 15, 8, 0, 0));
    episode.declaredAt = RAISED_AT;
    episode.lastIncidentAddedAt = new Date(Date.UTC(2026, 0, 15, 11, 45, 0));
    episode.incidentCount = 2;
    episode.episodeNumberWithPrefix = "IEP-9";
    episode.project = namedProject("Acme Production");

    const severity: IncidentSeverity = new IncidentSeverity();
    severity.name = "SEV2";
    severity.color = new Color("#d97706");
    episode.incidentSeverity = severity;

    const state: IncidentState = new IncidentState();
    state.name = "Identified";
    state.color = new Color("#7c3aed");
    episode.currentIncidentState = state;

    return episode;
  };

  test("carries the episode's own numbers and timestamps", () => {
    const context: OnCallNotificationContext = buildIncidentEpisodeContext({
      incidentEpisode: buildEpisode(),
      resourceId: ObjectID.generate(),
    });

    expect(context.resourceType).toBe(
      OnCallNotificationResourceType.IncidentEpisode,
    );
    expect(context.dashboardPath).toBe("incidents/episodes");
    expect(context.resourceNumber).toBe("IEP-9");

    expect(labelsOf(context.details)).toEqual([
      "Severity",
      "Current State",
      "Project",
      "Incidents In Episode",
      "Declared At",
      "Last Incident At",
    ]);

    expect(valueOf(context.details, "Incidents In Episode")).toBe("2");
    expect(valueOf(context.details, "Declared At")).toBe(
      "Jan 15, 2026, 9:30 AM UTC",
    );
    expect(colorOf(context.details, "Current State")).toBe("#7c3aed");
  });

  test("falls back to the creation time when nothing was declared", () => {
    const episode: IncidentEpisode = buildEpisode();
    delete episode.declaredAt;

    const context: OnCallNotificationContext = buildIncidentEpisodeContext({
      incidentEpisode: episode,
      resourceId: ObjectID.generate(),
    });

    expect(valueOf(context.details, "Declared At")).toBe(
      "Jan 15, 2026, 8:00 AM UTC",
    );
  });

  test("shows a zero count rather than dropping the row", () => {
    const episode: IncidentEpisode = buildEpisode();
    episode.incidentCount = 0;

    const context: OnCallNotificationContext = buildIncidentEpisodeContext({
      incidentEpisode: episode,
      resourceId: ObjectID.generate(),
    });

    expect(valueOf(context.details, "Incidents In Episode")).toBe("0");
  });
});

describe("detailsToJSON", () => {
  test("hands the view a plain object per row", () => {
    const json: JSONArray = detailsToJSON([
      { label: "Severity", value: "Critical", color: "#dc2626" },
      { label: "Project", value: "Acme", color: null },
    ]);

    expect(json).toEqual([
      { label: "Severity", value: "Critical", color: "#dc2626" },
      { label: "Project", value: "Acme", color: "" },
    ]);
  });

  test("turns a missing colour into an empty string, not null", () => {
    /*
     * Response.render takes a JSONObject and JSONValue has no null member.
     * The template only ever asks whether the colour is truthy.
     */
    const json: JSONArray = detailsToJSON([
      { label: "Project", value: "Acme", color: null },
    ]);

    expect(json[0]?.["color"]).toBe("");
  });

  test("is empty for no rows", () => {
    expect(detailsToJSON([])).toEqual([]);
  });
});

describe("getOnCallNotificationContext", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("reads the alert an alert notification points at", async () => {
    const alertId: ObjectID = ObjectID.generate();

    const alert: Alert = new Alert();
    alert.title = "Disk almost full";
    alert.createdAt = RAISED_AT;
    alert.monitor = namedMonitor("prod-db-1 disk");

    const findOneById: jest.Mock = jest
      .spyOn(AlertService, "findOneById")
      .mockResolvedValue(alert) as unknown as jest.Mock;

    const timelineItem: UserOnCallLogTimeline = new UserOnCallLogTimeline();
    timelineItem.triggeredByAlertId = alertId;

    const context: OnCallNotificationContext | null =
      await getOnCallNotificationContext({ timelineItem: timelineItem });

    expect(context?.resourceType).toBe(OnCallNotificationResourceType.Alert);
    expect(context?.resourceTitle).toBe("Disk almost full");
    expect(valueOf(context?.details || [], "Monitor")).toBe("prod-db-1 disk");

    expect(findOneById).toHaveBeenCalledTimes(1);
    expect(
      (
        findOneById.mock.calls[0]?.[0] as unknown as { id: ObjectID }
      ).id.toString(),
    ).toBe(alertId.toString());
  });

  test("reads the incident an incident notification points at", async () => {
    const incident: Incident = new Incident();
    incident.title = "Checkout is down";
    incident.declaredAt = RAISED_AT;

    jest.spyOn(IncidentService, "findOneById").mockResolvedValue(incident);

    const timelineItem: UserOnCallLogTimeline = new UserOnCallLogTimeline();
    timelineItem.triggeredByIncidentId = ObjectID.generate();

    const context: OnCallNotificationContext | null =
      await getOnCallNotificationContext({ timelineItem: timelineItem });

    expect(context?.resourceType).toBe(OnCallNotificationResourceType.Incident);
    expect(context?.resourceTitle).toBe("Checkout is down");
  });

  test("reads the alert episode an episode notification points at", async () => {
    const episode: AlertEpisode = new AlertEpisode();
    episode.title = "Elevated error rate";
    episode.createdAt = RAISED_AT;

    jest.spyOn(AlertEpisodeService, "findOneById").mockResolvedValue(episode);

    const timelineItem: UserOnCallLogTimeline = new UserOnCallLogTimeline();
    timelineItem.triggeredByAlertEpisodeId = ObjectID.generate();

    const context: OnCallNotificationContext | null =
      await getOnCallNotificationContext({ timelineItem: timelineItem });

    expect(context?.resourceType).toBe(
      OnCallNotificationResourceType.AlertEpisode,
    );
    expect(context?.resourceTitle).toBe("Elevated error rate");
  });

  test("reads the incident episode an episode notification points at", async () => {
    const episode: IncidentEpisode = new IncidentEpisode();
    episode.title = "Payments degradation";
    episode.createdAt = RAISED_AT;

    jest
      .spyOn(IncidentEpisodeService, "findOneById")
      .mockResolvedValue(episode);

    const timelineItem: UserOnCallLogTimeline = new UserOnCallLogTimeline();
    timelineItem.triggeredByIncidentEpisodeId = ObjectID.generate();

    const context: OnCallNotificationContext | null =
      await getOnCallNotificationContext({ timelineItem: timelineItem });

    expect(context?.resourceType).toBe(
      OnCallNotificationResourceType.IncidentEpisode,
    );
    expect(context?.resourceTitle).toBe("Payments degradation");
  });

  test("is null, without a read, when the notification points at nothing", async () => {
    const findOneById: jest.Mock = jest.spyOn(
      AlertService,
      "findOneById",
    ) as unknown as jest.Mock;

    const context: OnCallNotificationContext | null =
      await getOnCallNotificationContext({
        timelineItem: new UserOnCallLogTimeline(),
      });

    expect(context).toBeNull();
    expect(findOneById).not.toHaveBeenCalled();
  });

  test("is null when the resource has since been deleted", async () => {
    /*
     * The caller still has to render an acknowledgeable page in this case -
     * losing the description must never cost the engineer the button.
     */
    jest.spyOn(AlertService, "findOneById").mockResolvedValue(null);

    const timelineItem: UserOnCallLogTimeline = new UserOnCallLogTimeline();
    timelineItem.triggeredByAlertId = ObjectID.generate();

    await expect(
      getOnCallNotificationContext({ timelineItem: timelineItem }),
    ).resolves.toBeNull();
  });

  test("passes the recipient's timezone through to the timestamps", async () => {
    const alert: Alert = new Alert();
    alert.title = "Disk almost full";
    alert.createdAt = RAISED_AT;

    jest.spyOn(AlertService, "findOneById").mockResolvedValue(alert);

    const timelineItem: UserOnCallLogTimeline = new UserOnCallLogTimeline();
    timelineItem.triggeredByAlertId = ObjectID.generate();

    const context: OnCallNotificationContext | null =
      await getOnCallNotificationContext({
        timelineItem: timelineItem,
        timezone: Timezone.AsiaKolkata,
      });

    expect(valueOf(context?.details || [], "Raised At")).toBe(
      "Jan 15, 2026, 3:00 PM IST",
    );
  });
});
