import Alert from "../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import Service from "../../../../Models/DatabaseModels/Service";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../../Types/ObjectID";
import MeaningMatch, {
  MeaningScore,
  MeaningTerms,
} from "../../../../Utils/AI/MeaningMatch";
import PromptText from "../../../../Utils/AI/PromptText";
import AlertService from "../../../Services/AlertService";
import AlertStateService from "../../../Services/AlertStateService";
import IncidentService from "../../../Services/IncidentService";
import IncidentStateService from "../../../Services/IncidentStateService";
import MonitorService from "../../../Services/MonitorService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import AIMemory from "./AIMemory";

/*
 * AI SRE - what OneUptime AI has learned about each service (issue #6798).
 *
 * An investigation used to start from the incident or alert alone, and from
 * a few past ones that looked like it. What a team knows about a service -
 * "checkout runs out of database connections after a big deploy, and
 * recycling the pool fixes it" - was spread over its past incidents and
 * alerts, and nothing gathered it.
 *
 * This gathers it, for the services the subject is on (its own, and its
 * monitors'): each service's resolved incidents and alerts - linked to the
 * service, or raised by a monitor of it - whose cause is known, grouped by
 * meaning into the failures that keep happening (MeaningMatch), most
 * frequent first, each with how often and when it was last seen, its cause
 * and the fix that worked.
 *
 * A cause is known when it was recorded (the record's Root Cause), or when
 * OneUptime AI's analysis of it was confirmed by a person (an investigation
 * whose human verdict is Confirmed: its TL;DR). So the knowledge grows as
 * the team resolves incidents and confirms analyses, and an analysis a
 * person rejected never becomes knowledge. A fix is OneUptime AI's verified
 * fix of the record (AIMemory.describeFix).
 *
 * Nothing is stored: the knowledge is read from the records each time, so
 * it is never out of step with them - a record made private, or a verdict
 * changed, changes what is known at once.
 *
 * What it never reads: a private incident or alert (its title and cause
 * would reach the subject's report, which everyone who can see the subject
 * reads), a record of another project, or the subject itself. Every read is
 * bounded, and nothing here throws: knowledge is a help, not load-bearing.
 */

export const SERVICE_KNOWLEDGE_HEADING: string =
  "# What OneUptime AI has learned about these services";

// The most services the knowledge is read for.
export const MAX_SERVICES: number = 3;

// The most failures named per service.
export const MAX_FAILURE_MODES: number = 3;

// The most resolved incidents (or alerts) read per query.
export const MAX_RECORDS_READ: number = 100;

// The most monitors of the services read.
const MAX_MONITORS_READ: number = 100;

// The most records named under one failure.
const MAX_REFERENCES: number = 3;

/*
 * How alike two causes must read to be one failure: closer than a recurrence
 * match needs, as two different failures of one service share its words.
 */
export const FAILURE_MODE_SIMILARITY: number = 0.3;

const MAX_CAUSE_CHARS: number = 300;
const MAX_NAME_CHARS: number = 120;

export interface NamedService {
  // Lower case.
  id: string;
  name: string;
}

// One resolved incident or alert whose cause or fix is known.
export interface LearnedCase {
  // "incident #123", "alert #45".
  reference: string;
  title: string;
  cause: string | null;
  // The cause is OneUptime AI's analysis, which a person confirmed.
  isConfirmedAnalysis: boolean;
  fix: string | null;
  happenedAt: Date;
}

// The cases that read as one failure, the newest first.
export interface FailureMode {
  cases: Array<LearnedCase>;
}

export interface ServiceLessons {
  service: NamedService;
  failureModes: Array<FailureMode>;
}

interface RecordFacts {
  id: string;
  reference: string;
  title: string;
  rootCause: string | undefined;
  happenedAt: Date;
  serviceIds: Set<string>;
}

export default class ServiceKnowledge {
  /*
   * The context section an investigation reads: what is known about each
   * of `services`. Empty when nothing is. Never throws.
   */
  @CaptureSpan()
  public static async getContextSection(data: {
    projectId: ObjectID;
    services: Array<NamedService>;
    excludeIncidentId?: ObjectID | undefined;
    excludeAlertId?: ObjectID | undefined;
  }): Promise<string> {
    if (data.services.length === 0) {
      return "";
    }

    try {
      return ServiceKnowledge.buildContextSection(
        await ServiceKnowledge.read(data),
      );
    } catch (error) {
      logger.error(
        `AI: failed to read what is known about the services of the subject: ${error}`,
      );
      return "";
    }
  }

  /*
   * The services an incident is on: its own, then its monitors'. Empty when
   * none, or when they cannot be read.
   */
  @CaptureSpan()
  public static async readServicesOfIncident(data: {
    projectId: ObjectID;
    incidentId: ObjectID;
  }): Promise<Array<NamedService>> {
    try {
      const incident: Incident | null = await IncidentService.findOneBy({
        query: {
          _id: data.incidentId.toString(),
          projectId: data.projectId,
        },
        select: {
          _id: true,
          services: { _id: true, name: true },
          monitors: { _id: true },
        },
        props: { isRoot: true },
      });

      if (!incident) {
        return [];
      }

      return ServiceKnowledge.merge(
        incident.services || [],
        await ServiceKnowledge.readServicesOfMonitors({
          projectId: data.projectId,
          monitorIds: (incident.monitors || [])
            .map((monitor: Monitor): ObjectID | undefined => {
              return monitor.id || undefined;
            })
            .filter((id: ObjectID | undefined): id is ObjectID => {
              return Boolean(id);
            }),
        }),
      );
    } catch (error) {
      logger.error(
        `AI: failed to read the services of incident ${data.incidentId.toString()}: ${error}`,
      );
      return [];
    }
  }

  /*
   * The services an alert is on - `services`, read with the alert - then
   * its monitor's. Empty when none, or when they cannot be read.
   */
  @CaptureSpan()
  public static async readServicesOfAlert(data: {
    projectId: ObjectID;
    services: Array<Service> | undefined;
    monitorId: ObjectID | undefined;
  }): Promise<Array<NamedService>> {
    let monitorServices: Array<Service> = [];

    if (data.monitorId) {
      try {
        monitorServices = await ServiceKnowledge.readServicesOfMonitors({
          projectId: data.projectId,
          monitorIds: [data.monitorId],
        });
      } catch (error) {
        logger.error(
          `AI: failed to read the services of monitor ${data.monitorId.toString()}: ${error}`,
        );
      }
    }

    return ServiceKnowledge.merge(data.services || [], monitorServices);
  }

  // What is known about each of the first MAX_SERVICES of `services`.
  @CaptureSpan()
  public static async read(data: {
    projectId: ObjectID;
    services: Array<NamedService>;
    excludeIncidentId?: ObjectID | undefined;
    excludeAlertId?: ObjectID | undefined;
  }): Promise<Array<ServiceLessons>> {
    const services: Array<NamedService> = data.services.slice(0, MAX_SERVICES);

    if (services.length === 0) {
      return [];
    }

    const serviceIds: Array<ObjectID> = services.map(
      (service: NamedService): ObjectID => {
        return new ObjectID(service.id);
      },
    );
    const ours: Set<string> = new Set<string>(
      services.map((service: NamedService): string => {
        return service.id;
      }),
    );

    // The monitors of the services, and which of the services each is of.
    const monitors: Array<Monitor> = await MonitorService.findBy({
      query: {
        projectId: data.projectId,
        services: QueryHelper.inRelationArray(serviceIds),
      } as never,
      select: { _id: true, services: { _id: true } },
      limit: MAX_MONITORS_READ,
      skip: 0,
      props: { isRoot: true },
    });

    const servicesByMonitor: Map<string, Set<string>> = new Map<
      string,
      Set<string>
    >();

    for (const monitor of monitors) {
      const id: string = ServiceKnowledge.key(monitor.id);

      if (id) {
        servicesByMonitor.set(
          id,
          ServiceKnowledge.idsIn(monitor.services, ours),
        );
      }
    }

    const monitorIds: Array<ObjectID> = monitors
      .map((monitor: Monitor): ObjectID | undefined => {
        return monitor.id || undefined;
      })
      .filter((id: ObjectID | undefined): id is ObjectID => {
        return Boolean(id);
      });

    const [incidents, alerts]: [Array<RecordFacts>, Array<RecordFacts>] =
      await Promise.all([
        ServiceKnowledge.readIncidents({
          projectId: data.projectId,
          serviceIds,
          monitorIds,
          ours,
          servicesByMonitor,
          excludeId: ServiceKnowledge.key(data.excludeIncidentId),
        }),
        ServiceKnowledge.readAlerts({
          projectId: data.projectId,
          serviceIds,
          monitorIds,
          ours,
          servicesByMonitor,
          excludeId: ServiceKnowledge.key(data.excludeAlertId),
        }),
      ]);

    const [incidentAnalyses, alertAnalyses, incidentFixes, alertFixes]: [
      Map<string, string>,
      Map<string, string>,
      Map<string, string>,
      Map<string, string>,
    ] = await Promise.all([
      AIMemory.readConfirmedAnalyses({
        projectId: data.projectId,
        kind: "incident",
        ids: ServiceKnowledge.idsWithoutCause(incidents),
      }),
      AIMemory.readConfirmedAnalyses({
        projectId: data.projectId,
        kind: "alert",
        ids: ServiceKnowledge.idsWithoutCause(alerts),
      }),
      AIMemory.readVerifiedFixes({
        projectId: data.projectId,
        incidentIds: ServiceKnowledge.objectIds(incidents),
      }),
      AIMemory.readVerifiedAlertFixes({
        projectId: data.projectId,
        alertIds: ServiceKnowledge.objectIds(alerts),
      }),
    ]);

    const casesByService: Map<string, Array<LearnedCase>> = new Map<
      string,
      Array<LearnedCase>
    >();

    const learn: (
      records: Array<RecordFacts>,
      analyses: Map<string, string>,
      fixes: Map<string, string>,
    ) => void = (
      records: Array<RecordFacts>,
      analyses: Map<string, string>,
      fixes: Map<string, string>,
    ): void => {
      for (const record of records) {
        const recorded: string | null = record.rootCause?.trim() || null;
        const analysis: string | null = recorded
          ? null
          : analyses.get(record.id) || null;
        const fix: string | null = fixes.get(record.id) || null;

        if (!recorded && !analysis && !fix) {
          continue;
        }

        const learned: LearnedCase = {
          reference: record.reference,
          title: record.title,
          cause: recorded || analysis,
          isConfirmedAnalysis: Boolean(analysis),
          fix: fix,
          happenedAt: record.happenedAt,
        };

        for (const serviceId of record.serviceIds) {
          const cases: Array<LearnedCase> = casesByService.get(serviceId) || [];
          cases.push(learned);
          casesByService.set(serviceId, cases);
        }
      }
    };

    learn(incidents, incidentAnalyses, incidentFixes);
    learn(alerts, alertAnalyses, alertFixes);

    const lessons: Array<ServiceLessons> = [];

    for (const service of services) {
      const cases: Array<LearnedCase> = (
        casesByService.get(service.id) || []
      ).sort((a: LearnedCase, b: LearnedCase): number => {
        return b.happenedAt.getTime() - a.happenedAt.getTime();
      });

      const failureModes: Array<FailureMode> =
        ServiceKnowledge.groupIntoFailureModes(cases).slice(
          0,
          MAX_FAILURE_MODES,
        );

      if (failureModes.length > 0) {
        lessons.push({ service, failureModes });
      }
    }

    return lessons;
  }

  /*
   * `cases` - the newest first - grouped into the failures they read as:
   * each case joins the failure whose newest case its cause reads most like,
   * when it reads alike enough, else starts one. The failures seen most
   * often first, then the most recently seen.
   */
  public static groupIntoFailureModes(
    cases: Array<LearnedCase>,
  ): Array<FailureMode> {
    const modes: Array<{ mode: FailureMode; terms: MeaningTerms }> = [];

    for (const learned of cases) {
      const terms: MeaningTerms = MeaningMatch.read(
        learned.cause || `${learned.title}\n${learned.fix || ""}`,
      );

      let bestIndex: number = -1;
      let bestScore: MeaningScore | null = null;

      if (modes.length > 0 && terms.weights.size > 0) {
        const scores: Array<MeaningScore> = MeaningMatch.rank({
          query: terms,
          documents: modes.map(
            (item: { terms: MeaningTerms }): MeaningTerms => {
              return item.terms;
            },
          ),
        });

        for (let index: number = 0; index < scores.length; index++) {
          const score: MeaningScore = scores[index]!;

          if (!bestScore || score.similarity > bestScore.similarity) {
            bestScore = score;
            bestIndex = index;
          }
        }
      }

      if (
        bestScore &&
        bestIndex >= 0 &&
        bestScore.similarity >= FAILURE_MODE_SIMILARITY &&
        MeaningMatch.isMatch(bestScore)
      ) {
        modes[bestIndex]!.mode.cases.push(learned);
        continue;
      }

      modes.push({ mode: { cases: [learned] }, terms });
    }

    return modes
      .map((item: { mode: FailureMode }): FailureMode => {
        return item.mode;
      })
      .sort((a: FailureMode, b: FailureMode): number => {
        return (
          b.cases.length - a.cases.length ||
          b.cases[0]!.happenedAt.getTime() - a.cases[0]!.happenedAt.getTime()
        );
      });
  }

  // The markdown section for `lessons`; empty for none.
  public static buildContextSection(lessons: Array<ServiceLessons>): string {
    if (lessons.length === 0) {
      return "";
    }

    let markdown: string =
      `\n\n${SERVICE_KNOWLEDGE_HEADING}\n` +
      "Learned from each service's resolved incidents and alerts whose cause is known - recorded by your team, or OneUptime AI's analysis your team confirmed - and the fixes that worked. A failure that keeps coming back is the first thing to rule in or out: say in the report when this one looks like one of them, and whether its fix applies.\n";

    for (const lesson of lessons) {
      markdown += `\n## Service: ${PromptText.field(lesson.service.name, {
        maxLength: MAX_NAME_CHARS,
      })}\n`;

      for (const mode of lesson.failureModes) {
        const newest: LearnedCase = mode.cases[0]!;
        const seen: string =
          mode.cases.length === 1
            ? "Seen once"
            : `Seen ${mode.cases.length} times`;
        const references: string = mode.cases
          .slice(0, MAX_REFERENCES)
          .map((learned: LearnedCase): string => {
            return learned.reference;
          })
          .join(", ");

        markdown += `- ${seen}, last on ${newest.happenedAt
          .toISOString()
          .slice(0, 10)} (${references}${
          mode.cases.length > MAX_REFERENCES ? ", ..." : ""
        })`;

        const cause: LearnedCase | undefined = mode.cases.find(
          (learned: LearnedCase): boolean => {
            return Boolean(learned.cause);
          },
        );

        if (cause && cause.cause) {
          markdown += `\n  ${
            cause.isConfirmedAnalysis
              ? "Cause (OneUptime AI's analysis, confirmed by your team)"
              : "Cause"
          }: ${PromptText.field(cause.cause, { maxLength: MAX_CAUSE_CHARS })}`;
        } else {
          markdown += `\n  Cause: not recorded. What happened: ${PromptText.field(
            newest.title,
            { maxLength: MAX_NAME_CHARS },
          )}`;
        }

        const fix: LearnedCase | undefined = mode.cases.find(
          (learned: LearnedCase): boolean => {
            return Boolean(learned.fix);
          },
        );

        if (fix && fix.fix) {
          markdown += `\n  Fix that worked (OneUptime AI's, verified): ${fix.fix}`;
        }

        markdown += "\n";
      }
    }

    return markdown;
  }

  private static async readIncidents(data: {
    projectId: ObjectID;
    serviceIds: Array<ObjectID>;
    monitorIds: Array<ObjectID>;
    ours: Set<string>;
    servicesByMonitor: Map<string, Set<string>>;
    excludeId: string;
  }): Promise<Array<RecordFacts>> {
    const resolvedStateIds: Array<ObjectID> =
      await IncidentStateService.getResolvedIncidentStateIds(data.projectId);

    if (resolvedStateIds.length === 0) {
      return [];
    }

    const select: Record<string, unknown> = {
      _id: true,
      incidentNumber: true,
      title: true,
      rootCause: true,
      createdAt: true,
      isPrivate: true,
      services: { _id: true },
      monitors: { _id: true },
    };

    const read: (
      relation: Record<string, unknown>,
    ) => Promise<Array<Incident>> = async (
      relation: Record<string, unknown>,
    ): Promise<Array<Incident>> => {
      return await IncidentService.findBy({
        query: {
          projectId: data.projectId,
          currentIncidentStateId: QueryHelper.any(resolvedStateIds),
          ...relation,
        } as never,
        select: select as never,
        sort: { createdAt: SortOrder.Descending },
        limit: MAX_RECORDS_READ,
        skip: 0,
        props: { isRoot: true },
      });
    };

    const [linked, byMonitor]: [Array<Incident>, Array<Incident>] =
      await Promise.all([
        read({ services: QueryHelper.inRelationArray(data.serviceIds) }),
        data.monitorIds.length > 0
          ? read({ monitors: QueryHelper.inRelationArray(data.monitorIds) })
          : Promise.resolve([]),
      ]);

    const facts: Map<string, RecordFacts> = new Map<string, RecordFacts>();

    for (const incident of [...linked, ...byMonitor]) {
      const id: string = ServiceKnowledge.key(incident.id);

      if (
        !id ||
        id === data.excludeId ||
        incident.isPrivate === true ||
        facts.has(id)
      ) {
        continue;
      }

      const serviceIds: Set<string> = ServiceKnowledge.idsIn(
        incident.services,
        data.ours,
      );

      for (const monitor of incident.monitors || []) {
        for (const serviceId of data.servicesByMonitor.get(
          ServiceKnowledge.key(monitor.id),
        ) || []) {
          serviceIds.add(serviceId);
        }
      }

      if (serviceIds.size === 0) {
        continue;
      }

      facts.set(id, {
        id,
        reference: `incident #${incident.incidentNumber}`,
        title: incident.title || "Untitled",
        rootCause: incident.rootCause,
        happenedAt: new Date(incident.createdAt || 0),
        serviceIds,
      });
    }

    return Array.from(facts.values());
  }

  private static async readAlerts(data: {
    projectId: ObjectID;
    serviceIds: Array<ObjectID>;
    monitorIds: Array<ObjectID>;
    ours: Set<string>;
    servicesByMonitor: Map<string, Set<string>>;
    excludeId: string;
  }): Promise<Array<RecordFacts>> {
    const resolvedStateIds: Array<ObjectID> =
      await AlertStateService.getResolvedAlertStateIds(data.projectId);

    if (resolvedStateIds.length === 0) {
      return [];
    }

    const select: Record<string, unknown> = {
      _id: true,
      alertNumber: true,
      title: true,
      rootCause: true,
      createdAt: true,
      isPrivate: true,
      monitorId: true,
      services: { _id: true },
    };

    const read: (
      relation: Record<string, unknown>,
    ) => Promise<Array<Alert>> = async (
      relation: Record<string, unknown>,
    ): Promise<Array<Alert>> => {
      return await AlertService.findBy({
        query: {
          projectId: data.projectId,
          currentAlertStateId: QueryHelper.any(resolvedStateIds),
          ...relation,
        } as never,
        select: select as never,
        sort: { createdAt: SortOrder.Descending },
        limit: MAX_RECORDS_READ,
        skip: 0,
        props: { isRoot: true },
      });
    };

    const [linked, byMonitor]: [Array<Alert>, Array<Alert>] = await Promise.all(
      [
        read({ services: QueryHelper.inRelationArray(data.serviceIds) }),
        data.monitorIds.length > 0
          ? read({ monitorId: QueryHelper.any(data.monitorIds) })
          : Promise.resolve([]),
      ],
    );

    const facts: Map<string, RecordFacts> = new Map<string, RecordFacts>();

    for (const alert of [...linked, ...byMonitor]) {
      const id: string = ServiceKnowledge.key(alert.id);

      if (
        !id ||
        id === data.excludeId ||
        alert.isPrivate === true ||
        facts.has(id)
      ) {
        continue;
      }

      const serviceIds: Set<string> = ServiceKnowledge.idsIn(
        alert.services,
        data.ours,
      );

      for (const serviceId of data.servicesByMonitor.get(
        ServiceKnowledge.key(alert.monitorId),
      ) || []) {
        serviceIds.add(serviceId);
      }

      if (serviceIds.size === 0) {
        continue;
      }

      facts.set(id, {
        id,
        reference: `alert #${alert.alertNumber}`,
        title: alert.title || "Untitled",
        rootCause: alert.rootCause,
        happenedAt: new Date(alert.createdAt || 0),
        serviceIds,
      });
    }

    return Array.from(facts.values());
  }

  private static async readServicesOfMonitors(data: {
    projectId: ObjectID;
    monitorIds: Array<ObjectID>;
  }): Promise<Array<Service>> {
    if (data.monitorIds.length === 0) {
      return [];
    }

    const monitors: Array<Monitor> = await MonitorService.findBy({
      query: {
        projectId: data.projectId,
        _id: QueryHelper.any(data.monitorIds),
      },
      select: { _id: true, services: { _id: true, name: true } },
      limit: MAX_MONITORS_READ,
      skip: 0,
      props: { isRoot: true },
    });

    return monitors.flatMap((monitor: Monitor): Array<Service> => {
      return monitor.services || [];
    });
  }

  // `first` then `second`, each service once, by id.
  private static merge(
    first: Array<Service>,
    second: Array<Service>,
  ): Array<NamedService> {
    const services: Map<string, NamedService> = new Map<string, NamedService>();

    for (const service of [...first, ...second]) {
      const id: string = ServiceKnowledge.key(service.id);

      if (id && !services.has(id)) {
        services.set(id, { id, name: service.name || "Unnamed service" });
      }
    }

    return Array.from(services.values());
  }

  private static idsIn(
    services: Array<Service> | undefined,
    ours: Set<string>,
  ): Set<string> {
    const ids: Set<string> = new Set<string>();

    for (const service of services || []) {
      const id: string = ServiceKnowledge.key(service.id);

      if (ours.has(id)) {
        ids.add(id);
      }
    }

    return ids;
  }

  private static idsWithoutCause(records: Array<RecordFacts>): Array<ObjectID> {
    return records
      .filter((record: RecordFacts): boolean => {
        return !record.rootCause?.trim();
      })
      .map((record: RecordFacts): ObjectID => {
        return new ObjectID(record.id);
      });
  }

  private static objectIds(records: Array<RecordFacts>): Array<ObjectID> {
    return records.map((record: RecordFacts): ObjectID => {
      return new ObjectID(record.id);
    });
  }

  private static key(id: ObjectID | string | null | undefined): string {
    return id ? id.toString().toLowerCase() : "";
  }
}
