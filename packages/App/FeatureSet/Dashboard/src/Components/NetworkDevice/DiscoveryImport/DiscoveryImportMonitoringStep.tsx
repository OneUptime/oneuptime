import { DiscoveredNetworkDevice } from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import {
  DISCOVERY_IMPORT_POLLING_INTERVALS_IN_MINUTES,
  DiscoveryImportAlerting,
  DiscoveryImportSettings,
} from "Common/Types/NetworkDevice/DiscoveryImport";
import ActiveMonitorLimitUtil from "Common/Types/Monitor/ActiveMonitorLimit";
import { MonitorCriteriaAlertSummary } from "Common/Utils/Monitor/MonitorTemplateAlertSummary";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import ChoiceRows from "Common/UI/Components/ChoiceRows/ChoiceRows";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import Loader, { LoaderType } from "Common/UI/Components/Loader/Loader";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import { VeryLightGray } from "Common/Types/BrandColors";
import { PluralTemplate, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import { ActiveMonitorLimitAlert } from "../../Monitor/ActiveMonitorLimitNotice";
import { IMPORT_VENDOR_TEMPLATES_TOGGLE_TITLE } from "../BulkDeviceActionTitles";
import {
  DiscoveryImportAlertReach,
  DiscoveryImportOutcome,
  DiscoveryImportTemplateChoice,
  getDiscoveryImportOutcome,
} from "./DiscoveryImportOutcome";
import {
  DiscoveryImportProjectFacts,
  NamedColor,
} from "./DiscoveryImportProjectFacts";

/*
 * THE IMPORT'S SECOND STEP: HOW THE DEVICES ARE MONITORED (OneUptime issues
 * #4811 and #4815).
 *
 * Three questions, each answered before anything is created, and one plain
 * account of what the answers add up to:
 *
 *   - How often the scan's probe checks each device (its polling interval).
 *   - Whether each SNMP device gets its vendor's health template.
 *   - Who hears about a problem: nobody but the device's own status, or a
 *     monitor per device from a Network Device monitor template - the
 *     recommended alert pack, or any template of the project - previewed
 *     check by check: what it watches, whether it opens an incident or an
 *     alert and at what severity, and whether it can fire on a device that
 *     only answers ping.
 *
 * The account on the right ("What this import does") is worked out from the
 * same choices the import is sent with (getDiscoveryImportOutcome), so it can
 * never promise something the import will not do.
 */

export interface DiscoveryImportMonitoringStepProps {
  hosts: Array<DiscoveredNetworkDevice>;
  probeName?: string | undefined;
  settings: DiscoveryImportSettings;
  onSettingsChange: (settings: DiscoveryImportSettings) => void;
  facts: DiscoveryImportProjectFacts | null;
  isLoadingFacts: boolean;
  factsError?: string | undefined;
  // The template the settings pick, worked out by the dialog.
  template: DiscoveryImportTemplateChoice | null;
  isDisabled?: boolean | undefined;
}

// The value a recommended template Import would create is picked by.
export const RECOMMENDED_TEMPLATE_CHOICE_VALUE: string = "recommended";

export function getTemplateChoiceValue(
  choice: DiscoveryImportTemplateChoice,
): string {
  return choice.id || RECOMMENDED_TEMPLATE_CHOICE_VALUE;
}

const MINUTES: PluralTemplate = {
  one: "Every minute",
  other: "Every {{count}} minutes",
};

export function getPollingIntervalLabel(
  translator: Translator,
  minutes: number,
): string {
  if (minutes === 60) {
    return translator.translateText("Every hour") as string;
  }

  return translator.translatePlural(MINUTES, minutes);
}

function names(
  ids: Array<string>,
  lookup: Map<string, NamedColor> | undefined,
): string {
  return ids
    .map((id: string): string => {
      return lookup?.get(id)?.name || "";
    })
    .filter((name: string): boolean => {
      return Boolean(name);
    })
    .join(", ");
}

const TemplateCheckLine: FunctionComponent<{
  criterion: MonitorCriteriaAlertSummary;
  index: number;
  facts: DiscoveryImportProjectFacts | null;
  hasPingOnlyHosts: boolean;
}> = (props: {
  criterion: MonitorCriteriaAlertSummary;
  index: number;
  facts: DiscoveryImportProjectFacts | null;
  hasPingOnlyHosts: boolean;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const criterion: MonitorCriteriaAlertSummary = props.criterion;

  const incidentSeverities: string = names(
    criterion.incidentSeverityIds,
    props.facts?.incidentSeverities,
  );
  const alertSeverities: string = names(
    criterion.alertSeverityIds,
    props.facts?.alertSeverities,
  );
  const statusName: string = criterion.monitorStatusId
    ? props.facts?.monitorStatuses.get(criterion.monitorStatusId)?.name || ""
    : "";

  const actions: Array<string> = [];

  if (criterion.raisesIncident) {
    actions.push(
      incidentSeverities
        ? translator.translateTemplate("Opens an incident ({{severity}})", {
            severity: incidentSeverities,
          })
        : (translator.translateText("Opens an incident") as string),
    );
  }

  if (criterion.raisesAlert) {
    actions.push(
      alertSeverities
        ? translator.translateTemplate("Creates an alert ({{severity}})", {
            severity: alertSeverities,
          })
        : (translator.translateText("Creates an alert") as string),
    );
  }

  if (criterion.changesStatus && statusName) {
    actions.push(
      translator.translateTemplate("Marks the monitor {{status}}", {
        status: statusName,
      }),
    );
  }

  if (actions.length === 0) {
    actions.push(
      translator.translateText(
        "Raises nothing: it only decides the monitor's status",
      ) as string,
    );
  }

  if (criterion.onCallPolicyIds.length > 0) {
    actions.push(
      translator.translatePlural(
        {
          one: "Pages {{count}} on-call policy",
          other: "Pages {{count}} on-call policies",
        },
        criterion.onCallPolicyIds.length,
      ),
    );
  }

  return (
    <li
      className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4"
      data-testid="discovery-import-template-check"
    >
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-900">
          {criterion.name ||
            translator.translateTemplate("Check {{number}}", {
              number: props.index + 1,
            })}
        </p>
        <p className="text-xs text-gray-500">{actions.join(" · ")}</p>
      </div>
      {props.hasPingOnlyHosts && !criterion.isEvaluatedOnPingOnlyDevices && (
        <span
          className="inline-flex flex-shrink-0 items-center self-start rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600"
          title={translator.translateText(
            "This check reads an SNMP walk. A device that answers ping only is pinged, not walked, so this check never fires on it until it has SNMP credentials.",
          )}
        >
          {translator.translateText("SNMP devices only")}
        </span>
      )}
    </li>
  );
};

const DiscoveryImportMonitoringStep: FunctionComponent<
  DiscoveryImportMonitoringStepProps
> = (props: DiscoveryImportMonitoringStepProps): ReactElement => {
  const translator: Translator = useTranslator();
  const facts: DiscoveryImportProjectFacts | null = props.facts;
  const settings: DiscoveryImportSettings = props.settings;

  const outcome: DiscoveryImportOutcome = getDiscoveryImportOutcome({
    hosts: props.hosts,
    settings: settings,
    template: props.template,
    policies: facts?.policies || [],
    monitorRoom: facts?.monitorRoom ?? null,
  });

  const isAtMonitorLimit: boolean = Boolean(
    facts?.monitorLimitStatus &&
      ActiveMonitorLimitUtil.isAtOrOverLimit(facts.monitorLimitStatus),
  );

  /*
   * Why "A monitor for each device" cannot be picked, when it cannot: the
   * reader may not create monitors, or the project has no template and
   * cannot have one made. (A plan with no room says so with its own notice
   * above the choices.)
   */
  const monitorsLockedReason: string | undefined = !facts
    ? undefined
    : !facts.canCreateMonitors.isAllowed
      ? facts.canCreateMonitors.disabledReason ||
        (translator.translateText(
          "You may not create monitors in this project, so the import cannot give the devices one.",
        ) as string)
      : facts.templates.length === 0
        ? facts.templatesUnavailableReason ||
          (translator.translateText(
            "This project has no Network Device monitor template to monitor the devices with.",
          ) as string)
        : undefined;

  /*
   * With no way to give the devices a monitor, the only answer is "Status
   * only": the choices are shown locked on it, with why underneath, rather
   * than as a radio that does nothing when pressed.
   */
  const choiceLockedReason: string | undefined =
    monitorsLockedReason ||
    (isAtMonitorLimit
      ? (translator.translateText(
          "Your plan has no room for more monitors, so the devices are imported without one.",
        ) as string)
      : undefined);

  const templateOptions: Array<DropdownOption> = (facts?.templates || []).map(
    (choice: DiscoveryImportTemplateChoice): DropdownOption => {
      return {
        value: getTemplateChoiceValue(choice),
        label: choice.isCreatedOnImport
          ? translator.translateTemplate("{{name}} - created when you import", {
              name: choice.name,
            })
          : choice.name,
      };
    },
  );

  const selectedTemplateOption: DropdownOption | undefined = props.template
    ? templateOptions.find((option: DropdownOption): boolean => {
        return option.value === getTemplateChoiceValue(props.template!);
      })
    : undefined;

  const enabledChecks: Array<MonitorCriteriaAlertSummary> = (
    props.template?.summary.criteria || []
  ).filter((criterion: MonitorCriteriaAlertSummary): boolean => {
    return criterion.isEnabled;
  });

  const turnedOffChecks: number =
    (props.template?.summary.criteria.length || 0) - enabledChecks.length;

  const intervalLabel: string = getPollingIntervalLabel(
    translator,
    settings.pollingIntervalInMinutes,
  ).toLowerCase();

  const templatePicker: ReactElement = (
    <div className="space-y-3" data-testid="discovery-import-template-picker">
      <div>
        <FieldLabelElement
          title="Monitor template"
          required={true}
          hideOptionalLabel={true}
          description="Network Device templates read each device's own polls. Edit a template under Monitors > Settings > Templates; monitors made from it follow."
        />
        <Dropdown
          id="discovery-import-template"
          dataTestId="discovery-import-template"
          ariaLabel={translator.translateText("Monitor template")}
          options={templateOptions}
          value={selectedTemplateOption}
          isClearable={false}
          disabled={props.isDisabled}
          placeholder="Pick a template"
          onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
            const picked: string = Array.isArray(value)
              ? String(value[0] || "")
              : String(value || "");

            props.onSettingsChange({
              ...settings,
              monitorTemplateId: picked,
            });
          }}
        />
      </div>
      {props.template && (
        <div
          className="rounded-lg border border-gray-200 bg-white px-3"
          data-testid="discovery-import-template-preview"
        >
          <p className="pt-3 text-xs font-medium uppercase tracking-wide text-gray-500">
            {translator.translateText("What each monitor checks")}
          </p>
          {enabledChecks.length === 0 ? (
            <p className="py-3 text-sm text-gray-500">
              {translator.translateText(
                "This template has no checks turned on, so its monitors raise nothing.",
              )}
            </p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {enabledChecks.map(
                (
                  criterion: MonitorCriteriaAlertSummary,
                  index: number,
                ): ReactElement => {
                  return (
                    <TemplateCheckLine
                      key={criterion.id}
                      criterion={criterion}
                      index={index}
                      facts={facts}
                      hasPingOnlyHosts={outcome.pingOnlyHostCount > 0}
                    />
                  );
                },
              )}
            </ul>
          )}
          <p className="border-t border-gray-100 py-2 text-xs text-gray-500">
            {turnedOffChecks > 0
              ? translator.translatePlural(
                  {
                    one: "Checked every time a device is polled, {{interval}}. {{count}} more check is turned off in this template.",
                    other:
                      "Checked every time a device is polled, {{interval}}. {{count}} more checks are turned off in this template.",
                  },
                  turnedOffChecks,
                  { interval: intervalLabel },
                )
              : translator.translateTemplate(
                  "Checked every time a device is polled, {{interval}}.",
                  { interval: intervalLabel },
                )}
          </p>
        </div>
      )}
    </div>
  );

  return (
    <div
      className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]"
      data-testid="discovery-import-monitoring-step"
    >
      <div className="space-y-6">
        <section className="space-y-4">
          <div>
            <h4 className="text-sm font-semibold text-gray-900">
              {translator.translateText("How often they are checked")}
            </h4>
            <p className="mt-0.5 text-sm text-gray-500">
              {props.probeName
                ? translator.translateTemplate(
                    "{{probe}}, the probe that ran the scan, pings every device on this schedule and walks the ones that answered SNMP for interfaces, inventory and health. You can change it on each device later.",
                    { probe: props.probeName },
                  )
                : translator.translateText(
                    "The probe that ran the scan pings every device on this schedule and walks the ones that answered SNMP for interfaces, inventory and health. You can change it on each device later.",
                  )}
            </p>
          </div>
          <div className="max-w-xs">
            <FieldLabelElement
              title="Check every"
              required={true}
              hideOptionalLabel={true}
            />
            <Dropdown
              id="discovery-import-interval"
              dataTestId="discovery-import-interval"
              ariaLabel={translator.translateText("Check every")}
              isClearable={false}
              disabled={props.isDisabled}
              options={DISCOVERY_IMPORT_POLLING_INTERVALS_IN_MINUTES.map(
                (minutes: number): DropdownOption => {
                  return {
                    value: minutes,
                    label: getPollingIntervalLabel(translator, minutes),
                  };
                },
              )}
              value={{
                value: settings.pollingIntervalInMinutes,
                label: getPollingIntervalLabel(
                  translator,
                  settings.pollingIntervalInMinutes,
                ),
              }}
              onChange={(
                value: DropdownValue | Array<DropdownValue> | null,
              ) => {
                const minutes: number = Number(
                  Array.isArray(value) ? value[0] : value,
                );

                if (DISCOVERY_IMPORT_POLLING_INTERVALS_IN_MINUTES.includes(minutes)) {
                  props.onSettingsChange({
                    ...settings,
                    pollingIntervalInMinutes: minutes,
                  });
                }
              }}
            />
          </div>
          {outcome.snmpHostCount > 0 && (
            <Toggle
              title={translator.translatePlural(
                IMPORT_VENDOR_TEMPLATES_TOGGLE_TITLE,
                outcome.snmpHostCount,
                { count: translator.formatNumber(outcome.snmpHostCount) },
              )}
              description="Each device gets the health OIDs and SNMP tables for its vendor — CPU, memory, temperature, fans — as auto import rules do. A device whose vendor has no template is left as it is, and anything applied can be changed on the device's Settings."
              initialValue={settings.applyVendorTemplates}
              value={settings.applyVendorTemplates}
              disabled={props.isDisabled}
              dataTestId="discovered-device-apply-vendor-templates"
              onChange={(value: boolean) => {
                props.onSettingsChange({
                  ...settings,
                  applyVendorTemplates: value,
                });
              }}
            />
          )}
        </section>

        <section className="space-y-3">
          <div>
            <h4 className="text-sm font-semibold text-gray-900">
              {translator.translateText("Alerts and incidents")}
            </h4>
            <p className="mt-0.5 text-sm text-gray-500">
              {translator.translateText(
                "Polling tells you whether each device is up. A monitor is what opens an incident or an alert when it is not.",
              )}
            </p>
          </div>
          {props.isLoadingFacts ? (
            <div className="flex items-center gap-2 py-4 text-sm text-gray-500">
              <Loader loaderType={LoaderType.Bar} color={VeryLightGray} />
            </div>
          ) : (
            <>
              {props.factsError && (
                <Alert
                  type={AlertType.WARNING}
                  title={props.factsError}
                  dataTestId="discovery-import-facts-error"
                />
              )}
              {isAtMonitorLimit && facts?.monitorLimitStatus && (
                <ActiveMonitorLimitAlert status={facts.monitorLimitStatus} />
              )}
              <div className="-mx-1 overflow-hidden rounded-lg border border-gray-200 [&>div>div]:px-4 md:[&>div>div]:px-4">
                <ChoiceRows<DiscoveryImportAlerting>
                  ariaLabel="Who hears about a problem with an imported device"
                  dataTestId="discovery-import-alerting"
                  value={
                    choiceLockedReason
                      ? DiscoveryImportAlerting.None
                      : settings.alerting
                  }
                  isLocked={props.isDisabled}
                  lockedReason={choiceLockedReason}
                  options={[
                    {
                      value: DiscoveryImportAlerting.None,
                      title: "Status only",
                      description:
                        "Each device shows Up or Down on its page, its site and the map. This import creates no monitors.",
                      dataTestId: "discovery-import-alerting-none",
                    },
                    {
                      value: DiscoveryImportAlerting.MonitorTemplate,
                      title: "A monitor for each device",
                      description:
                        "Each device gets a Network Device monitor from the template you pick, and raises the incidents and alerts the template defines. Each monitor counts towards your plan.",
                      dataTestId: "discovery-import-alerting-template",
                      details:
                        !choiceLockedReason &&
                        settings.alerting ===
                          DiscoveryImportAlerting.MonitorTemplate
                          ? templatePicker
                          : undefined,
                    },
                  ]}
                  onPick={(value: DiscoveryImportAlerting) => {
                    props.onSettingsChange({
                      ...settings,
                      alerting: value,
                    });
                  }}
                />
              </div>
              {facts && facts.policies.length > 0 && (
                <PolicyNote
                  coveringPolicyNames={outcome.coveringPolicyNames}
                  scopedPolicyCount={outcome.scopedPolicyCount}
                />
              )}
            </>
          )}
        </section>
      </div>

      <OutcomeSummary
        outcome={outcome}
        intervalLabel={intervalLabel}
        monitorRoom={facts?.monitorRoom ?? null}
      />
    </div>
  );
};

const PolicyNote: FunctionComponent<{
  coveringPolicyNames: Array<string>;
  scopedPolicyCount: number;
}> = (props: {
  coveringPolicyNames: Array<string>;
  scopedPolicyCount: number;
}): ReactElement => {
  const translator: Translator = useTranslator();

  if (props.coveringPolicyNames.length === 0 && props.scopedPolicyCount === 0) {
    return <></>;
  }

  return (
    <p
      className="text-xs text-gray-500"
      data-testid="discovery-import-policy-note"
    >
      {props.coveringPolicyNames.length > 0
        ? translator.translateTemplate(
            "Your alert policy {{names}} also gives every device a monitor of its own, whichever you choose here.",
            {
              names: props.coveringPolicyNames
                .map((name: string): string => {
                  return `“${name}”`;
                })
                .join(", "),
            },
          )
        : translator.translatePlural(
            {
              one: "{{count}} alert policy covers devices by site, role or label: it gives these devices its monitor once they match it.",
              other:
                "{{count}} alert policies cover devices by site, role or label: each gives these devices its monitor once they match it.",
            },
            props.scopedPolicyCount,
          )}
    </p>
  );
};

/*
 * "What this import does": the outcome, in sentences, from the same data
 * the import is sent with.
 */
export const OutcomeSummary: FunctionComponent<{
  outcome: DiscoveryImportOutcome;
  intervalLabel: string;
  monitorRoom: number | null;
}> = (props: {
  outcome: DiscoveryImportOutcome;
  intervalLabel: string;
  monitorRoom: number | null;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const outcome: DiscoveryImportOutcome = props.outcome;

  const lines: Array<{ key: string; text: string; tone?: "warning" }> = [];

  if (outcome.snmpHostCount > 0) {
    lines.push({
      key: "snmp",
      text: translator.translatePlural(
        {
          one: "{{count}} device answered SNMP: it is walked {{interval}} for interfaces, inventory and health, with the credentials that answered it.",
          other:
            "{{count}} devices answered SNMP: they are walked {{interval}} for interfaces, inventory and health, with the credentials that answered them.",
        },
        outcome.snmpHostCount,
        {
          count: translator.formatNumber(outcome.snmpHostCount),
          interval: props.intervalLabel,
        },
      ),
    });
  }

  if (outcome.pingOnlyHostCount > 0) {
    lines.push({
      key: "ping",
      text: translator.translatePlural(
        {
          one: "{{count}} device answered ping only: it is pinged {{interval}}. Add SNMP credentials later to walk it too.",
          other:
            "{{count}} devices answered ping only: they are pinged {{interval}}. Add SNMP credentials later to walk them too.",
        },
        outcome.pingOnlyHostCount,
        {
          count: translator.formatNumber(outcome.pingOnlyHostCount),
          interval: props.intervalLabel,
        },
      ),
    });
  }

  if (outcome.appliesVendorTemplates) {
    lines.push({
      key: "vendor",
      text: translator.translateText(
        "SNMP devices get their vendor's health template on their first poll.",
      ) as string,
    });
  }

  if (outcome.template && outcome.monitorCount > 0) {
    const raises: string =
      outcome.raisesIncidents && outcome.raisesAlerts
        ? (translator.translateText(
            "opens incidents and creates alerts as its checks are met",
          ) as string)
        : outcome.raisesIncidents
          ? (translator.translateText(
              "opens incidents as its checks are met",
            ) as string)
          : outcome.raisesAlerts
            ? (translator.translateText(
                "creates alerts as its checks are met",
              ) as string)
            : (translator.translateText(
                "raises nothing: none of its checks opens an incident or creates an alert",
              ) as string);

    lines.push({
      key: "monitors",
      text: translator.translatePlural(
        {
          one: "{{count}} monitor from “{{template}}”, which {{raises}}.",
          other:
            "{{count}} monitors, one per device, from “{{template}}”, which {{raises}}.",
        },
        outcome.monitorCount,
        {
          count: translator.formatNumber(outcome.monitorCount),
          template: outcome.template.name,
          raises: raises,
        },
      ),
      ...(outcome.raisesIncidents || outcome.raisesAlerts
        ? {}
        : { tone: "warning" as const }),
    });

    if (outcome.pingOnlyHostsWithoutAlerts > 0) {
      lines.push({
        key: "ping-silent",
        tone: "warning",
        text: translator.translatePlural(
          {
            one: "Every check of this template reads an SNMP walk, so the {{count}} device that answers ping only will raise nothing until it has SNMP credentials.",
            other:
              "Every check of this template reads an SNMP walk, so the {{count}} devices that answer ping only will raise nothing until they have SNMP credentials.",
          },
          outcome.pingOnlyHostsWithoutAlerts,
          { count: translator.formatNumber(outcome.pingOnlyHostsWithoutAlerts) },
        ),
      });
    }

    if (outcome.monitorsBeyondRoom > 0) {
      lines.push({
        key: "room",
        tone: "warning",
        text: translator.translatePlural(
          {
            one: "Your plan has room for {{room}} more monitors, so {{count}} device will be imported without one.",
            other:
              "Your plan has room for {{room}} more monitors, so {{count}} devices will be imported without one.",
          },
          outcome.monitorsBeyondRoom,
          {
            count: translator.formatNumber(outcome.monitorsBeyondRoom),
            room: translator.formatNumber(Math.max(0, props.monitorRoom || 0)),
          },
        ),
      });
    }
  } else if (outcome.reach === DiscoveryImportAlertReach.Policies) {
    lines.push({
      key: "policies",
      text: translator.translateTemplate(
        "No monitors from this import. Your alert policy {{names}} gives every device its monitor.",
        {
          names: outcome.coveringPolicyNames
            .map((name: string): string => {
              return `“${name}”`;
            })
            .join(", "),
        },
      ),
    });
  } else {
    lines.push({
      key: "nobody",
      tone: "warning",
      text: translator.translateText(
        "No monitors: nobody is alerted when one of these devices goes down. Pick a monitor template, or set up an alert policy later.",
      ) as string,
    });
  }

  return (
    <aside
      className="h-fit rounded-xl border border-gray-200 bg-gray-50 p-4 lg:sticky lg:top-0"
      data-testid="discovery-import-outcome"
      aria-label={translator.translateText("What this import does")}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
        {translator.translateText("What this import does")}
      </p>
      <p
        className="mt-1 text-2xl font-semibold text-gray-900"
        data-testid="discovery-import-outcome-count"
      >
        {translator.translatePlural(
          { one: "{{count}} device", other: "{{count}} devices" },
          outcome.hostCount,
          { count: translator.formatNumber(outcome.hostCount) },
        )}
      </p>
      <ul className="mt-3 space-y-2.5">
        {lines.map(
          (line: { key: string; text: string; tone?: "warning" }) => {
            return (
              <li
                key={line.key}
                className={`flex gap-2 text-sm ${
                  line.tone === "warning" ? "text-amber-800" : "text-gray-700"
                }`}
                data-testid={`discovery-import-outcome-${line.key}`}
              >
                <span
                  aria-hidden="true"
                  className={`mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full ${
                    line.tone === "warning" ? "bg-amber-500" : "bg-gray-400"
                  }`}
                />
                <span>{line.text}</span>
              </li>
            );
          },
        )}
      </ul>
    </aside>
  );
};

export default DiscoveryImportMonitoringStep;
