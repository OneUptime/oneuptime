import Alert from "../../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import Includes from "../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../Types/ObjectID";
import AlertService from "../../Services/AlertService";
import AlertStateService from "../../Services/AlertStateService";
import IncidentStateService from "../../Services/IncidentStateService";
import AlertSeverityService from "../../Services/AlertSeverityService";
import IncidentService from "../../Services/IncidentService";
import IncidentSeverityService from "../../Services/IncidentSeverityService";
import logger from "../Logger";

/*
 * The alert/incident plumbing every security-event detection source
 * shares — extracted from DetectionRuleEvaluator so the threat-intel
 * matcher (and any future source) opens alerts through the exact same
 * dedupe and severity machinery instead of a drifting copy.
 *
 * Semantics preserved from the Sigma engine:
 *  - one open alert/incident per fingerprint: dedupe is a findBy scoped
 *    to THIS source's candidate fingerprints against unresolved state,
 *    never a scan of every open alert;
 *  - per-item try/catch on create, so one failing create cannot sink the
 *    rest of the batch (incident creates are heavy and consume
 *    user-visible incident numbers);
 *  - severity precedence: explicit id (validated to belong to the
 *    project), else name match on the source's severity label, else rank
 *    (severe sources get the project's most severe, others the least).
 */

export interface AlertableMatch {
  // Stable dedupe key, e.g. "detection-rule:<id>:<hash>".
  fingerprint: string;
  title: string;
  description: string;
  rootCause: string;
}

/*
 * What a match has now, for a source that links its own record to the
 * alert or incident: the one it opened (isNew), or the one already open
 * for its fingerprint. A create that failed has none.
 */
export interface DedupedRecordOutcome {
  fingerprint: string;
  recordId: ObjectID;
  isNew: boolean;
}

export type DedupedRecordOutcomeHandler = (
  outcome: DedupedRecordOutcome,
) => void;

export async function openDedupedAlerts(data: {
  projectId: ObjectID;
  alertSeverityId: ObjectID;
  matches: Array<AlertableMatch>;
  // Prefix for create-failure log lines, e.g. "DetectionRuleEvaluator: rule <id>".
  logLabel: string;
  // Told the alert each match has now, opened or already open.
  onOutcome?: DedupedRecordOutcomeHandler | undefined;
}): Promise<number> {
  const fingerprints: Array<string> = data.matches.map(
    (match: AlertableMatch): string => {
      return match.fingerprint;
    },
  );

  const openAlerts: Array<Alert> = await AlertService.findBy({
    query: {
      projectId: data.projectId,
      seriesFingerprint: new Includes(fingerprints),
      // Open: above the project's resolved state (Common/Utils/ResolvedState).
      currentAlertStateId: new Includes(
        await AlertStateService.getUnresolvedAlertStateIds(data.projectId),
      ),
    },
    select: {
      _id: true,
      seriesFingerprint: true,
    },
    skip: 0,
    limit: LIMIT_PER_PROJECT,
    props: {
      isRoot: true,
    },
  });

  const openFingerprints: Set<string> = new Set<string>(
    openAlerts
      .map((alert: Alert): string => {
        return alert.seriesFingerprint || "";
      })
      .filter((fingerprint: string): boolean => {
        return Boolean(fingerprint);
      }),
  );

  let created: number = 0;

  for (const match of data.matches) {
    if (openFingerprints.has(match.fingerprint)) {
      const open: Alert | undefined = openAlerts.find(
        (alert: Alert): boolean => {
          return alert.seriesFingerprint === match.fingerprint;
        },
      );

      if (open?.id) {
        data.onOutcome?.({
          fingerprint: match.fingerprint,
          recordId: open.id,
          isNew: false,
        });
      }

      continue;
    }

    const alert: Alert = new Alert();
    alert.projectId = data.projectId;
    alert.title = match.title;
    alert.description = match.description;
    alert.alertSeverityId = data.alertSeverityId;
    alert.seriesFingerprint = match.fingerprint;
    alert.isCreatedAutomatically = true;
    alert.rootCause = match.rootCause;

    try {
      const opened: Alert = await AlertService.create({
        data: alert,
        props: {
          isRoot: true,
        },
      });
      created++;

      if (opened?.id) {
        data.onOutcome?.({
          fingerprint: match.fingerprint,
          recordId: opened.id,
          isNew: true,
        });
      }
    } catch (error) {
      logger.error(`${data.logLabel}: failed creating alert:`);
      logger.error(error);
    }
  }

  return created;
}

/*
 * The incident twin. Dedupe runs BEFORE create — incident numbers are
 * user-visible and consumed per create — and each create is individually
 * guarded because IncidentService.onBeforeCreate throws when the project
 * has no "created" incident state, which cannot be pre-checked the way
 * an empty severity list can.
 */
export async function openDedupedIncidents(data: {
  projectId: ObjectID;
  incidentSeverityId: ObjectID;
  matches: Array<AlertableMatch>;
  logLabel: string;
  // Told the incident each match has now, declared or already open.
  onOutcome?: DedupedRecordOutcomeHandler | undefined;
}): Promise<number> {
  const fingerprints: Array<string> = data.matches.map(
    (match: AlertableMatch): string => {
      return match.fingerprint;
    },
  );

  const openIncidents: Array<Incident> = await IncidentService.findBy({
    query: {
      projectId: data.projectId,
      seriesFingerprint: new Includes(fingerprints),
      // Open: above the project's resolved state (Common/Utils/ResolvedState).
      currentIncidentStateId: new Includes(
        await IncidentStateService.getUnresolvedIncidentStateIds(
          data.projectId,
        ),
      ),
    },
    select: {
      _id: true,
      seriesFingerprint: true,
    },
    skip: 0,
    limit: LIMIT_PER_PROJECT,
    props: {
      isRoot: true,
    },
  });

  const openFingerprints: Set<string> = new Set<string>(
    openIncidents
      .map((incident: Incident): string => {
        return incident.seriesFingerprint || "";
      })
      .filter((fingerprint: string): boolean => {
        return Boolean(fingerprint);
      }),
  );

  let created: number = 0;

  for (const match of data.matches) {
    if (openFingerprints.has(match.fingerprint)) {
      const open: Incident | undefined = openIncidents.find(
        (incident: Incident): boolean => {
          return incident.seriesFingerprint === match.fingerprint;
        },
      );

      if (open?.id) {
        data.onOutcome?.({
          fingerprint: match.fingerprint,
          recordId: open.id,
          isNew: false,
        });
      }

      continue;
    }

    const incident: Incident = new Incident();
    incident.projectId = data.projectId;
    incident.title = match.title;
    incident.description = match.description;
    incident.incidentSeverityId = data.incidentSeverityId;
    incident.seriesFingerprint = match.fingerprint;
    incident.isCreatedAutomatically = true;
    incident.rootCause = match.rootCause;

    try {
      const declared: Incident = await IncidentService.create({
        data: incident,
        props: {
          isRoot: true,
        },
      });
      created++;

      if (declared?.id) {
        data.onOutcome?.({
          fingerprint: match.fingerprint,
          recordId: declared.id,
          isNew: true,
        });
      }
    } catch (error) {
      logger.error(`${data.logLabel}: failed creating incident:`);
      logger.error(error);
    }
  }

  return created;
}

/*
 * The precedence logic both severity resolvers share. Severities arrive
 * sorted by order ascending — lowest order is most severe, per the
 * model's own convention — so "most severe" is the first element and
 * "least severe" the last. An explicit id that is not in the list
 * (deleted, or belonging to another project) falls through silently
 * rather than failing the source.
 *
 * The explicit severity is the source's own setup, and is kept even when it
 * has been archived since: an automation keeps the values it was set up
 * with (Common/Utils/ArchivableValues). The ones OneUptime picks itself -
 * by name, or by rank - are never archived ones.
 */
export function pickSeverityByPrecedence<
  TSeverity extends {
    id?: ObjectID | null | undefined;
    name?: string | undefined;
    isArchived?: boolean | undefined;
  },
>(data: {
  severities: Array<TSeverity>;
  explicitSeverityId: ObjectID | undefined;
  // Matched case-insensitively against project severity names.
  severityLabel: string;
  // Severe sources rank to the project's most severe severity.
  isSevere: boolean;
}): ObjectID | null {
  const { explicitSeverityId, severityLabel, isSevere } = data;

  if (data.severities.length === 0) {
    return null;
  }

  if (explicitSeverityId) {
    const explicit: TSeverity | undefined = data.severities.find(
      (severity: TSeverity): boolean => {
        return severity.id?.toString() === explicitSeverityId.toString();
      },
    );

    if (explicit && explicit.id) {
      return explicit.id;
    }
  }

  // The ones OneUptime picks by itself, by name or by rank: the live ones.
  const severities: Array<TSeverity> = data.severities.filter(
    (severity: TSeverity): boolean => {
      return severity.isArchived !== true;
    },
  );

  if (severities.length === 0) {
    return null;
  }

  const nameMatch: TSeverity | undefined = severities.find(
    (severity: TSeverity): boolean => {
      return (
        (severity.name || "").toLowerCase() === severityLabel.toLowerCase()
      );
    },
  );

  if (nameMatch && nameMatch.id) {
    return nameMatch.id;
  }

  const chosen: TSeverity = isSevere
    ? severities[0]!
    : severities[severities.length - 1]!;

  return chosen.id || null;
}

export async function resolveAlertSeverityIdForProject(data: {
  projectId: ObjectID;
  explicitSeverityId: ObjectID | undefined;
  severityLabel: string;
  isSevere: boolean;
}): Promise<ObjectID | null> {
  const severities: Array<AlertSeverity> = await AlertSeverityService.findBy({
    query: {
      projectId: data.projectId,
    },
    select: {
      _id: true,
      name: true,
      isArchived: true,
    },
    sort: {
      order: SortOrder.Ascending,
    },
    skip: 0,
    limit: LIMIT_PER_PROJECT,
    props: {
      isRoot: true,
    },
  });

  return pickSeverityByPrecedence({
    severities,
    explicitSeverityId: data.explicitSeverityId,
    severityLabel: data.severityLabel,
    isSevere: data.isSevere,
  });
}

export async function resolveIncidentSeverityIdForProject(data: {
  projectId: ObjectID;
  explicitSeverityId: ObjectID | undefined;
  severityLabel: string;
  isSevere: boolean;
}): Promise<ObjectID | null> {
  const severities: Array<IncidentSeverity> =
    await IncidentSeverityService.findBy({
      query: {
        projectId: data.projectId,
      },
      select: {
        _id: true,
        name: true,
        isArchived: true,
      },
      sort: {
        order: SortOrder.Ascending,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: {
        isRoot: true,
      },
    });

  return pickSeverityByPrecedence({
    severities,
    explicitSeverityId: data.explicitSeverityId,
    severityLabel: data.severityLabel,
    isSevere: data.isSevere,
  });
}
