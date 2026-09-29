import Alert from "Common/Models/DatabaseModels/Alert";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentAlert from "Common/Models/DatabaseModels/IncidentAlert";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { INCIDENT_ALERT_ALREADY_LINKED_MESSAGE } from "Common/Types/Incident/IncidentAlertLink";
import ObjectID from "Common/Types/ObjectID";
import { CardButtonSchema } from "Common/UI/Components/Card/Card";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { PermissionGateResult } from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";

/*
 * Shared by every place that links an alert to an incident (an IncidentAlert
 * row): the alerts table's "Link to Incident" bulk action, an incident's
 * Linked Alerts page and an alert's Linked Incidents page.
 */

/*
 * How many alerts or incidents a link dialog lists up front, newest first,
 * labelled with their number so they can be told apart - monitor-generated
 * alerts and incidents share titles. Typing searches every one by title on
 * the server.
 */
export const LINK_OPTIONS_LIMIT: number = 500;

type FormatNumberedLabelFunction = (number: string, title: string) => string;

const formatNumberedLabel: FormatNumberedLabelFunction = (
  number: string,
  title: string,
): string => {
  if (!number) {
    return title;
  }

  return title ? `${number}: ${title}` : number;
};

type GetIncidentOptionLabelFunction = (incident: Incident) => string;

/* "INC-42: Database is down", "#42: Database is down", or the bare title. */
export const getIncidentOptionLabel: GetIncidentOptionLabelFunction = (
  incident: Incident,
): string => {
  return formatNumberedLabel(
    incident.incidentNumberWithPrefix ||
      (typeof incident.incidentNumber === "number"
        ? `#${incident.incidentNumber}`
        : ""),
    incident.title || "",
  );
};

type GetAlertOptionLabelFunction = (alert: Alert) => string;

/* "ALT-63: Checkout API is offline", "#63: ...", or the bare title. */
export const getAlertOptionLabel: GetAlertOptionLabelFunction = (
  alert: Alert,
): string => {
  return formatNumberedLabel(
    alert.alertNumberWithPrefix ||
      (typeof alert.alertNumber === "number" ? `#${alert.alertNumber}` : ""),
    alert.title || "",
  );
};

type FetchLinkOptionsFunction = () => Promise<Array<DropdownOption>>;

/* The most recent incidents, newest first, labelled with their number. */
export const fetchIncidentLinkOptions: FetchLinkOptionsFunction =
  async (): Promise<Array<DropdownOption>> => {
    const result: ListResult<Incident> = await ModelAPI.getList<Incident>({
      modelType: Incident,
      query: {},
      limit: LINK_OPTIONS_LIMIT,
      skip: 0,
      select: {
        _id: true,
        title: true,
        incidentNumber: true,
        incidentNumberWithPrefix: true,
      },
      sort: {
        createdAt: SortOrder.Descending,
      },
    });

    return result.data
      .filter((incident: Incident): boolean => {
        return Boolean(incident._id);
      })
      .map((incident: Incident): DropdownOption => {
        return {
          label: getIncidentOptionLabel(incident),
          value: incident._id!.toString(),
        };
      });
  };

/* The most recent alerts, newest first, labelled with their number. */
export const fetchAlertLinkOptions: FetchLinkOptionsFunction =
  async (): Promise<Array<DropdownOption>> => {
    const result: ListResult<Alert> = await ModelAPI.getList<Alert>({
      modelType: Alert,
      query: {},
      limit: LINK_OPTIONS_LIMIT,
      skip: 0,
      select: {
        _id: true,
        title: true,
        alertNumber: true,
        alertNumberWithPrefix: true,
      },
      sort: {
        createdAt: SortOrder.Descending,
      },
    });

    return result.data
      .filter((alert: Alert): boolean => {
        return Boolean(alert._id);
      })
      .map((alert: Alert): DropdownOption => {
        return {
          label: getAlertOptionLabel(alert),
          value: alert._id!.toString(),
        };
      });
  };

type CreateIncidentAlertLinkFunction = (data: {
  incidentId: ObjectID;
  alertId: ObjectID;
}) => Promise<void>;

/* Links one alert to one incident, in the current project. */
export const createIncidentAlertLink: CreateIncidentAlertLinkFunction =
  async (data: { incidentId: ObjectID; alertId: ObjectID }): Promise<void> => {
    const link: IncidentAlert = new IncidentAlert();
    link.incidentId = data.incidentId;
    link.alertId = data.alertId;

    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (projectId) {
      link.projectId = projectId;
    }

    await ModelAPI.create<IncidentAlert>({
      model: link,
      modelType: IncidentAlert,
    });
  };

type IsAlreadyLinkedErrorFunction = (message: string) => boolean;

// "A Incident Alert with the same ... already exists", lower-cased.
const UNIQUE_INDEX_VIOLATION_PATTERN: RegExp = new RegExp(
  "\\ban? incident alert with .+ already exists\\b",
);

/*
 * Whether a failed link failed only because the pair is already linked. The
 * server answers a duplicate with INCIDENT_ALERT_ALREADY_LINKED_MESSAGE. The
 * unique index's own wording ("A Incident Alert with the same Incident Id,
 * Alert Id, Project Id already exists...") is recognised too, for a duplicate
 * that raced past the model's check and was caught by the index instead:
 * IncidentAlert has no other unique constraint that message could come from.
 */
export const isAlreadyLinkedError: IsAlreadyLinkedErrorFunction = (
  message: string,
): boolean => {
  const normalized: string = (message || "").trim().toLowerCase();

  if (!normalized) {
    return false;
  }

  if (
    normalized.includes(INCIDENT_ALERT_ALREADY_LINKED_MESSAGE.toLowerCase())
  ) {
    return true;
  }

  return UNIQUE_INDEX_VIOLATION_PATTERN.test(normalized);
};

type LockUnlessAllowedFunction = (
  button: CardButtonSchema | null,
  gate: PermissionGateResult,
) => CardButtonSchema | null;

/*
 * Linking also needs read access to the other side: the server refuses a
 * link to an alert or incident the caller cannot see, and the picker could
 * not list them anyway. A known missing permission locks the button and says
 * which one; an unknown answer leaves it alone, like the other gates. A
 * button already locked (or hidden) keeps the reason it has.
 */
export const lockUnlessAllowed: LockUnlessAllowedFunction = (
  button: CardButtonSchema | null,
  gate: PermissionGateResult,
): CardButtonSchema | null => {
  if (!button || button.disabled) {
    return button;
  }

  if (gate.isAllowed || !gate.disabledReason) {
    return button;
  }

  return {
    ...button,
    disabled: true,
    tooltip: gate.disabledReason,
    onClick: () => {
      // Locked. The tooltip says which permission is missing.
    },
  };
};
