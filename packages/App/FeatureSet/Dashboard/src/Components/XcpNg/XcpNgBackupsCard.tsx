import React, { FunctionComponent, ReactElement } from "react";
import XcpNgPool from "Common/Models/DatabaseModels/XcpNgPool";
import XcpNgResource from "Common/Models/DatabaseModels/XcpNgResource";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import { formatDurationText } from "Common/Types/DateLanguage";
import { XcpNgBackupStatus } from "Common/Types/XcpNg/XcpNgPoolEvents";
import {
  XcpNgPoolBackupJob,
  XcpNgPoolBackupProblemVm,
  XcpNgPoolBackupRunSummary,
} from "Common/Types/XcpNg/XcpNgPoolEventState";
import BreakableName from "Common/UI/Components/BreakableName/BreakableName";
import Card from "Common/UI/Components/Card/Card";
import { getFigure } from "Common/UI/Components/EmptyFigure/EmptyFigure";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import WordsWithInfoTooltip from "Common/UI/Components/Tooltip/WordsWithInfoTooltip";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import { formatRelativeTime } from "../Home/HomeRelativeTime";
import { XCP_NG_METRIC_DESCRIPTIONS } from "../MetricDescriptions/XcpNgMetricDescriptions";
import { ResourceAttentionItem } from "../ResourcePart/ResourceAttention";
import ResourceAttentionPill, {
  ComponentProps as ResourceAttentionPillProps,
} from "../ResourcePart/ResourceAttentionPill";
import {
  XcpNgBackupSummary,
  getXcpNgBackupJobs,
  getXcpNgBackupsWatchedSince,
  getXcpNgNewestRun,
  isXcpNgBackupsRead,
  isXcpNgReadThroughXapi,
  summarizeXcpNgBackups,
} from "../../Pages/XcpNg/Utils/XcpNgEventFacts";
import {
  XcpNgProblem,
  XcpNgRouteFor,
  getXcpNgProblemItems,
} from "../../Pages/XcpNg/Utils/XcpNgHealth";
import {
  XCP_NG_METRIC_STALE_MS,
  toXcpNgDate,
  toXcpNgNumber,
} from "../../Pages/XcpNg/Utils/XcpNgResourceUtils";

/*
 * A POOL'S BACKUPS ON ITS OVERVIEW (#10997): how each VM's last backup
 * went, which are overdue, which no scheduled job backs up, and how each of
 * Xen Orchestra's backup jobs last ran for the pool - the questions an
 * XCP-ng admin asks every morning, as a Proxmox cluster's Backups card
 * answers them for its guests.
 *
 * Xen Orchestra runs the backups, and only a probe reading its REST API
 * sees them: a pool read only by the XCP-ng Agent (metrics) or through its
 * own XAPI (which keeps no backups) has none here, and the card says so
 * and how to see them, never "no backups".
 */

export interface ComponentProps {
  pool: XcpNgPool;
  rows: Array<XcpNgResource>;
  vmsRoute: Route;
  // Where connecting the pool's Xen Orchestra from a probe is explained.
  setupRoute: Route;
  routeFor: XcpNgRouteFor;
  now: Date;
}

type StatTone = "positive" | "danger" | "warning" | "neutral";

const STAT_TONE_CLASS_NAMES: Record<StatTone, string> = {
  positive: "text-emerald-700",
  danger: "text-red-700",
  warning: "text-amber-700",
  neutral: "text-gray-900",
};

interface Stat {
  key: string;
  label: string;
  value?: string | undefined;
  tone: StatTone;
  description: string;
  problem?: ResourceAttentionPillProps | undefined;
}

// How a run ended, as a chip: Xen Orchestra's own four words.
const RUN_STATUS_WORDS: Record<XcpNgBackupStatus, string> = {
  [XcpNgBackupStatus.Success]: translationKey("Succeeded"),
  [XcpNgBackupStatus.Failure]: translationKey("Failed"),
  [XcpNgBackupStatus.Interrupted]: translationKey("Interrupted"),
  [XcpNgBackupStatus.Skipped]: translationKey("Skipped"),
};

const RUN_STATUS_TONES: Record<XcpNgBackupStatus, PillTone> = {
  [XcpNgBackupStatus.Success]: PillTone.Success,
  [XcpNgBackupStatus.Failure]: PillTone.Danger,
  [XcpNgBackupStatus.Interrupted]: PillTone.Danger,
  [XcpNgBackupStatus.Skipped]: PillTone.Warning,
};

// What kind of job, as Xen Orchestra's job list names it.
export function getXcpNgJobKindWord(job: XcpNgPoolBackupJob): string | null {
  const type: string = (job.jobType || "").toLowerCase();
  if (type === "metadatabackup") {
    return translationKey("Metadata");
  }
  if (type === "mirrorbackup") {
    return translationKey("Mirror");
  }
  const mode: string = (job.mode || "").toLowerCase();
  if (mode === "delta") {
    return translationKey("Delta");
  }
  if (mode === "full") {
    return translationKey("Full");
  }
  return null;
}

/*
 * "1 day", "12 hours", "3 days": how often a job's schedules run it, at
 * most, in the reader's language and units.
 */
export function formatXcpNgInterval(
  seconds: number,
  language: string,
): string | null {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }
  const days: number = Math.floor(seconds / 86400);
  const hours: number = Math.floor((seconds % 86400) / 3600);
  const minutes: number = Math.floor((seconds % 3600) / 60);
  const parts: Array<{
    count: number;
    unit: "day" | "hour" | "minute";
  }> = [];
  if (days > 0) {
    parts.push({ count: days, unit: "day" });
  }
  if (hours > 0) {
    parts.push({ count: hours, unit: "hour" });
  }
  if (days === 0 && minutes > 0) {
    parts.push({ count: minutes, unit: "minute" });
  }
  return formatDurationText({
    parts: parts.slice(0, 2),
    locale: language,
    unitDisplay: "long",
    listStyle: "narrow",
  });
}

const XcpNgBackupsCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const tx: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };

  const isRead: boolean = isXcpNgBackupsRead(props.pool);
  const watchedSince: Date | null = getXcpNgBackupsWatchedSince(props.pool);
  const summary: XcpNgBackupSummary = summarizeXcpNgBackups({
    rows: props.rows,
    watchedSince: watchedSince,
    isRead: isRead,
    now: props.now,
  });
  const jobs: Array<XcpNgPoolBackupJob> = getXcpNgBackupJobs(props.pool);

  if (summary.vms === 0 && jobs.length === 0) {
    return <></>;
  }

  const when: (date: Date) => string = (date: Date): string => {
    return formatRelativeTime({
      date: date,
      now: props.now,
      language: translator.language,
    });
  };

  const vmsOf: (problem: XcpNgProblem) => Array<ResourceAttentionItem> = (
    problem: XcpNgProblem,
  ): Array<ResourceAttentionItem> => {
    return getXcpNgProblemItems({
      rows: props.rows,
      problem: problem,
      routeFor: props.routeFor,
      now: props.now,
      staleMs: XCP_NG_METRIC_STALE_MS,
      translator: translator,
      backups: { watchedSince: watchedSince },
    });
  };

  const vmsWords: (count: number) => string = (count: number): string => {
    return translator.translatePlural(
      { one: "{{count}} VM", other: "{{count}} VMs" },
      count,
    );
  };

  const stats: Array<Stat> = [];

  if (isRead) {
    const failedVms: Array<ResourceAttentionItem> =
      summary.failed > 0 ? vmsOf({ kind: "vmsBackupFailed" }) : [];
    const lateVms: Array<ResourceAttentionItem> =
      summary.late > 0
        ? vmsOf({ kind: "vmsBackupLate", watchedSince: watchedSince })
        : [];

    stats.push(
      {
        key: "ok",
        label: "Last backup OK",
        value: translator.formatNumber(summary.ok),
        tone: summary.ok > 0 ? "positive" : "neutral",
        description: XCP_NG_METRIC_DESCRIPTIONS.backupsLastOk,
      },
      {
        key: "failed",
        label: "Last backup failed",
        value: translator.formatNumber(summary.failed),
        tone: summary.failed > 0 ? "danger" : "neutral",
        description: XCP_NG_METRIC_DESCRIPTIONS.backupsLastFailed,
        problem:
          failedVms.length > 0
            ? {
                testId: "xcp-ng-backups-card-failed-vms",
                label: vmsWords(failedVms.length),
                tone: "danger",
                hint: "Show which VMs and why",
                dialog: {
                  title: translator.translatePlural(
                    {
                      one: "Last backup failed for {{count}} VM",
                      other: "Last backup failed for {{count}} VMs",
                    },
                    failedVms.length,
                  ),
                  description: XCP_NG_METRIC_DESCRIPTIONS.backupsLastFailed,
                  items: failedVms,
                  emptyMessage: "No VM's last backup failed now.",
                  showKind: false,
                },
              }
            : undefined,
      },
      {
        key: "late",
        label: "Backup overdue",
        value: translator.formatNumber(summary.late),
        tone: summary.late > 0 ? "warning" : "neutral",
        description: XCP_NG_METRIC_DESCRIPTIONS.backupsOverdue,
        problem:
          lateVms.length > 0
            ? {
                testId: "xcp-ng-backups-card-late-vms",
                label: vmsWords(lateVms.length),
                tone: "warning",
                hint: "Show which VMs and why",
                dialog: {
                  title: translator.translatePlural(
                    {
                      one: "{{count}} VM's backup is overdue",
                      other: "{{count}} VMs' backups are overdue",
                    },
                    lateVms.length,
                  ),
                  description: XCP_NG_METRIC_DESCRIPTIONS.backupsOverdue,
                  items: lateVms,
                  emptyMessage: "No VM's backup is overdue now.",
                  showKind: false,
                },
              }
            : undefined,
      },
      {
        key: "not-scheduled",
        label: "In no scheduled job",
        value: translator.formatNumber(summary.notScheduled),
        tone: summary.notScheduled > 0 ? "warning" : "neutral",
        description: XCP_NG_METRIC_DESCRIPTIONS.backupsNotScheduled,
      },
    );
  }

  const renderJob: (job: XcpNgPoolBackupJob) => ReactElement = (
    job: XcpNgPoolBackupJob,
  ): ReactElement => {
    const run: XcpNgPoolBackupRunSummary | null = getXcpNgNewestRun(job);
    const kindWord: string | null = getXcpNgJobKindWord(job);
    const runAt: Date | null = run
      ? toXcpNgDate(run.endedAt) || toXcpNgDate(run.startedAt)
      : null;
    const lastSuccessAt: Date | null = toXcpNgDate(job.lastSuccessAt);
    const interval: number | null = toXcpNgNumber(job.intervalSeconds);
    const vmCount: number = toXcpNgNumber(job.vmCount) || 0;

    const facts: Array<string> = [];
    if (vmCount > 0) {
      facts.push(vmsWords(vmCount));
    }
    const intervalWords: string | null =
      interval !== null
        ? formatXcpNgInterval(interval, translator.language)
        : null;
    if (job.isScheduled && intervalWords) {
      facts.push(
        translator.translateTemplate("Runs at least every {{interval}}", {
          interval: intervalWords,
        }),
      );
    }
    if (run && run.status !== XcpNgBackupStatus.Success && lastSuccessAt) {
      facts.push(
        translator.translateTemplate("Last good run {{time}}", {
          time: when(lastSuccessAt),
        }),
      );
    }

    const isFailed: boolean =
      run !== null &&
      (run.status === XcpNgBackupStatus.Failure ||
        run.status === XcpNgBackupStatus.Interrupted);
    const failedVms: Array<string> = (run?.problemVms || [])
      .filter((vm: XcpNgPoolBackupProblemVm): boolean => {
        return vm.status === XcpNgBackupStatus.Failure;
      })
      .map((vm: XcpNgPoolBackupProblemVm): string => {
        return vm.vmName;
      });
    // Xen Orchestra's own words for why: the run's, else its first VM's.
    const why: string = (
      run?.error ||
      (run?.problemVms || []).find((vm: XcpNgPoolBackupProblemVm): boolean => {
        return Boolean(vm.error);
      })?.error ||
      ""
    ).trim();

    return (
      <li
        key={job.jobId}
        className="flex items-start gap-3 py-3"
        data-testid="xcp-ng-backups-card-job"
        data-job={job.name}
        data-status={run ? run.status : "none"}
      >
        <div
          className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-slate-50 text-slate-600 ring-1 ring-inset ring-slate-200"
          aria-hidden="true"
        >
          <Icon icon={IconProp.Archive} className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="min-w-0 text-sm font-medium text-gray-900 [overflow-wrap:anywhere]">
              <BreakableName text={job.name} />
            </span>
            {kindWord ? (
              <Pill text={kindWord} tone={PillTone.Neutral} />
            ) : (
              <></>
            )}
            {job.isScheduled ? (
              <></>
            ) : (
              <Pill
                text="Not scheduled"
                tone={PillTone.Paused}
                dataTestId="xcp-ng-backups-card-not-scheduled"
              />
            )}
            {run ? (
              <span className="inline-flex flex-wrap items-center gap-1.5">
                <Pill
                  text={RUN_STATUS_WORDS[run.status] || run.status}
                  tone={RUN_STATUS_TONES[run.status] || PillTone.Neutral}
                  dataTestId="xcp-ng-backups-card-run-status"
                />
                {runAt ? (
                  <span className="text-xs text-gray-500">{when(runAt)}</span>
                ) : (
                  <></>
                )}
              </span>
            ) : (
              <span className="text-xs text-gray-500">
                {tx("Not run for this pool since it was connected")}
              </span>
            )}
          </div>
          {facts.length > 0 ? (
            <div className="mt-0.5 text-xs text-gray-500">
              {facts.join(" · ")}
            </div>
          ) : (
            <></>
          )}
          {isFailed && failedVms.length > 0 ? (
            <div
              className="mt-1 text-xs text-gray-700"
              data-testid="xcp-ng-backups-card-failed-vm-names"
            >
              {translator.translateTemplate("Failed: {{vms}}", {
                vms: failedVms.join(", "),
              })}
            </div>
          ) : (
            <></>
          )}
          {isFailed && why ? (
            <p
              className="mt-1 line-clamp-2 text-xs text-red-700 [overflow-wrap:anywhere]"
              data-testid="xcp-ng-backups-card-error"
              title={why}
            >
              {why}
            </p>
          ) : (
            <></>
          )}
        </div>
      </li>
    );
  };

  /*
   * Read through the pool's own XAPI, which keeps no backups, or not read
   * by a probe at all: what to do to see them.
   */
  const renderSetup: () => ReactElement = (): ReactElement => {
    const isXapi: boolean = isXcpNgReadThroughXapi(props.pool);
    return (
      <div
        className="flex flex-col gap-3 rounded-lg border border-indigo-100 bg-indigo-50 p-3 sm:flex-row sm:items-center sm:justify-between"
        data-testid="xcp-ng-backups-card-setup"
        data-path={isXapi ? "xapi" : "agent"}
      >
        <div className="flex min-w-0 items-start gap-2 text-sm text-indigo-900">
          <Icon
            icon={IconProp.Archive}
            className="mt-0.5 h-4 w-4 flex-shrink-0 text-indigo-600"
          />
          <span>
            {isXapi
              ? tx(
                  "XAPI keeps no backups: Xen Orchestra runs them. To see how every backup went, connect this pool's Xen Orchestra from a probe.",
                )
              : tx(
                  "See how every backup went, and this pool's alarms and high availability: connect its Xen Orchestra from a probe. The XCP-ng Agent reads metrics only.",
                )}
          </span>
        </div>
        <Link
          to={props.setupRoute}
          className="inline-flex flex-shrink-0 items-center justify-center gap-1.5 rounded-md border border-indigo-200 bg-white px-3 py-1.5 text-sm font-medium text-indigo-700 shadow-sm hover:bg-indigo-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          dataTestId="xcp-ng-backups-card-setup-link"
        >
          {tx("Connect Xen Orchestra")}
        </Link>
      </div>
    );
  };

  return (
    <div className="mb-6" data-testid="xcp-ng-backups-card">
      <Card
        title="Backups"
        description="How each VM's last backup went in Xen Orchestra, which are overdue, and how each backup job last ran for this pool."
        buttons={[
          <Link
            key="vms"
            to={props.vmsRoute}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
            dataTestId="xcp-ng-backups-card-vms"
          >
            {tx("View VMs")}
          </Link>,
        ]}
      >
        <div>
          {stats.length > 0 ? (
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {stats.map((stat: Stat): ReactElement => {
                return (
                  <div
                    key={stat.key}
                    data-testid="xcp-ng-backups-card-stat"
                    data-key={stat.key}
                    className="min-w-0 rounded-lg border border-gray-200 p-3"
                  >
                    <dt className="text-xs font-medium text-gray-500">
                      <WordsWithInfoTooltip
                        text={tx(stat.label)}
                        label={stat.label}
                        description={stat.description}
                      />
                    </dt>
                    <dd
                      className={`mt-1 text-xl font-semibold tabular-nums ${STAT_TONE_CLASS_NAMES[stat.tone]}`}
                    >
                      {getFigure(stat.value)}
                    </dd>
                    {stat.problem ? (
                      <dd className="mt-2">
                        <ResourceAttentionPill {...stat.problem} />
                      </dd>
                    ) : (
                      <></>
                    )}
                  </div>
                );
              })}
            </dl>
          ) : (
            renderSetup()
          )}

          {isRead && jobs.length > 0 ? (
            <div
              className="mt-5 border-t border-gray-100 pt-4"
              data-testid="xcp-ng-backups-card-jobs"
            >
              <h3 className="text-sm font-medium text-gray-900">
                {tx("Backup Jobs")}
              </h3>
              <ul className="divide-y divide-gray-100">
                {jobs.map(renderJob)}
              </ul>
            </div>
          ) : (
            <></>
          )}

          {isRead && jobs.length === 0 ? (
            <p
              className="mt-4 text-sm text-gray-500"
              data-testid="xcp-ng-backups-card-no-jobs"
            >
              {tx(
                "No Xen Orchestra backup job has backed up this pool's VMs since OneUptime started reading its backups.",
              )}
            </p>
          ) : (
            <></>
          )}
        </div>
      </Card>
    </div>
  );
};

export default XcpNgBackupsCard;
