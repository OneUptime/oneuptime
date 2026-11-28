import AppLink from "../../AppLink/AppLink";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import {
  MonitorTemplateChangeOutcome,
  MonitorTemplateChangeView,
} from "Common/Types/Monitor/MonitorTemplateChange";
import ObjectID from "Common/Types/ObjectID";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Icon from "Common/UI/Components/Icon/Icon";
import ProgressBar, {
  ProgressBarSize,
} from "Common/UI/Components/ProgressBar/ProgressBar";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import { getErrorInSentenceText } from "Common/UI/Utils/ErrorInSentence";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";
import {
  MonitorTemplateChangeIssueGroup,
  MonitorTemplateChangePhase,
  getIssueGroupTitle,
  getMonitorTemplateChangeCounts,
  getMonitorTemplateChangeDescription,
  getMonitorTemplateChangeIssueGroups,
  getMonitorTemplateChangePhase,
  getMonitorTemplateChangeTitle,
  getMonitorsReached,
  isMonitorTemplateChangePhaseActive,
} from "./MonitorTemplateChangeModel";

/*
 * A CHANGE OF MANY MONITORS' TEMPLATE, AS IT RUNS AND WHEN IT IS DONE
 * (issues #11260, #11266).
 *
 * One bar - the monitors dealt with of those asked for - with what is
 * behind its number (linked, linked already, left out, failed, not
 * reached, and the open incidents and alerts resolved), and under it the
 * monitors that did not end well, grouped by the server's reason: a
 * thousand monitors refused for one reason read as one line with a thousand
 * names behind it. Everything is read from the change's record on the
 * server, so closing the dialog, leaving the page or opening the template on
 * another screen shows the same change where it stands.
 */

export interface ComponentProps {
  view: MonitorTemplateChangeView;
  now?: number | undefined;
}

// How many names a group shows before "and N more".
const NAMES_SHOWN: number = 8;

function monitorRoute(monitorId: string): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.MONITOR_VIEW] as Route,
    { modelId: new ObjectID(monitorId) },
  );
}

const IssueGroup: FunctionComponent<{
  group: MonitorTemplateChangeIssueGroup;
}> = (props: { group: MonitorTemplateChangeIssueGroup }): ReactElement => {
  const translator: Translator = useTranslator();
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const shown: Array<{ id: string; name?: string | undefined }> = isOpen
    ? props.group.monitors
    : props.group.monitors.slice(0, NAMES_SHOWN);
  const hidden: number = props.group.monitors.length - shown.length;

  return (
    <li className="px-4 py-3" data-testid="monitor-template-change-issue">
      <div className="flex items-start gap-2">
        <Icon
          icon={
            props.group.outcome === MonitorTemplateChangeOutcome.Skipped
              ? IconProp.Info
              : IconProp.Alert
          }
          className={`mt-0.5 h-4 w-4 flex-shrink-0 ${
            props.group.outcome === MonitorTemplateChangeOutcome.Failed
              ? "text-red-500"
              : "text-amber-500"
          }`}
        />
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium text-gray-900">
            {getIssueGroupTitle(translator, props.group)}
          </p>
          {props.group.reason && (
            <p className="text-sm text-gray-600">
              {getErrorInSentenceText({
                message: props.group.reason,
                translator: translator,
              })}
            </p>
          )}
          <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
            {shown.map((monitor: { id: string; name?: string | undefined }) => {
              return (
                <li key={monitor.id}>
                  <AppLink
                    to={monitorRoute(monitor.id)}
                    className="font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
                  >
                    <IsolatedText
                      text={
                        monitor.name ||
                        (translator.translateText("Monitor") as string)
                      }
                    />
                  </AppLink>
                </li>
              );
            })}
          </ul>
          {hidden > 0 && (
            <button
              type="button"
              className="text-xs font-medium text-indigo-600 hover:text-indigo-700 hover:underline focus:outline-none focus-visible:underline"
              data-testid="monitor-template-change-issue-more"
              onClick={() => {
                setIsOpen(true);
              }}
            >
              {translator.translatePlural(
                { one: "Show {{count}} more", other: "Show {{count}} more" },
                hidden,
                { count: translator.formatNumber(hidden) },
              )}
            </button>
          )}
        </div>
      </div>
    </li>
  );
};

const MonitorTemplateChangeProgress: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const phase: MonitorTemplateChangePhase = getMonitorTemplateChangePhase(
    props.view,
    props.now,
  );
  const isActive: boolean = isMonitorTemplateChangePhaseActive(phase);
  const isFailed: boolean =
    phase === MonitorTemplateChangePhase.Failed ||
    (props.view.settings.deleteTemplateWhenDone &&
      !isActive &&
      !props.view.isTemplateDeleted);
  const hasIssues: boolean = props.view.retryableCount > 0;
  const counts: Array<string> = getMonitorTemplateChangeCounts({
    translator: translator,
    view: props.view,
  });
  const groups: Array<MonitorTemplateChangeIssueGroup> =
    getMonitorTemplateChangeIssueGroups(props.view.lines);

  return (
    <div className="space-y-5" data-testid="monitor-template-change-progress">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={`mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${
            isFailed
              ? "bg-red-50 text-red-600"
              : isActive
                ? "bg-indigo-50 text-indigo-600"
                : hasIssues || props.view.progress.skipped > 0
                  ? "bg-amber-50 text-amber-600"
                  : "bg-green-50 text-green-600"
          }`}
        >
          <Icon
            icon={
              isActive
                ? IconProp.Spinner
                : isFailed || hasIssues || props.view.progress.skipped > 0
                  ? IconProp.Alert
                  : IconProp.CheckCircle
            }
            className={`h-4 w-4 ${isActive ? "motion-safe:animate-spin" : ""}`}
          />
        </span>
        <div className="min-w-0">
          <h4
            className="text-base font-semibold text-gray-900"
            data-testid="monitor-template-change-title"
            role="status"
            aria-live="polite"
          >
            {getMonitorTemplateChangeTitle({
              translator: translator,
              view: props.view,
              phase: phase,
            })}
          </h4>
          <p className="mt-0.5 text-sm text-gray-500">
            {getMonitorTemplateChangeDescription({
              translator: translator,
              view: props.view,
              phase: phase,
            })}
          </p>
        </div>
      </div>

      {props.view.error && (
        <Alert
          type={AlertType.DANGER}
          title={getErrorInSentenceText({
            message: props.view.error,
            translator: translator,
          })}
          dataTestId="monitor-template-change-error"
        />
      )}

      {props.view.progress.total > 0 && (
        <div data-testid="monitor-template-change-bar">
          <ProgressBar
            count={getMonitorsReached(props.view.progress)}
            totalCount={props.view.progress.total}
            suffix="Monitors"
            size={ProgressBarSize.Small}
          />
          {counts.length > 0 && (
            <p
              className="mt-2 text-xs text-gray-500"
              data-testid="monitor-template-change-counts"
            >
              {counts.join(" · ")}
            </p>
          )}
        </div>
      )}

      {groups.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-gray-200">
          <ul
            className="divide-y divide-gray-100"
            data-testid="monitor-template-change-issues"
          >
            {groups.map(
              (group: MonitorTemplateChangeIssueGroup, index: number) => {
                return (
                  <IssueGroup key={`${group.outcome}-${index}`} group={group} />
                );
              },
            )}
          </ul>
          {props.view.isLinesTruncated && (
            <p className="border-t border-gray-100 px-4 py-2 text-xs text-gray-500">
              {translator.translateText(
                "More monitors than listed here ended the same way.",
              )}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default MonitorTemplateChangeProgress;
