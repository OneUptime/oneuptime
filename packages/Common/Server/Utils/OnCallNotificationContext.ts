import AlertEpisodeService from "../Services/AlertEpisodeService";
import AlertService from "../Services/AlertService";
import IncidentEpisodeService from "../Services/IncidentEpisodeService";
import IncidentService from "../Services/IncidentService";
import Alert from "../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../Models/DatabaseModels/AlertEpisode";
import Incident from "../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../Models/DatabaseModels/IncidentEpisode";
import Monitor from "../../Models/DatabaseModels/Monitor";
import Service from "../../Models/DatabaseModels/Service";
import UserOnCallLogTimeline from "../../Models/DatabaseModels/UserOnCallLogTimeline";
import OneUptimeDate from "../../Types/Date";
import { JSONArray, JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Timezone from "../../Types/Timezone";

/*
 * The public acknowledge page used to show a title and nothing else. Someone
 * woken at 3am by an SMS was asked to acknowledge a page that told them
 * nothing about what they were acknowledging - no severity, no monitor, no
 * project, no time it was raised.
 * See https://github.com/OneUptime/oneuptime/issues/3457.
 *
 * This module turns whichever of the four notification sources fired
 * (Alert, Incident, Alert Episode, Incident Episode) into a flat, view-ready
 * shape. The read of the database is one function; every transform around it
 * is pure, so the rendering rules are tested without a database.
 */

export enum OnCallNotificationResourceType {
  Alert = "Alert",
  Incident = "Incident",
  AlertEpisode = "Alert Episode",
  IncidentEpisode = "Incident Episode",
}

/** Where the resource lives under `/dashboard/:projectId/`. */
export const DashboardPathByResourceType: Record<
  OnCallNotificationResourceType,
  string
> = {
  [OnCallNotificationResourceType.Alert]: "alerts",
  [OnCallNotificationResourceType.Incident]: "incidents",
  [OnCallNotificationResourceType.AlertEpisode]: "alerts/episodes",
  [OnCallNotificationResourceType.IncidentEpisode]: "incidents/episodes",
};

export interface OnCallNotificationResourceReference {
  resourceType: OnCallNotificationResourceType;
  dashboardPath: string;
  resourceId: ObjectID;
}

/** One row of the "what am I acknowledging" list. */
export interface OnCallNotificationDetail {
  label: string;
  value: string;
  /** Hex colour for the swatch next to the value, or null for no swatch. */
  color: string | null;
}

export interface OnCallNotificationContext {
  resourceType: OnCallNotificationResourceType;
  dashboardPath: string;
  resourceId: ObjectID;
  /** Human-facing identifier, e.g. "ALT-42". Empty when the project has none. */
  resourceNumber: string;
  resourceTitle: string;
  resourceDescription: string;
  details: Array<OnCallNotificationDetail>;
}

/*
 * A description is free text a human typed, and some of them are essays. The
 * page is a decision aid, not the incident record - the dashboard link carries
 * the rest.
 */
export const MAX_DESCRIPTION_LENGTH: number = 500;

/*
 * The colours come out of the database as project-configurable strings and are
 * interpolated straight into a style attribute. Anything that is not plainly a
 * hex colour is dropped rather than escaped: there is no legitimate severity
 * colour that this rejects, and it keeps `style="background-color: ..."` from
 * ever becoming an injection point.
 */
const HEX_COLOR: RegExp = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export type SanitizeColorFunction = (
  color: string | null | undefined,
) => string | null;

export const sanitizeColor: SanitizeColorFunction = (
  color: string | null | undefined,
): string | null => {
  if (!color) {
    return null;
  }

  const trimmed: string = color.toString().trim();

  return HEX_COLOR.test(trimmed) ? trimmed : null;
};

export type TruncateDescriptionFunction = (
  description: string | null | undefined,
) => string;

export const truncateDescription: TruncateDescriptionFunction = (
  description: string | null | undefined,
): string => {
  if (!description) {
    return "";
  }

  const trimmed: string = description.toString().trim();

  if (trimmed.length <= MAX_DESCRIPTION_LENGTH) {
    return trimmed;
  }

  return `${trimmed.slice(0, MAX_DESCRIPTION_LENGTH).trimEnd()}...`;
};

export type FormatDateFunction = (
  date: Date | null | undefined,
  timezone?: string | undefined,
) => string;

/*
 * Rendered server-side, so "local time" would mean the container's timezone,
 * which is meaningless to the reader. The recipient's own timezone is used
 * when we know it, and the zone abbreviation is always appended so the wall
 * clock is never ambiguous.
 *
 * The clock format is pinned rather than sniffed: the sniff reads the browser
 * locale, and there is no browser here.
 *
 * The zone is validated rather than trusted. User.timezone is a text column,
 * and moment renders an unrecognised zone as the literal "Invalid date" - a
 * worse answer than UTC on a page whose entire purpose is to inform.
 */
export const formatDate: FormatDateFunction = (
  date: Date | null | undefined,
  timezone?: string | undefined,
): string => {
  if (!date) {
    return "";
  }

  const isKnownTimezone: boolean = Boolean(
    timezone &&
      Object.values(Timezone).includes(timezone as unknown as Timezone),
  );

  return OneUptimeDate.getDateAsFormattedStringInTimezone({
    date: date,
    timezone: isKnownTimezone ? timezone : "UTC",
    use12HourFormat: true,
  });
};

type DetailBuilderFunction = (
  details: Array<OnCallNotificationDetail>,
  label: string,
  value: string | null | undefined,
  color?: string | null | undefined,
) => void;

/** Rows with nothing in them are omitted rather than rendered blank. */
const addDetail: DetailBuilderFunction = (
  details: Array<OnCallNotificationDetail>,
  label: string,
  value: string | null | undefined,
  color?: string | null | undefined,
): void => {
  if (!value) {
    return;
  }

  const trimmedValue: string = value.toString().trim();

  if (!trimmedValue) {
    return;
  }

  details.push({
    label: label,
    value: trimmedValue,
    color: sanitizeColor(color),
  });
};

type NamedEntityListFunction = (
  entities: Array<Monitor> | Array<Service> | undefined,
) => string;

const joinNames: NamedEntityListFunction = (
  entities: Array<Monitor> | Array<Service> | undefined,
): string => {
  if (!entities || entities.length === 0) {
    return "";
  }

  return entities
    .map((entity: Monitor | Service): string => {
      return entity.name || "";
    })
    .filter((name: string): boolean => {
      return Boolean(name);
    })
    .join(", ");
};

export type DetailsToJSONFunction = (
  details: Array<OnCallNotificationDetail>,
) => JSONArray;

/**
 * `Response.render` takes a JSONObject, and JSONValue has no null member, so
 * "no colour" crosses into the view as an empty string. The template only ever
 * asks whether it is truthy.
 */
export const detailsToJSON: DetailsToJSONFunction = (
  details: Array<OnCallNotificationDetail>,
): JSONArray => {
  return details.map((detail: OnCallNotificationDetail): JSONObject => {
    return {
      label: detail.label,
      value: detail.value,
      color: detail.color || "",
    };
  });
};

export type GetResourceReferenceFunction = (
  timelineItem: UserOnCallLogTimeline,
) => OnCallNotificationResourceReference | null;

/**
 * Which of the four things this on-call notification was raised for.
 *
 * The order matters and matches the rest of the codebase: an alert that
 * belongs to an episode carries both ids, and the more specific one wins.
 */
export const getResourceReference: GetResourceReferenceFunction = (
  timelineItem: UserOnCallLogTimeline,
): OnCallNotificationResourceReference | null => {
  const candidates: Array<
    [OnCallNotificationResourceType, ObjectID | undefined]
  > = [
    [
      OnCallNotificationResourceType.Incident,
      timelineItem.triggeredByIncidentId,
    ],
    [
      OnCallNotificationResourceType.IncidentEpisode,
      timelineItem.triggeredByIncidentEpisodeId,
    ],
    [
      OnCallNotificationResourceType.AlertEpisode,
      timelineItem.triggeredByAlertEpisodeId,
    ],
    [OnCallNotificationResourceType.Alert, timelineItem.triggeredByAlertId],
  ];

  for (const [resourceType, resourceId] of candidates) {
    if (resourceId) {
      return {
        resourceType: resourceType,
        dashboardPath: DashboardPathByResourceType[resourceType],
        resourceId: resourceId,
      };
    }
  }

  return null;
};

export type BuildAlertContextFunction = (data: {
  alert: Alert;
  resourceId: ObjectID;
  timezone?: string | undefined;
}) => OnCallNotificationContext;

export const buildAlertContext: BuildAlertContextFunction = (data: {
  alert: Alert;
  resourceId: ObjectID;
  timezone?: string | undefined;
}): OnCallNotificationContext => {
  const alert: Alert = data.alert;
  const details: Array<OnCallNotificationDetail> = [];

  addDetail(
    details,
    "Severity",
    alert.alertSeverity?.name,
    alert.alertSeverity?.color?.toString(),
  );
  addDetail(
    details,
    "Current State",
    alert.currentAlertState?.name,
    alert.currentAlertState?.color?.toString(),
  );
  addDetail(details, "Project", alert.project?.name);
  addDetail(details, "Monitor", alert.monitor?.name);
  addDetail(details, "Services", joinNames(alert.services));
  addDetail(details, "Raised At", formatDate(alert.createdAt, data.timezone));

  return {
    resourceType: OnCallNotificationResourceType.Alert,
    dashboardPath:
      DashboardPathByResourceType[OnCallNotificationResourceType.Alert],
    resourceId: data.resourceId,
    resourceNumber: alert.alertNumberWithPrefix || "",
    resourceTitle: alert.title || "",
    resourceDescription: truncateDescription(alert.description),
    details: details,
  };
};

export type BuildIncidentContextFunction = (data: {
  incident: Incident;
  resourceId: ObjectID;
  timezone?: string | undefined;
}) => OnCallNotificationContext;

export const buildIncidentContext: BuildIncidentContextFunction = (data: {
  incident: Incident;
  resourceId: ObjectID;
  timezone?: string | undefined;
}): OnCallNotificationContext => {
  const incident: Incident = data.incident;
  const details: Array<OnCallNotificationDetail> = [];

  addDetail(
    details,
    "Severity",
    incident.incidentSeverity?.name,
    incident.incidentSeverity?.color?.toString(),
  );
  addDetail(
    details,
    "Current State",
    incident.currentIncidentState?.name,
    incident.currentIncidentState?.color?.toString(),
  );
  addDetail(details, "Project", incident.project?.name);
  addDetail(details, "Monitors", joinNames(incident.monitors));
  addDetail(details, "Services", joinNames(incident.services));
  addDetail(
    details,
    "Declared At",
    formatDate(incident.declaredAt || incident.createdAt, data.timezone),
  );

  return {
    resourceType: OnCallNotificationResourceType.Incident,
    dashboardPath:
      DashboardPathByResourceType[OnCallNotificationResourceType.Incident],
    resourceId: data.resourceId,
    resourceNumber: incident.incidentNumberWithPrefix || "",
    resourceTitle: incident.title || "",
    resourceDescription: truncateDescription(incident.description),
    details: details,
  };
};

export type BuildAlertEpisodeContextFunction = (data: {
  alertEpisode: AlertEpisode;
  resourceId: ObjectID;
  timezone?: string | undefined;
}) => OnCallNotificationContext;

export const buildAlertEpisodeContext: BuildAlertEpisodeContextFunction =
  (data: {
    alertEpisode: AlertEpisode;
    resourceId: ObjectID;
    timezone?: string | undefined;
  }): OnCallNotificationContext => {
    const alertEpisode: AlertEpisode = data.alertEpisode;
    const details: Array<OnCallNotificationDetail> = [];

    addDetail(
      details,
      "Severity",
      alertEpisode.alertSeverity?.name,
      alertEpisode.alertSeverity?.color?.toString(),
    );
    addDetail(
      details,
      "Current State",
      alertEpisode.currentAlertState?.name,
      alertEpisode.currentAlertState?.color?.toString(),
    );
    addDetail(details, "Project", alertEpisode.project?.name);
    addDetail(
      details,
      "Alerts In Episode",
      alertEpisode.alertCount === undefined || alertEpisode.alertCount === null
        ? ""
        : alertEpisode.alertCount.toString(),
    );
    addDetail(
      details,
      "Started At",
      formatDate(alertEpisode.createdAt, data.timezone),
    );
    addDetail(
      details,
      "Last Alert At",
      formatDate(alertEpisode.lastAlertAddedAt, data.timezone),
    );

    return {
      resourceType: OnCallNotificationResourceType.AlertEpisode,
      dashboardPath:
        DashboardPathByResourceType[
          OnCallNotificationResourceType.AlertEpisode
        ],
      resourceId: data.resourceId,
      resourceNumber: alertEpisode.episodeNumberWithPrefix || "",
      resourceTitle: alertEpisode.title || "",
      resourceDescription: truncateDescription(alertEpisode.description),
      details: details,
    };
  };

export type BuildIncidentEpisodeContextFunction = (data: {
  incidentEpisode: IncidentEpisode;
  resourceId: ObjectID;
  timezone?: string | undefined;
}) => OnCallNotificationContext;

export const buildIncidentEpisodeContext: BuildIncidentEpisodeContextFunction =
  (data: {
    incidentEpisode: IncidentEpisode;
    resourceId: ObjectID;
    timezone?: string | undefined;
  }): OnCallNotificationContext => {
    const incidentEpisode: IncidentEpisode = data.incidentEpisode;
    const details: Array<OnCallNotificationDetail> = [];

    addDetail(
      details,
      "Severity",
      incidentEpisode.incidentSeverity?.name,
      incidentEpisode.incidentSeverity?.color?.toString(),
    );
    addDetail(
      details,
      "Current State",
      incidentEpisode.currentIncidentState?.name,
      incidentEpisode.currentIncidentState?.color?.toString(),
    );
    addDetail(details, "Project", incidentEpisode.project?.name);
    addDetail(
      details,
      "Incidents In Episode",
      incidentEpisode.incidentCount === undefined ||
        incidentEpisode.incidentCount === null
        ? ""
        : incidentEpisode.incidentCount.toString(),
    );
    addDetail(
      details,
      "Declared At",
      formatDate(
        incidentEpisode.declaredAt || incidentEpisode.createdAt,
        data.timezone,
      ),
    );
    addDetail(
      details,
      "Last Incident At",
      formatDate(incidentEpisode.lastIncidentAddedAt, data.timezone),
    );

    return {
      resourceType: OnCallNotificationResourceType.IncidentEpisode,
      dashboardPath:
        DashboardPathByResourceType[
          OnCallNotificationResourceType.IncidentEpisode
        ],
      resourceId: data.resourceId,
      resourceNumber: incidentEpisode.episodeNumberWithPrefix || "",
      resourceTitle: incidentEpisode.title || "",
      resourceDescription: truncateDescription(incidentEpisode.description),
      details: details,
    };
  };

export type GetOnCallNotificationContextFunction = (data: {
  timelineItem: UserOnCallLogTimeline;
  timezone?: string | undefined;
}) => Promise<OnCallNotificationContext | null>;

/**
 * Reads whichever resource this notification was raised for and returns it in
 * the shape the acknowledge page renders.
 *
 * Returns null when the notification points at nothing, or at a resource that
 * has since been deleted. The caller still has to render a usable page in that
 * case - a missing description is not a reason to refuse the acknowledgement.
 */
export const getOnCallNotificationContext: GetOnCallNotificationContextFunction =
  async (data: {
    timelineItem: UserOnCallLogTimeline;
    timezone?: string | undefined;
  }): Promise<OnCallNotificationContext | null> => {
    const reference: OnCallNotificationResourceReference | null =
      getResourceReference(data.timelineItem);

    if (!reference) {
      return null;
    }

    if (reference.resourceType === OnCallNotificationResourceType.Alert) {
      const alert: Alert | null = await AlertService.findOneById({
        id: reference.resourceId,
        select: {
          _id: true,
          title: true,
          description: true,
          createdAt: true,
          alertNumberWithPrefix: true,
          project: {
            name: true,
          },
          monitor: {
            name: true,
          },
          services: {
            name: true,
          },
          alertSeverity: {
            name: true,
            color: true,
          },
          currentAlertState: {
            name: true,
            color: true,
          },
        },
        props: {
          isRoot: true,
        },
      });

      if (!alert) {
        return null;
      }

      return buildAlertContext({
        alert: alert,
        resourceId: reference.resourceId,
        timezone: data.timezone,
      });
    }

    if (reference.resourceType === OnCallNotificationResourceType.Incident) {
      const incident: Incident | null = await IncidentService.findOneById({
        id: reference.resourceId,
        select: {
          _id: true,
          title: true,
          description: true,
          createdAt: true,
          declaredAt: true,
          incidentNumberWithPrefix: true,
          project: {
            name: true,
          },
          monitors: {
            name: true,
          },
          services: {
            name: true,
          },
          incidentSeverity: {
            name: true,
            color: true,
          },
          currentIncidentState: {
            name: true,
            color: true,
          },
        },
        props: {
          isRoot: true,
        },
      });

      if (!incident) {
        return null;
      }

      return buildIncidentContext({
        incident: incident,
        resourceId: reference.resourceId,
        timezone: data.timezone,
      });
    }

    if (
      reference.resourceType === OnCallNotificationResourceType.AlertEpisode
    ) {
      const alertEpisode: AlertEpisode | null =
        await AlertEpisodeService.findOneById({
          id: reference.resourceId,
          select: {
            _id: true,
            title: true,
            description: true,
            createdAt: true,
            lastAlertAddedAt: true,
            alertCount: true,
            episodeNumberWithPrefix: true,
            project: {
              name: true,
            },
            alertSeverity: {
              name: true,
              color: true,
            },
            currentAlertState: {
              name: true,
              color: true,
            },
          },
          props: {
            isRoot: true,
          },
        });

      if (!alertEpisode) {
        return null;
      }

      return buildAlertEpisodeContext({
        alertEpisode: alertEpisode,
        resourceId: reference.resourceId,
        timezone: data.timezone,
      });
    }

    const incidentEpisode: IncidentEpisode | null =
      await IncidentEpisodeService.findOneById({
        id: reference.resourceId,
        select: {
          _id: true,
          title: true,
          description: true,
          createdAt: true,
          declaredAt: true,
          lastIncidentAddedAt: true,
          incidentCount: true,
          episodeNumberWithPrefix: true,
          project: {
            name: true,
          },
          incidentSeverity: {
            name: true,
            color: true,
          },
          currentIncidentState: {
            name: true,
            color: true,
          },
        },
        props: {
          isRoot: true,
        },
      });

    if (!incidentEpisode) {
      return null;
    }

    return buildIncidentEpisodeContext({
      incidentEpisode: incidentEpisode,
      resourceId: reference.resourceId,
      timezone: data.timezone,
    });
  };
