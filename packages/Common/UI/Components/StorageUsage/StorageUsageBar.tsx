import OneUptimeDate from "../../../Types/Date";
import {
  StorageUsage,
  StorageUsageLevel,
  formatStorageBytes,
  formatStorageUsedPercent,
  getStorageUsedPercentFigure,
} from "../../../Utils/Storage/StorageUsage";
import Pill from "../Pill/Pill";
import { PillTone } from "../Pill/PillTone";
import TranslatedSentence from "../TranslatedSentence/TranslatedSentence";
import TableEmptyValue from "../Table/TableEmptyValue";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * HOW FULL A STORE IS, DRAWN ONE WAY EVERYWHERE.
 *
 * A Kubernetes claim, a Proxmox storage, a VMware datastore, a Ceph OSD:
 * each page hands this the reading StorageUsage worked out, and it draws
 * how much is used as a bar and a percent, how much is free and how big the
 * store is, in the reader's digits. The bar is calm until the store is
 * nearly full (amber) and red once it is almost out of space, at the lines
 * the reading was given (StorageUsage's thresholds).
 *
 * Compact is a list's cell: the bar, the percent, and the amount used under
 * them. Detail is a card's body: the percent large, the bar, then Used,
 * Free and Capacity, a pill when it is nearly full, and when it was
 * measured. Inline is a dashboard widget's narrow cell: a short bar and the
 * percent on one line, with no width of its own to push the next column
 * aside. A store that reported nothing says so in words (noUsageText),
 * never with an empty bar or a 0% it never measured.
 */

export enum StorageUsageBarSize {
  Inline = "inline",
  Compact = "compact",
  Detail = "detail",
}

export interface ComponentProps {
  usage: StorageUsage | null;
  size?: StorageUsageBarSize | undefined;
  /*
   * How an amount is written: binary bytes ("36.2 GiB") unless the store
   * counts something else (a Ceph pool's objects, inodes).
   */
  formatAmount?: ((amount: number) => string) | undefined;
  /*
   * English, looked up where it is drawn: what a store that reported no
   * usage says in place of the bar. Left out, a compact cell draws the
   * quiet dash and a detail card "No usage reported."
   */
  noUsageText?: string | undefined;
  // Compact only: draw the amount used under the bar. Defaults to true.
  showAmount?: boolean | undefined;
  // Detail only: when the store last reported it.
  measuredAt?: Date | undefined;
  // What a test finds it by.
  dataTestId?: string | undefined;
}

export const STORAGE_USAGE_BAR_COLOR_CLASS_NAMES: Record<
  StorageUsageLevel,
  string
> = {
  // The calm green every storage bar in the product drew.
  [StorageUsageLevel.Normal]: "bg-emerald-500",
  [StorageUsageLevel.Warning]: "bg-amber-500",
  [StorageUsageLevel.Critical]: "bg-red-500",
};

// The words a detail card's pill says, and its tone.
export const STORAGE_USAGE_LEVEL_PILLS: Record<
  StorageUsageLevel,
  { text: string; tone: PillTone } | null
> = {
  [StorageUsageLevel.Normal]: null,
  [StorageUsageLevel.Warning]: { text: "Nearly full", tone: PillTone.Warning },
  [StorageUsageLevel.Critical]: {
    text: "Almost out of space",
    tone: PillTone.Danger,
  },
};

const UsageTrack: FunctionComponent<{
  usage: StorageUsage;
  heightClassName: string;
  label: string;
}> = (props: {
  usage: StorageUsage;
  heightClassName: string;
  label: string;
}): ReactElement => {
  const width: number = Math.min(Math.max(props.usage.usedPercent, 0), 100);

  return (
    <div
      role="meter"
      aria-label={props.label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={getStorageUsedPercentFigure(props.usage)}
      className={`w-full min-w-0 flex-1 overflow-hidden rounded-full bg-gray-200 ${props.heightClassName}`}
    >
      <div
        data-testid="storage-usage-fill"
        data-level={props.usage.level}
        className={`${props.heightClassName} rounded-full ${
          STORAGE_USAGE_BAR_COLOR_CLASS_NAMES[props.usage.level]
        }`}
        style={{ width: `${width}%` }}
      />
    </div>
  );
};

const StorageUsageBar: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const size: StorageUsageBarSize = props.size || StorageUsageBarSize.Compact;
  const formatAmount: (amount: number) => string =
    props.formatAmount ||
    ((amount: number): string => {
      return formatStorageBytes(amount, translator.language);
    });
  const testId: string = props.dataTestId || "storage-usage";

  if (!props.usage) {
    if (size === StorageUsageBarSize.Inline && !props.noUsageText) {
      return <TableEmptyValue isSmall={true} />;
    }

    if (size === StorageUsageBarSize.Compact && !props.noUsageText) {
      return <TableEmptyValue />;
    }

    return (
      <span
        data-testid={`${testId}-none`}
        className={
          size === StorageUsageBarSize.Detail
            ? "text-sm text-gray-600"
            : "text-xs text-gray-500"
        }
      >
        {translator.translateText(props.noUsageText || "No usage reported.")}
      </span>
    );
  }

  const usage: StorageUsage = props.usage;
  const percent: string = formatStorageUsedPercent(usage, translator.language);
  const meterLabel: string = translator.translateTemplate("{{percent}} used", {
    percent: percent,
  });

  if (size === StorageUsageBarSize.Inline) {
    return (
      <div data-testid={testId} className="flex min-w-0 items-center gap-1.5">
        <div className="flex w-12 flex-shrink-0">
          <UsageTrack
            usage={usage}
            heightClassName="h-1.5"
            label={meterLabel}
          />
        </div>
        <span className="whitespace-nowrap text-xs tabular-nums text-gray-500">
          {percent}
        </span>
      </div>
    );
  }

  if (size === StorageUsageBarSize.Compact) {
    return (
      <div data-testid={testId} className="min-w-[8rem]">
        <div className="flex items-center gap-2">
          <UsageTrack usage={usage} heightClassName="h-2" label={meterLabel} />
          <span className="whitespace-nowrap text-xs font-medium tabular-nums text-gray-700">
            {percent}
          </span>
        </div>
        {props.showAmount !== false ? (
          <div className="mt-0.5 text-xs text-gray-500">
            {/* "36.2 GiB", not "GiB 36.2", on a right-to-left page. */}
            <bdi>{formatAmount(usage.used)}</bdi>
          </div>
        ) : null}
      </div>
    );
  }

  const pill: { text: string; tone: PillTone } | null =
    STORAGE_USAGE_LEVEL_PILLS[usage.level];

  const figures: Array<{ key: string; title: string; amount: number }> = [
    { key: "used", title: "Used", amount: usage.used },
    // The room left, never the price (MeaningKeys).
    { key: "free", title: "Free (storage space)", amount: usage.free },
    { key: "capacity", title: "Capacity", amount: usage.capacity },
  ];

  return (
    <div data-testid={testId} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-gray-600">
          <TranslatedSentence
            template="{{percent}} used"
            slots={{
              percent: (
                <span className="text-2xl font-semibold tabular-nums text-gray-900">
                  {percent}
                </span>
              ),
            }}
          />
        </div>
        {pill ? (
          <Pill
            text={pill.text}
            tone={pill.tone}
            dataTestId={`${testId}-level`}
          />
        ) : null}
      </div>
      <UsageTrack usage={usage} heightClassName="h-3" label={meterLabel} />
      <dl className="grid grid-cols-3 gap-4">
        {figures.map(
          (figure: { key: string; title: string; amount: number }) => {
            return (
              <div key={figure.key} className="min-w-0">
                <dt className="text-xs font-medium text-gray-500">
                  {translator.translateText(figure.title)}
                </dt>
                <dd
                  data-testid={`${testId}-${figure.key}`}
                  className="mt-0.5 text-sm font-semibold tabular-nums text-gray-900"
                >
                  <bdi>{formatAmount(figure.amount)}</bdi>
                </dd>
              </div>
            );
          },
        )}
      </dl>
      {props.measuredAt ? (
        <p data-testid={`${testId}-measured`} className="text-xs text-gray-500">
          {translator.translateTemplate("Reported {{time}}", {
            time: OneUptimeDate.fromNow(props.measuredAt),
          })}
        </p>
      ) : null}
    </div>
  );
};

export default StorageUsageBar;
