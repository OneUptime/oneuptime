import React, { FunctionComponent, ReactElement } from "react";
import XcpNgPool from "Common/Models/DatabaseModels/XcpNgPool";
import XcpNgResource from "Common/Models/DatabaseModels/XcpNgResource";
import Route from "Common/Types/API/Route";
import Card from "Common/UI/Components/Card/Card";
import { getFigure } from "Common/UI/Components/EmptyFigure/EmptyFigure";
import Link from "Common/UI/Components/Link/Link";
import WordsWithInfoTooltip from "Common/UI/Components/Tooltip/WordsWithInfoTooltip";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import { XcpNgHaVerdictSource } from "Common/Utils/XcpNg/XcpNgHighAvailability";
import { XCP_NG_METRIC_DESCRIPTIONS } from "../MetricDescriptions/XcpNgMetricDescriptions";
import {
  XcpNgHaSummary,
  isXcpNgEventsRead,
  summarizeXcpNgHa,
} from "../../Pages/XcpNg/Utils/XcpNgEventFacts";
import { getXcpNgDisplayName } from "../../Pages/XcpNg/Utils/XcpNgResourceUtils";

/*
 * A POOL'S HIGH AVAILABILITY ON ITS OVERVIEW (#10997): whether HA is on,
 * whether it could still restart every protected VM if one more host
 * failed, how many failures it is set to tolerate, and which host is the
 * pool master - each a reading a probe takes from Xen Orchestra, or from
 * the pool's own XAPI.
 *
 * "Survives a host failure" is the verdict the server derives the HA alert
 * from (XcpNgHighAvailability): XAPI's own plan when the pool is read
 * through XAPI, the hosts up and enabled through Xen Orchestra, whose REST
 * API reports no plan. A pool no probe reads (the agent reads metrics only)
 * draws no card: the Backups card says how to connect it.
 */

export interface ComponentProps {
  pool: XcpNgPool;
  rows: Array<XcpNgResource>;
  getHostRoute: (externalId: string) => Route;
}

type StatTone = "positive" | "danger" | "neutral";

const STAT_TONE_CLASS_NAMES: Record<StatTone, string> = {
  positive: "text-emerald-700",
  danger: "text-red-700",
  neutral: "text-gray-900",
};

interface Stat {
  key: string;
  label: string;
  value?: string | ReactElement | undefined;
  tone: StatTone;
  description: string;
}

const XcpNgHighAvailabilityCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const tx: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };

  if (!isXcpNgEventsRead(props.pool)) {
    return <></>;
  }

  const ha: XcpNgHaSummary = summarizeXcpNgHa({
    pool: props.pool,
    rows: props.rows,
  });

  const canTolerate: boolean | null = ha.verdict.canTolerateHostFailure;
  const configured: number | null = ha.verdict.hostFailuresToTolerate;
  const covered: number | null = ha.verdict.planExistsFor;

  const masterName: string | null = ha.master
    ? getXcpNgDisplayName(ha.master)
    : null;

  const stats: Array<Stat> = [
    {
      key: "enabled",
      label: "High Availability",
      value:
        ha.state === "unknown"
          ? undefined
          : ha.state === "on"
            ? tx("On")
            : tx("Off"),
      tone: ha.state === "on" ? "positive" : "neutral",
      description: XCP_NG_METRIC_DESCRIPTIONS.haEnabled,
    },
    {
      key: "survives",
      label: "Survives a host failure",
      value:
        ha.state !== "on" || canTolerate === null
          ? undefined
          : canTolerate
            ? tx("Yes")
            : tx("No"),
      tone:
        ha.state !== "on" || canTolerate === null
          ? "neutral"
          : canTolerate
            ? "positive"
            : "danger",
      description: XCP_NG_METRIC_DESCRIPTIONS.haSurvivesHostFailure,
    },
    {
      key: "tolerates",
      label: "Host failures tolerated",
      // "1 of 1": what the plan covers of what HA is set to tolerate.
      value:
        ha.state === "on" && configured !== null
          ? covered !== null
            ? translator.translateTemplate("{{covered}} of {{configured}}", {
                covered: translator.formatNumber(covered),
                configured: translator.formatNumber(configured),
              })
            : translator.formatNumber(configured)
          : undefined,
      tone:
        ha.state === "on" &&
        configured !== null &&
        covered !== null &&
        covered < configured
          ? "danger"
          : "neutral",
      description: XCP_NG_METRIC_DESCRIPTIONS.haHostFailuresToTolerate,
    },
    {
      key: "master",
      label: "Pool master",
      value:
        masterName && ha.master?.externalId ? (
          <Link
            to={props.getHostRoute(ha.master.externalId)}
            className="text-indigo-600 hover:text-indigo-700 hover:underline [overflow-wrap:anywhere]"
            dataTestId="xcp-ng-ha-card-master"
          >
            {masterName}
          </Link>
        ) : undefined,
      tone: "neutral",
      description: XCP_NG_METRIC_DESCRIPTIONS.poolMaster,
    },
  ];

  return (
    <div className="mb-6" data-testid="xcp-ng-ha-card">
      <Card
        title="High Availability"
        description="Whether XCP-ng restarts this pool's protected VMs on another host when theirs fails, and whether it still could, as a probe last read it."
      >
        <div>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {stats.map((stat: Stat): ReactElement => {
              return (
                <div
                  key={stat.key}
                  data-testid="xcp-ng-ha-card-stat"
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
                    className={`mt-1 text-xl font-semibold ${STAT_TONE_CLASS_NAMES[stat.tone]}`}
                  >
                    {typeof stat.value === "string" || stat.value === undefined
                      ? getFigure(stat.value)
                      : stat.value}
                  </dd>
                </div>
              );
            })}
          </dl>
          {ha.state === "on" &&
          ha.verdict.source === XcpNgHaVerdictSource.Hosts &&
          canTolerate === false ? (
            <p
              className="mt-3 text-sm text-gray-600"
              data-testid="xcp-ng-ha-card-hosts-left"
            >
              {translator.translatePlural(
                {
                  one: "Only {{count}} host is up and enabled: if it fails, no host is left to restart its VMs on.",
                  other:
                    "Only {{count}} hosts are up and enabled: too few to restart the VMs of one that fails.",
                },
                ha.hostsUpAndEnabled,
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

export default XcpNgHighAvailabilityCard;
