import AIAgentTaskPullRequest from "../../../../Models/DatabaseModels/AIAgentTaskPullRequest";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import CodeFixTaskType, {
  CodeFixTaskTypeHelper,
} from "../../../../Types/AI/CodeFixTaskType";
import {
  TelemetryFixBaseline,
  TelemetryFixSignal,
} from "../../../../Types/AI/FixProductionBaseline";
import FixProductionStatus from "../../../../Types/AI/FixProductionStatus";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import { Green500, Red500 } from "../../../../Types/BrandColors";
import OneUptimeDate from "../../../../Types/Date";
import ObjectID from "../../../../Types/ObjectID";
import { mdText } from "../../../../Utils/Markdown/FeedMarkdown";
import GitHubCommits, {
  GitHubPullRequestFilePatch,
  GitHubRepositoryName,
} from "../../CodeRepository/GitHub/GitHubCommits";
import logger from "../../Logger";
import FixProductionFeed from "./FixProductionFeed";
import FixProductionTelemetry, {
  ARRIVAL_KINDS_BY_SIGNAL,
  FixTelemetryWindow,
} from "./FixProductionTelemetry";
import {
  FixProductionVerdict,
  HOUR_IN_MS,
  decideDeployWait,
  isMeasureDue,
  watchedMilliseconds,
} from "./FixProductionVerdict";
import FixProductionVerifier, {
  ShippedFix,
  VerifierRun,
} from "./FixProductionVerifier";
import {
  TELEMETRY_FIX_THRESHOLDS,
  TelemetryArrival,
  TelemetryArrivalKind,
  TelemetrySignalCounts,
  decideTelemetryBaseline,
  decideTelemetryVerdict,
  readAddedQuotedText,
} from "./TelemetryFixVerdict";

/*
 * A merged telemetry improvement, watched in production: the Telemetry
 * check of FixProductionVerifier, for ImproveTracing (spans), ImproveLogging
 * (logs) and ImproveInstrumentation (both).
 *
 * On the fix's first check its pull request's diff is read from GitHub,
 * and the text quoted on the lines it adds (TelemetryFixVerdict
 * .readAddedQuotedText) is looked for in the week before the merge - in the
 * service the improvement was asked for, or the whole project for an
 * instrumentation fix of an incident, which names no service. What was not
 * there is what the fix adds, and it is kept with how many spans and logs
 * the service sent (TelemetryFixBaseline).
 *
 * Then the deploy that ships it is found like any fix's, and once the fix
 * has run a day - about hourly after - the deployed fix's telemetry is
 * searched for what it adds, and the service's spans and logs are counted,
 * for TelemetryFixVerdict to decide. An instrumentation fix of an incident
 * or alert says how it went on that incident's (or alert's) feed.
 */

// What a telemetry improvement is watched in.
interface TelemetryTarget {
  serviceId?: ObjectID | undefined;
  signals: Array<TelemetryFixSignal>;
}

export default class TelemetryFixWatch {
  public static async verify(
    fix: AIAgentTaskPullRequest,
    run: VerifierRun,
  ): Promise<void> {
    const aiRun: AIRun | null = await FixProductionVerifier.readRun(fix);

    if (!aiRun) {
      await FixProductionVerifier.settle(fix, run, {
        status: FixProductionStatus.Unverifiable,
        summary:
          "The task that opened this fix no longer exists, so what it adds cannot be looked for in production.",
      });
      return;
    }

    const mergedAt: Date = FixProductionVerifier.mergedAtOf(fix, run);
    let baseline: TelemetryFixBaseline | undefined =
      fix.productionBaseline?.telemetry;

    if (!baseline) {
      const texts: Array<string> | null =
        await TelemetryFixWatch.readAddedTexts(fix, run);

      if (!texts) {
        // GitHub could not be read: asked again next time, while a deploy is waited for.
        if (decideDeployWait({ mergedAt, now: run.now })) {
          await FixProductionVerifier.settle(fix, run, {
            status: FixProductionStatus.Unverifiable,
            summary:
              "The fix's changes could not be read from GitHub in the 14 days after it merged, so what it adds cannot be looked for in production.",
          });
        }
        return;
      }

      baseline = await TelemetryFixWatch.readBaseline({
        fix,
        target: TelemetryFixWatch.targetOf(aiRun),
        texts,
        mergedAt,
      });

      await FixProductionVerifier.saveBaseline(fix, { telemetry: baseline });

      const nothing: FixProductionVerdict | null = decideTelemetryBaseline({
        candidateCount: baseline.candidates.length,
        isServiceScoped: Boolean(baseline.serviceId),
      });

      if (nothing) {
        await FixProductionVerifier.settle(fix, run, nothing);
        return;
      }
    }

    const serviceId: ObjectID | undefined = baseline.serviceId
      ? new ObjectID(baseline.serviceId)
      : undefined;

    const shipped: ShippedFix | null = await FixProductionVerifier.awaitDeploy({
      fix,
      run,
      serviceId,
      mergedAt,
    });

    if (!shipped) {
      return;
    }

    const watched: number = watchedMilliseconds({
      deployedAt: shipped.deployedAt,
      now: run.now,
      rolloutGraceMinutes: TELEMETRY_FIX_THRESHOLDS.rolloutGraceMinutes,
    });
    const hasRunADay: boolean =
      watched >= TELEMETRY_FIX_THRESHOLDS.minWatchHours * HOUR_IN_MS;

    // Past the first day, read about hourly: in between there is nothing new.
    if (
      hasRunADay &&
      !shipped.isNew &&
      !isMeasureDue({
        watchedMs: watched,
        minWatchHours: TELEMETRY_FIX_THRESHOLDS.minWatchHours,
        maxWatchDays: TELEMETRY_FIX_THRESHOLDS.maxWatchDays,
      })
    ) {
      return;
    }

    let arrivals: Array<TelemetryArrival> = [];
    let sinceCounts: TelemetrySignalCounts | null = null;

    if (hasRunADay) {
      const version: string | undefined =
        await FixProductionVerifier.versionToRead({
          projectId: fix.projectId!,
          serviceId,
          shipped,
          now: run.now,
        });

      [arrivals, sinceCounts] = await Promise.all([
        FixProductionTelemetry.findTexts(
          {
            projectId: fix.projectId!,
            serviceId,
            from: FixProductionVerifier.sinceDeployWindowStart({
              shipped,
              version,
            }),
            to: run.now,
            version,
          },
          TelemetryFixWatch.kindsOf(baseline.signals),
          baseline.candidates,
        ),
        // Whatever version sent them: a broken exporter sends none.
        serviceId
          ? FixProductionTelemetry.countSignals(
              {
                projectId: fix.projectId!,
                serviceId,
                from: FixProductionVerifier.sinceDeployWindowStart({
                  shipped,
                }),
                to: run.now,
              },
              baseline.signals,
            )
          : Promise.resolve(null),
      ]);
    }

    const verdict: FixProductionVerdict = decideTelemetryVerdict({
      deployedAt: shipped.deployedAt,
      now: run.now,
      signals: baseline.signals,
      candidateCount: baseline.candidates.length,
      arrivals,
      baselineCounts: serviceId
        ? { spans: baseline.spanCount, logs: baseline.logCount }
        : null,
      sinceCounts,
      deployLabel: FixProductionVerifier.deployLabelOf(shipped),
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
      await TelemetryFixWatch.postVerdict({ fix, aiRun, verdict });
    }
  }

  /*
   * Where the improvement shows: the service a logging or tracing
   * improvement was asked for; for an instrumentation fix, which names no
   * service, the whole project.
   */
  public static targetOf(aiRun: AIRun): TelemetryTarget {
    const taskType: CodeFixTaskType = CodeFixTaskTypeHelper.fromDatabaseValue(
      aiRun.codeFixTaskType,
    );
    const telemetryServiceId: string | undefined =
      aiRun.taskContext?.telemetryServiceId;
    const serviceId: ObjectID | undefined =
      telemetryServiceId && ObjectID.isValidUUID(telemetryServiceId)
        ? new ObjectID(telemetryServiceId)
        : undefined;

    switch (taskType) {
      case CodeFixTaskType.ImproveTracing:
        return { serviceId, signals: [TelemetryFixSignal.Spans] };
      case CodeFixTaskType.ImproveLogging:
        return { serviceId, signals: [TelemetryFixSignal.Logs] };
      default:
        return {
          signals: [TelemetryFixSignal.Spans, TelemetryFixSignal.Logs],
        };
    }
  }

  /*
   * The text quoted on the lines the fix's pull request adds, or null when
   * GitHub could not be asked (no token, a rate limit, GitHub down) - asked
   * again next time. A pull request GitHub no longer knows adds nothing.
   */
  public static async readAddedTexts(
    fix: AIAgentTaskPullRequest,
    run: VerifierRun,
  ): Promise<Array<string> | null> {
    const repository: GitHubRepositoryName | null =
      FixProductionVerifier.repositoryOf(fix);

    if (!repository || !fix.pullRequestNumber) {
      return [];
    }

    const token: string | null = await FixProductionVerifier.tokenFor(fix, run);

    if (!token) {
      return null;
    }

    try {
      const read: { files: Array<GitHubPullRequestFilePatch> } =
        await GitHubCommits.listPullRequestFilePatches({
          token,
          owner: repository.owner,
          repository: repository.name,
          pullRequestNumber: fix.pullRequestNumber,
        });

      return readAddedQuotedText(
        read.files.map((file: GitHubPullRequestFilePatch): string => {
          return file.patch || "";
        }),
      ).texts;
    } catch (error) {
      if (error instanceof HTTPErrorResponse && error.statusCode === 404) {
        return [];
      }

      logger.debug(
        `Fix verification: could not read the diff of fix pull request ${fix.id?.toString()}: ${error}`,
      );
      return null;
    }
  }

  /*
   * What the fix adds that the week before the merge did not carry, and how
   * many spans and logs the service sent then.
   */
  private static async readBaseline(data: {
    fix: AIAgentTaskPullRequest;
    target: TelemetryTarget;
    texts: Array<string>;
    mergedAt: Date;
  }): Promise<TelemetryFixBaseline> {
    const from: Date = OneUptimeDate.addRemoveDays(
      data.mergedAt,
      -TELEMETRY_FIX_THRESHOLDS.baselineDays,
    );
    const window: FixTelemetryWindow = {
      projectId: data.fix.projectId!,
      serviceId: data.target.serviceId,
      from,
      to: data.mergedAt,
    };

    const [seenBefore, counts]: [
      Array<TelemetryArrival>,
      TelemetrySignalCounts,
    ] = await Promise.all([
      FixProductionTelemetry.findTexts(
        window,
        TelemetryFixWatch.kindsOf(data.target.signals),
        data.texts,
      ),
      data.target.serviceId
        ? FixProductionTelemetry.countSignals(window, data.target.signals)
        : Promise.resolve({ spans: 0, logs: 0 }),
    ]);

    const seen: Set<string> = new Set<string>(
      seenBefore.map((arrival: TelemetryArrival): string => {
        return arrival.text;
      }),
    );

    return {
      ...(data.target.serviceId
        ? { serviceId: data.target.serviceId.toString() }
        : {}),
      signals: data.target.signals,
      candidates: data.texts.filter((text: string): boolean => {
        return !seen.has(text);
      }),
      spanCount: counts.spans,
      logCount: counts.logs,
      from: from.toISOString(),
      to: data.mergedAt.toISOString(),
    };
  }

  private static kindsOf(
    signals: Array<TelemetryFixSignal>,
  ): Array<TelemetryArrivalKind> {
    return signals.flatMap(
      (signal: TelemetryFixSignal): Array<TelemetryArrivalKind> => {
        return ARRIVAL_KINDS_BY_SIGNAL[signal] || [];
      },
    );
  }

  /*
   * An instrumentation fix was asked for by an inconclusive investigation of
   * an incident or alert: its feed says whether the telemetry the
   * investigation was missing now arrives.
   */
  private static async postVerdict(data: {
    fix: AIAgentTaskPullRequest;
    aiRun: AIRun;
    verdict: FixProductionVerdict;
  }): Promise<void> {
    const subjectId: ObjectID | undefined =
      data.aiRun.triggeredByIncidentId || data.aiRun.triggeredByAlertId;

    if (!subjectId) {
      return;
    }

    const isVerified: boolean =
      data.verdict.status === FixProductionStatus.Verified;

    await FixProductionFeed.postNote({
      fix: data.fix,
      kind: data.aiRun.triggeredByIncidentId ? "incident" : "alert",
      subjectId,
      color: isVerified ? Green500 : Red500,
      markdown: isVerified
        ? mdText`✅ **The telemetry OneUptime AI added is arriving:** ${data.verdict.summary} ${FixProductionFeed.pullRequestLink(data.fix)}`
        : mdText`⚠️ **OneUptime AI's telemetry fix stopped the service's telemetry:** ${data.verdict.summary} ${FixProductionFeed.pullRequestLink(data.fix)}`,
    });
  }
}
