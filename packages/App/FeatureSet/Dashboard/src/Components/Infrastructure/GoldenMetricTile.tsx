import React, { FunctionComponent, ReactElement } from "react";
import BreakableName from "Common/UI/Components/BreakableName/BreakableName";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import WordsWithInfoTooltip from "Common/UI/Components/Tooltip/WordsWithInfoTooltip";
import { getDrawnLanguage } from "Common/UI/Components/SideMenu/SideMenuEntryState";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { TILE_TITLE_LONG_WORDS } from "../TelemetryResource/TileTitleWords";

/*
 * Product-neutral golden-metric hero tile (extracted from the
 * Kubernetes cluster overview): an icon-badged stat card with an
 * optional threshold-colored progress bar. Used by the Kubernetes,
 * Proxmox, and Ceph overview pages.
 *
 * A page hands the tile its title, and the line under its value, as English
 * literals ("Capacity Used", "heartbeat presence"), and the tile draws them
 * in the reader's language, as the telemetry overviews' tiles do
 * (ResourceOverview) and the shared components do with the English they are
 * given (Locales/README.md, stage 2). A name the locale has no words for - a
 * metric someone named - and a line a page worded itself read as given.
 */

export type GoldenMetricTileColor =
  | "blue"
  | "violet"
  | "amber"
  | "emerald"
  | "slate"
  | "sky";

export interface GoldenMetricTileProps {
  // The metric's name, as an English literal: the tile translates it.
  title: string;
  icon: IconProp;
  iconColor: GoldenMetricTileColor;
  value: string;
  /*
   * The line under the value: English the tile translates ("total across
   * nodes"), or a line the page worded itself, which reads as given.
   */
  sublabel?: string | undefined;
  /*
   * The sublabel is a value as the resource wrote it - a mount point, a
   * device - rather than a sentence: it reads in its own direction, so
   * /var/lib/postgresql keeps its leading slash on a Persian page, and a
   * long one breaks after its slashes rather than running out of the tile.
   */
  isSublabelAsWritten?: boolean | undefined;
  percent?: number | null | undefined;
  thresholds?: { warn: number; danger: number } | undefined;
  /*
   * `higherIsBetter` flips the threshold comparison so that 100%
   * availability reads green and 80% reads red, instead of the
   * default "higher = worse" used for CPU / memory / filesystem
   * saturation. When true, `thresholds.warn` is the floor below
   * which we tint amber and `thresholds.danger` is the floor below
   * which we tint red. Defaults to false to preserve existing tile
   * behavior.
   */
  higherIsBetter?: boolean | undefined;
  /*
   * The bar's colour as the product's rules say it, when they read more
   * than the number: a vCenter's 1/3 hosts effective is calm while the two
   * others are in standby, and red while one is not responding. Overrides
   * `thresholds`.
   */
  tone?: GoldenMetricTileTone | undefined;
  // What the number means, shown in an (i) tooltip beside the title.
  description?: string | undefined;
}

export type GoldenMetricTileTone = "positive" | "warning" | "danger";

const TONE_BAR_CLASS_NAMES: Record<GoldenMetricTileTone, string> = {
  positive: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-red-500",
};

/*
 * Exported so overview pages can reuse the same palette for sibling
 * cards (e.g. the golden chart headers next to the tiles).
 */
export const tileColorClasses: Record<
  GoldenMetricTileColor,
  { bg: string; ring: string; text: string }
> = {
  blue: { bg: "bg-blue-50", ring: "ring-blue-200", text: "text-blue-600" },
  violet: {
    bg: "bg-violet-50",
    ring: "ring-violet-200",
    text: "text-violet-600",
  },
  amber: { bg: "bg-amber-50", ring: "ring-amber-200", text: "text-amber-600" },
  emerald: {
    bg: "bg-emerald-50",
    ring: "ring-emerald-200",
    text: "text-emerald-600",
  },
  slate: { bg: "bg-slate-50", ring: "ring-slate-200", text: "text-slate-600" },
  sky: { bg: "bg-sky-50", ring: "ring-sky-200", text: "text-sky-600" },
};

const GoldenMetricTile: FunctionComponent<GoldenMetricTileProps> = (
  props: GoldenMetricTileProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const colors: { bg: string; ring: string; text: string } =
    tileColorClasses[props.iconColor];

  /*
   * The title in the reader's language. A translated one says its language
   * (lang) and breaks a word too long for a narrow tile's line where that
   * language hyphenates it (TileTitleWords) - a German
   * "KNOTENVERFÜGBARKEIT" in a phone's two columns - instead of running
   * under the icon. The (i) takes the English and words its own label.
   */
  const title: string = translator.translateText(props.title) || props.title;
  const titleLanguage: string | undefined = getDrawnLanguage({
    english: props.title,
    drawn: title,
    language: translator.language,
  });

  /*
   * The line under the value, too, unless it is a value as the resource
   * wrote it (a mount point, a device), which is never looked up.
   */
  const sublabel: string | undefined =
    props.sublabel && !props.isSublabelAsWritten
      ? translator.translateText(props.sublabel) || props.sublabel
      : props.sublabel;
  const sublabelLanguage: string | undefined = props.isSublabelAsWritten
    ? undefined
    : getDrawnLanguage({
        english: props.sublabel,
        drawn: sublabel,
        language: translator.language,
      });

  const barColor: string = (() => {
    if (props.percent === null || props.percent === undefined) {
      return "bg-gray-300";
    }
    if (props.tone) {
      return TONE_BAR_CLASS_NAMES[props.tone];
    }
    const t: { warn: number; danger: number } = props.thresholds || {
      warn: 70,
      danger: 90,
    };
    if (props.higherIsBetter) {
      if (props.percent < t.danger) {
        return "bg-red-500";
      }
      if (props.percent < t.warn) {
        return "bg-amber-500";
      }
      return "bg-emerald-500";
    }
    if (props.percent >= t.danger) {
      return "bg-red-500";
    }
    if (props.percent >= t.warn) {
      return "bg-amber-500";
    }
    return "bg-emerald-500";
  })();

  const safePercent: number =
    props.percent === null || props.percent === undefined
      ? 0
      : Math.min(100, Math.max(0, props.percent));

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        {/*
         * A title longer than its box - one German word, "KNOTENVERFÜGBARKEIT"
         * - breaks inside it (hyphenated where the reader's language allows)
         * instead of running under the icon, and its (i) follows its last
         * word on whichever line it ends (issue #7348).
         */}
        <div className="flex min-w-0">
          <WordsWithInfoTooltip
            className="min-w-0 text-xs font-medium text-gray-500 uppercase tracking-wider"
            dataTestId="golden-metric-tile-title"
            text={title}
            lang={titleLanguage}
            rule={TILE_TITLE_LONG_WORDS}
            label={props.title}
            description={props.description}
          />
        </div>
        <div
          className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md ${colors.bg} ring-1 ring-inset ${colors.ring}`}
        >
          <Icon icon={props.icon} className={`h-3.5 w-3.5 ${colors.text}`} />
        </div>
      </div>
      {/*
       * The figure set apart, so a size reads as the Details cards and the
       * tables write theirs on a page read from the right: "۲۵ GiB", never
       * "GiB ۲۵" (#7106). A percent or a count draws as before.
       */}
      <div
        className="text-2xl font-semibold text-gray-900 leading-none"
        data-testid="golden-metric-tile-value"
      >
        <bdi>{props.value}</bdi>
      </div>
      {sublabel ? (
        <div
          className="mt-1 text-xs text-gray-500"
          data-testid="golden-metric-tile-sublabel"
          lang={sublabelLanguage}
        >
          {props.isSublabelAsWritten ? (
            <bdi>
              <BreakableName text={sublabel} />
            </bdi>
          ) : (
            sublabel
          )}
        </div>
      ) : (
        <div className="mt-1 text-xs text-gray-400">&nbsp;</div>
      )}
      {props.percent !== undefined && props.percent !== null && (
        <div className="mt-3 w-full bg-gray-100 rounded-full h-1.5">
          <div
            className={`${barColor} h-1.5 rounded-full transition-all`}
            style={{ width: `${safePercent}%` }}
          />
        </div>
      )}
    </div>
  );
};

export default GoldenMetricTile;
