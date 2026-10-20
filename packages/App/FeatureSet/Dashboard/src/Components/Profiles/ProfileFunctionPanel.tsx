import React, {
  FunctionComponent,
  ReactElement,
  useMemo,
  useState,
} from "react";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import SideOver from "Common/UI/Components/SideOver/SideOver";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { ProfileFunctionChange } from "Common/Utils/Profiles/ProfileComparison";
import {
  ProfileFrameOrigin,
  getProfileFrameOrigin,
} from "Common/Utils/Profiles/ProfileFrames";
import {
  ProfileCallChain,
  ProfileCallee,
  ProfileTreeNode,
  getOwnCodeValue,
  getShareOfWindow,
  getTopCallees,
  getTopCallerChains,
} from "Common/Utils/Profiles/ProfileHotspot";
import {
  formatProfileShare,
  formatProfileValue,
} from "Common/Utils/Profiles/ProfileTypes";
import ProfileUtil from "../../Utils/ProfileUtil";
import {
  ProfileKindChoice,
  ProfilesWindowPair,
  buildProfileMonitorRoute,
  getNearestOwnCaller,
  suggestFunctionShareThreshold,
} from "../../Utils/ProfilesView";
import useAiOffered from "../../Utils/UseAiOffered";
import FlamegraphView, { FlamegraphNode } from "./FlamegraphView";
import {
  PANEL_BEFORE_AFTER,
  PANEL_BEFORE_AFTER_OWN,
  PANEL_CALLEES,
  PANEL_CALLEES_NONE,
  PANEL_CALLERS,
  PANEL_CALLERS_NONE,
  PANEL_DESCRIPTION,
  PANEL_HIDE_GRAPHS,
  PANEL_HIGHLIGHT,
  PANEL_NOT_YOUR_CODE,
  PANEL_OPEN_SOURCE,
  PANEL_PICK_SERVICE_TO_FIX,
  PANEL_OWN_HINT,
  PANEL_SAMPLE_COUNT,
  PANEL_SELF_HINT,
  PANEL_SHOW_GRAPHS,
  PANEL_TITLE,
  PANEL_TOTAL_HINT,
  PANEL_WATCH,
  PROFILE_ORIGIN_LABELS,
  SORT_BY_SELF,
  SORT_BY_TOTAL,
  VIEW_YOUR_CODE,
} from "./ProfileCopy";
import ProfileFixStrip from "./ProfileFixStrip";
import { findSourceLink } from "./ProfileFunctionTable";
import {
  ProfileFunctionFocus,
  ProfileSourceLink,
  fetchFunctionFocus,
  fetchSourceLinks,
} from "./ProfilesApi";
import useProfileRequest, { ProfileRequestState } from "./UseProfileRequest";

/*
 * ONE FUNCTION, EXPLAINED.
 *
 * Opened from the headline, a row of the function list or a frame of the
 * flame graph, beside the page (the page stays as it was). It says, top to
 * bottom:
 *
 *   - what the function is: its name, its file and line - a link into the
 *     repository that holds it, when one does - and whose code it is;
 *   - how much it takes: self (its own code) and total (with what it
 *     calls) as shares of the window, and - comparing - before and after;
 *   - what can be done: Fix with AI when the server says it applies, a
 *     monitor that alerts when its share passes a threshold set above
 *     today's, and a highlight of it in the flame graph;
 *   - who calls it and what it calls, heaviest first, each a link to its
 *     own panel - and, for those who want them, as two flame graphs.
 */

export interface ComponentProps {
  functionName: string;
  fileName: string;
  // One service (its fix and its monitor), or null for every service.
  serviceId: string | null;
  kind: ProfileKindChoice;
  startTime: Date;
  endTime: Date;
  comparison: ProfilesWindowPair | null;
  // What the comparison says about this function, when comparing.
  change?: ProfileFunctionChange | null | undefined;
  // The source links the page already found.
  sourceLinks: Array<ProfileSourceLink>;
  isHighlighted: boolean;
  onHighlight: () => void;
  onOpenFunction: (row: { functionName: string; fileName: string }) => void;
  onClose: () => void;
}

function toFlamegraphNode(node: ProfileTreeNode): FlamegraphNode {
  return {
    name: node.functionName || "(root)",
    fileName: node.fileName,
    lineNumber: 0,
    frameType: node.frameType || "",
    category: ProfileUtil.getModuleCategory(node.fileName),
    selfValue: node.selfValue,
    totalValue: node.totalValue,
    children: node.children.map(toFlamegraphNode),
  };
}

const ProfileFunctionPanel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const isAiOffered: boolean = useAiOffered();
  const [showGraphs, setShowGraphs] = useState<boolean>(false);

  // Comparing, the function is read in the window after.
  const readWindow: { startTime: Date; endTime: Date } = props.comparison
    ? props.comparison.after
    : { startTime: props.startTime, endTime: props.endTime };

  const serviceIds: Array<string> | undefined = props.serviceId
    ? [props.serviceId]
    : undefined;

  const focusKey: string = [
    props.functionName,
    props.fileName,
    props.serviceId || "",
    props.kind.queryTypes.join(","),
    readWindow.startTime.toISOString(),
    readWindow.endTime.toISOString(),
  ].join("\u0000");

  const focus: ProfileRequestState<ProfileFunctionFocus> =
    useProfileRequest<ProfileFunctionFocus>(focusKey, () => {
      return fetchFunctionFocus({
        functionName: props.functionName,
        fileName: props.fileName,
        window: readWindow,
        serviceIds,
        profileTypes: props.kind.queryTypes,
      });
    });

  const knownLink: ProfileSourceLink | undefined = props.fileName
    ? findSourceLink(
        props.sourceLinks,
        props.fileName,
        focus.data?.lineNumber || 0,
      )
    : undefined;

  // A function the page found no link for yet: asked once, quietly.
  const lookup: ProfileRequestState<Array<ProfileSourceLink>> =
    useProfileRequest<Array<ProfileSourceLink>>(
      props.fileName && !knownLink && focus.data
        ? `${props.fileName}\u0000${focus.data.lineNumber}`
        : null,
      async (): Promise<Array<ProfileSourceLink>> => {
        try {
          return await fetchSourceLinks([
            {
              fileName: props.fileName,
              lineNumber: focus.data?.lineNumber || 0,
            },
          ]);
        } catch {
          return [];
        }
      },
    );

  const sourceLink: ProfileSourceLink | undefined =
    knownLink || (lookup.data ? lookup.data[0] : undefined);

  const origin: ProfileFrameOrigin = getProfileFrameOrigin(
    props.fileName,
    props.functionName,
    focus.data?.callees?.frameType || "",
  );

  const windowTotal: number = focus.data?.windowTotal || 0;
  const selfShare: number = getShareOfWindow(
    focus.data?.selfValue || 0,
    windowTotal,
  );
  const totalShare: number = getShareOfWindow(
    focus.data?.totalValue || 0,
    windowTotal,
  );

  // Its own code, with the library and runtime code it calls (own code only).
  const ownValue: number = focus.data?.callees
    ? getOwnCodeValue(focus.data.callees)
    : 0;
  const ownShare: number = getShareOfWindow(ownValue, windowTotal);

  // Code that is not the application's own is changed through its callers.
  const nearestOwnCaller: { functionName: string; fileName: string } | null =
    useMemo(() => {
      return origin === ProfileFrameOrigin.Own
        ? null
        : getNearestOwnCaller(focus.data?.callers);
    }, [focus.data, origin]);

  const callerChains: Array<ProfileCallChain> = useMemo(() => {
    return focus.data?.callers
      ? getTopCallerChains(focus.data.callers, { limit: 5, depth: 3 })
      : [];
  }, [focus.data]);

  const callees: Array<ProfileCallee> = useMemo(() => {
    return focus.data?.callees
      ? getTopCallees(focus.data.callees, { limit: 8 })
      : [];
  }, [focus.data]);

  const monitorRoute: Route = buildProfileMonitorRoute({
    serviceId: props.serviceId || undefined,
    functionName: props.functionName,
    profileType: props.kind.selection,
    threshold: suggestFunctionShareThreshold(totalShare),
  });

  const where: string = props.fileName
    ? `${ProfileUtil.formatFileName(props.fileName, 96)}${
        focus.data && focus.data.lineNumber > 0
          ? `:${focus.data.lineNumber}`
          : ""
      }`
    : "";

  const functionButton: (row: {
    functionName: string;
    fileName: string;
  }) => ReactElement = (row: {
    functionName: string;
    fileName: string;
  }): ReactElement => {
    return (
      <button
        type="button"
        className="min-w-0 truncate rounded-sm text-left font-mono text-sm text-gray-900 hover:text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        title={
          row.fileName
            ? `${row.functionName} · ${row.fileName}`
            : row.functionName
        }
        onClick={() => {
          props.onOpenFunction(row);
        }}
      >
        {row.functionName || translator.translateText("(anonymous)")}
      </button>
    );
  };

  const shareBar: (share: number) => ReactElement = (
    share: number,
  ): ReactElement => {
    return (
      <div
        className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-100"
        aria-hidden="true"
      >
        <div
          className="h-full rounded-full bg-indigo-400"
          style={{ width: `${Math.min(100, share)}%` }}
        />
      </div>
    );
  };

  const renderBody: () => ReactElement = (): ReactElement => {
    if (focus.error) {
      return (
        <ErrorMessage message={focus.error} onRefreshClick={focus.reload} />
      );
    }

    if (focus.isLoading || !focus.data) {
      return (
        <div className="space-y-3" data-testid="profiles-panel-loading">
          <div className="grid grid-cols-3 gap-3">
            {[0, 1, 2].map((index: number) => {
              return (
                <div
                  key={index}
                  className="h-16 animate-pulse rounded-lg border border-gray-100 bg-gray-50"
                />
              );
            })}
          </div>
          <div className="h-32 animate-pulse rounded-lg border border-gray-100 bg-gray-50" />
        </div>
      );
    }

    const data: ProfileFunctionFocus = focus.data;

    /*
     * Each share under its name and what it counts. From sm the boxes sit
     * side by side; the hints wrap to different lengths (German's run to
     * three lines), so the figures sit at the bottom of their boxes
     * (sm:mt-auto) and line up. On a phone each box is one row - what it
     * counts on the left, the figure on the right - so three figures take
     * a third of the height and the fix below stays in view.
     */
    const stat: (figure: {
      label: string;
      hint: string;
      share: number;
      value: number;
      testId: string;
      isOwn?: boolean;
    }) => ReactElement = (figure: {
      label: string;
      hint: string;
      share: number;
      value: number;
      testId: string;
      isOwn?: boolean;
    }): ReactElement => {
      return (
        <div
          className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 rounded-lg border px-3 py-2 sm:flex sm:flex-col sm:items-stretch ${
            figure.isOwn ? "border-orange-100 bg-orange-50" : "border-gray-200"
          }`}
          data-testid={`${figure.testId}-box`}
        >
          <dt className="row-span-2 text-xs font-medium text-gray-700 sm:row-span-1">
            {translator.translateText(figure.label)}{" "}
            <span className="font-normal text-gray-500">
              {translator.translateText(figure.hint)}
            </span>
          </dt>
          <dd
            className="text-right font-mono text-lg font-semibold text-gray-900 sm:mt-auto sm:pt-0.5 sm:text-left"
            data-testid={figure.testId}
          >
            {formatProfileShare(figure.share)}
          </dd>
          <dd className="text-right text-xs text-gray-500 sm:text-left">
            {formatProfileValue(figure.value, props.kind.unit)}
          </dd>
        </div>
      );
    };

    return (
      <div className="space-y-6">
        <dl
          className={`grid grid-cols-1 gap-2 sm:gap-3 ${
            origin === ProfileFrameOrigin.Own
              ? "sm:grid-cols-3"
              : "sm:grid-cols-2"
          }`}
          data-testid="profiles-panel-stats"
        >
          {stat({
            label: SORT_BY_SELF,
            hint: PANEL_SELF_HINT,
            share: selfShare,
            value: data.selfValue,
            testId: "profiles-panel-self",
          })}
          {stat({
            label: SORT_BY_TOTAL,
            hint: PANEL_TOTAL_HINT,
            share: totalShare,
            value: data.totalValue,
            testId: "profiles-panel-total",
          })}
          {origin === ProfileFrameOrigin.Own ? (
            stat({
              label: VIEW_YOUR_CODE,
              hint: PANEL_OWN_HINT,
              share: ownShare,
              value: ownValue,
              testId: "profiles-panel-own",
              isOwn: true,
            })
          ) : (
            <></>
          )}
        </dl>

        <p
          className="-mt-3 text-xs text-gray-500"
          data-testid="profiles-panel-samples"
        >
          {translator.translatePlural(PANEL_SAMPLE_COUNT, data.sampleCount)}
        </p>

        {props.change ? (
          <p
            className="-mt-3 text-sm text-gray-600"
            data-testid="profiles-panel-change"
          >
            {origin === ProfileFrameOrigin.Own
              ? translator.translateTemplate(PANEL_BEFORE_AFTER_OWN, {
                  before: formatProfileShare(
                    props.change.before?.ownShare || 0,
                  ),
                  after: formatProfileShare(props.change.after?.ownShare || 0),
                })
              : translator.translateTemplate(PANEL_BEFORE_AFTER, {
                  before: formatProfileShare(
                    props.change.before?.selfShare || 0,
                  ),
                  after: formatProfileShare(props.change.after?.selfShare || 0),
                })}
          </p>
        ) : (
          <></>
        )}

        {nearestOwnCaller ? (
          <p
            className="rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-700 ring-1 ring-inset ring-gray-200"
            data-testid="profiles-panel-not-yours"
          >
            <TranslatedSentence
              template={PANEL_NOT_YOUR_CODE}
              slots={{
                function: (
                  <button
                    type="button"
                    className="rounded-sm font-mono font-semibold text-indigo-700 [overflow-wrap:anywhere] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                    data-testid="profiles-panel-own-caller"
                    onClick={() => {
                      props.onOpenFunction(nearestOwnCaller);
                    }}
                  >
                    {nearestOwnCaller.functionName}
                  </button>
                ),
              }}
            />
          </p>
        ) : (
          <></>
        )}

        {props.serviceId ? (
          <ProfileFixStrip
            request={{
              serviceId: props.serviceId,
              functionName: props.functionName,
              fileName: props.fileName,
              profileType: props.kind.selection,
              window: readWindow,
              beforeWindow: props.comparison?.before,
            }}
          />
        ) : isAiOffered && origin === ProfileFrameOrigin.Own ? (
          <p
            className="text-sm text-gray-500"
            data-testid="profiles-panel-pick-service"
          >
            {translator.translateText(PANEL_PICK_SERVICE_TO_FIX)}
          </p>
        ) : (
          <></>
        )}

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-sm font-medium text-indigo-600 hover:text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            aria-pressed={props.isHighlighted}
            data-testid="profiles-panel-highlight"
            onClick={props.onHighlight}
          >
            <Icon icon={IconProp.Search} className="h-4 w-4" />
            {translator.translateText(
              props.isHighlighted
                ? "Clear the flame graph highlight"
                : PANEL_HIGHLIGHT,
            )}
          </button>
          <Link
            to={monitorRoute}
            className="inline-flex items-center gap-1.5 rounded-sm font-medium text-indigo-600 hover:text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            dataTestId="profiles-panel-watch"
          >
            <>
              <Icon icon={IconProp.Bell} className="h-4 w-4" />
              {translator.translateTemplate(PANEL_WATCH, {
                threshold: `${suggestFunctionShareThreshold(totalShare)}%`,
              })}
            </>
          </Link>
        </div>

        <section data-testid="profiles-panel-callers">
          <h3 className="text-sm font-semibold text-gray-900">
            {translator.translateText(PANEL_CALLERS)}
          </h3>
          {callerChains.length === 0 ? (
            <p className="mt-1 text-sm text-gray-500">
              {translator.translateText(PANEL_CALLERS_NONE)}
            </p>
          ) : (
            <ol className="mt-2 space-y-2">
              {callerChains.map((chain: ProfileCallChain, index: number) => {
                const first: { functionName: string; fileName: string } =
                  chain.frames[0]!;
                const share: number = getShareOfWindow(
                  chain.value,
                  windowTotal,
                );

                return (
                  <li key={index} className="min-w-0">
                    <div className="flex min-w-0 items-center justify-between gap-3">
                      {functionButton(first)}
                      <span className="flex-none font-mono text-xs text-gray-600">
                        {formatProfileShare(share)}
                      </span>
                    </div>
                    {chain.frames.length > 1 ? (
                      <p className="truncate font-mono text-xs text-gray-400">
                        {chain.frames
                          .slice(1)
                          .map(
                            (frame: {
                              functionName: string;
                              fileName: string;
                            }): string => {
                              return `← ${frame.functionName}`;
                            },
                          )
                          .join(" ")}
                      </p>
                    ) : (
                      <></>
                    )}
                    {shareBar(share)}
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <section data-testid="profiles-panel-callees">
          <h3 className="text-sm font-semibold text-gray-900">
            {translator.translateText(PANEL_CALLEES)}
          </h3>
          {callees.length === 0 ? (
            <p className="mt-1 text-sm text-gray-500">
              {translator.translateText(PANEL_CALLEES_NONE)}
            </p>
          ) : (
            <ol className="mt-2 space-y-2">
              {callees.map((callee: ProfileCallee) => {
                const share: number = getShareOfWindow(
                  callee.value,
                  windowTotal,
                );
                const calleeOrigin: ProfileFrameOrigin = getProfileFrameOrigin(
                  callee.fileName,
                  callee.functionName,
                  callee.frameType,
                );

                return (
                  <li
                    key={`${callee.functionName}\u0000${callee.fileName}`}
                    className="min-w-0"
                  >
                    <div className="flex min-w-0 items-center justify-between gap-3">
                      {functionButton(callee)}
                      <span className="flex-none text-xs text-gray-500">
                        {translator.translateText(
                          PROFILE_ORIGIN_LABELS[calleeOrigin],
                        )}
                        <span className="ml-2 font-mono text-gray-600">
                          {formatProfileShare(share)}
                        </span>
                      </span>
                    </div>
                    {shareBar(share)}
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        {data.callers || data.callees ? (
          <div>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-sm text-sm font-medium text-gray-600 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              aria-expanded={showGraphs}
              data-testid="profiles-panel-graphs-toggle"
              onClick={() => {
                setShowGraphs(!showGraphs);
              }}
            >
              <Icon
                icon={showGraphs ? IconProp.ChevronDown : IconProp.ChevronRight}
                className="h-4 w-4"
              />
              {translator.translateText(
                showGraphs ? PANEL_HIDE_GRAPHS : PANEL_SHOW_GRAPHS,
              )}
            </button>
            {showGraphs ? (
              <div
                className="mt-3 space-y-5"
                data-testid="profiles-panel-graphs"
              >
                {data.callers ? (
                  <div>
                    <h4 className="mb-2 text-xs font-medium text-gray-500">
                      {translator.translateText(PANEL_CALLERS)}
                    </h4>
                    <FlamegraphView
                      root={toFlamegraphNode(data.callers)}
                      unit={props.kind.unit}
                      compact={true}
                      truncated={data.truncated}
                    />
                  </div>
                ) : (
                  <></>
                )}
                {data.callees ? (
                  <div>
                    <h4 className="mb-2 text-xs font-medium text-gray-500">
                      {translator.translateText(PANEL_CALLEES)}
                    </h4>
                    <FlamegraphView
                      root={toFlamegraphNode(data.callees)}
                      unit={props.kind.unit}
                      compact={true}
                      truncated={data.truncated}
                    />
                  </div>
                ) : (
                  <></>
                )}
              </div>
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

  return (
    <SideOver
      title={PANEL_TITLE}
      description={PANEL_DESCRIPTION}
      onClose={props.onClose}
    >
      <div className="space-y-5" data-testid="profiles-panel">
        <div>
          <h3
            className="break-all font-mono text-base font-semibold text-gray-900"
            data-testid="profiles-panel-name"
          >
            {props.functionName || translator.translateText("(anonymous)")}
          </h3>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            {where ? (
              sourceLink ? (
                <a
                  href={sourceLink.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-w-0 items-center gap-1 font-mono text-indigo-600 hover:text-indigo-800 hover:underline"
                  data-testid="profiles-panel-source-link"
                >
                  <span className="break-all">{where}</span>
                  <Icon
                    icon={IconProp.ExternalLink}
                    className="h-3 w-3 flex-none"
                  />
                  <span className="sr-only">
                    {translator.translateTemplate(PANEL_OPEN_SOURCE, {
                      path: sourceLink.path,
                      repository: sourceLink.repositoryName,
                    })}
                  </span>
                </a>
              ) : (
                <span
                  className="break-all font-mono text-gray-500"
                  data-testid="profiles-panel-file"
                >
                  {where}
                </span>
              )
            ) : (
              <></>
            )}
            <span
              className={`rounded-full px-2 py-0.5 font-medium ${
                origin === ProfileFrameOrigin.Own
                  ? "bg-orange-50 text-orange-700 ring-1 ring-orange-200"
                  : "bg-gray-100 text-gray-600 ring-1 ring-gray-200"
              }`}
              data-testid="profiles-panel-origin"
            >
              {translator.translateText(PROFILE_ORIGIN_LABELS[origin])}
            </span>
          </div>
        </div>
        {renderBody()}
      </div>
    </SideOver>
  );
};

export default ProfileFunctionPanel;
