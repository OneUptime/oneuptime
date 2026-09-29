import Alert from "../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../Models/DatabaseModels/Incident";
import {
  InvestigationEventReference,
  InvestigationReferenceKind,
} from "../../../../Types/AI/InvestigationEvidence";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../Types/ObjectID";
import {
  ExtractedInvestigationEventReference,
  extractEventReferences,
  parseInvestigationReport,
} from "../../../../Utils/AI/InvestigationReport";
import AlertService from "../../../Services/AlertService";
import IncidentService from "../../../Services/IncidentService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import logger from "../../Logger";

/*
 * Resolves the incident/alert numbers an AI investigation report mentions
 * ("recurrence of #6954") to the project's own records, so the panel can link
 * them.
 *
 * The numbers come from model-authored text, so nothing about them is
 * trusted: each lookup is pinned to the subject's project and runs under the
 * VIEWER's permissions (a viewer never gets a link — or a title — for a
 * record they could not open), and a number that matches more than one row
 * (incident numbers carry no unique constraint) is skipped as ambiguous.
 * Links are decoration: any failure is logged and resolves to no links.
 */

/*
 * Rows fetched per kind. A report yields at most 25 references, so this only
 * binds when numbers are duplicated; the tail group is then discarded because
 * it may be incomplete (see indexUniqueRows).
 */
export const MAX_REFERENCE_LOOKUP_ROWS: number = 100;

export interface ResolveInvestigationReferencesInput {
  markdown: string;
  subjectType: InvestigationReferenceKind;
  projectId: ObjectID;
  props: DatabaseCommonInteractionProps;
}

interface ResolvedRow {
  number: number;
  id: string;
  displayNumber: string;
  title: string;
  stateName?: string | undefined;
  stateColor?: string | undefined;
}

/*
 * Numbers that map to exactly one row. Rows arrive sorted by number, so when
 * the lookup hit its row limit the LAST number's group may have been cut
 * short — a number that looks unique there could still be ambiguous, so it
 * is dropped rather than guessed.
 */
function indexUniqueRows(
  rows: Array<ResolvedRow>,
  isLimitHit: boolean,
): Map<number, ResolvedRow> {
  const rowsByNumber: Map<number, Array<ResolvedRow>> = new Map();

  for (const row of rows) {
    const group: Array<ResolvedRow> = rowsByNumber.get(row.number) || [];
    group.push(row);
    rowsByNumber.set(row.number, group);
  }

  if (isLimitHit && rows.length > 0) {
    rowsByNumber.delete(rows[rows.length - 1]!.number);
  }

  const unique: Map<number, ResolvedRow> = new Map();

  for (const [number, group] of rowsByNumber) {
    if (group.length === 1) {
      unique.set(number, group[0]!);
    }
  }

  return unique;
}

/*
 * A viewer who cannot read the other table (an alert-only member reading
 * "incident #5") is expected, and the panel polls the report every few
 * seconds, so a permission denial is debug noise rather than an error.
 */
function logLookupFailure(
  kind: InvestigationReferenceKind,
  error: unknown,
): void {
  if (error instanceof NotAuthorizedException) {
    logger.debug(
      `AI: viewer may not read ${kind} references in an investigation report: ${error}`,
    );
    return;
  }

  logger.error(
    `AI: could not resolve ${kind} references in an investigation report: ${error}`,
  );
}

async function resolveIncidentNumbers(data: {
  numbers: Array<number>;
  projectId: ObjectID;
  props: DatabaseCommonInteractionProps;
}): Promise<Map<number, ResolvedRow>> {
  if (data.numbers.length === 0) {
    return new Map();
  }

  try {
    const incidents: Array<Incident> = await IncidentService.findBy({
      query: {
        projectId: data.projectId,
        incidentNumber: QueryHelper.any(data.numbers),
      },
      select: {
        _id: true,
        incidentNumber: true,
        incidentNumberWithPrefix: true,
        title: true,
        currentIncidentState: {
          name: true,
          color: true,
        },
      },
      sort: { incidentNumber: SortOrder.Ascending },
      limit: MAX_REFERENCE_LOOKUP_ROWS,
      skip: 0,
      props: data.props,
    });

    const rows: Array<ResolvedRow> = [];

    for (const incident of incidents) {
      const number: number | undefined = incident.incidentNumber;
      const id: string | undefined = incident.id?.toString();

      if (typeof number !== "number" || !id) {
        continue;
      }

      rows.push({
        number,
        id,
        displayNumber: incident.incidentNumberWithPrefix || `#${number}`,
        title: incident.title || "",
        stateName: incident.currentIncidentState?.name || undefined,
        stateColor:
          incident.currentIncidentState?.color?.toString() || undefined,
      });
    }

    return indexUniqueRows(rows, incidents.length >= MAX_REFERENCE_LOOKUP_ROWS);
  } catch (error) {
    logLookupFailure("incident", error);
    return new Map();
  }
}

async function resolveAlertNumbers(data: {
  numbers: Array<number>;
  projectId: ObjectID;
  props: DatabaseCommonInteractionProps;
}): Promise<Map<number, ResolvedRow>> {
  if (data.numbers.length === 0) {
    return new Map();
  }

  try {
    const alerts: Array<Alert> = await AlertService.findBy({
      query: {
        projectId: data.projectId,
        alertNumber: QueryHelper.any(data.numbers),
      },
      select: {
        _id: true,
        alertNumber: true,
        alertNumberWithPrefix: true,
        title: true,
        currentAlertState: {
          name: true,
          color: true,
        },
      },
      sort: { alertNumber: SortOrder.Ascending },
      limit: MAX_REFERENCE_LOOKUP_ROWS,
      skip: 0,
      props: data.props,
    });

    const rows: Array<ResolvedRow> = [];

    for (const alert of alerts) {
      const number: number | undefined = alert.alertNumber;
      const id: string | undefined = alert.id?.toString();

      if (typeof number !== "number" || !id) {
        continue;
      }

      rows.push({
        number,
        id,
        displayNumber: alert.alertNumberWithPrefix || `#${number}`,
        title: alert.title || "",
        stateName: alert.currentAlertState?.name || undefined,
        stateColor: alert.currentAlertState?.color?.toString() || undefined,
      });
    }

    return indexUniqueRows(rows, alerts.length >= MAX_REFERENCE_LOOKUP_ROWS);
  } catch (error) {
    logLookupFailure("alert", error);
    return new Map();
  }
}

function numbersOfKind(
  references: Array<ExtractedInvestigationEventReference>,
  kind: InvestigationReferenceKind,
): Array<number> {
  return references
    .filter((reference: ExtractedInvestigationEventReference): boolean => {
      return reference.kind === kind;
    })
    .map((reference: ExtractedInvestigationEventReference): number => {
      return reference.number;
    });
}

/*
 * The report's incident/alert references that resolve to exactly one record
 * the viewer can read, in the order the report first mentions them. An
 * unqualified "#123" means the subject's own kind, unless the report also
 * names 123 explicitly as the other kind. Numbers after words from another
 * numbering ("scheduled maintenance #42", "PR #45") are never looked up.
 */
export async function resolveInvestigationReferences(
  data: ResolveInvestigationReferencesInput,
): Promise<Array<InvestigationEventReference>> {
  try {
    if (!data.markdown || !data.projectId) {
      return [];
    }

    /*
     * Only the model's note: the server-authored Evidence checked labels
     * ("Incident #6954 timeline") and footer are not references the report
     * makes, and the panel never renders them as prose.
     */
    const extracted: Array<ExtractedInvestigationEventReference> =
      extractEventReferences(
        parseInvestigationReport(data.markdown).bodyMarkdown,
        data.subjectType,
      );

    if (extracted.length === 0) {
      return [];
    }

    const [incidentRows, alertRows]: [
      Map<number, ResolvedRow>,
      Map<number, ResolvedRow>,
    ] = await Promise.all([
      resolveIncidentNumbers({
        numbers: numbersOfKind(extracted, "incident"),
        projectId: data.projectId,
        props: data.props,
      }),
      resolveAlertNumbers({
        numbers: numbersOfKind(extracted, "alert"),
        projectId: data.projectId,
        props: data.props,
      }),
    ]);

    const references: Array<InvestigationEventReference> = [];

    for (const reference of extracted) {
      const row: ResolvedRow | undefined = (
        reference.kind === "incident" ? incidentRows : alertRows
      ).get(reference.number);

      if (!row) {
        continue;
      }

      const resolved: InvestigationEventReference = {
        kind: reference.kind,
        number: reference.number,
        id: row.id,
        displayNumber: row.displayNumber,
        title: row.title,
      };

      if (row.stateName) {
        resolved.stateName = row.stateName;
      }

      if (row.stateColor) {
        resolved.stateColor = row.stateColor;
      }

      references.push(resolved);
    }

    return references;
  } catch (error) {
    logger.error(
      `AI: could not resolve references in an investigation report: ${error}`,
    );
    return [];
  }
}
