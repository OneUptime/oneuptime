import React, { FunctionComponent, ReactElement } from "react";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import HyphenatedWords from "Common/UI/Components/HyphenatedWords/HyphenatedWords";
import Icon from "Common/UI/Components/Icon/Icon";
import { getDrawnLanguage } from "Common/UI/Components/SideMenu/SideMenuEntryState";
import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import AppLink from "../AppLink/AppLink";
import {
  TILE_TITLE_LONG_WORDS,
  getTileTitleWordsClassName,
} from "../TelemetryResource/TileTitleWords";

/*
 * The stat strip at the top of the Cloud Overview and the Costs pages: four
 * numbers a reader takes in first - how many accounts and resources, how
 * many need attention, what the month costs - each a click from its list.
 * The same tiles as App Platforms' strip (CloudFleetSummary), laid out the
 * same way: by the room the strip and each tile have, not the window's -
 * four in a row from 52rem of strip, two below, and a tile under 11rem
 * drops its icon, which only decorates.
 *
 * Titles and sublabels are English, drawn in the reader's language; a value
 * is drawn as given (a page formats its numbers and money in the reader's
 * own way). A tone colours a value that needs a look.
 */

export type CloudStatTone = "neutral" | "warning" | "danger" | "positive";

export interface CloudStatTile {
  key: string;
  title: string;
  description?: string | undefined;
  value: string;
  // Under the value: what it is of, how it compares.
  sublabel?: string | undefined;
  // A sublabel already in the reader's language (a sentence a page wrote).
  sublabelIsTranslated?: boolean | undefined;
  icon: IconProp;
  color: "emerald" | "blue" | "indigo" | "violet" | "amber" | "rose" | "sky";
  tone?: CloudStatTone | undefined;
  // The list the number is of.
  to?: Route | undefined;
  loading?: boolean | undefined;
}

const COLORS: Record<
  CloudStatTile["color"],
  { bg: string; ring: string; text: string }
> = {
  emerald: {
    bg: "bg-emerald-50",
    ring: "ring-emerald-200",
    text: "text-emerald-600",
  },
  blue: { bg: "bg-blue-50", ring: "ring-blue-200", text: "text-blue-600" },
  indigo: {
    bg: "bg-indigo-50",
    ring: "ring-indigo-200",
    text: "text-indigo-600",
  },
  violet: {
    bg: "bg-violet-50",
    ring: "ring-violet-200",
    text: "text-violet-600",
  },
  amber: { bg: "bg-amber-50", ring: "ring-amber-200", text: "text-amber-600" },
  rose: { bg: "bg-rose-50", ring: "ring-rose-200", text: "text-rose-600" },
  sky: { bg: "bg-sky-50", ring: "ring-sky-200", text: "text-sky-600" },
};

export const CLOUD_STAT_VALUE_TONE_CLASS_NAMES: Record<CloudStatTone, string> =
  {
    neutral: "text-gray-900",
    positive: "text-emerald-700",
    warning: "text-amber-700",
    danger: "text-red-700",
  };

export const CLOUD_STAT_STRIP_GRID_CLASS_NAME: string =
  "grid grid-cols-2 gap-4 [@container(min-width:52rem)]:grid-cols-4";

const Tile: FunctionComponent<{ tile: CloudStatTile }> = (props: {
  tile: CloudStatTile;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const tile: CloudStatTile = props.tile;
  const style: { bg: string; ring: string; text: string } = COLORS[tile.color];
  const title: string = translator.translateText(tile.title) || tile.title;
  const titleLanguage: string | undefined = getDrawnLanguage({
    english: tile.title,
    drawn: title,
    language: translator.language,
  });
  const sublabel: string = tile.sublabel
    ? tile.sublabelIsTranslated
      ? tile.sublabel
      : translator.translateText(tile.sublabel) || tile.sublabel
    : "";

  const body: ReactElement = (
    <div
      data-testid="cloud-stat-tile"
      data-key={tile.key}
      data-tone={tile.tone || "neutral"}
      className={`h-full rounded-xl border border-gray-200 bg-white p-4 shadow-sm [container-type:inline-size] ${
        tile.to
          ? "transition-colors hover:border-indigo-300 hover:shadow focus-within:ring-2 focus-within:ring-indigo-500"
          : ""
      }`}
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          <span
            className={`min-w-0 text-xs font-medium uppercase tracking-wider text-gray-500 ${getTileTitleWordsClassName(
              { text: title, lang: titleLanguage },
            )}`}
            lang={titleLanguage}
          >
            <HyphenatedWords
              text={title}
              lang={titleLanguage}
              rule={TILE_TITLE_LONG_WORDS}
            />
          </span>
          {tile.description ? (
            <InfoTooltip label={tile.title} text={tile.description} />
          ) : (
            <></>
          )}
        </div>
        <div
          aria-hidden="true"
          className={`flex h-7 w-7 flex-none items-center justify-center rounded-md ${style.bg} ring-1 ring-inset ${style.ring} [@container(max-width:10.99rem)]:hidden`}
        >
          <Icon icon={tile.icon} className={`h-3.5 w-3.5 ${style.text}`} />
        </div>
      </div>
      {tile.loading ? (
        <div
          data-testid="cloud-stat-tile-loading"
          className="h-6 w-20 animate-pulse rounded bg-gray-100"
        />
      ) : (
        <div
          data-testid="cloud-stat-tile-value"
          className={`break-words text-2xl font-semibold leading-tight ${
            CLOUD_STAT_VALUE_TONE_CLASS_NAMES[tile.tone || "neutral"]
          }`}
        >
          <bdi>{tile.value}</bdi>
        </div>
      )}
      {sublabel ? (
        <div
          data-testid="cloud-stat-tile-sublabel"
          className="mt-1 break-words text-xs text-gray-500"
        >
          {sublabel}
        </div>
      ) : (
        <></>
      )}
    </div>
  );

  if (!tile.to) {
    return body;
  }

  return (
    <AppLink
      to={tile.to}
      className="block h-full rounded-xl focus:outline-none"
      dataTestId="cloud-stat-tile-link"
    >
      {body}
    </AppLink>
  );
};

export interface ComponentProps {
  tiles: Array<CloudStatTile>;
  testId?: string | undefined;
}

const CloudStatStrip: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div
      data-testid={props.testId || "cloud-stat-strip"}
      className="mb-6 [container-type:inline-size]"
    >
      <div className={CLOUD_STAT_STRIP_GRID_CLASS_NAME}>
        {props.tiles.map((tile: CloudStatTile): ReactElement => {
          return <Tile key={tile.key} tile={tile} />;
        })}
      </div>
    </div>
  );
};

export default CloudStatStrip;
