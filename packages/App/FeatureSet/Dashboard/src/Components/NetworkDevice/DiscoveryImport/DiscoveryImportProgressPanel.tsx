import AppLink from "../../AppLink/AppLink";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import {
  DiscoveryImportDeviceOutcome,
  DiscoveryImportHostResult,
  DiscoveryImportMonitorOutcome,
  DiscoveryImportView,
} from "Common/Types/NetworkDevice/DiscoveryImport";
import ObjectID from "Common/Types/ObjectID";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Icon from "Common/UI/Components/Icon/Icon";
import ProgressBar, {
  ProgressBarSize,
} from "Common/UI/Components/ProgressBar/ProgressBar";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import {
  DiscoveryImportIssueGroup,
  DiscoveryImportIssueHost,
  DiscoveryImportIssueKind,
  DiscoveryImportPhase,
  DiscoveryImportProgressModel,
  getDiscoveryImportProgressModel,
} from "./DiscoveryImportProgressModel";

/*
 * THE IMPORT, AS IT RUNS AND WHEN IT IS DONE (OneUptime issue #4812).
 *
 * Two bars, because a device and its monitor are separate work that fails
 * separately - the devices bar counts every host dealt with, the monitors
 * bar every monitor - each with what is behind its number: imported, already
 * there, failed. Under them the hosts that did not end well, grouped by the
 * server's own reason, so five hundred hosts refused for one reason read as
 * one line with five hundred names behind it, not five hundred lines.
 *
 * Everything here is read from the import's record on the server: closing
 * the dialog, leaving the page or opening it in another tab shows the same
 * import where it stands, and the bars keep moving with the dialog closed.
 */

export interface DiscoveryImportProgressPanelProps {
  view: DiscoveryImportView;
  // Every host's result, once fetched for the full list.
  allResults: Array<DiscoveryImportHostResult> | null;
  isLoadingAllResults: boolean;
  allResultsError?: string | undefined;
  onShowAllResults: () => void;
  now?: number | undefined;
}

function deviceRoute(deviceId: string): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.NETWORK_DEVICE_VIEW] as Route,
    { modelId: new ObjectID(deviceId) },
  );
}

function monitorRoute(monitorId: string): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.MONITOR_VIEW] as Route,
    { modelId: new ObjectID(monitorId) },
  );
}

export function getIssueGroupTitle(
  translator: Translator,
  group: DiscoveryImportIssueGroup,
): string {
  const count: number = group.hosts.length;

  switch (group.kind) {
    case DiscoveryImportIssueKind.DeviceFailed:
      return translator.translatePlural(
        {
          one: "{{count}} host was not imported",
          other: "{{count}} hosts were not imported",
        },
        count,
        { count: translator.formatNumber(count) },
      );
    case DiscoveryImportIssueKind.MonitorFailed:
      return translator.translatePlural(
        {
          one: "{{count}} device was imported without its monitor",
          other: "{{count}} devices were imported without their monitors",
        },
        count,
        { count: translator.formatNumber(count) },
      );
    case DiscoveryImportIssueKind.NotReached:
      return translator.translatePlural(
        {
          one: "{{count}} host was not reached",
          other: "{{count}} hosts were not reached",
        },
        count,
        { count: translator.formatNumber(count) },
      );
    default:
      return translator.translatePlural(
        {
          one: "{{count}} device has no monitor from this import",
          other: "{{count}} devices have no monitor from this import",
        },
        count,
        { count: translator.formatNumber(count) },
      );
  }
}

// How many host names an issue group shows before "and N more".
export const ISSUE_GROUP_NAMES_SHOWN: number = 12;

// A host in an issue group: its name, and its address when that is not the name.
export function getIssueHostLabel(host: DiscoveryImportIssueHost): string {
  return host.name && host.name !== host.ipAddress
    ? `${host.name} (${host.ipAddress})`
    : host.ipAddress;
}

/*
 * A group of more hosts than it names: "and 18 more" opens the list of every
 * host, and Show fewer under the list folds it back to the names (issue
 * #5364: it used to open for good, the button gone). Each press hands focus
 * to the button that undoes it, which is drawn where the other one was not.
 */
const IssueGroup: FunctionComponent<{
  group: DiscoveryImportIssueGroup;
}> = (props: { group: DiscoveryImportIssueGroup }): ReactElement => {
  const translator: Translator = useTranslator();
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  // Set by a press, until focus has moved to the button that undoes it.
  const isTogglingRef: React.MutableRefObject<boolean> = useRef<boolean>(false);
  const moreButtonRef: React.RefObject<HTMLButtonElement> =
    useRef<HTMLButtonElement>(null);
  const fewerButtonRef: React.RefObject<HTMLButtonElement> =
    useRef<HTMLButtonElement>(null);
  const hostListId: string = `discovery-import-issue-hosts-${useId()}`;
  const group: DiscoveryImportIssueGroup = props.group;

  useEffect(() => {
    if (!isTogglingRef.current) {
      return;
    }

    isTogglingRef.current = false;
    (isExpanded ? fewerButtonRef : moreButtonRef).current?.focus();
  }, [isExpanded]);

  const toggle: (expand: boolean) => void = (expand: boolean): void => {
    isTogglingRef.current = true;
    setIsExpanded(expand);
  };
  const isWarning: boolean =
    group.kind === DiscoveryImportIssueKind.DeviceFailed ||
    group.kind === DiscoveryImportIssueKind.MonitorFailed;
  const previewHosts: Array<DiscoveryImportIssueHost> = group.hosts.slice(
    0,
    ISSUE_GROUP_NAMES_SHOWN,
  );
  const hiddenCount: number = group.hosts.length - previewHosts.length;

  return (
    <li
      className="px-4 py-3"
      data-testid={`discovery-import-issue-${group.kind}`}
    >
      <div className="flex items-start gap-2">
        <Icon
          icon={isWarning ? IconProp.Alert : IconProp.Info}
          className={`mt-0.5 h-4 w-4 flex-shrink-0 ${
            isWarning ? "text-red-500" : "text-gray-400"
          }`}
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-900">
            {getIssueGroupTitle(translator, group)}
          </p>
          {group.reason && (
            <p
              className="mt-0.5 break-words text-sm text-gray-600"
              data-testid="discovery-import-issue-reason"
            >
              {translator.translateText(group.reason) || group.reason}
            </p>
          )}
          {isExpanded ? (
            <>
              {/*
               * Every host, one a line, in a box of its own height: a group
               * can hold thousands, and a paragraph of five hundred names
               * would push the rest of the summary out of reach.
               */}
              <ul
                id={hostListId}
                className="mt-2 grid max-h-48 grid-cols-1 gap-x-6 gap-y-1 overflow-y-auto rounded-md border border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-600 sm:grid-cols-2"
                data-testid={`discovery-import-issue-hosts-${group.kind}`}
              >
                {group.hosts.map(
                  (host: DiscoveryImportIssueHost, index: number) => {
                    const label: string = getIssueHostLabel(host);

                    return (
                      <li
                        key={`${host.ipAddress}-${index}`}
                        className="truncate"
                        title={label}
                      >
                        {label}
                      </li>
                    );
                  },
                )}
              </ul>
              <button
                ref={fewerButtonRef}
                type="button"
                aria-expanded={isExpanded}
                aria-controls={hostListId}
                className="mt-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-700 focus:outline-none focus-visible:underline"
                data-testid={`discovery-import-issue-fewer-${group.kind}`}
                onClick={() => {
                  toggle(false);
                }}
              >
                {translator.translateText("Show fewer")}
              </button>
            </>
          ) : (
            <p className="mt-1 break-words text-xs text-gray-500">
              {previewHosts.map(getIssueHostLabel).join(", ")}
              {hiddenCount > 0 && (
                <>
                  {" "}
                  <button
                    ref={moreButtonRef}
                    type="button"
                    aria-expanded={isExpanded}
                    className="font-medium text-indigo-600 hover:text-indigo-700 focus:outline-none focus-visible:underline"
                    data-testid={`discovery-import-issue-more-${group.kind}`}
                    onClick={() => {
                      toggle(true);
                    }}
                  >
                    {translator.translatePlural(
                      {
                        one: "and {{count}} more",
                        other: "and {{count}} more",
                      },
                      hiddenCount,
                      { count: translator.formatNumber(hiddenCount) },
                    )}
                  </button>
                </>
              )}
            </p>
          )}
        </div>
      </div>
    </li>
  );
};

function deviceOutcomeLabel(
  translator: Translator,
  result: DiscoveryImportHostResult,
): string {
  switch (result.device) {
    case DiscoveryImportDeviceOutcome.Created:
      return translator.translateText("Imported") as string;
    case DiscoveryImportDeviceOutcome.AlreadyAdded:
      return translator.translateText("Already added") as string;
    case DiscoveryImportDeviceOutcome.Failed:
      return translator.translateText("Not imported") as string;
    case DiscoveryImportDeviceOutcome.NotReached:
      return translator.translateText("Not reached") as string;
    default:
      return translator.translateText("Waiting") as string;
  }
}

function monitorOutcomeLabel(
  translator: Translator,
  result: DiscoveryImportHostResult,
): string {
  switch (result.monitor) {
    case DiscoveryImportMonitorOutcome.Created:
      return translator.translateText("Monitor created") as string;
    case DiscoveryImportMonitorOutcome.AlreadyThere:
      return translator.translateText("Already monitored") as string;
    case DiscoveryImportMonitorOutcome.Failed:
      return translator.translateText("Monitor failed") as string;
    case DiscoveryImportMonitorOutcome.Skipped:
      return translator.translateText("No monitor") as string;
    case DiscoveryImportMonitorOutcome.NotRequested:
      return "";
    default:
      return translator.translateText("Waiting") as string;
  }
}

const ResultsList: FunctionComponent<{
  results: Array<DiscoveryImportHostResult>;
}> = (props: { results: Array<DiscoveryImportHostResult> }): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <ul
      className="max-h-80 divide-y divide-gray-100 overflow-y-auto"
      data-testid="discovery-import-results"
    >
      {props.results.map(
        (result: DiscoveryImportHostResult, index: number): ReactElement => {
          const monitorLabel: string = monitorOutcomeLabel(translator, result);

          return (
            <li
              key={`${result.ipAddress}-${index}`}
              className="flex flex-col gap-1 px-4 py-2 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                {result.deviceId ? (
                  <AppLink
                    to={deviceRoute(result.deviceId)}
                    className="block truncate text-sm font-medium text-gray-900 hover:underline"
                  >
                    {result.name || result.ipAddress}
                  </AppLink>
                ) : (
                  <p className="truncate text-sm font-medium text-gray-900">
                    {result.name || result.ipAddress}
                  </p>
                )}
                <p className="truncate text-xs text-gray-500">
                  {result.ipAddress}
                </p>
              </div>
              <div className="flex flex-shrink-0 flex-wrap items-center gap-2 text-xs">
                <span
                  className={`rounded-full px-2 py-0.5 font-medium ${
                    result.device === DiscoveryImportDeviceOutcome.Failed
                      ? "bg-red-50 text-red-700"
                      : result.device === DiscoveryImportDeviceOutcome.Created
                        ? "bg-green-50 text-green-700"
                        : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {deviceOutcomeLabel(translator, result)}
                </span>
                {monitorLabel ? (
                  result.monitorId ? (
                    <AppLink
                      to={monitorRoute(result.monitorId)}
                      className="rounded-full bg-indigo-50 px-2 py-0.5 font-medium text-indigo-700 hover:underline"
                    >
                      {monitorLabel}
                    </AppLink>
                  ) : (
                    <span
                      className={`rounded-full px-2 py-0.5 font-medium ${
                        result.monitor === DiscoveryImportMonitorOutcome.Failed
                          ? "bg-red-50 text-red-700"
                          : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {monitorLabel}
                    </span>
                  )
                ) : (
                  <></>
                )}
              </div>
            </li>
          );
        },
      )}
    </ul>
  );
};

export function getPhaseTitle(
  translator: Translator,
  model: DiscoveryImportProgressModel,
): string {
  switch (model.phase) {
    case DiscoveryImportPhase.Starting:
      return translator.translateText("Starting the import…") as string;
    case DiscoveryImportPhase.Waiting:
      return translator.translateText(
        "Waiting for another import in this project to finish",
      ) as string;
    case DiscoveryImportPhase.Running:
      return translator.translatePlural(
        {
          one: "Importing {{count}} device…",
          other: "Importing {{count}} devices…",
        },
        model.hostCount,
        { count: translator.formatNumber(model.hostCount) },
      );
    case DiscoveryImportPhase.Stopping:
      return translator.translateText(
        "Stopping after the host being imported now…",
      ) as string;
    case DiscoveryImportPhase.Finished:
      return translator.translateText("Import finished") as string;
    case DiscoveryImportPhase.Stopped:
      return translator.translateText("Import stopped") as string;
    default:
      return translator.translateText("The import could not finish") as string;
  }
}

/*
 * The line under the headline: what the reader can do now. A stopped import
 * has nothing to fix - the reader stopped it - so it says what stays and
 * what Retry does instead of asking for a fix.
 */
export function getPhaseDescription(
  translator: Translator,
  model: DiscoveryImportProgressModel,
  view: DiscoveryImportView,
): string {
  if (model.phase === DiscoveryImportPhase.Waiting) {
    return translator.translateText(
      "Imports in a project run one at a time, so the same address is never imported twice. This one starts as soon as the one before it finishes.",
    ) as string;
  }

  if (model.phase === DiscoveryImportPhase.Stopping) {
    return translator.translateText(
      "What it has imported so far stays.",
    ) as string;
  }

  if (model.isActive) {
    return translator.translateText(
      "You can close this window: the import carries on, and Review Results shows where it stands.",
    ) as string;
  }

  if (model.retryableCount > 0) {
    return model.phase === DiscoveryImportPhase.Stopped
      ? (translator.translateText(
          "What it imported before it stopped stays. Retry tries the rest again, and nothing is created twice.",
        ) as string)
      : (translator.translateText(
          "Fix what is listed below, then retry: only those hosts are tried again, and nothing is created twice.",
        ) as string);
  }

  /*
   * "Monitored from" only when every device got its monitor: a device that
   * takes its status from a monitor bound to it is skipped, and listed below.
   */
  if (
    view.monitorTemplateName &&
    model.progress.monitorsRequested > 0 &&
    model.progress.monitorsSkipped === 0
  ) {
    return translator.translateTemplate(
      "Every host is in the inventory, monitored from “{{template}}”.",
      { template: view.monitorTemplateName },
    );
  }

  return translator.translateText("Every host is in the inventory.") as string;
}

const DiscoveryImportProgressPanel: FunctionComponent<
  DiscoveryImportProgressPanelProps
> = (props: DiscoveryImportProgressPanelProps): ReactElement => {
  const translator: Translator = useTranslator();
  const model: DiscoveryImportProgressModel = getDiscoveryImportProgressModel(
    props.view,
    props.now,
  );
  const progress: DiscoveryImportView["progress"] = model.progress;
  const devicesInCount: number =
    progress.devicesCreated + progress.devicesAlreadyAdded;

  const deviceParts: Array<string> = [
    translator.translatePlural(
      { one: "{{count}} imported", other: "{{count}} imported" },
      progress.devicesCreated,
      { count: translator.formatNumber(progress.devicesCreated) },
    ),
  ];

  if (progress.devicesAlreadyAdded > 0) {
    deviceParts.push(
      translator.translatePlural(
        { one: "{{count}} already there", other: "{{count}} already there" },
        progress.devicesAlreadyAdded,
        { count: translator.formatNumber(progress.devicesAlreadyAdded) },
      ),
    );
  }

  if (progress.devicesFailed > 0) {
    deviceParts.push(
      translator.translatePlural(
        { one: "{{count}} failed", other: "{{count}} failed" },
        progress.devicesFailed,
        { count: translator.formatNumber(progress.devicesFailed) },
      ),
    );
  }

  if (progress.devicesNotReached > 0) {
    deviceParts.push(
      translator.translatePlural(
        { one: "{{count}} not reached", other: "{{count}} not reached" },
        progress.devicesNotReached,
        { count: translator.formatNumber(progress.devicesNotReached) },
      ),
    );
  }

  const monitorParts: Array<string> = [
    translator.translatePlural(
      { one: "{{count}} created", other: "{{count}} created" },
      progress.monitorsCreated,
      { count: translator.formatNumber(progress.monitorsCreated) },
    ),
  ];

  if (progress.monitorsAlreadyThere > 0) {
    monitorParts.push(
      translator.translatePlural(
        { one: "{{count}} already there", other: "{{count}} already there" },
        progress.monitorsAlreadyThere,
        { count: translator.formatNumber(progress.monitorsAlreadyThere) },
      ),
    );
  }

  if (progress.monitorsFailed > 0) {
    monitorParts.push(
      translator.translatePlural(
        { one: "{{count}} failed", other: "{{count}} failed" },
        progress.monitorsFailed,
        { count: translator.formatNumber(progress.monitorsFailed) },
      ),
    );
  }

  if (progress.monitorsSkipped > 0) {
    monitorParts.push(
      translator.translatePlural(
        { one: "{{count}} skipped", other: "{{count}} skipped" },
        progress.monitorsSkipped,
        { count: translator.formatNumber(progress.monitorsSkipped) },
      ),
    );
  }

  const isDone: boolean = !model.isActive;

  return (
    <div className="space-y-5" data-testid="discovery-import-progress">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={`mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${
            model.phase === DiscoveryImportPhase.Failed
              ? "bg-red-50 text-red-600"
              : isDone
                ? model.retryableCount > 0
                  ? "bg-amber-50 text-amber-600"
                  : "bg-green-50 text-green-600"
                : "bg-indigo-50 text-indigo-600"
          }`}
        >
          <Icon
            icon={
              model.phase === DiscoveryImportPhase.Failed
                ? IconProp.Alert
                : isDone
                  ? model.retryableCount > 0
                    ? IconProp.Alert
                    : IconProp.CheckCircle
                  : IconProp.Spinner
            }
            className={`h-4 w-4 ${isDone ? "" : "motion-safe:animate-spin"}`}
          />
        </span>
        <div className="min-w-0">
          <h4
            className="text-base font-semibold text-gray-900"
            data-testid="discovery-import-progress-title"
            role="status"
            aria-live="polite"
          >
            {getPhaseTitle(translator, model)}
          </h4>
          <p className="mt-0.5 text-sm text-gray-500">
            {getPhaseDescription(translator, model, props.view)}
          </p>
        </div>
      </div>

      {props.view.error && (
        <Alert
          type={AlertType.DANGER}
          title={translator.translateText(props.view.error) || props.view.error}
          dataTestId="discovery-import-error"
        />
      )}

      {/*
       * Side by side when there are monitors to count too; the devices bar
       * alone takes the width rather than half of it.
       */}
      <div
        className={`grid grid-cols-1 gap-5 ${
          model.monitorsRequested > 0 ? "md:grid-cols-2" : ""
        }`}
      >
        <div data-testid="discovery-import-devices-progress">
          <ProgressBar
            count={model.devicesReached}
            totalCount={model.hostCount}
            suffix="Devices"
            size={ProgressBarSize.Small}
          />
          <p
            className="mt-2 text-xs text-gray-500"
            data-testid="discovery-import-devices-counts"
          >
            {deviceParts.join(" · ")}
          </p>
        </div>
        {model.monitorsRequested > 0 ? (
          <div data-testid="discovery-import-monitors-progress">
            <ProgressBar
              count={model.monitorsReached}
              totalCount={model.monitorsRequested}
              suffix="Monitors"
              size={ProgressBarSize.Small}
            />
            <p
              className="mt-2 text-xs text-gray-500"
              data-testid="discovery-import-monitors-counts"
            >
              {monitorParts.join(" · ")}
            </p>
          </div>
        ) : (
          <></>
        )}
      </div>

      {model.issueGroups.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-gray-200">
          <ul
            className="divide-y divide-gray-100"
            data-testid="discovery-import-issues"
          >
            {model.issueGroups.map(
              (group: DiscoveryImportIssueGroup, index: number) => {
                return (
                  <IssueGroup key={`${group.kind}-${index}`} group={group} />
                );
              },
            )}
          </ul>
          {model.hasMoreIssues && (
            <p className="border-t border-gray-100 px-4 py-2 text-xs text-gray-500">
              {translator.translateText(
                "More hosts than listed here ended the same way. Show every host to see them all.",
              )}
            </p>
          )}
        </div>
      )}

      {isDone && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            {devicesInCount > 0 && (
              <AppLink
                to={RouteUtil.populateRouteParams(
                  RouteMap[PageMap.NETWORK_DEVICES] as Route,
                )}
                className="font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
              >
                {translator.translateText("View devices") as string}
              </AppLink>
            )}
            {progress.monitorsCreated + progress.monitorsAlreadyThere > 0 && (
              <AppLink
                to={RouteUtil.populateRouteParams(
                  RouteMap[PageMap.MONITORS] as Route,
                )}
                className="font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
              >
                {translator.translateText("View monitors") as string}
              </AppLink>
            )}
            {!props.allResults && (
              <button
                type="button"
                data-testid="discovery-import-show-all"
                disabled={props.isLoadingAllResults}
                className="font-medium text-indigo-600 hover:text-indigo-700 hover:underline focus:outline-none focus-visible:underline disabled:cursor-wait disabled:text-indigo-300"
                onClick={props.onShowAllResults}
              >
                {translator.translatePlural(
                  {
                    one: "Show the host",
                    other: "Show every host ({{count}})",
                  },
                  model.hostCount,
                  { count: translator.formatNumber(model.hostCount) },
                )}
              </button>
            )}
          </div>
          {props.allResultsError && (
            <Alert
              type={AlertType.WARNING}
              title={props.allResultsError}
              dataTestId="discovery-import-all-results-error"
            />
          )}
          {props.allResults && (
            <div className="overflow-hidden rounded-lg border border-gray-200">
              <ResultsList results={props.allResults} />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default DiscoveryImportProgressPanel;
