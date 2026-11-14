import React, { Fragment, FunctionComponent, ReactElement } from "react";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Card from "Common/UI/Components/Card/Card";
import { useCardRuledListClassName } from "Common/UI/Components/Card/CardSurface";
import BreakableName from "Common/UI/Components/BreakableName/BreakableName";
import DetailRecordLine from "Common/UI/Components/Detail/DetailRecordLine";
import Label from "Common/Models/DatabaseModels/Label";
import OneUptimeDate from "Common/Types/Date";
import {
  getTextReadingDirectionByMostLetters,
  RIGHT_TO_LEFT,
} from "Common/Types/ReadingDirection";
import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";
import { getDrawnLanguage } from "Common/UI/Components/SideMenu/SideMenuEntryState";
import {
  getSentenceParts,
  SentencePart,
  translateNamedAction,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import AppLink from "../AppLink/AppLink";
import EditInSettingsLink from "./EditInSettingsLink";
import { TILE_TITLE_LONG_WORDS } from "./TileTitleWords";
import WordsWithInfoTooltip from "Common/UI/Components/Tooltip/WordsWithInfoTooltip";
import ResourceHeroDescription from "./ResourceHeroDescription";
import ResourceLabelsCard from "./ResourceLabelsCard";
import {
  RESOURCE_HERO_CONTROLS_CLASS_NAME,
  RESOURCE_HERO_IDENTITY_CLASS_NAME,
  RESOURCE_HERO_TOP_ROW_CLASS_NAME,
} from "./ResourceHeroLayout";
import { getReportedResourceOverviewDetailRows } from "./ResourceOverviewDetails";
import { ResourceOverviewHealth } from "./ResourceOverviewHealth";

export interface ResourceOverviewChip {
  icon: IconProp;
  label: string;
}

/*
 * One fact in the Details card. A row whose value is empty is not drawn
 * (ResourceOverviewDetails), so a page lists every fact it can show and
 * the card says only the ones the resource reported. The label is the
 * English the locale files hold: the card draws it in the reader's
 * language.
 */
export interface ResourceOverviewDetailRow {
  label: string;
  value: string | undefined;
  /*
   * How the value is drawn when it is more than text - an agent version with
   * its upgrade sign (AgentVersion). Drawn only while `value` is set: a row
   * without a value is left out, element and all.
   */
  element?: ReactElement | undefined;
  mono?: boolean | undefined;
}

export type ResourceOverviewTileColor =
  | "blue"
  | "violet"
  | "amber"
  | "emerald"
  | "slate"
  | "sky"
  | "rose";

export interface ResourceOverviewTile {
  /*
   * The metric's name, and the line under its value, as English literals:
   * the tile draws both in the reader's language (a name or a line the
   * locale has no words for, or one a page worded itself, reads as given).
   */
  title: string;
  value: string;
  /*
   * Words drawn in place of the value when there is no number to show and
   * the page can say what would give one ("Needs consumer traces"): an
   * English literal the tile draws in the reader's language, smaller and
   * muted, so it never reads as a figure.
   */
  valueNote?: string | undefined;
  icon: IconProp;
  iconColor: ResourceOverviewTileColor;
  loading?: boolean | undefined;
  sublabel?: string | undefined;
  // 0-100 — renders a saturation bar under the value when provided.
  percent?: number | null | undefined;
  thresholds?: { warn: number; danger: number } | undefined;
  higherIsBetter?: boolean | undefined;
  to?: Route | undefined;
  /*
   * What the number means, in plain words - shown in an (i) tooltip beside
   * the title. "p95" or "error rate" is jargon to most of the people who
   * land on an overview.
   */
  description?: string | undefined;
}

// The status pill's colour: green, amber or gray.
/*
 * "danger" is a resource broken by its own rules (a cloud resource failing
 * its status checks): the red the lists' Unhealthy pill draws.
 */
export type ResourceOverviewStatusTone =
  | "positive"
  | "warning"
  | "danger"
  | "neutral";

/*
 * The resource's health, beside its status pill, by its product's own rules
 * (a database's: the lines of its engine's recommended alerts) - the pill
 * every infrastructure hero draws, for the Overviews drawn here.
 */
export type { ResourceOverviewHealth };

export interface ResourceOverviewProps {
  icon: IconProp;
  title: string;
  identifier: string;
  /*
   * What the identifier is, as the line under the title names it: an
   * attribute's own name ("service.name") drawn as written, or an English
   * word ("type", "account") the line draws in the reader's language.
   */
  identifierLabel: string;
  status: string | undefined;
  /*
   * The pill's words and colour when "Connected" / "Disconnected" (read off
   * `status`) would say the wrong thing — a Database's pill is about when
   * ANY source last saw it, and must not echo its engine-metrics status.
   * Unset, the pill is exactly what `status` has always produced.
   */
  statusLabel?: string | undefined;
  statusTone?: ResourceOverviewStatusTone | undefined;
  /*
   * What the pill means, as its hover text: English the hover says in the
   * reader's language, or words a page already put in it.
   */
  statusDescription?: string | undefined;
  // Its health beside the status pill; left out, no health pill.
  health?: ResourceOverviewHealth | undefined;
  lastSeenAt: Date | undefined;
  /*
   * Drawn straight under the hero, beside the status pill it explains: the
   * "how do I connect this?" card (ResourceConnectionGuideCard), which draws
   * nothing once the resource is connected - or, for a resource read from
   * its cloud, what needs attention on it (NeedsAttentionCard), before any
   * number, as a host's and a cluster's Overview lead with theirs.
   */
  connectionGuide?: ReactElement | undefined;
  /*
   * What on the resource needs someone (NeedsAttentionCard), under the hero
   * and before any number, as on every infrastructure Overview.
   */
  needsAttention?: ReactElement | undefined;
  /*
   * What the resource is, in its owner's words (its Settings): drawn under
   * its name in the hero, where it is read with the name at every width. It
   * used to be the Details card's own line, at the foot of the page, which
   * a card hides on a phone.
   */
  description?: string | undefined;
  chips: Array<ResourceOverviewChip>;
  // Domain-relevant golden metric tiles, computed by the page.
  tiles: Array<ResourceOverviewTile>;
  tilesLoading?: boolean | undefined;
  // Hero top-right controls (e.g. a time-range picker).
  controls?: ReactElement | undefined;
  // Trend charts rendered between the tiles and the details card.
  charts?: ReactElement | undefined;
  /*
   * There are no links to the resource's telemetry pages here: the side
   * menu beside the Overview already lists every one of them (#4979 and
   * its follow-up of #4980 took the "Explore telemetry" card off every
   * Overview).
   */
  detailRows: Array<ResourceOverviewDetailRow>;
  /*
   * What the Details card's rows are, under its title, in the page's own
   * words: every page says where its rows come from. A service's, a
   * serverless function's and a cloud environment's are the resource
   * attributes its telemetry reported (RESOURCE_OVERVIEW_DETAILS_DESCRIPTION);
   * a database's and a queue's come from its spans, the broker and its
   * agent, a RUM application's from its SDK and its recordings, a cloud
   * account's and a cloud resource's from their cloud. It used to default to
   * the resource attributes' line, which a database's and a queue's card
   * then said about rows that are not (#5298's UI review). Never the
   * resource's own description: that is in the hero, under its name.
   */
  detailsDescription: string;
  /*
   * The resource's own record id: the small ID line every details card ends
   * with (DetailRecordLine - "ID", its first characters, a copy button), in
   * place of a row that spelled all 36 characters out first.
   */
  recordId?: string | undefined;
  /*
   * Its labels, for a phone: from 640px up the page's header lists them
   * beside the page's title (ModelPage), and the card under the Details
   * would only say them a second time.
   */
  labels?: Array<Label> | undefined;
  /*
   * The resource's Settings page, where its name, description and labels
   * are edited (ResourceDetailsCard): the Details card links there.
   */
  settingsRoute?: Route | undefined;
}

/*
 * What a Details card's rows are when they are the resource attributes its
 * telemetry reported (English): a service's, a serverless function's, a
 * cloud environment's.
 */
export const RESOURCE_OVERVIEW_DETAILS_DESCRIPTION: string = translationKey(
  "Metadata captured from OpenTelemetry resource attributes.",
);

/*
 * The hero's identifier line, "type: Elastic Load Balancer", is one sentence
 * in the reader's language, so each language writes its label's colon its
 * own way: French spaces it ("type : ..."), Chinese writes a full-width one
 * with no space after it.
 */
export const RESOURCE_OVERVIEW_IDENTIFIER_SENTENCE: string = translationKey(
  "{{label}}: {{identifier}}",
);

// The words of the identifier line around the identifier, as drawn.
export interface ResourceOverviewIdentifierWords {
  // The label and its colon, and the space after it when the language puts one there.
  before: string;
  // What the language writes after the identifier: "" in every language today.
  after: string;
}

/*
 * The identifier line's words before and after the identifier, in the
 * translator's language (a sentence that lost the identifier reads in
 * English). The label is the reader's word ("Typ") or an attribute's name
 * as written ("service.name"), set apart where it could move the words
 * around it in a sentence read right to left.
 */
export function getResourceOverviewIdentifierWords(
  translator: Translator,
  label: string,
): ResourceOverviewIdentifierWords {
  const parts: Array<SentencePart> = getSentenceParts({
    translator,
    template: RESOURCE_OVERVIEW_IDENTIFIER_SENTENCE,
    slots: ["identifier"],
    values: { label },
  });
  const slotAt: number = parts.findIndex((part: SentencePart): boolean => {
    return part.kind === "slot";
  });

  if (slotAt < 0) {
    return { before: `${label}: `, after: "" };
  }

  const textOf: (pieces: Array<SentencePart>) => string = (
    pieces: Array<SentencePart>,
  ): string => {
    return pieces
      .map((part: SentencePart): string => {
        return part.kind === "text" ? part.text : "";
      })
      .join("");
  };

  return {
    before: textOf(parts.slice(0, slotAt)),
    after: textOf(parts.slice(slotAt + 1)),
  };
}

// The identifier line's words around the identifier: kept whole, with the spaces the language writes.
export const RESOURCE_OVERVIEW_IDENTIFIER_WORDS_CLASS_NAME: string =
  "flex-none whitespace-pre";

/*
 * How the identifier line draws its words around the identifier. In
 * monospace, as the whole line always was - a type, an account or an
 * attribute's name ("service.name") reads like the code it names - unless
 * the words read right to left: a monospace font draws no Persian letter
 * of its own, and the one it borrowed set the label's joined letters in
 * fixed-width cells beside the page's Persian (#6149's review). Those words
 * take the page's font; the identifier stays in monospace. An attribute's
 * name on a Persian page is still code, in monospace.
 */
export function getResourceOverviewIdentifierWordsClassName(
  words: string,
): string {
  return getTextReadingDirectionByMostLetters(words) === RIGHT_TO_LEFT
    ? RESOURCE_OVERVIEW_IDENTIFIER_WORDS_CLASS_NAME
    : `${RESOURCE_OVERVIEW_IDENTIFIER_WORDS_CLASS_NAME} font-mono`;
}

const tileColorClasses: Record<
  ResourceOverviewTileColor,
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
  rose: { bg: "bg-rose-50", ring: "ring-rose-200", text: "text-rose-600" },
};

/*
 * A Details value: a long one wraps inside its row - a name after its own
 * dots and slashes first (BreakableName: "com.acme.inventory." /
 * "reservations"), anywhere only where a part is still too long for the
 * line, and a sentence between its words. It used to break at whatever
 * letter filled the line (break-all): "switched off for th" / "is project".
 */
export const RESOURCE_OVERVIEW_DETAIL_VALUE_CLASS_NAME: string =
  "mt-1 min-w-0 text-sm text-gray-900 [overflow-wrap:anywhere] sm:col-span-2 sm:mt-0";

/*
 * The golden metric tiles: four to a row only where the overview itself is
 * wide enough for four, by a container query rather than the screen's
 * width. Beside a record page's side menu a 1024px window leaves the
 * overview some 680px, four tiles of 158px: a German "Verbraucht" broke
 * mid-word and every line under a value was cut. Two to a row until the
 * overview is 52rem wide (four tiles of some 200px), as a 1280px window's
 * is beside the menu.
 */
export const RESOURCE_OVERVIEW_TILES_FRAME_CLASS_NAME: string =
  "mb-6 [container-type:inline-size]";
export const RESOURCE_OVERVIEW_TILES_GRID_CLASS_NAME: string =
  "grid grid-cols-2 gap-4 [@container(min-width:52rem)]:grid-cols-4";

const STATUS_TONE_CLASSES: Record<
  ResourceOverviewStatusTone,
  { badge: string; dot: string }
> = {
  positive: {
    badge: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    dot: "bg-emerald-500",
  },
  warning: {
    badge: "bg-amber-50 text-amber-700 ring-amber-200",
    dot: "bg-amber-500",
  },
  danger: {
    badge: "bg-red-50 text-red-700 ring-red-200",
    dot: "bg-red-500",
  },
  neutral: {
    badge: "bg-gray-50 text-gray-700 ring-gray-200",
    dot: "bg-gray-400",
  },
};

const HEALTH_TONE_CLASSES: Record<
  ResourceOverviewHealth["tone"],
  { badge: string; dot: string }
> = {
  positive: STATUS_TONE_CLASSES.positive,
  warning: STATUS_TONE_CLASSES.warning,
  neutral: STATUS_TONE_CLASSES.neutral,
  danger: {
    badge: "bg-red-50 text-red-700 ring-red-200",
    dot: "bg-red-500",
  },
};

const GoldenMetricTile: FunctionComponent<ResourceOverviewTile> = (
  props: ResourceOverviewTile,
): ReactElement => {
  const translator: Translator = useTranslator();
  const colors: { bg: string; ring: string; text: string } =
    tileColorClasses[props.iconColor];
  /*
   * A page hands the tile its English name ("Page loads", "Queries"), and the
   * tile draws it in the reader's language, as the shared components do with
   * the English they are given (Locales/README.md, stage 2). The link laid
   * over a linked tile and the line read while it loads say the same name in
   * the same language; the (i) takes the English and words its own label.
   */
  const title: string = translator.translateText(props.title) || props.title;
  /*
   * A translated name can hold a word longer than a narrow tile's line - a
   * Portuguese "Carregamentos" in a phone's two columns. It breaks where
   * its language hyphenates it, the title saying which language it is in
   * (TileTitleWords), and never runs under the icon, which keeps its size.
   */
  const titleLanguage: string | undefined = getDrawnLanguage({
    english: props.title,
    drawn: title,
    language: translator.language,
  });
  /*
   * The line under the value, too: a page hands it in English ("selected
   * range", "spans, selected range") or already worded ("median 0.9 s"), and
   * the tile draws it as the locale words it, so a title in the reader's
   * language never sits over an English line the locale has words for.
   */
  const sublabel: string | undefined = props.sublabel
    ? translator.translateText(props.sublabel) || props.sublabel
    : undefined;
  const sublabelLanguage: string | undefined = getDrawnLanguage({
    english: props.sublabel,
    drawn: sublabel,
    language: translator.language,
  });
  const valueNote: string | undefined = props.valueNote
    ? translator.translateText(props.valueNote) || props.valueNote
    : undefined;
  const valueNoteLanguage: string | undefined = getDrawnLanguage({
    english: props.valueNote,
    drawn: valueNote,
    language: translator.language,
  });

  const barColor: string = (() => {
    if (props.percent === null || props.percent === undefined) {
      return "bg-gray-300";
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
    <div
      className="relative h-full rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-all hover:border-indigo-300 hover:shadow"
      aria-busy={props.loading ? "true" : "false"}
    >
      {/*
       * A linked tile is one big click target, but the (i) inside it must not
       * navigate - and a button may not sit inside an anchor. So the link is
       * laid over the card rather than wrapped around it, and the (i) is
       * lifted above the overlay.
       */}
      {props.to ? (
        <AppLink
          to={props.to}
          className="absolute inset-0 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          <span className="sr-only">
            {translateNamedAction(translator, {
              template: "View {{itemName}}",
              itemName: props.title,
            })}
          </span>
        </AppLink>
      ) : (
        <></>
      )}
      <div className="flex items-center justify-between mb-3">
        {/*
         * The (i) after the title's last word, on whichever line it ends
         * (issue #7348), lifted above the link laid over a linked tile.
         */}
        <div className="min-w-0">
          <WordsWithInfoTooltip
            className="min-w-0 text-xs font-medium text-gray-500 uppercase tracking-wider"
            text={title}
            lang={titleLanguage}
            rule={TILE_TITLE_LONG_WORDS}
            label={props.title}
            description={props.description}
            infoClassName="relative z-10"
          />
        </div>
        <div
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${colors.bg} ring-1 ring-inset ${colors.ring}`}
        >
          <Icon icon={props.icon} className={`h-3.5 w-3.5 ${colors.text}`} />
        </div>
      </div>
      {props.loading ? (
        <div role="status" aria-live="polite">
          <span className="sr-only">
            {translateNamedAction(translator, {
              template: "Loading {{itemsName}}",
              itemName: props.title,
            })}
          </span>
          <div
            className="h-6 w-24 rounded bg-gray-100 motion-safe:animate-pulse"
            aria-hidden="true"
          />
          <div
            className="mt-2 h-3 w-32 max-w-full rounded bg-gray-100 motion-safe:animate-pulse"
            aria-hidden="true"
          />
          {props.percent !== undefined || props.thresholds ? (
            <div
              className="mt-3 h-1.5 w-full rounded-full bg-gray-100 motion-safe:animate-pulse"
              aria-hidden="true"
            />
          ) : (
            <></>
          )}
        </div>
      ) : (
        <Fragment>
          {valueNote ? (
            /*
             * As tall as a value's line, so a tile with a note lines up with
             * its neighbours' sublabels.
             */
            <div
              className="flex min-h-6 items-end text-sm font-medium leading-tight text-gray-500"
              lang={valueNoteLanguage}
              data-testid="resource-overview-tile-value-note"
            >
              {valueNote}
            </div>
          ) : (
            <div className="text-2xl font-semibold text-gray-900 leading-none">
              {props.value}
            </div>
          )}
          {sublabel ? (
            /*
             * Up to two lines, never cut on one: a phone's two columns cut
             * "broker metrics; 18 throttled" before its number, and a tap
             * has no hover to read the rest.
             */
            <div
              className="mt-1 line-clamp-2 break-words text-xs text-gray-500"
              lang={sublabelLanguage}
            >
              {sublabel}
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
        </Fragment>
      )}
    </div>
  );
};

const ResourceOverview: FunctionComponent<ResourceOverviewProps> = (
  props: ResourceOverviewProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  /*
   * The Details rows: ruled from edge to edge of their card, their words
   * where the card's title starts, at every width.
   */
  const ruledListClassName: string = useCardRuledListClassName();
  // Only the facts the resource reported; an empty one is not a row.
  const reportedDetailRows: Array<ResourceOverviewDetailRow> =
    getReportedResourceOverviewDetailRows(props.detailRows);
  const status: string = (props.status || "").toLowerCase();
  const isConnected: boolean = status === "connected" || status === "active";
  /*
   * One whole sentence either way, in the reader's language: "Last seen" and
   * a German time read "Zuletzt gesehen vor 5 Minuten", never "Last seen vor
   * 5 Minuten", and a resource that never reported reads "Never seen".
   */
  const lastSeenText: string = props.lastSeenAt
    ? translator.translateTemplate("Last seen {{time}}", {
        time: OneUptimeDate.fromNow(props.lastSeenAt),
      })
    : translator.translateText("Never seen") || "Never seen";

  const statusTone: ResourceOverviewStatusTone =
    props.statusTone || (isConnected ? "positive" : "warning");
  const statusBadgeClass: string = STATUS_TONE_CLASSES[statusTone].badge;
  const statusDotClass: string = STATUS_TONE_CLASSES[statusTone].dot;
  /*
   * The pill's word: one the product words ("Connected", "Seen recently",
   * "Reporting") in the reader's language, one a page worded itself as
   * given.
   */
  const givenStatusLabel: string =
    props.statusLabel ||
    (isConnected
      ? translationKey("Connected")
      : translationKey("Disconnected"));
  const statusLabel: string =
    translator.translateText(givenStatusLabel) || givenStatusLabel;
  // The pill's hover, in the reader's language too.
  const statusDescription: string | undefined = props.statusDescription
    ? translator.translateText(props.statusDescription) ||
      props.statusDescription
    : undefined;
  /*
   * The identifier's label: a word ("type", "account") in the reader's
   * language, an attribute's name ("service.name") as written - the
   * locale has no word for it.
   */
  const identifierLabel: string =
    translator.translateText(props.identifierLabel) || props.identifierLabel;
  const identifierWords: ResourceOverviewIdentifierWords =
    getResourceOverviewIdentifierWords(translator, identifierLabel);

  return (
    <Fragment>
      {/* Hero */}
      <div className="relative mb-6 rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="absolute inset-0 overflow-hidden rounded-xl pointer-events-none">
          <div
            className="absolute inset-x-0 top-0 h-24 bg-gradient-to-br from-indigo-50 via-white to-white"
            aria-hidden="true"
          />
        </div>
        <div className="relative px-6 py-5">
          {/*
           * Laid out as every resource hero is (ResourceHeroLayout): the
           * name keeps its room and the controls (time range, refresh) give
           * way - beside the title while the rest of the row holds them,
           * under it, at the row's end, when it does not. Its own basis
           * (24rem) kept the controls beside a long name at a laptop's
           * width and cut the name, its identifier and its description
           * short there, where a host's or a cluster's hero showed them
           * whole (#5298's UI review). Before that a fixed md breakpoint
           * put the title at 0px wide at 768 (side menu shown), 109px at
           * 900 and 181px at 1024.
           */}
          <div
            data-testid="resource-overview-header-row"
            className={RESOURCE_HERO_TOP_ROW_CLASS_NAME}
          >
            <div
              data-testid="resource-overview-title-block"
              className={RESOURCE_HERO_IDENTITY_CLASS_NAME}
            >
              <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-white ring-1 ring-inset ring-indigo-200 shadow-sm">
                <Icon icon={props.icon} className="h-6 w-6 text-indigo-600" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-xl font-semibold text-gray-900 truncate">
                    {props.title}
                  </h1>
                  <span
                    data-testid="resource-overview-status"
                    title={statusDescription}
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${statusBadgeClass}`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${statusDotClass}`}
                    />
                    {statusLabel}
                  </span>
                  {props.health ? (
                    <span className="inline-flex items-center gap-1">
                      <span
                        data-testid="resource-overview-health"
                        data-health={props.health.state}
                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${
                          HEALTH_TONE_CLASSES[props.health.tone].badge
                        }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            HEALTH_TONE_CLASSES[props.health.tone].dot
                          }`}
                        />
                        {translator.translateText(props.health.label) ||
                          props.health.label}
                      </span>
                      {props.health.description ? (
                        <InfoTooltip
                          label={props.health.descriptionLabel || "Health"}
                          text={props.health.description}
                        />
                      ) : (
                        <></>
                      )}
                    </span>
                  ) : (
                    <></>
                  )}
                </div>
                <ResourceHeroDescription text={props.description} />
                {props.identifier ? (
                  /*
                   * The identifier is set apart from its label, so a type
                   * or a name in Latin letters keeps its brackets and its
                   * place on a page read right to left. Too long for the
                   * line, it is cut at its own end, in its own direction:
                   * cut with the line, a Persian page lost its start
                   * ("…d Balancer (ALB, NLB, GWLB)" on a phone).
                   *
                   * Each piece is set in monospace itself, as the whole
                   * line always was: the page gives every element Inter
                   * (index.ejs's universal rule), so a child would not
                   * keep the line's font. Words that read right to left
                   * - a Persian label - keep the page's font instead
                   * (getResourceOverviewIdentifierWordsClassName).
                   *
                   * The label and its colon are the reader's sentence
                   * ("{{label}}: {{identifier}}"), so each language writes
                   * the colon its own way - French "type : ", Chinese
                   * "类型：" - and the space after it, kept as written
                   * (whitespace-pre), is the gap: none where the language
                   * puts none.
                   */
                  <div
                    data-testid="resource-overview-identifier"
                    className="mt-1 flex min-w-0 items-baseline font-mono text-sm text-gray-500"
                  >
                    {identifierWords.before ? (
                      <span
                        data-testid="resource-overview-identifier-label"
                        className={getResourceOverviewIdentifierWordsClassName(
                          identifierWords.before,
                        )}
                      >
                        {identifierWords.before}
                      </span>
                    ) : (
                      <></>
                    )}
                    <bdi
                      dir="auto"
                      data-testid="resource-overview-identifier-value"
                      className="min-w-0 truncate font-mono"
                    >
                      {props.identifier}
                    </bdi>
                    {identifierWords.after ? (
                      <span
                        className={getResourceOverviewIdentifierWordsClassName(
                          identifierWords.after,
                        )}
                      >
                        {identifierWords.after}
                      </span>
                    ) : (
                      <></>
                    )}
                  </div>
                ) : (
                  <></>
                )}
                <div className="mt-1 text-xs text-gray-400">{lastSeenText}</div>
              </div>
            </div>
            {props.controls ? (
              <div
                data-testid="resource-overview-controls"
                className={RESOURCE_HERO_CONTROLS_CLASS_NAME}
              >
                {props.controls}
              </div>
            ) : (
              <></>
            )}
          </div>

          {props.chips.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {props.chips.map(
                (chip: ResourceOverviewChip, idx: number): ReactElement => {
                  return (
                    <span
                      key={`chip-${idx}`}
                      className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-700"
                    >
                      <Icon
                        icon={chip.icon}
                        className="h-3 w-3 text-gray-500"
                      />
                      <span className="font-medium">{chip.label}</span>
                    </span>
                  );
                },
              )}
            </div>
          )}
        </div>
      </div>

      {props.connectionGuide ? props.connectionGuide : <></>}

      {props.needsAttention ? props.needsAttention : <></>}

      {/* Golden metric tiles */}
      {props.tilesLoading && props.tiles.length === 0 ? (
        <div className={RESOURCE_OVERVIEW_TILES_FRAME_CLASS_NAME}>
          <div className={RESOURCE_OVERVIEW_TILES_GRID_CLASS_NAME}>
            {Array.from({ length: 4 }, (_: unknown, idx: number) => {
              return (
                <div
                  key={`tile-skeleton-${idx}`}
                  className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
                >
                  <div className="h-3 w-16 rounded bg-gray-100 animate-pulse" />
                  <div className="mt-3 h-8 w-20 rounded bg-gray-100 animate-pulse" />
                  <div className="mt-2 h-3 w-24 rounded bg-gray-100 animate-pulse" />
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        props.tiles.length > 0 && (
          <div className={RESOURCE_OVERVIEW_TILES_FRAME_CLASS_NAME}>
            <div
              data-testid="resource-overview-tiles"
              className={RESOURCE_OVERVIEW_TILES_GRID_CLASS_NAME}
            >
              {props.tiles.map(
                (tile: ResourceOverviewTile, idx: number): ReactElement => {
                  return (
                    <GoldenMetricTile
                      key={`tile-${idx}`}
                      {...tile}
                      loading={props.tilesLoading || tile.loading}
                    />
                  );
                },
              )}
            </div>
          </div>
        )
      )}

      {/* Trend charts */}
      {props.charts ? <div className="mb-6">{props.charts}</div> : <></>}

      {/* Details */}
      <Card
        title="Details"
        description={props.detailsDescription}
        buttons={
          props.settingsRoute
            ? [
                <EditInSettingsLink
                  key="edit-in-settings"
                  to={props.settingsRoute}
                />,
              ]
            : undefined
        }
      >
        {reportedDetailRows.length > 0 || props.recordId ? (
          <div
            data-testid="resource-overview-details-body"
            className={ruledListClassName}
          >
            {reportedDetailRows.length > 0 ? (
              <dl
                data-testid="resource-overview-details"
                className="divide-y divide-gray-200"
              >
                {reportedDetailRows.map(
                  (
                    row: ResourceOverviewDetailRow,
                    idx: number,
                  ): ReactElement => {
                    return (
                      <div
                        key={`row-${idx}`}
                        data-testid="resource-overview-detail-row"
                        className="px-5 py-3 sm:grid sm:grid-cols-3 sm:gap-4 md:px-6"
                      >
                        <dt className="text-sm font-medium text-gray-500">
                          {translator.translateText(row.label) || row.label}
                        </dt>
                        <dd
                          data-testid="resource-overview-detail-value"
                          className={`${RESOURCE_OVERVIEW_DETAIL_VALUE_CLASS_NAME} ${
                            row.mono === false ? "" : "font-mono"
                          }`}
                        >
                          {row.element || (
                            <BreakableName text={row.value || ""} />
                          )}
                        </dd>
                      </div>
                    );
                  },
                )}
              </dl>
            ) : (
              <p
                data-testid="resource-overview-no-details"
                className="px-5 py-3 text-sm text-gray-500 md:px-6"
              >
                {translator.translateText("No details reported yet.")}
              </p>
            )}
            {props.recordId ? (
              <div className="px-5 py-3 md:px-6">
                <DetailRecordLine recordId={props.recordId} />
              </div>
            ) : (
              <></>
            )}
          </div>
        ) : (
          <p
            data-testid="resource-overview-no-details"
            className="text-sm text-gray-500"
          >
            {translator.translateText("No details reported yet.")}
          </p>
        )}
      </Card>

      {/*
       * Labels: on a phone only. From sm up the page's header shows them
       * beside the page's title (ModelPage, Page's labels), so a card of
       * them here repeated them, as the Explore telemetry card repeated the
       * side menu (#4980).
       */}
      <ResourceLabelsCard labels={props.labels} />
    </Fragment>
  );
};

/*
 * One tile on its own, for a page that lays out its own overview - an App
 * Platforms app's tabs - beside tiles drawn here.
 */
export { GoldenMetricTile as ResourceOverviewTileCard };

export default ResourceOverview;
