import React, { FunctionComponent, ReactElement } from "react";
import Host from "Common/Models/DatabaseModels/Host";
import { Amber500, Blue, Gray500, Green, Red } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import { HostHealthText, HostHealthTone } from "Common/Types/Host/HostHealth";
import BreakableName from "Common/UI/Components/BreakableName/BreakableName";
import Pill from "Common/UI/Components/Pill/Pill";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator, composedValue } from "Common/UI/Utils/TranslateTemplate";
import { formatRelativeTime } from "../Home/HomeRelativeTime";
import { withSentenceDigits } from "../ResourcePart/SentenceDigits";
import { ReadingDirection } from "Common/Types/ReadingDirection";
import {
  LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME,
  getLineDirection,
} from "Common/UI/Utils/LineDirection";
import {
  HostStatusFacts,
  HostUsage,
  HostUsageKind,
  formatHostBytes,
  formatHostUsagePercent,
  getHostStatusFacts,
  getHostUsage,
} from "../../Pages/Host/Utils/HostFacts";

/*
 * The Hosts list's Status, CPU, Memory and Disk cells (HostFacts says what
 * each holds). Status is the host's health in one word - Healthy, Degraded,
 * Unhealthy, Not reporting, Starting - with the most telling reason under
 * it ("/var 96% full"), so the row says why without opening the host. The
 * usage cells are what the host last reported, as a bar coloured by the
 * line its Needs attention card draws, with what it is a share of beneath:
 * its cores, its RAM, its fullest mount.
 */

export const HOST_STATUS_COLORS: Record<HostHealthTone, Color> = {
  positive: Green,
  warning: Amber500,
  danger: Red,
  neutral: Gray500,
};

/*
 * The reason under a host's badge wraps within its column, breaking after
 * a mount's slashes (BreakableName) rather than widening the column - a
 * table's cell keeps its values on one line (whitespace-nowrap), so the
 * reason says it wraps.
 */
export const HOST_STATUS_REASON_CLASS_NAME: string =
  "whitespace-normal text-xs text-gray-600 [overflow-wrap:anywhere]";

/*
 * The Status and usage columns' widths, named by the page so the table
 * keeps them (CellClassName) rather than drawing each value whole: the
 * badge with a reason of up to 10rem; a bar of 5.5 to 6.5rem with its
 * percent, what it is a share of under it cut short with "..." and whole
 * under the pointer. The name, three bars and the status then fit a
 * laptop's card beside the side menu.
 */
export const HOST_STATUS_COLUMN_CLASS_NAME: string =
  "min-w-[7rem] max-w-[10rem]";

export const HOST_USAGE_COLUMN_CLASS_NAME: string =
  "min-w-[5.5rem] max-w-[6.5rem]";

export const HOST_USAGE_CELL_CLASS_NAME: string = "min-w-[5.5rem]";

export const HOST_USAGE_SUBLABEL_CLASS_NAME: string =
  "mt-0.5 truncate text-xs text-gray-500";

export const HOST_USAGE_BAR_CLASS_NAMES: Record<HostHealthTone, string> = {
  positive: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-red-500",
  neutral: "bg-gray-300",
};

/*
 * A reason as the Needs attention card words it: its numbers in the
 * sentence's digits, each value set apart from the words around it, so a
 * mount in a Persian reason keeps its slashes where they were written.
 */
function textOf(translator: Translator, reason: HostHealthText): string {
  if (reason.plural) {
    return translator.translatePlural(
      { one: reason.plural.one, other: reason.text },
      reason.plural.count,
      withSentenceDigits(reason.values),
      { setsValuesApart: true },
    );
  }
  return reason.values
    ? translator.translateTemplate(
        reason.text,
        withSentenceDigits(reason.values),
        { setsValuesApart: true },
      )
    : translator.translateText(reason.text) || reason.text;
}

/*
 * One line of a cell that ends in "..." where its column does: it reads the
 * way what it holds is written where the page reads the other way
 * (LineDirection), so a host name or a mount in Latin letters on a Persian
 * page is cut short at its own end, lined up as the page's lines are.
 */
export interface HostCellLine {
  dir: ReadingDirection | undefined;
  className: string;
}

export function getHostCellLine(data: {
  text: string;
  language: string | undefined;
  className: string;
}): HostCellLine {
  const dir: ReadingDirection | undefined = getLineDirection(
    data.text,
    data.language,
  );
  return {
    dir: dir,
    className: dir
      ? `${data.className} ${LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME}`
      : data.className,
  };
}

export const HostStatusCell: FunctionComponent<{
  host: Host;
  now: Date;
}> = (props: { host: Host; now: Date }): ReactElement => {
  const translator: Translator = useTranslator();
  const facts: HostStatusFacts = getHostStatusFacts({
    row: props.host,
    now: props.now,
  });

  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      <span data-testid="host-status" data-tone={facts.tone}>
        <Pill
          text={facts.status.text}
          color={facts.isStarting ? Blue : HOST_STATUS_COLORS[facts.tone]}
          isPulsing={facts.isStarting}
        />
      </span>
      {facts.lastReportedAt ? (
        <div
          data-testid="host-status-last-report"
          className={HOST_STATUS_REASON_CLASS_NAME}
        >
          {translator.translateTemplate(
            "Last reported {{time}}",
            {
              time: composedValue((sentence: Translator): string => {
                return formatRelativeTime({
                  date: facts.lastReportedAt as Date,
                  now: props.now,
                  language: sentence.language,
                });
              }),
            },
            { setsValuesApart: true },
          )}
        </div>
      ) : (
        <></>
      )}
      {facts.firstReason ? (
        <div
          data-testid="host-status-reason"
          className={HOST_STATUS_REASON_CLASS_NAME}
        >
          <BreakableName text={textOf(translator, facts.firstReason)} />
          {facts.moreReasons > 0 ? (
            <>
              {/* A space, so "+1 more" may move to a line of its own. */}{" "}
              <span className="whitespace-nowrap text-gray-500">
                {translator.translatePlural(
                  { one: "+{{count}} more", other: "+{{count}} more" },
                  facts.moreReasons,
                )}
              </span>
            </>
          ) : (
            <></>
          )}
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export const HostUsageCell: FunctionComponent<{
  host: Host;
  kind: HostUsageKind;
  now: Date;
}> = (props: { host: Host; kind: HostUsageKind; now: Date }): ReactElement => {
  const translator: Translator = useTranslator();
  const usage: HostUsage = getHostUsage({
    row: props.host,
    kind: props.kind,
    now: props.now,
  });

  if (usage.percent === null) {
    return <TableEmptyValue screenReaderText="Not reported" />;
  }

  /*
   * What the bar is a share of: the host's cores, its RAM ("of 32 GiB",
   * the size set apart in a Persian sentence) or the fullest mount, whole
   * under the pointer.
   */
  let sublabel: ReactElement = <></>;

  if (props.kind === "cpu" && props.host.cpuCores) {
    sublabel = (
      <div className={HOST_USAGE_SUBLABEL_CLASS_NAME}>
        {translator.translatePlural(
          { one: "{{count}} core", other: "{{count}} cores" },
          Number(props.host.cpuCores),
        )}
      </div>
    );
  } else if (props.kind === "memory" && props.host.totalMemoryBytes) {
    sublabel = (
      <div className={HOST_USAGE_SUBLABEL_CLASS_NAME}>
        {translator.translateTemplate(
          "of {{total}}",
          { total: formatHostBytes(Number(props.host.totalMemoryBytes)) },
          { setsValuesApart: true },
        )}
      </div>
    );
  } else if (props.kind === "disk" && props.host.latestDiskMountpoint) {
    const mount: string = props.host.latestDiskMountpoint;
    const line: HostCellLine = getHostCellLine({
      text: mount,
      language: translator.language,
      className: `${HOST_USAGE_SUBLABEL_CLASS_NAME} font-mono`,
    });
    sublabel = (
      <div
        dir={line.dir}
        className={line.className}
        title={mount}
        data-testid="host-usage-mount"
      >
        {mount}
      </div>
    );
  }

  return (
    <div
      className={HOST_USAGE_CELL_CLASS_NAME}
      data-testid={`host-usage-${props.kind}`}
      data-tone={usage.tone}
    >
      <div className="flex items-center gap-2">
        <div
          className="h-1.5 flex-1 rounded-full bg-gray-100"
          aria-hidden="true"
        >
          <div
            className={`h-1.5 rounded-full ${HOST_USAGE_BAR_CLASS_NAMES[usage.tone]}`}
            style={{ width: `${Math.max(usage.percent, 2)}%` }}
          />
        </div>
        <span className="w-10 text-end text-xs font-medium tabular-nums text-gray-700">
          {formatHostUsagePercent(usage.percent)}
        </span>
      </div>
      {sublabel}
    </div>
  );
};
