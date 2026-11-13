import React, { FunctionComponent, ReactElement } from "react";
import ProxmoxResource from "Common/Models/DatabaseModels/ProxmoxResource";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Card from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import WordsWithInfoTooltip from "Common/UI/Components/Tooltip/WordsWithInfoTooltip";
import { getRouteToPageAnchor } from "Common/UI/Utils/PageAnchor";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import { formatRelativeTime } from "../Home/HomeRelativeTime";
import { PROXMOX_METRIC_DESCRIPTIONS } from "../MetricDescriptions/ProxmoxMetricDescriptions";
import {
  ProxmoxBackupSummary,
  summarizeProxmoxBackups,
} from "../../Pages/Proxmox/Utils/ProxmoxPartFacts";
import { PROXMOX_NOTIFICATIONS_STEP_ANCHOR } from "../../Pages/Proxmox/Utils/DocumentationMarkdown";

/*
 * A cluster's backups on its Overview: how each guest's last backup went
 * and which guests no backup job includes - the two questions a Proxmox
 * admin asks every morning.
 *
 * The two answers come from different places. pve-exporter says which
 * guests a backup job includes; only Proxmox VE's own notifications say how
 * a backup went. Until the cluster sends them, the card says so and points
 * to the two commands that do (the setup guide's last step).
 */

export interface ComponentProps {
  rows: Array<ProxmoxResource>;
  // When the cluster last sent a notification; null when it never has.
  lastNotificationAt: Date | null;
  /*
   * The setup guide, whose last step sends the notifications: the card's
   * link opens it on that step (PROXMOX_NOTIFICATIONS_STEP_ANCHOR).
   */
  setupRoute: Route;
  guestsRoute: Route;
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
  value: string;
  tone: StatTone;
  description: string;
}

const ProxmoxBackupsCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const tx: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };

  const summary: ProxmoxBackupSummary = summarizeProxmoxBackups(props.rows);

  if (summary.guests === 0) {
    return <></>;
  }

  const hasNotifications: boolean = props.lastNotificationAt !== null;
  const hasResults: boolean = summary.withResult > 0;
  const formatCount: (count: number) => string = (count: number): string => {
    return translator.formatNumber(count);
  };

  const stats: Array<Stat> = [];

  if (hasResults || hasNotifications) {
    stats.push(
      {
        key: "ok",
        label: "Last backup OK",
        value: formatCount(summary.ok),
        tone: summary.ok > 0 ? "positive" : "neutral",
        description: PROXMOX_METRIC_DESCRIPTIONS.backupsLastOk,
      },
      {
        key: "failed",
        label: "Last backup failed",
        value: formatCount(summary.failed),
        tone: summary.failed > 0 ? "danger" : "neutral",
        description: PROXMOX_METRIC_DESCRIPTIONS.backupsLastFailed,
      },
    );
  }

  stats.push({
    key: "not-in-job",
    label: "In no backup job",
    value: summary.coverageKnown > 0 ? formatCount(summary.notInJob) : "—",
    tone: summary.notInJob > 0 ? "warning" : "neutral",
    description: PROXMOX_METRIC_DESCRIPTIONS.backupsNotInJob,
  });

  if (hasResults) {
    stats.push({
      key: "newest",
      label: "Newest backup",
      value: summary.newestBackupAt
        ? formatRelativeTime({
            date: summary.newestBackupAt,
            now: props.now,
            language: translator.language,
          })
        : "—",
      tone: "neutral",
      description: PROXMOX_METRIC_DESCRIPTIONS.backupsNewest,
    });
  }

  return (
    <div className="mb-6" data-testid="proxmox-backups-card">
      <Card
        title="Backups"
        description="How each guest's last backup went, and which guests no backup job includes."
        buttons={[
          <Link
            key="guests"
            to={props.guestsRoute}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
            dataTestId="proxmox-backups-card-guests"
          >
            {tx("View guests")}
          </Link>,
        ]}
      >
        <div>
          <dl
            className={`grid grid-cols-2 gap-4 ${
              stats.length >= 4 ? "sm:grid-cols-4" : "sm:grid-cols-3"
            }`}
          >
            {stats.map((stat: Stat): ReactElement => {
              return (
                <div
                  key={stat.key}
                  data-testid="proxmox-backups-card-stat"
                  data-key={stat.key}
                  className="min-w-0 rounded-lg border border-gray-200 p-3"
                >
                  {/*
                   * The (i) after the label's last word, on the line it
                   * ends on (issue #7348).
                   */}
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
                    {stat.value}
                  </dd>
                </div>
              );
            })}
          </dl>
          {/*
           * Results mean the notifications arrive, whatever the cluster's
           * row says; the way to set them up shows only when neither does.
           */}
          {hasNotifications || hasResults ? (
            <></>
          ) : (
            <div
              className="mt-4 flex flex-col gap-3 rounded-lg border border-indigo-100 bg-indigo-50 p-3 sm:flex-row sm:items-center sm:justify-between"
              data-testid="proxmox-backups-card-setup"
            >
              <div className="flex min-w-0 items-start gap-2 text-sm text-indigo-900">
                <Icon
                  icon={IconProp.Bell}
                  className="mt-0.5 h-4 w-4 flex-shrink-0 text-indigo-600"
                />
                <span>
                  {tx(
                    "See how every backup went: send Proxmox VE's notifications to OneUptime with two commands on any node.",
                  )}
                </span>
              </div>
              <Link
                to={getRouteToPageAnchor(
                  props.setupRoute,
                  PROXMOX_NOTIFICATIONS_STEP_ANCHOR,
                )}
                className="inline-flex flex-shrink-0 items-center justify-center gap-1.5 rounded-md border border-indigo-200 bg-white px-3 py-1.5 text-sm font-medium text-indigo-700 shadow-sm hover:bg-indigo-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                dataTestId="proxmox-backups-card-setup-link"
              >
                {tx("Set up notifications")}
              </Link>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
};

export default ProxmoxBackupsCard;
