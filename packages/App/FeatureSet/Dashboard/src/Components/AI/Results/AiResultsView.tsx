import {
  AiResultsBreakdown,
  AiResultsByModel,
  AiResultsCard,
  AiResultsFact,
  AiResultsModelRow,
  AiResultsRecordsTarget,
  AiResultsSegment,
  AiResultsWeekBar,
  BY_MODEL_TITLE,
  MODEL_CHANGE_LEGEND,
  UNKNOWN_MODEL_LABEL,
  describeAiResultsPartial,
  describeAiResultsWindow,
  describeModelResult,
  getAiResultsCards,
} from "./AiResultsData";
import AiResultsRecordsDialog from "./AiResultsRecordsDialog";
import { AI_RESULTS_RECORDS_CLICK_HINTS } from "./AiResultsRecordsData";
import { describeTrendDate } from "../ActivityInsights/AiActivityInsightsData";
import { AiOutcomes } from "Common/Types/AI/AiOutcomes";
import IconProp from "Common/Types/Icon/IconProp";
import Card from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import StackedProgressBar from "Common/UI/Components/StackedProgressBar/StackedProgressBar";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

/*
 * The AI Results page's body (AiResultsPage loads it): one card per
 * question - did OneUptime AI keep people from being paged, did its fixes
 * work, was it right about the root cause - each with its number out of
 * what it counts, its 12 weeks one bar a week, and how the number breaks
 * down. Every sentence comes from AiResultsData.
 *
 * Inside a card nothing is a box of its own: the number and its breakdown
 * on one side, the weeks on the other, side by side where there is room
 * and one under the other on a phone.
 *
 * Each part of a breakdown opens what it counts (#7768): its legend entry
 * is a button, and the dialog lists the incidents and alerts, fixes, pull
 * requests or investigations behind the number (AiResultsRecordsDialog).
 * Under the breakdown, By model says how each model OneUptime AI ran on
 * did, once more than one did, and a week whose investigations moved to
 * another model is marked over its bar (#7762).
 */

// The part of a breakdown whose records are open, and its label.
interface OpenRecords {
  target: AiResultsRecordsTarget;
  label: string;
}

export interface ComponentProps {
  outcomes: AiOutcomes;
}

function WeekBars(props: { card: AiResultsCard }): ReactElement {
  const translator: Translator = useTranslator();
  const weeks: Array<AiResultsWeekBar> = props.card.weeks;
  const hasModelChange: boolean = weeks.some(
    (week: AiResultsWeekBar): boolean => {
      return Boolean(week.modelChange);
    },
  );
  const peak: number = Math.max(
    1,
    ...weeks.map((week: AiResultsWeekBar): number => {
      return week.total;
    }),
  );

  if (weeks.length === 0) {
    return <></>;
  }

  return (
    <div className="min-w-0" data-testid="ai-results-weeks">
      <p className="text-xs font-medium text-gray-500">
        {translator.translateText("Week by week")}
      </p>
      {/*
        Each bar is the week's whole count, as tall as its share of the
        busiest week; its green part is what went well.
      */}
      <div
        className="mt-2 flex h-24 items-end gap-1"
        role="img"
        aria-label={[props.card.recentWeeks, ...props.card.modelChanges].join(
          " ",
        )}
      >
        {weeks.map((week: AiResultsWeekBar): ReactElement => {
          const height: number = (week.total / peak) * 100;
          const share: number =
            week.total > 0 ? (week.value / week.total) * 100 : 0;

          return (
            <div
              key={week.weekStart}
              className="relative flex h-full min-w-0 flex-1 flex-col justify-end"
              title={
                week.modelChange
                  ? `${week.description}\n${week.modelChange}`
                  : week.description
              }
              data-testid="ai-results-week"
              data-week-start={week.weekStart}
              data-value={week.value}
              data-total={week.total}
              data-model-change={week.modelChange ? "true" : undefined}
            >
              {week.total > 0 ? (
                <div
                  className="flex w-full flex-col justify-end overflow-hidden rounded-sm bg-gray-200"
                  style={{ height: `${Math.max(height, 8)}%` }}
                >
                  <div
                    className="w-full bg-emerald-500"
                    style={{ height: `${share}%` }}
                  />
                </div>
              ) : (
                <div className="h-px w-full bg-gray-200" />
              )}
              {/*
                The week most investigations moved to another model: a
                line the whole height, before the week's bar where the
                weeks are read from, so it reads as "from here on".
              */}
              {week.modelChange ? (
                <span
                  className="pointer-events-none absolute inset-y-0 -start-0.5 w-0.5 rounded-full bg-violet-500"
                  aria-hidden="true"
                  data-testid="ai-results-week-model-change"
                />
              ) : (
                <></>
              )}
            </div>
          );
        })}
      </div>
      {/*
        The first and the last week, as the reader's calendar writes them.
      */}
      <div
        className="mt-1 flex justify-between gap-2 text-xs text-gray-500"
        data-testid="ai-results-weeks-ends"
      >
        <span>{describeTrendDate(weeks[0]!.weekStart)}</span>
        <span>{describeTrendDate(weeks[weeks.length - 1]!.weekStart)}</span>
      </div>
      {/*
        What a bar is made of, in the colours it is drawn in: its green
        part, and the whole bar.
      */}
      <ul
        className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500"
        data-testid="ai-results-weeks-legend"
      >
        <li className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 flex-none rounded-sm bg-emerald-500"
            aria-hidden="true"
          />
          {translator.translateText(props.card.weekLegend.value)}
        </li>
        <li className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 flex-none rounded-sm bg-gray-200"
            aria-hidden="true"
          />
          {translator.translateText(props.card.weekLegend.total)}
        </li>
        {hasModelChange ? (
          <li
            className="flex items-center gap-1.5"
            data-testid="ai-results-weeks-legend-model-change"
          >
            <span
              className="inline-block h-2.5 w-0.5 flex-none rounded-full bg-violet-500"
              aria-hidden="true"
            />
            {translator.translateText(MODEL_CHANGE_LEGEND)}
          </li>
        ) : (
          <></>
        )}
      </ul>
      <p
        className="mt-2 text-sm text-gray-600"
        data-testid="ai-results-recent-weeks"
      >
        {props.card.recentWeeks}
      </p>
      {props.card.modelChanges.map(
        (change: string, index: number): ReactElement => {
          return (
            <p
              key={index}
              className="mt-1 text-xs text-gray-500"
              data-testid="ai-results-model-change"
            >
              {change}
            </p>
          );
        },
      )}
    </div>
  );
}

function Breakdown(props: {
  breakdown: AiResultsBreakdown;
  onOpenRecords: (records: OpenRecords) => void;
}): ReactElement {
  const translator: Translator = useTranslator();
  const total: number = props.breakdown.segments.reduce(
    (sum: number, segment: AiResultsSegment): number => {
      return sum + segment.value;
    },
    0,
  );

  return (
    <div data-testid="ai-results-breakdown">
      {props.breakdown.title ? (
        <p className="mb-2 text-xs font-medium text-gray-500">
          {translator.translateText(props.breakdown.title)}
        </p>
      ) : (
        <></>
      )}
      <StackedProgressBar
        heightClassName="h-2.5"
        totalValue={total}
        segments={props.breakdown.segments.map((segment: AiResultsSegment) => {
          const hint: string =
            AI_RESULTS_RECORDS_CLICK_HINTS[segment.records.part];

          return {
            value: segment.value,
            color: segment.color,
            label: translator.translateText(segment.label) || segment.label,
            // Each part opens exactly what it counts (#7768).
            onClick: (): void => {
              props.onOpenRecords({
                target: segment.records,
                label: segment.label,
              });
            },
            clickHint: translator.translateText(hint) || hint,
          };
        })}
      />
    </div>
  );
}

function Facts(props: { facts: Array<AiResultsFact> }): ReactElement {
  const translator: Translator = useTranslator();

  if (props.facts.length === 0) {
    return <></>;
  }

  return (
    <dl className="divide-y divide-gray-100" data-testid="ai-results-facts">
      {props.facts.map((fact: AiResultsFact): ReactElement => {
        return (
          <div
            key={fact.label}
            className="flex items-center justify-between gap-3 py-1.5 text-sm"
            data-testid="ai-results-fact"
          >
            <dt className="min-w-0 text-gray-600">
              {translator.translateText(fact.label)}
            </dt>
            <dd className="font-medium text-gray-900">
              {translator.formatNumber(fact.value)}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/*
 * How each model did (#7762): a line a model - its name as the provider
 * names it, a bar of what went well, and "23 of 27" - the most counted
 * first.
 */
function ByModel(props: { byModel: AiResultsByModel }): ReactElement {
  const translator: Translator = useTranslator();

  return (
    <div data-testid="ai-results-by-model">
      <p className="text-xs font-medium text-gray-500">
        {translator.translateText(BY_MODEL_TITLE)}
      </p>
      {props.byModel.note ? (
        <p
          className="mt-0.5 text-xs text-gray-500"
          data-testid="ai-results-by-model-note"
        >
          {translator.translateText(props.byModel.note)}
        </p>
      ) : (
        <></>
      )}
      <ul className="mt-2 space-y-2">
        {props.byModel.rows.map((row: AiResultsModelRow): ReactElement => {
          const share: number = row.total > 0 ? (row.value / row.total) * 100 : 0;
          const name: string =
            row.modelName === null
              ? translator.translateText(UNKNOWN_MODEL_LABEL) ||
                UNKNOWN_MODEL_LABEL
              : row.modelName;

          return (
            <li
              key={row.modelName === null ? "" : row.modelName}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-sm sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto]"
              data-testid="ai-results-by-model-row"
              data-model={row.modelName === null ? "" : row.modelName}
            >
              <span
                className={`min-w-0 truncate ${
                  row.modelName === null
                    ? "text-gray-500"
                    : "font-medium text-gray-800"
                }`}
                title={name}
                dir={row.modelName === null ? undefined : "ltr"}
              >
                {name}
              </span>
              <span
                className="col-span-2 order-last h-1.5 overflow-hidden rounded-full bg-gray-200 sm:order-none sm:col-span-1"
                aria-hidden="true"
              >
                <span
                  className="block h-full rounded-full bg-emerald-500"
                  style={{ width: `${share}%` }}
                />
              </span>
              <span
                className="whitespace-nowrap text-gray-600"
                data-testid="ai-results-by-model-count"
              >
                {describeModelResult(row, translator)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ResultCard(props: {
  card: AiResultsCard;
  onOpenRecords: (records: OpenRecords) => void;
}): ReactElement {
  const translator: Translator = useTranslator();
  const card: AiResultsCard = props.card;
  const hasResults: boolean = card.total > 0;

  return (
    <Card title={card.title} description={card.description}>
      <div
        className={
          hasResults ? "grid grid-cols-1 gap-x-10 gap-y-6 md:grid-cols-2" : ""
        }
        data-testid={`ai-results-card-${card.kind}`}
      >
        <div className="min-w-0 space-y-5">
          {hasResults ? (
            <p
              className="text-sm leading-relaxed text-gray-600"
              data-testid="ai-results-headline"
            >
              <TranslatedSentence
                template={card.headline}
                count={card.total}
                slots={{
                  value: (
                    <span
                      className="text-3xl font-semibold tracking-tight text-gray-900"
                      data-testid="ai-results-value"
                    >
                      {translator.formatNumber(card.value)}
                    </span>
                  ),
                }}
              />
            </p>
          ) : (
            <div
              className="flex items-start gap-3"
              data-testid="ai-results-start"
            >
              <Icon
                icon={IconProp.Clock}
                className="mt-0.5 h-5 w-5 flex-none text-gray-400"
              />
              <div className="min-w-0 space-y-1">
                {card.startNotes.map(
                  (note: string, index: number): ReactElement => {
                    return (
                      <p key={index} className="text-sm text-gray-600">
                        {note}
                      </p>
                    );
                  },
                )}
              </div>
            </div>
          )}
          {card.breakdowns.map(
            (breakdown: AiResultsBreakdown, index: number): ReactElement => {
              return (
                <Breakdown
                  key={index}
                  breakdown={breakdown}
                  onOpenRecords={props.onOpenRecords}
                />
              );
            },
          )}
          <Facts facts={card.facts} />
          {card.byModel ? <ByModel byModel={card.byModel} /> : <></>}
        </div>
        {hasResults ? <WeekBars card={card} /> : <></>}
      </div>
    </Card>
  );
}

const AiResultsView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const cards: Array<AiResultsCard> = getAiResultsCards(props.outcomes);
  const [openRecords, setOpenRecords] = useState<OpenRecords | null>(null);

  return (
    <Fragment>
      {props.outcomes.isPartial ? (
        <div
          className="mb-5 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
          data-testid="ai-results-partial"
        >
          <Icon
            icon={IconProp.Info}
            className="mt-0.5 h-4 w-4 flex-none text-amber-600"
          />
          <p className="min-w-0">{describeAiResultsPartial()}</p>
        </div>
      ) : (
        <></>
      )}
      {cards.map((card: AiResultsCard): ReactElement => {
        return (
          <ResultCard
            key={card.kind}
            card={card}
            onOpenRecords={setOpenRecords}
          />
        );
      })}
      <p className="text-xs text-gray-500" data-testid="ai-results-window">
        {describeAiResultsWindow(props.outcomes)}
      </p>
      {openRecords ? (
        <AiResultsRecordsDialog
          key={`${openRecords.target.part}-${openRecords.target.outcome}`}
          target={openRecords.target}
          label={openRecords.label}
          windowEnd={props.outcomes.windowEnd}
          onClose={() => {
            setOpenRecords(null);
          }}
        />
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default AiResultsView;
