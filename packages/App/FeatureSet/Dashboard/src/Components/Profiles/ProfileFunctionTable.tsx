import React, { FunctionComponent, ReactElement, useState } from "react";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { ProfileFunctionChange } from "Common/Utils/Profiles/ProfileComparison";
import { ProfileFrameOrigin } from "Common/Utils/Profiles/ProfileFrames";
import { getShareOfWindow } from "Common/Utils/Profiles/ProfileHotspot";
import {
  ProfileValueUnit,
  formatProfileShare,
  formatProfileValue,
} from "Common/Utils/Profiles/ProfileTypes";
import ProfileUtil, { ModuleCategory } from "../../Utils/ProfileUtil";
import {
  PROFILE_FUNCTION_ROWS,
  PROFILE_FUNCTION_ROWS_ALL,
  ProfileFunctionRow,
  ProfileFunctionView,
  getProfileOrigin,
  getShownFunctionChanges,
  getShownFunctionRows,
} from "../../Utils/ProfilesView";
import {
  CHANGES_EMPTY,
  CHANGES_OWN_EMPTY,
  FUNCTIONS_COMPARE_DESCRIPTION,
  FUNCTIONS_EMPTY,
  FUNCTIONS_OWN_EMPTY,
  OWN_CODE_COMPARE_DESCRIPTION,
  OWN_CODE_EXPLAINED,
  OWN_CODE_SENTENCE,
  PANEL_HIGHLIGHT,
  PANEL_OPEN_SOURCE,
  PROFILE_ORIGIN_LABELS,
  SELF_AND_TOTAL_SENTENCE,
  SELF_EXPLAINED,
  SORT_BY_SELF,
  SORT_BY_TOTAL,
  TOTAL_EXPLAINED,
} from "./ProfileCopy";
import { ProfileSourceLink } from "./ProfilesApi";

/*
 * THE FUNCTIONS, RANKED, IN PLAIN WORDS.
 *
 * Each row is one function: its name, its file and line (a link into the
 * repository when one holds it), whose code it is, and its share of the
 * window, ranked one of three ways:
 *
 *   Self       the time in the function's own code;
 *   Total      the function and everything it calls;
 *   Your code  only the application's own functions, each with the
 *              library, runtime and system code it calls - the time a
 *              change to it can win back.
 *
 * What the ranking means is said above the list, where a person who has
 * never used a profiler reads it first. In Self and Total the bar draws
 * both: the dark part is Self, the light part what it calls. Your code
 * lists the application's own code only, so its rows leave out whose code
 * each one is.
 *
 * Comparing two windows, each row says the function's self share before
 * and after, and how many points it moved; Your code keeps the
 * application's own functions.
 */

export interface ComponentProps {
  isLoading: boolean;
  error: string;
  onRetry: () => void;
  unit: ProfileValueUnit;
  // One window.
  rows?: Array<ProfileFunctionRow> | undefined;
  windowTotal?: number | undefined;
  // Two windows.
  changes?: Array<ProfileFunctionChange> | undefined;
  view: ProfileFunctionView;
  truncated: boolean;
  sourceLinks: Array<ProfileSourceLink>;
  highlightedFunctionName: string;
  onOpenFunction: (row: { functionName: string; fileName: string }) => void;
  onHighlight: (functionName: string) => void;
}

export function findSourceLink(
  links: Array<ProfileSourceLink>,
  fileName: string,
  lineNumber: number,
): ProfileSourceLink | undefined {
  return (
    links.find((link: ProfileSourceLink): boolean => {
      return link.fileName === fileName && link.lineNumber === lineNumber;
    }) ||
    links.find((link: ProfileSourceLink): boolean => {
      return link.fileName === fileName;
    })
  );
}

const ORIGIN_TO_MODULE: Record<ProfileFrameOrigin, ModuleCategory> = {
  [ProfileFrameOrigin.Own]: "own",
  [ProfileFrameOrigin.Dependency]: "vendor",
  [ProfileFrameOrigin.Runtime]: "runtime",
  [ProfileFrameOrigin.Native]: "native",
  [ProfileFrameOrigin.Unknown]: "unknown",
};

interface FrameRow {
  functionName: string;
  fileName: string;
  lineNumber: number;
  frameType: string;
}

const CLEAR_HIGHLIGHT: string = "Clear the flame graph highlight";

const ProfileFunctionTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [showAll, setShowAll] = useState<boolean>(false);
  const limit: number = showAll
    ? PROFILE_FUNCTION_ROWS_ALL
    : PROFILE_FUNCTION_ROWS;

  if (props.error) {
    return (
      <ErrorMessage message={props.error} onRefreshClick={props.onRetry} />
    );
  }

  if (props.isLoading) {
    return (
      <div className="space-y-2" data-testid="profiles-functions-loading">
        {[0, 1, 2, 3, 4].map((index: number) => {
          return (
            <div
              key={index}
              className="h-12 animate-pulse rounded-md border border-gray-100 bg-gray-50"
            />
          );
        })}
      </div>
    );
  }

  const isOwnView: boolean = props.view === "own";
  const isTotalView: boolean = props.view === "total";

  /*
   * A share column of one window. The column the list is ranked by reads
   * first: its share in bold over its value; the other is its share alone,
   * quieter - so ranking by Total puts the eye on Total, not on a Self of 0%.
   */
  const renderFigure: (figure: {
    share: number;
    value: number;
    isRanked: boolean;
    testId: string;
  }) => ReactElement = (figure: {
    share: number;
    value: number;
    isRanked: boolean;
    testId: string;
  }): ReactElement => {
    return (
      <div className="w-24 flex-none text-right max-sm:hidden sm:block">
        <div
          className={`font-mono text-sm ${
            figure.isRanked ? "font-semibold text-gray-900" : "text-gray-500"
          }`}
          data-testid={figure.testId}
          data-ranked={figure.isRanked}
        >
          {formatProfileShare(figure.share)}
        </div>
        {figure.isRanked ? (
          <div className="text-xs text-gray-500">
            {formatProfileValue(figure.value, props.unit)}
          </div>
        ) : (
          <></>
        )}
      </div>
    );
  };

  const renderWhere: (row: FrameRow) => ReactElement = (
    row: FrameRow,
  ): ReactElement => {
    const origin: ProfileFrameOrigin = getProfileOrigin(row);
    // Every row of Your code is the application's own: said once, above.
    const isOriginShown: boolean = !isOwnView;
    const link: ProfileSourceLink | undefined = row.fileName
      ? findSourceLink(props.sourceLinks, row.fileName, row.lineNumber)
      : undefined;
    const where: string = row.fileName
      ? `${ProfileUtil.formatFileName(row.fileName, 64)}${row.lineNumber > 0 ? `:${row.lineNumber}` : ""}`
      : "";

    return (
      <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-500">
        {where ? (
          link ? (
            <a
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-w-0 items-center gap-1 font-mono text-indigo-600 hover:text-indigo-800 hover:underline"
              title={translator.translateTemplate(PANEL_OPEN_SOURCE, {
                path: link.path,
                repository: link.repositoryName,
              })}
              data-testid="profiles-function-source-link"
            >
              <span className="truncate">{where}</span>
              <Icon
                icon={IconProp.ExternalLink}
                className="h-3 w-3 flex-none"
              />
            </a>
          ) : (
            <span className="min-w-0 truncate font-mono" title={row.fileName}>
              {where}
            </span>
          )
        ) : (
          <></>
        )}
        {isOriginShown ? (
          <span
            className={
              origin === ProfileFrameOrigin.Own
                ? "font-medium text-orange-700"
                : "text-gray-500"
            }
            data-testid="profiles-function-origin"
          >
            {translator.translateText(PROFILE_ORIGIN_LABELS[origin])}
          </span>
        ) : (
          <></>
        )}
      </div>
    );
  };

  const renderName: (row: FrameRow) => ReactElement = (
    row: FrameRow,
  ): ReactElement => {
    const style: { bg: string } = ProfileUtil.getModuleFrameStyle(
      ORIGIN_TO_MODULE[getProfileOrigin(row)],
      0.8,
    );
    const isHighlighted: boolean =
      props.highlightedFunctionName.length > 0 &&
      props.highlightedFunctionName === row.functionName;
    const highlightLabel: string =
      translator.translateText(
        isHighlighted ? CLEAR_HIGHLIGHT : PANEL_HIGHLIGHT,
      ) || PANEL_HIGHLIGHT;

    return (
      <div className="flex min-w-0 items-center gap-2">
        <span
          className={`inline-block h-2.5 w-2.5 flex-none rounded-sm ${style.bg}`}
          aria-hidden="true"
        />
        <button
          type="button"
          className="min-w-0 truncate rounded-sm text-left font-mono text-sm font-medium text-gray-900 hover:text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          title={row.functionName}
          data-testid="profiles-function-name"
          onClick={() => {
            props.onOpenFunction(row);
          }}
        >
          {row.functionName || translator.translateText("(anonymous)")}
        </button>
        <button
          type="button"
          className={`flex-none rounded p-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
            isHighlighted
              ? "text-indigo-600"
              : "text-gray-400 hover:text-gray-700"
          }`}
          aria-pressed={isHighlighted}
          title={highlightLabel}
          aria-label={highlightLabel}
          data-testid="profiles-function-highlight"
          onClick={() => {
            props.onHighlight(row.functionName);
          }}
        >
          <Icon icon={IconProp.Search} className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  };

  const term: (text: string) => ReactElement = (text: string): ReactElement => {
    return (
      <span className="font-semibold text-gray-900">
        {translator.translateText(text)}
      </span>
    );
  };

  const explanation: ReactElement = (
    <p
      className="mb-3 text-sm leading-relaxed text-gray-600"
      data-testid="profiles-functions-explained"
    >
      {props.changes ? (
        translator.translateText(
          isOwnView
            ? OWN_CODE_COMPARE_DESCRIPTION
            : FUNCTIONS_COMPARE_DESCRIPTION,
        )
      ) : isOwnView ? (
        translator.translateText(OWN_CODE_SENTENCE)
      ) : (
        <TranslatedSentence
          template={SELF_AND_TOTAL_SENTENCE}
          slots={{ self: term("Self"), total: term("Total") }}
        />
      )}
    </p>
  );

  const showAllToggle: (count: number) => ReactElement = (
    count: number,
  ): ReactElement => {
    if (count <= PROFILE_FUNCTION_ROWS) {
      return <></>;
    }

    return (
      <button
        type="button"
        className="mt-3 rounded-sm text-sm font-medium text-indigo-600 hover:text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        aria-expanded={showAll}
        data-testid="profiles-functions-show-all"
        onClick={() => {
          setShowAll(!showAll);
        }}
      >
        {showAll
          ? translator.translateText("Show fewer")
          : translator.translatePlural(
              {
                one: "Show all {{count}} function",
                other: "Show all {{count}} functions",
              },
              count,
            )}
      </button>
    );
  };

  const empty: (text: string) => ReactElement = (
    text: string,
  ): ReactElement => {
    return (
      <div>
        {explanation}
        <p
          className="py-8 text-center text-sm text-gray-500"
          data-testid="profiles-functions-empty"
        >
          {translator.translateText(text)}
        </p>
      </div>
    );
  };

  if (props.changes) {
    const changes: Array<ProfileFunctionChange> = getShownFunctionChanges(
      props.changes,
      isOwnView,
      limit,
    );
    const changeCount: number = getShownFunctionChanges(
      props.changes,
      isOwnView,
      PROFILE_FUNCTION_ROWS_ALL,
    ).length;

    if (changes.length === 0) {
      return empty(isOwnView ? CHANGES_OWN_EMPTY : CHANGES_EMPTY);
    }

    return (
      <div>
        {explanation}
        <ol
          className="-mx-5 divide-y divide-gray-100 md:-mx-6"
          data-testid="profiles-functions"
        >
          {changes.map((change: ProfileFunctionChange, index: number) => {
            // Your code reads own-code shares; every function its self share.
            const before: number = isOwnView
              ? change.before?.ownShare || 0
              : change.before?.selfShare || 0;
            const after: number = isOwnView
              ? change.after?.ownShare || 0
              : change.after?.selfShare || 0;
            const points: number = isOwnView
              ? change.ownShareChange
              : change.selfShareChange;
            const isHeavier: boolean = points > 0;
            const beforeAfter: ReactElement = (
              <>
                {formatProfileShare(before)}{" "}
                <span className="text-gray-400" aria-hidden="true">
                  →
                </span>{" "}
                {formatProfileShare(after)}
              </>
            );
            const pointsText: string =
              translator.translateTemplate("{{change}} points", {
                change: `${isHeavier ? "+" : ""}${points.toFixed(1)}`,
              }) || "";
            const pointsClass: string = `font-semibold ${
              isHeavier ? "text-red-600" : "text-green-600"
            }`;

            return (
              <li
                key={`${change.functionName}\u0000${change.fileName}`}
                className="flex items-start gap-3 px-5 py-3 md:px-6"
                data-testid="profiles-function-row"
              >
                <span className="mt-0.5 w-6 flex-none text-right font-mono text-xs text-gray-400">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  {renderName(change)}
                  {renderWhere(change)}
                  {/*
                   * Below sm the change goes under the name, as the shares
                   * of one window do: beside it, it left a phone's names
                   * cut to a few letters.
                   */}
                  <div
                    className="mt-1.5 flex flex-wrap items-baseline gap-x-2 text-xs sm:hidden"
                    data-testid="profiles-function-change-compact"
                  >
                    <span className="whitespace-nowrap font-mono text-gray-700">
                      {beforeAfter}
                    </span>
                    <span className={pointsClass}>{pointsText}</span>
                  </div>
                </div>
                <div className="flex-none text-right max-sm:hidden sm:block">
                  <div className="whitespace-nowrap font-mono text-sm text-gray-700">
                    {beforeAfter}
                  </div>
                  <div
                    className={`text-xs ${pointsClass}`}
                    data-testid="profiles-function-change"
                  >
                    {pointsText}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
        {showAllToggle(changeCount)}
      </div>
    );
  }

  const windowTotal: number = props.windowTotal || 0;
  const rows: Array<ProfileFunctionRow> = getShownFunctionRows(
    props.rows || [],
    props.view,
    limit,
  );
  const rowCount: number = getShownFunctionRows(
    props.rows || [],
    props.view,
    PROFILE_FUNCTION_ROWS_ALL,
  ).length;

  if (rows.length === 0) {
    return empty(isOwnView ? FUNCTIONS_OWN_EMPTY : FUNCTIONS_EMPTY);
  }

  return (
    <div>
      {explanation}
      <div className="-mx-5 items-center gap-3 border-b border-gray-100 px-5 pb-2 text-xs font-medium uppercase tracking-wide text-gray-500 max-sm:hidden sm:flex md:-mx-6 md:px-6">
        <span className="w-6 flex-none" />
        <span className="flex-1">{translator.translateText("Function")}</span>
        {isOwnView ? (
          <span
            className="w-28 flex-none text-right text-gray-700"
            title={translator.translateText(OWN_CODE_EXPLAINED)}
          >
            {translator.translateText("Your code")}
          </span>
        ) : (
          <>
            <span
              className={`w-24 flex-none text-right ${
                isTotalView ? "" : "text-gray-700"
              }`}
              title={translator.translateText(SELF_EXPLAINED)}
            >
              {translator.translateText(SORT_BY_SELF)}
            </span>
            <span
              className={`w-24 flex-none text-right ${
                isTotalView ? "text-gray-700" : ""
              }`}
              title={translator.translateText(TOTAL_EXPLAINED)}
            >
              {translator.translateText(SORT_BY_TOTAL)}
            </span>
          </>
        )}
      </div>
      <ol
        className="-mx-5 divide-y divide-gray-100 md:-mx-6"
        data-testid="profiles-functions"
        data-view={props.view}
      >
        {rows.map((row: ProfileFunctionRow, index: number) => {
          const selfShare: number = getShareOfWindow(
            row.selfValue,
            windowTotal,
          );
          const totalShare: number = getShareOfWindow(
            row.totalValue,
            windowTotal,
          );
          const ownShare: number = getShareOfWindow(row.ownValue, windowTotal);

          return (
            <li
              key={`${row.functionName}\u0000${row.fileName}`}
              className="flex items-start gap-3 px-5 py-3 md:px-6"
              data-testid="profiles-function-row"
            >
              <span className="mt-0.5 w-6 flex-none text-right font-mono text-xs text-gray-400">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                {renderName(row)}
                {renderWhere(row)}
                <div
                  className="relative mt-2 h-1.5 w-full max-w-md overflow-hidden rounded-full bg-gray-100"
                  aria-hidden="true"
                >
                  {isOwnView ? (
                    <div
                      className="absolute inset-y-0 left-0 rounded-full bg-orange-400"
                      style={{ width: `${Math.min(100, ownShare)}%` }}
                    />
                  ) : (
                    <>
                      <div
                        className="absolute inset-y-0 left-0 rounded-full bg-indigo-200"
                        style={{ width: `${Math.min(100, totalShare)}%` }}
                      />
                      <div
                        className="absolute inset-y-0 left-0 rounded-full bg-indigo-500"
                        style={{ width: `${Math.min(100, selfShare)}%` }}
                      />
                    </>
                  )}
                </div>
                {/*
                 * Below sm the shares go under the name: beside it, two
                 * columns of figures left the name no room on a phone.
                 * The one the list is ranked by comes first.
                 */}
                <div
                  className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-gray-500 sm:hidden"
                  data-testid="profiles-function-shares-compact"
                >
                  {isOwnView ? (
                    <span>
                      <span className="font-mono font-semibold text-gray-900">
                        {formatProfileShare(ownShare)}
                      </span>{" "}
                      · {formatProfileValue(row.ownValue, props.unit)}
                    </span>
                  ) : (
                    (isTotalView
                      ? [
                          { label: SORT_BY_TOTAL, share: totalShare },
                          { label: SORT_BY_SELF, share: selfShare },
                        ]
                      : [
                          { label: SORT_BY_SELF, share: selfShare },
                          { label: SORT_BY_TOTAL, share: totalShare },
                        ]
                    ).map(
                      (
                        figure: { label: string; share: number },
                        position: number,
                      ) => {
                        return (
                          <span key={figure.label}>
                            {translator.translateText(figure.label)}{" "}
                            <span
                              className={`font-mono ${
                                position === 0
                                  ? "font-semibold text-gray-900"
                                  : "text-gray-700"
                              }`}
                            >
                              {formatProfileShare(figure.share)}
                            </span>
                            {position === 0 ? (
                              <>
                                {" "}
                                ·{" "}
                                {formatProfileValue(
                                  isTotalView ? row.totalValue : row.selfValue,
                                  props.unit,
                                )}
                              </>
                            ) : (
                              <></>
                            )}
                          </span>
                        );
                      },
                    )
                  )}
                </div>
              </div>
              {isOwnView ? (
                <div className="w-28 flex-none text-right max-sm:hidden sm:block">
                  <div
                    className="font-mono text-sm font-semibold text-gray-900"
                    data-testid="profiles-function-own"
                  >
                    {formatProfileShare(ownShare)}
                  </div>
                  <div className="text-xs text-gray-500">
                    {formatProfileValue(row.ownValue, props.unit)}
                  </div>
                </div>
              ) : (
                <>
                  {renderFigure({
                    share: selfShare,
                    value: row.selfValue,
                    isRanked: !isTotalView,
                    testId: "profiles-function-self",
                  })}
                  {renderFigure({
                    share: totalShare,
                    value: row.totalValue,
                    isRanked: isTotalView,
                    testId: "profiles-function-total",
                  })}
                </>
              )}
            </li>
          );
        })}
      </ol>
      {showAllToggle(rowCount)}
      {props.truncated ? (
        <p className="mt-3 text-xs text-gray-500">
          {translator.translateText(
            "This window held more distinct stacks than are read at once: the smallest are left out.",
          )}
        </p>
      ) : (
        <></>
      )}
    </div>
  );
};

export default ProfileFunctionTable;
