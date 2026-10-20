import React, { FunctionComponent, ReactElement } from "react";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  ProfileChangeDirection,
  ProfileFunctionChange,
} from "Common/Utils/Profiles/ProfileComparison";
import { ProfileFrameOrigin } from "Common/Utils/Profiles/ProfileFrames";
import { getShareOfWindow } from "Common/Utils/Profiles/ProfileHotspot";
import {
  ProfileValueUnit,
  formatProfileShare,
  formatProfileValue,
} from "Common/Utils/Profiles/ProfileTypes";
import ProfileUtil, { ModuleCategory } from "../../Utils/ProfileUtil";
import { ProfileFunctionRow, getProfileOrigin } from "../../Utils/ProfilesView";
import {
  FUNCTIONS_COMPARE_DESCRIPTION,
  PANEL_HIGHLIGHT,
  PANEL_OPEN_SOURCE,
  PROFILE_ORIGIN_LABELS,
  SELF_AND_TOTAL_SENTENCE,
  SELF_EXPLAINED,
  TOTAL_EXPLAINED,
} from "./ProfileCopy";
import { ProfileSourceLink } from "./ProfilesApi";

/*
 * THE FUNCTIONS, RANKED, IN PLAIN WORDS.
 *
 * Each row is one function: its name, its file and line (a link into the
 * repository when one holds it), whose code it is, and two shares of the
 * window - Self, the time in the function's own code, and Total, the
 * function with everything it calls - explained above the list, where a
 * person who has never used a profiler reads them first. The bar draws
 * both: the dark part is Self, the light part what it calls.
 *
 * Comparing two windows, each row says the function's self share before
 * and after, and how many points it moved.
 */

export type ProfileFunctionSort = "self" | "total";

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
  sortBy: ProfileFunctionSort;
  onlyOwnCode: boolean;
  truncated: boolean;
  sourceLinks: Array<ProfileSourceLink>;
  highlightedFunctionName: string;
  onOpenFunction: (row: { functionName: string; fileName: string }) => void;
  onHighlight: (functionName: string) => void;
}

// The most rows the list shows; the flame graph has the rest.
export const PROFILE_FUNCTION_ROWS: number = 15;

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

const ProfileFunctionTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

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

  const isCompare: boolean = Boolean(props.changes);

  const renderWhere: (row: {
    functionName: string;
    fileName: string;
    lineNumber: number;
    frameType: string;
  }) => ReactElement = (row: {
    functionName: string;
    fileName: string;
    lineNumber: number;
    frameType: string;
  }): ReactElement => {
    const origin: ProfileFrameOrigin = getProfileOrigin(row);
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
      </div>
    );
  };

  const renderName: (row: {
    functionName: string;
    fileName: string;
    lineNumber: number;
    frameType: string;
  }) => ReactElement = (row: {
    functionName: string;
    fileName: string;
    lineNumber: number;
    frameType: string;
  }): ReactElement => {
    const style: { bg: string } = ProfileUtil.getModuleFrameStyle(
      ORIGIN_TO_MODULE[getProfileOrigin(row)],
      0.8,
    );
    const isHighlighted: boolean =
      props.highlightedFunctionName.length > 0 &&
      props.highlightedFunctionName === row.functionName;

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
              : "text-gray-300 hover:text-gray-600"
          }`}
          aria-pressed={isHighlighted}
          title={translator.translateText(
            isHighlighted ? "Clear the flame graph highlight" : PANEL_HIGHLIGHT,
          )}
          aria-label={translator.translateText(
            isHighlighted ? "Clear the flame graph highlight" : PANEL_HIGHLIGHT,
          )}
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

  const header: ReactElement = (
    <p
      className="mb-3 text-sm leading-relaxed text-gray-600"
      data-testid="profiles-self-total-explained"
    >
      <TranslatedSentence
        template={SELF_AND_TOTAL_SENTENCE}
        slots={{
          self: (
            <span className="font-semibold text-gray-900">
              {translator.translateText("Self")}
            </span>
          ),
          total: (
            <span className="font-semibold text-gray-900">
              {translator.translateText("Total")}
            </span>
          ),
        }}
      />
    </p>
  );

  if (isCompare) {
    // The biggest moves first, either way.
    const changes: Array<ProfileFunctionChange> = (props.changes || [])
      .filter((change: ProfileFunctionChange): boolean => {
        return (
          change.direction !== ProfileChangeDirection.Same &&
          (!props.onlyOwnCode ||
            getProfileOrigin(change) === ProfileFrameOrigin.Own)
        );
      })
      .sort((a: ProfileFunctionChange, b: ProfileFunctionChange): number => {
        return (
          Math.abs(b.selfShareChange) - Math.abs(a.selfShareChange) ||
          a.functionName.localeCompare(b.functionName)
        );
      })
      .slice(0, PROFILE_FUNCTION_ROWS);

    if (changes.length === 0) {
      return (
        <p
          className="py-8 text-center text-sm text-gray-500"
          data-testid="profiles-functions-empty"
        >
          {translator.translateText(
            "No function's share of the time changed between these windows.",
          )}
        </p>
      );
    }

    return (
      <div>
        <p
          className="mb-3 text-sm leading-relaxed text-gray-600"
          data-testid="profiles-compare-explained"
        >
          {translator.translateText(FUNCTIONS_COMPARE_DESCRIPTION)}
        </p>
        <ol
          className="-mx-5 divide-y divide-gray-100 md:-mx-6"
          data-testid="profiles-functions"
        >
          {changes.map((change: ProfileFunctionChange, index: number) => {
            const isSlower: boolean =
              change.direction === ProfileChangeDirection.Slower ||
              change.direction === ProfileChangeDirection.New;

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
                </div>
                <div className="flex-none text-right">
                  <div className="font-mono text-sm text-gray-700">
                    {formatProfileShare(change.before?.selfShare || 0)}{" "}
                    <span className="text-gray-400">→</span>{" "}
                    {formatProfileShare(change.after?.selfShare || 0)}
                  </div>
                  <div
                    className={`text-xs font-semibold ${
                      isSlower ? "text-red-600" : "text-green-600"
                    }`}
                    data-testid="profiles-function-change"
                  >
                    {translator.translateTemplate("{{change}} points", {
                      change: `${change.selfShareChange > 0 ? "+" : ""}${change.selfShareChange.toFixed(1)}`,
                    })}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    );
  }

  const windowTotal: number = props.windowTotal || 0;
  const rows: Array<ProfileFunctionRow> = [...(props.rows || [])]
    .filter((row: ProfileFunctionRow): boolean => {
      return (
        !props.onlyOwnCode || getProfileOrigin(row) === ProfileFrameOrigin.Own
      );
    })
    .sort((a: ProfileFunctionRow, b: ProfileFunctionRow): number => {
      return props.sortBy === "total"
        ? b.totalValue - a.totalValue
        : b.selfValue - a.selfValue;
    })
    .slice(0, PROFILE_FUNCTION_ROWS);

  if (rows.length === 0) {
    return (
      <div>
        {header}
        <p
          className="py-8 text-center text-sm text-gray-500"
          data-testid="profiles-functions-empty"
        >
          {translator.translateText(
            props.onlyOwnCode
              ? "None of your own code ran in this window."
              : "No functions were sampled in this window.",
          )}
        </p>
      </div>
    );
  }

  return (
    <div>
      {header}
      <div className="-mx-5 hidden items-center gap-3 border-b border-gray-100 px-5 pb-2 text-xs font-medium uppercase tracking-wide text-gray-400 sm:flex md:-mx-6 md:px-6">
        <span className="w-6 flex-none" />
        <span className="flex-1">{translator.translateText("Function")}</span>
        <span
          className="w-24 flex-none text-right"
          title={translator.translateText(SELF_EXPLAINED)}
        >
          {translator.translateText("Self")}
        </span>
        <span
          className="w-20 flex-none text-right"
          title={translator.translateText(TOTAL_EXPLAINED)}
        >
          {translator.translateText("Total")}
        </span>
      </div>
      <ol
        className="-mx-5 divide-y divide-gray-100 md:-mx-6"
        data-testid="profiles-functions"
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
                  <div
                    className="absolute inset-y-0 left-0 rounded-full bg-indigo-200"
                    style={{ width: `${Math.min(100, totalShare)}%` }}
                  />
                  <div
                    className="absolute inset-y-0 left-0 rounded-full bg-indigo-500"
                    style={{ width: `${Math.min(100, selfShare)}%` }}
                  />
                </div>
              </div>
              <div className="w-24 flex-none text-right">
                <div
                  className="font-mono text-sm font-semibold text-gray-900"
                  data-testid="profiles-function-self"
                >
                  {formatProfileShare(selfShare)}
                </div>
                <div className="text-xs text-gray-500">
                  {formatProfileValue(row.selfValue, props.unit)}
                </div>
              </div>
              <div className="w-20 flex-none text-right">
                <div
                  className="font-mono text-sm text-gray-700"
                  data-testid="profiles-function-total"
                >
                  {formatProfileShare(totalShare)}
                </div>
                <div className="text-xs text-gray-400 sm:hidden">
                  {translator.translateText("Total")}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
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
