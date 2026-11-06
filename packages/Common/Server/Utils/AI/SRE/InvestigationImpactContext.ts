import Alert from "../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import ServiceLevelObjective from "../../../../Models/DatabaseModels/ServiceLevelObjective";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../../Types/ObjectID";
import SloWindowType from "../../../../Types/ServiceLevelObjective/SloWindowType";
import PromptText from "../../../../Utils/AI/PromptText";
import { IMPACT_SECTION_TITLE } from "../../../../Utils/AI/InvestigationReport";
import AlertService from "../../../Services/AlertService";
import IncidentService from "../../../Services/IncidentService";
import ServiceLevelObjectiveService from "../../../Services/ServiceLevelObjectiveService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import CaptureSpan from "../../Telemetry/CaptureSpan";

/*
 * AI SRE - WHAT AN INCIDENT'S OR ALERT'S USERS RELY ON, FOR THE IMPACT
 * SECTION OF ITS REPORT.
 *
 * Every report opens, after its summary, with Impact: the users, services
 * and SLOs affected and how that was worked out (AIInvestigationEngine's
 * persona) - the first thing the leading AI SRE tools show, because how bad
 * it is decides who is woken and what is said to customers. The users and
 * the services the investigation counts from the telemetry. The SLOs are the
 * project's own objectives, and the model would otherwise look for them by
 * name among every SLO query_slos lists: so the starting context names the
 * ones that count the record, with what the SLO evaluation last measured:
 *
 *   - the SLOs linked to it (its Affected Resources - an SLO's burn-rate
 *     rule links the SLO it watches to what it declares);
 *   - the SLOs that count one of its monitors;
 *
 * enabled and not archived, the linked ones first, at most MAX_IMPACT_SLOS,
 * with the ids query_slos takes. A record with monitors that no SLO counts
 * says so, so the report says so rather than guess. Every read is held to
 * the record's project. Enrichment only: a read that fails leaves the
 * context as it was (the runners catch it).
 */

// The most SLOs the context names.
export const MAX_IMPACT_SLOS: number = 5;

// The SLOs read per kind of link, at most (one more says there are more).
const SLO_READ_LIMIT: number = MAX_IMPACT_SLOS + 1;

// The most monitors an incident's SLOs are looked up by.
const MAX_IMPACT_MONITORS: number = 25;

const MAX_NAME_CHARS: number = 200;

// One SLO that counts the record, as its last evaluation measured it.
export interface ImpactSlo {
  id: string;
  name: string;
  // Linked to the record itself (its Affected Resources).
  isLinked: boolean;
  // The record's monitors it counts (none for a linked one that counts none).
  monitorNames: Array<string>;
  targetPercentage?: number | undefined;
  currentSliPercentage?: number | undefined;
  errorBudgetRemainingPercentage?: number | undefined;
  currentBurnRate?: number | undefined;
  sloStatus?: string | undefined;
  lastEvaluatedAt?: Date | undefined;
  // "a rolling 30 days", "the calendar month".
  window?: string | undefined;
}

export interface InvestigationImpact {
  subjectKind: "incident" | "alert";
  // Whether the record has monitors an SLO could count.
  hasMonitors: boolean;
  // Linked ones first, at most MAX_IMPACT_SLOS.
  slos: Array<ImpactSlo>;
  // More SLOs count the record than are named.
  hasMoreSlos: boolean;
}

interface SubjectLinks {
  monitors: Array<{ id: ObjectID; name: string }>;
  linkedSloIds: Array<ObjectID>;
}

// A percentage as the context writes it: at most two decimals.
function formatPercent(value: number): string {
  return `${Math.round(value * 100) / 100}%`;
}

// How an SLO measures, in words: "a rolling 30 days", "the calendar month".
function describeWindow(slo: ServiceLevelObjective): string {
  if (slo.windowType === SloWindowType.CalendarMonth) {
    return "the calendar month";
  }

  return `a rolling ${slo.windowDays ?? 30} days`;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export default class InvestigationImpactContext {
  // The SLOs that count an incident; null when it cannot be read.
  @CaptureSpan()
  public static async readForIncident(data: {
    projectId: ObjectID;
    incidentId: ObjectID;
  }): Promise<InvestigationImpact | null> {
    const incident: Incident | null = await IncidentService.findOneBy({
      query: { _id: data.incidentId.toString(), projectId: data.projectId },
      select: {
        _id: true,
        monitors: { _id: true, name: true },
        serviceLevelObjectives: { _id: true },
      },
      props: { isRoot: true },
    });

    if (!incident) {
      return null;
    }

    return await InvestigationImpactContext.readSlos({
      projectId: data.projectId,
      subjectKind: "incident",
      links: {
        monitors: InvestigationImpactContext.toMonitors(incident.monitors),
        linkedSloIds: InvestigationImpactContext.toIds(
          incident.serviceLevelObjectives,
        ),
      },
    });
  }

  // The alert twin of readForIncident: an alert has one monitor.
  @CaptureSpan()
  public static async readForAlert(data: {
    projectId: ObjectID;
    alertId: ObjectID;
  }): Promise<InvestigationImpact | null> {
    const alert: Alert | null = await AlertService.findOneBy({
      query: { _id: data.alertId.toString(), projectId: data.projectId },
      select: {
        _id: true,
        monitor: { _id: true, name: true },
        serviceLevelObjectives: { _id: true },
      },
      props: { isRoot: true },
    });

    if (!alert) {
      return null;
    }

    return await InvestigationImpactContext.readSlos({
      projectId: data.projectId,
      subjectKind: "alert",
      links: {
        monitors: InvestigationImpactContext.toMonitors(
          alert.monitor ? [alert.monitor] : [],
        ),
        linkedSloIds: InvestigationImpactContext.toIds(
          alert.serviceLevelObjectives,
        ),
      },
    });
  }

  /*
   * The SLOs linked to the record and the ones that count its monitors,
   * read in the record's project: enabled, not archived, linked first.
   */
  public static async readSlos(data: {
    projectId: ObjectID;
    subjectKind: "incident" | "alert";
    links: SubjectLinks;
  }): Promise<InvestigationImpact> {
    const select: Record<string, unknown> = {
      _id: true,
      name: true,
      targetPercentage: true,
      windowType: true,
      windowDays: true,
      currentSliPercentage: true,
      errorBudgetRemainingPercentage: true,
      currentBurnRate: true,
      sloStatus: true,
      lastEvaluatedAt: true,
      monitors: { _id: true, name: true },
    };

    const baseQuery: Record<string, unknown> = {
      projectId: data.projectId,
      isEnabled: true,
      isArchived: false,
    };

    const [linked, counting]: [
      Array<ServiceLevelObjective>,
      Array<ServiceLevelObjective>,
    ] = await Promise.all([
      data.links.linkedSloIds.length > 0
        ? ServiceLevelObjectiveService.findBy({
            query: {
              ...baseQuery,
              _id: QueryHelper.any(data.links.linkedSloIds),
            } as never,
            select: select as never,
            sort: { name: SortOrder.Ascending },
            limit: SLO_READ_LIMIT,
            skip: 0,
            props: { isRoot: true },
          })
        : Promise.resolve([]),
      data.links.monitors.length > 0
        ? ServiceLevelObjectiveService.findBy({
            query: {
              ...baseQuery,
              monitors: QueryHelper.inRelationArray(
                data.links.monitors.map(
                  (monitor: { id: ObjectID }): ObjectID => {
                    return monitor.id;
                  },
                ),
              ),
            } as never,
            select: select as never,
            sort: { name: SortOrder.Ascending },
            limit: SLO_READ_LIMIT,
            skip: 0,
            props: { isRoot: true },
          })
        : Promise.resolve([]),
    ]);

    const monitorNames: Map<string, string> = new Map<string, string>(
      data.links.monitors.map(
        (monitor: { id: ObjectID; name: string }): [string, string] => {
          return [monitor.id.toString().toLowerCase(), monitor.name];
        },
      ),
    );
    const linkedIds: Set<string> = new Set<string>(
      data.links.linkedSloIds.map((id: ObjectID): string => {
        return id.toString().toLowerCase();
      }),
    );

    const byId: Map<string, ImpactSlo> = new Map<string, ImpactSlo>();

    for (const slo of [...linked, ...counting]) {
      const id: string = slo.id?.toString().toLowerCase() || "";

      if (!id || byId.has(id)) {
        continue;
      }

      byId.set(id, {
        id,
        name: slo.name || "",
        isLinked: linkedIds.has(id),
        monitorNames: (slo.monitors || [])
          .map((monitor: Monitor): string => {
            return (
              monitorNames.get(monitor.id?.toString().toLowerCase() || "") || ""
            );
          })
          .filter((name: string): boolean => {
            return Boolean(name);
          }),
        targetPercentage: readNumber(slo.targetPercentage),
        currentSliPercentage: readNumber(slo.currentSliPercentage),
        errorBudgetRemainingPercentage: readNumber(
          slo.errorBudgetRemainingPercentage,
        ),
        currentBurnRate: readNumber(slo.currentBurnRate),
        sloStatus: slo.sloStatus || undefined,
        lastEvaluatedAt: slo.lastEvaluatedAt
          ? new Date(slo.lastEvaluatedAt)
          : undefined,
        window: describeWindow(slo),
      });
    }

    const slos: Array<ImpactSlo> = Array.from(byId.values()).sort(
      (a: ImpactSlo, b: ImpactSlo): number => {
        return Number(b.isLinked) - Number(a.isLinked);
      },
    );

    return {
      subjectKind: data.subjectKind,
      hasMonitors: data.links.monitors.length > 0,
      slos: slos.slice(0, MAX_IMPACT_SLOS),
      hasMoreSlos:
        slos.length > MAX_IMPACT_SLOS ||
        linked.length >= SLO_READ_LIMIT ||
        counting.length >= SLO_READ_LIMIT,
    };
  }

  /*
   * The "# Impact" block of the starting context: the SLOs that count the
   * record with the ids query_slos takes, and how to work the rest out.
   * Empty for a record with no monitor and no SLO linked to it.
   */
  public static buildContextSection(data: InvestigationImpact | null): string {
    if (!data || (!data.hasMonitors && data.slos.length === 0)) {
      return "";
    }

    const subject: string = `this ${data.subjectKind}`;
    const lines: Array<string> = ["", "", `# ${IMPACT_SECTION_TITLE}`];

    if (data.slos.length === 0) {
      lines.push(
        `No SLO of this project counts ${subject}'s monitors, and none is linked to it: say so in the report's SLOs line.`,
      );
    } else {
      lines.push(
        `The SLOs that count ${subject}, as the SLO evaluation last measured them (query_slos with an sloId reads one in full, with its burn-rate rules):`,
      );

      for (const slo of data.slos) {
        lines.push(`- ${InvestigationImpactContext.describeSlo(slo, subject)}`);
      }

      if (data.hasMoreSlos) {
        lines.push(
          `- (more SLOs count ${subject} than the ${MAX_IMPACT_SLOS} listed; query_slos lists the rest)`,
        );
      }
    }

    lines.push(
      `Count the users and the services ${subject} hurts from the telemetry, and say in each line of the report's Impact section what you counted and over which window.`,
    );

    return lines.join("\n");
  }

  // One SLO's line: its name and id, why it is listed, and how it stands.
  public static describeSlo(slo: ImpactSlo, subject: string): string {
    const name: string = PromptText.field(slo.name, {
      maxLength: MAX_NAME_CHARS,
    });
    const why: Array<string> = [];

    if (slo.isLinked) {
      why.push(`linked to ${subject}`);
    }

    if (slo.monitorNames.length > 0) {
      why.push(
        `counts monitor ${slo.monitorNames
          .map((monitorName: string): string => {
            return JSON.stringify(
              PromptText.field(monitorName, { maxLength: MAX_NAME_CHARS }),
            );
          })
          .join(", ")}`,
      );
    }

    const facts: Array<string> = [];

    if (slo.currentSliPercentage !== undefined) {
      facts.push(
        slo.targetPercentage !== undefined
          ? `${formatPercent(slo.currentSliPercentage)} against its ${formatPercent(slo.targetPercentage)} target over ${slo.window}`
          : `${formatPercent(slo.currentSliPercentage)} over ${slo.window}`,
      );
    } else if (slo.targetPercentage !== undefined) {
      facts.push(
        `a ${formatPercent(slo.targetPercentage)} target over ${slo.window}, not measured yet`,
      );
    }

    if (slo.errorBudgetRemainingPercentage !== undefined) {
      facts.push(
        `${formatPercent(slo.errorBudgetRemainingPercentage)} of its error budget left`,
      );
    }

    if (slo.currentBurnRate !== undefined) {
      facts.push(
        `burning its budget at ${Math.round(slo.currentBurnRate * 100) / 100}x`,
      );
    }

    if (slo.lastEvaluatedAt) {
      facts.push(`measured ${slo.lastEvaluatedAt.toISOString()}`);
    }

    const status: string = slo.sloStatus ? `${slo.sloStatus}` : "";
    const standing: string = [status, facts.join(", ")]
      .filter((part: string): boolean => {
        return Boolean(part);
      })
      .join(" - ");

    return `SLO ${JSON.stringify(name)} (sloId: ${slo.id})${
      why.length > 0 ? `, ${why.join(" and ")}` : ""
    }${standing ? `: ${standing}` : ""}`;
  }

  private static toMonitors(
    monitors: Array<Monitor> | undefined,
  ): Array<{ id: ObjectID; name: string }> {
    return (monitors || [])
      .filter((monitor: Monitor): boolean => {
        return Boolean(monitor.id);
      })
      .slice(0, MAX_IMPACT_MONITORS)
      .map((monitor: Monitor): { id: ObjectID; name: string } => {
        return { id: monitor.id!, name: monitor.name || "" };
      });
  }

  private static toIds(
    models: Array<ServiceLevelObjective> | undefined,
  ): Array<ObjectID> {
    return (models || [])
      .map((model: ServiceLevelObjective): ObjectID | null => {
        return model.id;
      })
      .filter((id: ObjectID | null): id is ObjectID => {
        return Boolean(id);
      });
  }
}
