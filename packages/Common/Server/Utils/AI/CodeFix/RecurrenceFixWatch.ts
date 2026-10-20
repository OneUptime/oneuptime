import Alert from "../../../../Models/DatabaseModels/Alert";
import AIAgentTaskPullRequest from "../../../../Models/DatabaseModels/AIAgentTaskPullRequest";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import { RecurrenceFixBaseline } from "../../../../Types/AI/FixProductionBaseline";
import FixProductionStatus from "../../../../Types/AI/FixProductionStatus";
import { IncidentAlertAiSubjectKind } from "../../../../Types/AI/IncidentAlertAiLogs";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import { Green500, Red500 } from "../../../../Types/BrandColors";
import OneUptimeDate from "../../../../Types/Date";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import { MarkdownText, mdText } from "../../../../Utils/Markdown/FeedMarkdown";
import AlertService from "../../../Services/AlertService";
import AlertStateService from "../../../Services/AlertStateService";
import IncidentService from "../../../Services/IncidentService";
import IncidentStateService from "../../../Services/IncidentStateService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import FixProductionFeed from "./FixProductionFeed";
import { FixProductionVerdict, quoteName } from "./FixProductionVerdict";
import FixProductionVerifier, {
  ShippedFix,
  VerifierRun,
} from "./FixProductionVerifier";
import {
  RECURRENCE_FIX_THRESHOLDS,
  decideRecurrenceVerdict,
} from "./RecurrenceFixVerdict";

/*
 * A merged fix of the root cause an investigation found (FixFromIncident),
 * watched in production: the Recurrence check of FixProductionVerifier.
 *
 * The investigated incident (or alert) names the monitors that raised it;
 * how many incidents (or alerts) they raised in the month before the merge
 * is counted once, on the fix's first check, and kept
 * (RecurrenceFixBaseline). The deploy that ships the fix is found among
 * every change of the project - an incident names no service - and from
 * its rollout grace on, every incident (or alert) the monitors raise is a
 * recurrence. RecurrenceFixVerdict decides; the incidents live in Postgres,
 * so they are counted on every check.
 *
 * A decided fix says so on the investigated incident's feed - fixed in
 * production, or not - and a regressed one on the first recurrence's too,
 * so whoever responds to it knows a fix for it already shipped.
 */

// The investigated incident or alert, as the watch reads it.
interface RecurrenceSubject {
  kind: IncidentAlertAiSubjectKind;
  id: ObjectID;
  // "INC-42", "#42".
  label: string;
  monitorIds: Array<ObjectID>;
  // 'monitor "API health"', or "its monitors".
  monitorLabel: string;
}

// An incident or an alert a monitor raised since the deploy.
interface Recurrence {
  id: ObjectID;
  label: string;
}

export default class RecurrenceFixWatch {
  public static async verify(
    fix: AIAgentTaskPullRequest,
    run: VerifierRun,
  ): Promise<void> {
    const subject: RecurrenceSubject | FixProductionVerdict =
      await RecurrenceFixWatch.readSubject(fix);

    if ("status" in subject) {
      await FixProductionVerifier.settle(fix, run, subject);
      return;
    }

    const mergedAt: Date = FixProductionVerifier.mergedAtOf(fix, run);
    let baseline: RecurrenceFixBaseline | undefined =
      fix.productionBaseline?.recurrence;

    if (!baseline) {
      const from: Date = OneUptimeDate.addRemoveDays(
        mergedAt,
        -RECURRENCE_FIX_THRESHOLDS.baselineDays,
      );

      baseline = {
        subjectKind: subject.kind,
        monitorIds: subject.monitorIds.map((id: ObjectID): string => {
          return id.toString();
        }),
        count: await RecurrenceFixWatch.countRaised({
          fix,
          kind: subject.kind,
          monitorIds: subject.monitorIds,
          from,
          to: mergedAt,
        }),
        from: from.toISOString(),
        to: mergedAt.toISOString(),
      };

      await FixProductionVerifier.saveBaseline(fix, { recurrence: baseline });
    }

    const shipped: ShippedFix | null = await FixProductionVerifier.awaitDeploy(
      { fix, run, mergedAt },
    );

    if (!shipped) {
      return;
    }

    // The monitors watched are the ones the fix's baseline counted.
    const monitorIds: Array<ObjectID> = baseline.monitorIds.map(
      (id: string): ObjectID => {
        return new ObjectID(id);
      },
    );
    const since: Date = OneUptimeDate.addRemoveMinutes(
      shipped.deployedAt,
      RECURRENCE_FIX_THRESHOLDS.rolloutGraceMinutes,
    );

    const [recurrences, hasOpenSubject]: [number, boolean] = await Promise.all(
      [
        RecurrenceFixWatch.countRaised({
          fix,
          kind: baseline.subjectKind,
          monitorIds,
          from: since,
          to: run.now,
        }),
        RecurrenceFixWatch.hasOpen({
          fix,
          kind: baseline.subjectKind,
          monitorIds,
        }),
      ],
    );

    const firstRecurrence: Recurrence | null =
      recurrences > 0
        ? await RecurrenceFixWatch.firstRaised({
            fix,
            kind: baseline.subjectKind,
            monitorIds,
            from: since,
            to: run.now,
          })
        : null;

    // While one is open the monitor raises no other: quiet counts from after it.
    if (hasOpenSubject && run.now.getTime() >= since.getTime()) {
      baseline = { ...baseline, openSeenAt: run.now.toISOString() };
      await FixProductionVerifier.saveBaseline(fix, { recurrence: baseline });
    }

    const deployLabel: string = FixProductionVerifier.deployLabelOf(shipped);
    const verdict: FixProductionVerdict = decideRecurrenceVerdict({
      deployedAt: shipped.deployedAt,
      now: run.now,
      subjectKind: baseline.subjectKind,
      recurrences,
      firstRecurrenceLabel: firstRecurrence?.label,
      baselineCount: baseline.count,
      hasOpenSubject,
      openSeenAt: baseline.openSeenAt
        ? new Date(baseline.openSeenAt)
        : undefined,
      deployLabel,
      monitorLabel: subject.monitorLabel,
    });

    await FixProductionVerifier.settle(
      fix,
      run,
      verdict,
      shipped.isNew ? shipped : undefined,
    );

    if (
      verdict.status === FixProductionStatus.Verified ||
      verdict.status === FixProductionStatus.Regressed
    ) {
      await RecurrenceFixWatch.postVerdict({
        fix,
        subject,
        verdict,
        firstRecurrence,
        deployLabel,
      });
    }
  }

  /*
   * The investigated incident or alert and its monitors, or the verdict that
   * there is nothing to watch: no subject any more, or one no monitor raised.
   */
  public static async readSubject(
    fix: AIAgentTaskPullRequest,
  ): Promise<RecurrenceSubject | FixProductionVerdict> {
    const aiRun: AIRun | null = await FixProductionVerifier.readRun(fix);

    if (aiRun?.triggeredByIncidentId) {
      const incident: Incident | null = await IncidentService.findOneBy({
        query: {
          _id: aiRun.triggeredByIncidentId.toString(),
          projectId: fix.projectId!,
        },
        select: {
          _id: true,
          incidentNumber: true,
          incidentNumberWithPrefix: true,
          monitors: { _id: true, name: true },
        },
        props: { isRoot: true },
      });

      if (incident?.id) {
        return RecurrenceFixWatch.toSubject({
          kind: "incident",
          id: incident.id,
          label: RecurrenceFixWatch.labelOf(
            incident.incidentNumberWithPrefix,
            incident.incidentNumber,
          ),
          monitors: incident.monitors || [],
        });
      }
    }

    if (aiRun?.triggeredByAlertId) {
      const alert: Alert | null = await AlertService.findOneBy({
        query: {
          _id: aiRun.triggeredByAlertId.toString(),
          projectId: fix.projectId!,
        },
        select: {
          _id: true,
          alertNumber: true,
          alertNumberWithPrefix: true,
          monitor: { _id: true, name: true },
        },
        props: { isRoot: true },
      });

      if (alert?.id) {
        return RecurrenceFixWatch.toSubject({
          kind: "alert",
          id: alert.id,
          label: RecurrenceFixWatch.labelOf(
            alert.alertNumberWithPrefix,
            alert.alertNumber,
          ),
          monitors: alert.monitor ? [alert.monitor] : [],
        });
      }
    }

    return {
      status: FixProductionStatus.Unverifiable,
      summary:
        "The incident or alert this fix was opened for no longer exists, so whether it happens again cannot be watched.",
    };
  }

  private static toSubject(data: {
    kind: IncidentAlertAiSubjectKind;
    id: ObjectID;
    label: string;
    monitors: Array<Monitor>;
  }): RecurrenceSubject | FixProductionVerdict {
    const monitors: Array<Monitor> = data.monitors.filter(
      (monitor: Monitor): boolean => {
        return Boolean(monitor.id);
      },
    );

    if (monitors.length === 0) {
      return {
        status: FixProductionStatus.Unverifiable,
        summary: `No monitor raised the ${data.kind} this fix was opened for, so there is no monitor to watch for it again.`,
      };
    }

    return {
      kind: data.kind,
      id: data.id,
      label: data.label,
      monitorIds: monitors.map((monitor: Monitor): ObjectID => {
        return monitor.id!;
      }),
      monitorLabel:
        monitors.length === 1
          ? monitors[0]!.name
            ? `monitor ${quoteName(monitors[0]!.name)}`
            : "its monitor"
          : "its monitors",
    };
  }

  // "INC-42", else "#42".
  private static labelOf(
    withPrefix: string | undefined,
    number: number | undefined,
  ): string {
    return withPrefix || (number ? `#${number}` : "");
  }

  // The incidents (or alerts) the monitors raised in a window.
  private static async countRaised(data: {
    fix: AIAgentTaskPullRequest;
    kind: IncidentAlertAiSubjectKind;
    monitorIds: Array<ObjectID>;
    from: Date;
    to: Date;
  }): Promise<number> {
    if (data.to.getTime() <= data.from.getTime()) {
      return 0;
    }

    const count: PositiveNumber =
      data.kind === "incident"
        ? await IncidentService.countBy({
            query: {
              projectId: data.fix.projectId!,
              monitors: QueryHelper.inRelationArray(data.monitorIds),
              createdAt: new InBetween(data.from, data.to),
            } as never,
            props: { isRoot: true },
          })
        : await AlertService.countBy({
            query: {
              projectId: data.fix.projectId!,
              monitorId: QueryHelper.any(data.monitorIds),
              createdAt: new InBetween(data.from, data.to),
            } as never,
            props: { isRoot: true },
          });

    return count.toNumber();
  }

  // The first incident (or alert) the monitors raised in a window.
  private static async firstRaised(data: {
    fix: AIAgentTaskPullRequest;
    kind: IncidentAlertAiSubjectKind;
    monitorIds: Array<ObjectID>;
    from: Date;
    to: Date;
  }): Promise<Recurrence | null> {
    if (data.kind === "incident") {
      const incidents: Array<Incident> = await IncidentService.findBy({
        query: {
          projectId: data.fix.projectId!,
          monitors: QueryHelper.inRelationArray(data.monitorIds),
          createdAt: new InBetween(data.from, data.to),
        } as never,
        select: {
          _id: true,
          incidentNumber: true,
          incidentNumberWithPrefix: true,
        },
        sort: { createdAt: SortOrder.Ascending },
        limit: 1,
        skip: 0,
        props: { isRoot: true },
      });

      return incidents[0]?.id
        ? {
            id: incidents[0].id,
            label: RecurrenceFixWatch.labelOf(
              incidents[0].incidentNumberWithPrefix,
              incidents[0].incidentNumber,
            ),
          }
        : null;
    }

    const alerts: Array<Alert> = await AlertService.findBy({
      query: {
        projectId: data.fix.projectId!,
        monitorId: QueryHelper.any(data.monitorIds),
        createdAt: new InBetween(data.from, data.to),
      } as never,
      select: { _id: true, alertNumber: true, alertNumberWithPrefix: true },
      sort: { createdAt: SortOrder.Ascending },
      limit: 1,
      skip: 0,
      props: { isRoot: true },
    });

    return alerts[0]?.id
      ? {
          id: alerts[0].id,
          label: RecurrenceFixWatch.labelOf(
            alerts[0].alertNumberWithPrefix,
            alerts[0].alertNumber,
          ),
        }
      : null;
  }

  // Whether one of the monitors' incidents (or alerts) is still open.
  private static async hasOpen(data: {
    fix: AIAgentTaskPullRequest;
    kind: IncidentAlertAiSubjectKind;
    monitorIds: Array<ObjectID>;
  }): Promise<boolean> {
    const projectId: ObjectID = data.fix.projectId!;

    const count: PositiveNumber =
      data.kind === "incident"
        ? await IncidentService.countBy({
            query: {
              projectId,
              monitors: QueryHelper.inRelationArray(data.monitorIds),
              currentIncidentStateId: QueryHelper.any(
                await IncidentStateService.getUnresolvedIncidentStateIds(
                  projectId,
                ),
              ),
            } as never,
            props: { isRoot: true },
          })
        : await AlertService.countBy({
            query: {
              projectId,
              monitorId: QueryHelper.any(data.monitorIds),
              currentAlertStateId: QueryHelper.any(
                await AlertStateService.getUnresolvedAlertStateIds(projectId),
              ),
            } as never,
            props: { isRoot: true },
          });

    return count.toNumber() > 0;
  }

  /*
   * The verdict on the investigated incident's (or alert's) feed, and - for
   * a fix that did not stop it - on the first recurrence's. Best-effort: a
   * failed note is logged, and the verdict stands.
   */
  private static async postVerdict(data: {
    fix: AIAgentTaskPullRequest;
    subject: RecurrenceSubject;
    verdict: FixProductionVerdict;
    firstRecurrence: Recurrence | null;
    deployLabel: string;
  }): Promise<void> {
    const isVerified: boolean =
      data.verdict.status === FixProductionStatus.Verified;
    const pullRequest: MarkdownText = FixProductionFeed.pullRequestLink(
      data.fix,
    );

    await FixProductionFeed.postNote({
      fix: data.fix,
      kind: data.subject.kind,
      subjectId: data.subject.id,
      color: isVerified ? Green500 : Red500,
      markdown: isVerified
        ? mdText`✅ **OneUptime AI's fix worked in production:** ${data.verdict.summary} ${pullRequest}`
        : mdText`⚠️ **OneUptime AI's fix did not stop this:** ${data.verdict.summary} ${pullRequest}`,
    });

    if (!isVerified && data.firstRecurrence) {
      await FixProductionFeed.postNote({
        fix: data.fix,
        kind: data.subject.kind,
        subjectId: data.firstRecurrence.id,
        color: Red500,
        markdown: mdText`⚠️ **This happened again after an AI fix shipped:** OneUptime AI's fix for ${data.subject.kind} ${data.subject.label} shipped in ${data.deployLabel}, and ${data.subject.monitorLabel} raised this ${data.subject.kind} since, so its root cause may not be fixed. ${pullRequest}`,
      });
    }
  }
}
