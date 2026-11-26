import React, { FunctionComponent, ReactElement } from "react";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import BreakableName from "Common/UI/Components/BreakableName/BreakableName";
import Card from "Common/UI/Components/Card/Card";
import { useCardRuledBodyClassName } from "Common/UI/Components/Card/CardSurface";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import { getValueOrQuietDash } from "Common/UI/Components/Table/TableEmptyValue";
import WordsWithInfoTooltip from "Common/UI/Components/Tooltip/WordsWithInfoTooltip";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import { formatStorageBytes } from "Common/Utils/Storage/StorageUsage";
import { getXcpNgLoadBarClassName } from "./XcpNgHostsCard";
import ResourcePartRow from "../ResourcePart/ResourcePartRow";
import { XcpNgBusyPart } from "../../Pages/XcpNg/Utils/XcpNgPartFacts";
import {
  formatXcpNgPercent,
  getXcpNgDisplayName,
  toXcpNgNumber,
} from "../../Pages/XcpNg/Utils/XcpNgResourceUtils";

/*
 * WHAT KEEPS AN XCP-NG POOL, OR ONE OF ITS HOSTS, BUSY: its running VMs -
 * or the pool's hosts - using the most CPU, and those using the most
 * memory, at their latest report, side by side (one under the other on a
 * phone), each a step from its own page (the whole row, ResourcePartRow).
 * A VM's row names the host it runs on; a row's bar is coloured as its row
 * in its list colours it, so one VM reads the same in both.
 *
 * A VM's memory is in use only while its guest tools report what is free:
 * a VM without them uses an unknown amount and is never ranked by it.
 */

// How many parts each ranking lists.
export const XCP_NG_BUSIEST_SHOWN: number = 5;

export interface XcpNgBusiestRanking {
  // English, looked up: "CPU Usage".
  title: string;
  // What the ranking means, for its (i): English, looked up.
  description: string;
  // The line under the title, in the reader's words: "Top 5 VMs by CPU".
  subtitle: string;
  parts: Array<XcpNgBusyPart>;
  // English: what the ranking says when nothing to rank has reported.
  emptyMessage: string;
}

export interface ComponentProps {
  testId: string;
  // English, looked up by the card.
  title: string;
  description: string;
  cpu: XcpNgBusiestRanking;
  memory: XcpNgBusiestRanking;
  getRoute: (part: XcpNgBusyPart) => Route;
  // Whether each row names the host it runs on (a pool's busiest VMs).
  showHost?: boolean | undefined;
  // The link at the card's foot to every part: in the reader's words already.
  allLabel?: string | undefined;
  allRoute?: Route | undefined;
  onShowAll?: (() => void) | undefined;
}

const XcpNgBusiestCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const bodyClassName: string = useCardRuledBodyClassName();

  const tx: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };

  // What a row's memory is, under its name or as its figure.
  const memoryLine: (part: XcpNgBusyPart) => string | null = (
    part: XcpNgBusyPart,
  ): string | null => {
    const total: number | null = toXcpNgNumber(part.row.maxMemoryBytes);
    if (part.memoryBytes === null) {
      return null;
    }
    return total !== null && total > 0
      ? translator.translateTemplate("{{used}} of {{total}} memory", {
          used: formatStorageBytes(part.memoryBytes, translator.language),
          total: formatStorageBytes(total, translator.language),
        })
      : translator.translateTemplate("{{used}} memory", {
          used: formatStorageBytes(part.memoryBytes, translator.language),
        });
  };

  const renderRanking: (data: {
    key: "cpu" | "memory";
    ranking: XcpNgBusiestRanking;
    icon: IconProp;
    iconClassName: string;
    barClassName: (percent: number) => string;
  }) => ReactElement = (data: {
    key: "cpu" | "memory";
    ranking: XcpNgBusiestRanking;
    icon: IconProp;
    iconClassName: string;
    barClassName: (percent: number) => string;
  }): ReactElement => {
    const testId: string = `${props.testId}-${data.key}`;
    return (
      <div className="min-w-0" data-testid={testId}>
        <div className="flex items-center gap-2 px-5 pb-1 pt-4 md:px-6">
          <div
            className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${data.iconClassName}`}
            aria-hidden="true"
          >
            <Icon icon={data.icon} className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h4 className="text-sm font-semibold text-gray-900">
              <WordsWithInfoTooltip
                text={tx(data.ranking.title)}
                label={data.ranking.title}
                description={data.ranking.description}
              />
            </h4>
            <p className="text-xs text-gray-500">{data.ranking.subtitle}</p>
          </div>
        </div>
        {data.ranking.parts.length === 0 ? (
          <p
            className="px-5 py-4 text-sm text-gray-500 md:px-6"
            data-testid={`${testId}-empty`}
          >
            {tx(data.ranking.emptyMessage)}
          </p>
        ) : (
          <ol>
            {data.ranking.parts.map(
              (part: XcpNgBusyPart, index: number): ReactElement => {
                const externalId: string = part.row.externalId || "";
                const name: string = getXcpNgDisplayName(part.row);
                const percent: number | null =
                  data.key === "cpu" ? part.cpuPercent : part.memoryPercent;
                const bar: number = Math.min(100, Math.max(0, percent ?? 0));
                const hostName: string =
                  props.showHost && part.row.parentHostName
                    ? part.row.parentHostName
                    : "";
                const line: string | null =
                  data.key === "memory" ? memoryLine(part) : null;

                return (
                  <li key={externalId || name} data-testid={`${testId}-item`}>
                    <ResourcePartRow
                      to={externalId ? props.getRoute(part) : undefined}
                      className="flex items-center gap-3"
                    >
                      <span
                        className="w-4 flex-shrink-0 text-xs tabular-nums text-gray-500"
                        aria-hidden="true"
                      >
                        {translator.formatNumber(index + 1)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                            <span
                              data-testid={`${testId}-name`}
                              className="min-w-0 text-sm font-medium text-gray-900 [overflow-wrap:anywhere]"
                            >
                              <BreakableName text={name} />
                            </span>
                            {hostName ? (
                              <span className="inline-flex rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-600">
                                <bdi>{hostName}</bdi>
                              </span>
                            ) : (
                              <></>
                            )}
                          </div>
                          <span
                            className="flex-shrink-0 text-sm font-semibold tabular-nums text-gray-700"
                            data-testid={`${testId}-value`}
                          >
                            {getValueOrQuietDash(formatXcpNgPercent(percent), {
                              isSmall: true,
                            })}
                          </span>
                        </div>
                        {line ? (
                          <div className="mt-0.5 text-xs text-gray-500">
                            {line}
                          </div>
                        ) : (
                          <></>
                        )}
                        <div
                          className="mt-1.5 h-1.5 w-full rounded-full bg-gray-100"
                          aria-hidden="true"
                        >
                          <div
                            className={`h-1.5 rounded-full ${data.barClassName(bar)}`}
                            style={{ width: `${Math.max(bar, 2)}%` }}
                          />
                        </div>
                      </div>
                    </ResourcePartRow>
                  </li>
                );
              },
            )}
          </ol>
        )}
      </div>
    );
  };

  const footer: ReactElement | null =
    props.allLabel && (props.allRoute || props.onShowAll) ? (
      <div
        className="border-t border-gray-200 px-5 py-3 text-sm md:px-6"
        data-testid={`${props.testId}-all`}
      >
        {props.allRoute ? (
          <Link
            to={props.allRoute}
            className="rounded-sm font-medium text-indigo-600 hover:text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
          >
            {props.allLabel}
          </Link>
        ) : (
          <button
            type="button"
            onClick={props.onShowAll}
            className="rounded-sm font-medium text-indigo-600 hover:text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
          >
            {props.allLabel}
          </button>
        )}
      </div>
    ) : null;

  return (
    <Card title={props.title} description={props.description}>
      <div className={bodyClassName} data-testid={props.testId}>
        <div className="grid grid-cols-1 divide-y divide-gray-200 lg:grid-cols-2 lg:divide-x lg:divide-y-0 rtl:divide-x-reverse">
          {renderRanking({
            key: "cpu",
            ranking: props.cpu,
            icon: IconProp.CPUChip,
            iconClassName: "bg-blue-50 text-blue-600",
            barClassName: (percent: number): string => {
              return getXcpNgLoadBarClassName({
                percent: percent,
                metric: "cpu",
              });
            },
          })}
          {renderRanking({
            key: "memory",
            ranking: props.memory,
            icon: IconProp.SquareStack,
            iconClassName: "bg-violet-50 text-violet-600",
            barClassName: (percent: number): string => {
              return getXcpNgLoadBarClassName({
                percent: percent,
                metric: "memory",
                normalClassName: "bg-violet-500",
              });
            },
          })}
        </div>
        {footer}
      </div>
    </Card>
  );
};

export default XcpNgBusiestCard;
