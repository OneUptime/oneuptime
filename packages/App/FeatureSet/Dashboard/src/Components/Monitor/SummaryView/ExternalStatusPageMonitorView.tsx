import OneUptimeDate from "Common/Types/Date";
import ProbeAttempt from "Common/Types/Probe/ProbeAttempt";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import ExternalStatusPageMonitorResponse, {
  ExternalStatusPageComponentStatus,
} from "Common/Types/Monitor/ExternalStatusPageMonitor/ExternalStatusPageMonitorResponse";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Statusbubble from "Common/UI/Components/StatusBubble/StatusBubble";
import React, { FunctionComponent, ReactElement, useId } from "react";
import ProbeAttemptsView from "./ProbeAttemptsView";
import { SummaryFact, SummaryFacts, SummaryView } from "./SummaryFacts";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import ExternalStatusPageComponentStatusDisplayUtil, {
  ExternalStatusPageComponentStatusDisplay,
} from "../../../Utils/ExternalStatusPageComponentStatusDisplay";
import ExternalStatusPageComponentsCopy from "../../Form/Monitor/ExternalStatusPageMonitor/ExternalStatusPageComponentsCopy";

export const EXTERNAL_STATUS_PAGE_UNMATCHED_TEST_ID: string =
  "external-status-page-unmatched-components";
export const EXTERNAL_STATUS_PAGE_OUTSIDE_INCIDENTS_TEST_ID: string =
  "external-status-page-incidents-outside-scope";

/*
 * What a check watched of the page: the components it chose (a check made
 * before a monitor could choose several names its one filter instead), or
 * none for the whole page.
 */
export const getWatchedComponentNames: (
  response: ExternalStatusPageMonitorResponse | undefined,
) => Array<string> = (
  response: ExternalStatusPageMonitorResponse | undefined,
): Array<string> => {
  if (Array.isArray(response?.componentNames)) {
    return response!.componentNames;
  }

  return response?.componentName ? [response.componentName] : [];
};

// The Scope fact: the whole page, a group, the chosen components, or both.
export const getScopeText: (data: {
  translator: Translator;
  componentGroupName: string | undefined;
  componentNames: Array<string>;
}) => string = (data: {
  translator: Translator;
  componentGroupName: string | undefined;
  componentNames: Array<string>;
}): string => {
  const group: string | undefined = data.componentGroupName;
  const names: Array<string> = data.componentNames;

  if (names.length === 0) {
    return group
      ? data.translator.translateTemplate("Group: {{group}}", { group: group })
      : data.translator.translateTemplate("All components");
  }

  if (names.length === 1) {
    return group
      ? `${group} › ${names[0]}`
      : data.translator.translateTemplate("Component: {{component}}", {
          component: names[0] as string,
        });
  }

  return group
    ? data.translator.translatePlural(
        {
          one: "{{group}} › {{count}} chosen component",
          other: "{{group}} › {{count}} chosen components",
        },
        names.length,
        { group: group },
      )
    : data.translator.translatePlural(
        {
          one: "{{count}} chosen component",
          other: "{{count}} chosen components",
        },
        names.length,
      );
};

export interface ComponentProps {
  probeMonitorResponse: ProbeMonitorResponse;
  probeName?: string | undefined;
}

/*
 * The facts are SummaryFacts, which every monitor type's summary shares:
 * two to a row, four once the view itself is 64rem wide. The view is drawn
 * in places of very different widths at one screen width - the overview's
 * Summary card (two thirds of the page), Test Monitor's result and
 * Monitoring Logs' View Summary (wide dialogs) - so its own width decides,
 * not the screen's: four to a row in the Summary card left a value such as
 * degraded_performance no room. A fact's title may break inside a word,
 * hyphenated in the reader's language: two cards to a row on a phone leave
 * "GELTUNGSBEREICH" (Scope, in German) no room on one line.
 */

// Runs of underscores in a status value ("degraded_performance").
const UNDERSCORES: RegExp = /(_+)/;

/*
 * A status value as the criteria compare it - under_maintenance - with a
 * line break allowed after each underscore, so a narrow card wraps it as
 * "under_" / "maintenance" instead of cutting it. <wbr> adds no character:
 * the value copies as it is.
 */
const withBreaksAfterUnderscores: (value: string) => ReactElement = (
  value: string,
): ReactElement => {
  return (
    <>
      {value
        .split(UNDERSCORES)
        .map((part: string, index: number): ReactElement => {
          return (
            <React.Fragment key={index}>
              {part}
              {part.startsWith("_") ? <wbr /> : <></>}
            </React.Fragment>
          );
        })}
    </>
  );
};

/*
 * What one check of an external status page found: on the monitor's
 * Summary, in Test Monitor's result and in Monitoring Logs. First the
 * check - which probe, whether the page answered, how fast, when - and why
 * it failed, when it did; then what the page said - the provider, its
 * overall status, its active incidents and the scope; then each component
 * in scope as a row: its name, its group and what the page says of it, and
 * its status in the words and colour the Component Status criteria use
 * (ExternalStatusPageComponentStatusDisplay). The status sits at the end of
 * the row from sm up and under the name below it, by breakpoint rather than
 * by wrapping, so a long name never moves its own status alone.
 */
const ExternalStatusPageMonitorView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const componentsHeadingId: string = useId();
  const externalStatusPageResponse:
    | ExternalStatusPageMonitorResponse
    | undefined = props.probeMonitorResponse?.externalStatusPageResponse;

  let responseTimeInMs: number =
    externalStatusPageResponse?.responseTimeInMs || 0;

  if (responseTimeInMs > 0) {
    responseTimeInMs = Math.round(responseTimeInMs);
  }

  const probeAttempts: Array<ProbeAttempt> =
    props.probeMonitorResponse.probeAttempts || [];
  const totalAttempts: number =
    props.probeMonitorResponse.totalAttempts ?? probeAttempts.length;
  const hadRetries: boolean = totalAttempts > 1;

  const scopeText: string = getScopeText({
    translator: translator,
    componentGroupName: externalStatusPageResponse?.componentGroupName,
    componentNames: getWatchedComponentNames(externalStatusPageResponse),
  });

  /*
   * The page's incidents the scope leaves out - those of other components,
   * and those that name none - said beside the count, so a quiet monitor
   * during an outage elsewhere on the page reads as one that left it out.
   */
  const incidentsOutsideScope: number =
    externalStatusPageResponse?.incidentsOutsideScopeCount || 0;

  // The chosen names the page does not list: watched, they watch nothing.
  const unmatchedNames: Array<string> =
    externalStatusPageResponse?.unmatchedComponentNames || [];

  const components: Array<ExternalStatusPageComponentStatus> =
    externalStatusPageResponse?.componentStatuses || [];

  // The line under a component's name: its group, and what the page says.
  const getComponentDetail: (
    component: ExternalStatusPageComponentStatus,
  ) => string = (component: ExternalStatusPageComponentStatus): string => {
    const parts: Array<string> = [];

    if (component.groupName?.trim()) {
      parts.push(component.groupName.trim());
    }

    if (
      component.description?.trim() &&
      !ExternalStatusPageComponentStatusDisplayUtil.isDescriptionTheStatus({
        description: component.description,
        status: component.status,
      })
    ) {
      parts.push(component.description.trim());
    }

    return parts.join(" · ");
  };

  return (
    <SummaryView dataTestId="external-status-page-summary">
      <SummaryFacts dataTestId="external-status-page-check-facts">
        <SummaryFact title="Probe" value={props.probeName || "-"} />
        <SummaryFact
          title="Status"
          value={translator.translateTemplate(
            props.probeMonitorResponse.isOnline ? "Online" : "Offline",
          )}
        />
        <SummaryFact
          title="Response Time"
          value={responseTimeInMs ? responseTimeInMs + " ms" : "-"}
        />
        <SummaryFact
          title="Monitored At"
          value={
            props.probeMonitorResponse?.monitoredAt
              ? OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                  props.probeMonitorResponse.monitoredAt,
                )
              : "-"
          }
        />
      </SummaryFacts>

      {props.probeMonitorResponse.failureCause && (
        <SummaryFacts dataTestId="external-status-page-error">
          <SummaryFact
            isWide={true}
            title="Error"
            value={props.probeMonitorResponse.failureCause?.toString() || "-"}
          />
        </SummaryFacts>
      )}

      <SummaryFacts dataTestId="external-status-page-page-facts">
        <SummaryFact
          title="Provider"
          value={externalStatusPageResponse?.provider || "-"}
        />
        <SummaryFact
          title="Overall Status"
          value={
            externalStatusPageResponse?.overallStatus
              ? withBreaksAfterUnderscores(
                  externalStatusPageResponse.overallStatus,
                )
              : "-"
          }
        />
        <SummaryFact
          title="Active Incidents"
          value={
            incidentsOutsideScope > 0 ? (
              <>
                {externalStatusPageResponse?.activeIncidentCount?.toString() ||
                  "0"}
                <span
                  className="mt-0.5 block text-xs text-gray-500"
                  data-testid={EXTERNAL_STATUS_PAGE_OUTSIDE_INCIDENTS_TEST_ID}
                >
                  {translator.translatePlural(
                    {
                      one: "{{count}} more on the page, not counted",
                      other: "{{count}} more on the page, not counted",
                    },
                    incidentsOutsideScope,
                  )}
                </span>
              </>
            ) : (
              externalStatusPageResponse?.activeIncidentCount?.toString() || "0"
            )
          }
        />
        <SummaryFact title="Scope" value={scopeText} />
      </SummaryFacts>

      {unmatchedNames.length > 0 && (
        <p
          className="flex items-start gap-2 break-words rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-inset ring-amber-200"
          data-testid={EXTERNAL_STATUS_PAGE_UNMATCHED_TEST_ID}
        >
          <Icon icon={IconProp.Alert} className="mt-0.5 h-4 w-4 flex-none" />
          <span className="min-w-0">
            {ExternalStatusPageComponentsCopy.unmatchedSentence(
              translator,
              unmatchedNames,
            )}
          </span>
        </p>
      )}

      {components.length > 0 && (
        <div className="space-y-3">
          <h3
            id={componentsHeadingId}
            className="text-sm font-medium text-gray-700"
          >
            {translator.translateText("Component Statuses")}
          </h3>
          <ul
            className="divide-y divide-gray-200 rounded-lg border border-gray-200"
            aria-labelledby={componentsHeadingId}
            data-testid="external-status-page-components"
          >
            {components.map(
              (
                component: ExternalStatusPageComponentStatus,
                index: number,
              ): ReactElement => {
                const display: ExternalStatusPageComponentStatusDisplay =
                  ExternalStatusPageComponentStatusDisplayUtil.getDisplay(
                    component.status,
                  );
                const detail: string = getComponentDetail(component);

                return (
                  <li
                    key={index}
                    data-testid="external-status-page-component"
                    className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                  >
                    <div className="min-w-0 sm:flex-1">
                      <div
                        className="break-words text-sm font-medium text-gray-900"
                        data-testid="external-status-page-component-name"
                      >
                        {component.name}
                      </div>
                      {detail ? (
                        <div
                          className="mt-0.5 break-words text-xs text-gray-500"
                          data-testid="external-status-page-component-detail"
                        >
                          {detail}
                        </div>
                      ) : (
                        <></>
                      )}
                    </div>
                    <div
                      className="sm:flex-none"
                      data-testid="external-status-page-component-status"
                      data-status={component.status}
                    >
                      <Statusbubble
                        text={display.label}
                        color={display.color}
                        shouldAnimate={false}
                      />
                    </div>
                  </li>
                );
              },
            )}
          </ul>
        </div>
      )}

      {hadRetries && (
        <ProbeAttemptsView
          attempts={probeAttempts}
          totalAttempts={totalAttempts}
        />
      )}
    </SummaryView>
  );
};

export default ExternalStatusPageMonitorView;
