import { DiscoveredNetworkDevice } from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import {
  DISCOVERY_IMPORT_POLLING_INTERVALS_IN_MINUTES,
  DiscoveryImportAlerting,
  DiscoveryImportSettings,
} from "Common/Types/NetworkDevice/DiscoveryImport";
import ActiveMonitorLimitUtil from "Common/Types/Monitor/ActiveMonitorLimit";
import MonitorType from "Common/Types/Monitor/MonitorType";
import { MonitorCriteriaAlertSummary } from "Common/Utils/Monitor/MonitorTemplateAlertSummary";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import ChoiceRows from "Common/UI/Components/ChoiceRows/ChoiceRows";
import Dropdown, {
  DropdownOption,
  DropdownOptionGroup,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import CompactLoader from "Common/UI/Components/ComponentLoader/CompactLoader";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import { BILLING_ENABLED } from "Common/UI/Config";
import {
  TemplateValue,
  Translator,
  translatableTerm,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import { getMonitoringIntervalLabel } from "../../../Utils/MonitorIntervalDropdownOptions";
import { ActiveMonitorLimitAlert } from "../../Monitor/ActiveMonitorLimitNotice";
import { IMPORT_VENDOR_TEMPLATES_TOGGLE_TITLE } from "../BulkDeviceActionTitles";
import {
  getPollingIntervalLabel,
  getPollingIntervalOptions,
} from "./PollingIntervalLabels";
import {
  DiscoveryImportAlertReach,
  DiscoveryImportOutcome,
  DiscoveryImportTemplateChoice,
  checksDeviceAddress,
  getDiscoveryImportOutcome,
  getTemplateChoiceValue,
} from "./DiscoveryImportOutcome";
import {
  DiscoveryImportProjectFacts,
  NamedColor,
} from "./DiscoveryImportProjectFacts";
import {
  ADDRESS_TEMPLATES_GROUP_TITLE,
  LISTED_TEMPLATE_KINDS_RULE,
  MANAGE_TEMPLATES_LINK_TITLE,
  POLL_TEMPLATES_GROUP_TITLE,
  UNNAMED_TEMPLATE_NAME,
} from "./DiscoveryImportTemplateCopy";

/*
 * THE IMPORT'S SECOND STEP: HOW THE DEVICES ARE MONITORED (OneUptime issues
 * #4811, #4815 and #5145).
 *
 * Three questions, each answered before anything is created, and one plain
 * account of what the answers add up to:
 *
 *   - How often the scan's probe checks each device (its polling interval).
 *   - Whether each SNMP device gets its vendor's health template.
 *   - Who hears about a problem: nobody but the device's own status, or a
 *     monitor per device from a template - the recommended alert pack, or
 *     any of the project's templates a device's monitor can be made from: a
 *     Network Device one, whose monitor reads each device's polls, or a
 *     Ping, IP, Port or NTP one, whose monitor checks each device's address
 *     from the scan's probe (#5145: a customer's own Ping template never
 *     showed). One line under the list says which kinds are listed, beside
 *     a link to the templates. The picked one is previewed check by check:
 *     what each device gets, when it is checked, what each check raises and
 *     at what severity, and, for a Network Device template, which checks
 *     need an SNMP walk a device that only answers ping does not get.
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

/*
 * The probe an address monitor runs from, as a sentence names it: the
 * scan's probe by name, or - when the dialog does not know its name - the
 * probe that ran the scan, translated with the sentence it sits in.
 */
function probeValue(probeName: string | undefined): TemplateValue {
  return (
    probeName ||
    translatableTerm("the probe that ran the scan", { inSentence: true })
  );
}

// A template's name as the step draws it: as someone typed it.
export function getTemplateChoiceName(
  translator: Translator,
  choice: DiscoveryImportTemplateChoice,
): string {
  return (
    choice.name || (translator.translateText(UNNAMED_TEMPLATE_NAME) as string)
  );
}

/*
 * What a Ping, IP, Port or NTP template's monitor does, in the words its
 * option in the list carries under its name.
 */
export function describeAddressTemplate(
  translator: Translator,
  choice: DiscoveryImportTemplateChoice,
): string {
  if (choice.monitorType === MonitorType.IP) {
    return translator.translateText("Pings each device's IP address") as string;
  }

  if (choice.monitorType === MonitorType.Port) {
    const ports: Array<number> = choice.ports || [];

    if (ports.length === 1) {
      return translator.translateTemplate(
        "Checks port {{port}} on each device",
        { port: String(ports[0]) },
      );
    }

    if (ports.length > 1) {
      return translator.translateTemplate(
        "Checks ports {{ports}} on each device",
        { ports: ports.join(", ") },
      );
    }

    return translator.translateText("Checks a port on each device") as string;
  }

  if (choice.monitorType === MonitorType.NTP) {
    return translator.translateText("Asks each device for the time") as string;
  }

  return translator.translateText("Pings each device") as string;
}

/*
 * The first line of the picked template's preview: what each device gets.
 */
export function getTemplateLead(
  translator: Translator,
  choice: DiscoveryImportTemplateChoice,
  probeName: string | undefined,
): string {
  const probe: TemplateValue = probeValue(probeName);

  if (choice.monitorType === MonitorType.Ping) {
    return translator.translateTemplate(
      "Each device gets a Ping monitor that pings its own address from {{probe}}.",
      { probe: probe },
    );
  }

  if (choice.monitorType === MonitorType.IP) {
    return translator.translateTemplate(
      "Each device gets an IP monitor that pings its own IP address from {{probe}}.",
      { probe: probe },
    );
  }

  if (choice.monitorType === MonitorType.Port) {
    const ports: Array<number> = choice.ports || [];

    if (ports.length === 1) {
      return translator.translateTemplate(
        "Each device gets a Port monitor that checks port {{port}} on its own address from {{probe}}.",
        { port: String(ports[0]), probe: probe },
      );
    }

    if (ports.length > 1) {
      return translator.translateTemplate(
        "Each device gets a Port monitor that checks ports {{ports}} on its own address from {{probe}}.",
        { ports: ports.join(", "), probe: probe },
      );
    }

    return translator.translateTemplate(
      "Each device gets a Port monitor that checks its own address from {{probe}}.",
      { probe: probe },
    );
  }

  if (choice.monitorType === MonitorType.NTP) {
    return translator.translateTemplate(
      "Each device gets an NTP monitor that asks its own address for the time from {{probe}}.",
      { probe: probe },
    );
  }

  return translator.translateText(
    "Each device gets a Network Device monitor that reads what its polls find.",
  ) as string;
}

const TemplateCheckLine: FunctionComponent<{
  criterion: MonitorCriteriaAlertSummary;
  index: number;
  facts: DiscoveryImportProjectFacts | null;
  dataTestId?: string | undefined;
}> = (props: {
  criterion: MonitorCriteriaAlertSummary;
  index: number;
  facts: DiscoveryImportProjectFacts | null;
  dataTestId?: string | undefined;
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
      className="py-2"
      data-testid={props.dataTestId || "discovery-import-template-check"}
    >
      <p className="text-sm font-medium text-gray-900">
        {criterion.name ||
          translator.translateTemplate("Check {{number}}", {
            number: props.index + 1,
          })}
      </p>
      <p className="text-xs text-gray-500">{actions.join(" · ")}</p>
    </li>
  );
};

/*
 * The picked template, check by check, under one line that says what each
 * device gets and one that says when its monitor checks.
 *
 * A Network Device template's checks that read an SNMP walk never fire on a
 * device that only answers ping: when some of the hosts are like that, those
 * checks are listed apart, under "SNMP devices only", and when every host is
 * - the 516 kitchen displays and registers of #5145 - they are folded into
 * one line that opens on request, so the checks that can fire on these
 * devices are what the reader sees.
 */
const TemplatePreview: FunctionComponent<{
  template: DiscoveryImportTemplateChoice;
  facts: DiscoveryImportProjectFacts | null;
  outcome: DiscoveryImportOutcome;
  pollingIntervalInMinutes: number;
  probeName?: string | undefined;
}> = (props: {
  template: DiscoveryImportTemplateChoice;
  facts: DiscoveryImportProjectFacts | null;
  outcome: DiscoveryImportOutcome;
  pollingIntervalInMinutes: number;
  probeName?: string | undefined;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const [showWalkChecks, setShowWalkChecks] = useState<boolean>(false);
  const template: DiscoveryImportTemplateChoice = props.template;
  const isAddressTemplate: boolean = checksDeviceAddress(template);

  const enabledChecks: Array<MonitorCriteriaAlertSummary> =
    template.summary.criteria.filter(
      (criterion: MonitorCriteriaAlertSummary): boolean => {
        return criterion.isEnabled;
      },
    );

  const turnedOffChecks: number =
    template.summary.criteria.length - enabledChecks.length;

  const hasPingOnlyHosts: boolean = props.outcome.pingOnlyHostCount > 0;
  const isEveryHostPingOnly: boolean =
    hasPingOnlyHosts && props.outcome.snmpHostCount === 0;

  // Every check fires on every device, unless it needs a walk some lack.
  const firesOnEveryDevice: (
    criterion: MonitorCriteriaAlertSummary,
  ) => boolean = (criterion: MonitorCriteriaAlertSummary): boolean => {
    return (
      isAddressTemplate ||
      !hasPingOnlyHosts ||
      criterion.isEvaluatedOnPingOnlyDevices
    );
  };

  const everywhereChecks: Array<MonitorCriteriaAlertSummary> =
    enabledChecks.filter(firesOnEveryDevice);
  const walkChecks: Array<MonitorCriteriaAlertSummary> = enabledChecks.filter(
    (criterion: MonitorCriteriaAlertSummary): boolean => {
      return !firesOnEveryDevice(criterion);
    },
  );

  const intervalLabel: string | undefined = getMonitoringIntervalLabel(
    template.monitoringInterval,
  );

  const renderChecks: (
    checks: Array<MonitorCriteriaAlertSummary>,
    dataTestId: string,
  ) => ReactElement = (
    checks: Array<MonitorCriteriaAlertSummary>,
    dataTestId: string,
  ): ReactElement => {
    return (
      <ul className="divide-y divide-gray-100">
        {checks.map((criterion: MonitorCriteriaAlertSummary): ReactElement => {
          return (
            <TemplateCheckLine
              key={criterion.id}
              criterion={criterion}
              index={enabledChecks.indexOf(criterion)}
              facts={props.facts}
              dataTestId={dataTestId}
            />
          );
        })}
      </ul>
    );
  };

  return (
    <div
      className="rounded-lg border border-gray-200 bg-white px-3"
      data-testid="discovery-import-template-preview"
    >
      <div className="border-b border-gray-100 py-3">
        <p
          className="text-sm text-gray-900"
          data-testid="discovery-import-template-lead"
        >
          {getTemplateLead(translator, template, props.probeName)}
        </p>
        <p
          className="mt-0.5 text-xs text-gray-500"
          data-testid="discovery-import-template-schedule"
        >
          {isAddressTemplate
            ? intervalLabel
              ? translator.translateTemplate(
                  "Checked on the template's schedule: {{interval}}.",
                  {
                    // "every 5 minutes", as the poll's line beside it reads.
                    interval: translatableTerm(intervalLabel, {
                      inSentence: true,
                    }),
                  },
                )
              : translator.translateText("Checked on the template's schedule.")
            : translator.translateTemplate(
                "Checked each time a device is polled: every {{minutes}} min.",
                { minutes: props.pollingIntervalInMinutes },
              )}
        </p>
      </div>
      <p className="pt-3 text-xs font-medium uppercase tracking-wide text-gray-500">
        {translator.translateText("What each monitor checks")}
      </p>
      {enabledChecks.length === 0 ? (
        <p
          className="py-3 text-sm text-gray-500"
          data-testid="discovery-import-template-no-checks"
        >
          {translator.translateText(
            "This template has no checks turned on, so its monitors raise nothing.",
          )}
        </p>
      ) : (
        <>
          {everywhereChecks.length > 0 ? (
            renderChecks(everywhereChecks, "discovery-import-template-check")
          ) : (
            <p
              className="py-3 text-sm text-gray-500"
              data-testid="discovery-import-template-no-ping-checks"
            >
              {translator.translateText(
                "None of its checks can fire on a device that answers ping only: each one reads an SNMP walk.",
              )}
            </p>
          )}
          {walkChecks.length > 0 && !isEveryHostPingOnly && (
            <div
              className="border-t border-gray-100 pt-3"
              data-testid="discovery-import-template-walk-checks"
            >
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                {translator.translateText("SNMP devices only")}
              </p>
              <p className="mt-0.5 text-xs text-gray-500">
                {translator.translateText(
                  "These read an SNMP walk, so they never fire on a device that answers ping only until it has SNMP credentials.",
                )}
              </p>
              {renderChecks(walkChecks, "discovery-import-template-walk-check")}
            </div>
          )}
          {walkChecks.length > 0 && isEveryHostPingOnly && (
            <div
              className="border-t border-gray-100 py-2"
              data-testid="discovery-import-template-walk-checks"
            >
              <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                <p
                  className="text-xs text-gray-500"
                  data-testid="discovery-import-template-walk-checks-folded"
                >
                  {translator.translatePlural(
                    {
                      one: "{{count}} more check reads an SNMP walk: it stays quiet until these devices have SNMP credentials.",
                      other:
                        "{{count}} more checks read an SNMP walk: they stay quiet until these devices have SNMP credentials.",
                    },
                    walkChecks.length,
                    {
                      count: translator.formatNumber(walkChecks.length),
                    },
                  )}
                </p>
                <button
                  type="button"
                  className="self-start whitespace-nowrap text-xs font-medium text-indigo-600 hover:text-indigo-700 focus:outline-none focus-visible:underline sm:self-auto"
                  aria-expanded={showWalkChecks}
                  data-testid="discovery-import-template-walk-checks-toggle"
                  onClick={() => {
                    setShowWalkChecks(!showWalkChecks);
                  }}
                >
                  {showWalkChecks
                    ? translator.translateText("Hide them")
                    : translator.translateText("Show them")}
                </button>
              </div>
              {showWalkChecks &&
                renderChecks(
                  walkChecks,
                  "discovery-import-template-walk-check",
                )}
            </div>
          )}
        </>
      )}
      {turnedOffChecks > 0 && (
        <p
          className="border-t border-gray-100 py-2 text-xs text-gray-500"
          data-testid="discovery-import-template-turned-off"
        >
          {translator.translatePlural(
            {
              one: "{{count}} more check is turned off in this template.",
              other: "{{count}} more checks are turned off in this template.",
            },
            turnedOffChecks,
            { count: translator.formatNumber(turnedOffChecks) },
          )}
        </p>
      )}
    </div>
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
            "This project has no Network Device, Ping, IP, Port or NTP monitor template to monitor the devices with.",
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

  const toTemplateOption: (
    choice: DiscoveryImportTemplateChoice,
  ) => DropdownOption = (
    choice: DiscoveryImportTemplateChoice,
  ): DropdownOption => {
    return {
      value: getTemplateChoiceValue(choice),
      label: choice.isCreatedOnImport
        ? translator.translateTemplate("{{name}} - created when you import", {
            name: getTemplateChoiceName(translator, choice),
          })
        : getTemplateChoiceName(translator, choice),
      // Drawn as named: a template called "Labels" is not translated.
      isUserContent: true,
      ...(checksDeviceAddress(choice)
        ? { description: describeAddressTemplate(translator, choice) }
        : {}),
    };
  };

  const templates: Array<DiscoveryImportTemplateChoice> =
    facts?.templates || [];
  const pollTemplateOptions: Array<DropdownOption> = templates
    .filter((choice: DiscoveryImportTemplateChoice): boolean => {
      return !checksDeviceAddress(choice);
    })
    .map(toTemplateOption);
  const addressTemplateOptions: Array<DropdownOption> = templates
    .filter(checksDeviceAddress)
    .map(toTemplateOption);
  const templateOptions: Array<DropdownOption> = [
    ...pollTemplateOptions,
    ...addressTemplateOptions,
  ];

  /*
   * Both kinds in one list are told apart under a heading each: the ones
   * that read each device's polls, then the ones that check its address.
   * One kind alone needs no heading.
   */
  const groupedTemplateOptions: Array<DropdownOption | DropdownOptionGroup> =
    pollTemplateOptions.length > 0 && addressTemplateOptions.length > 0
      ? [
          {
            label: translator.translateText(
              POLL_TEMPLATES_GROUP_TITLE,
            ) as string,
            options: pollTemplateOptions,
          },
          {
            label: translator.translateText(
              ADDRESS_TEMPLATES_GROUP_TITLE,
            ) as string,
            options: addressTemplateOptions,
          },
        ]
      : templateOptions;

  const selectedTemplateOption: DropdownOption | undefined = props.template
    ? templateOptions.find((option: DropdownOption): boolean => {
        return option.value === getTemplateChoiceValue(props.template!);
      })
    : undefined;

  const templatesRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.MONITORS_SETTINGS_TEMPLATES] as Route,
  );

  const templatePicker: ReactElement = (
    <div className="space-y-3" data-testid="discovery-import-template-picker">
      <div>
        <FieldLabelElement
          title="Monitor template"
          required={true}
          hideOptionalLabel={true}
          description={
            <span data-testid="discovery-import-template-rule">
              {translator.translateText(LISTED_TEMPLATE_KINDS_RULE)}{" "}
              {/*
               * In a new tab, so the choices made here stay: a template
               * added there is in this list on coming back (the dialog
               * reads the templates again when its window is focused).
               */}
              <Link
                to={templatesRoute}
                openInNewTab={true}
                className="inline-flex items-center gap-0.5 font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
                dataTestId="discovery-import-manage-templates"
              >
                {translator.translateText(MANAGE_TEMPLATES_LINK_TITLE)}
                <Icon
                  icon={IconProp.ExternalLink}
                  className="h-3 w-3 flex-shrink-0"
                />
              </Link>
            </span>
          }
        />
        <Dropdown
          id="discovery-import-template"
          dataTestId="discovery-import-template"
          ariaLabel={translator.translateText("Monitor template")}
          options={groupedTemplateOptions}
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
        <TemplatePreview
          key={getTemplateChoiceValue(props.template)}
          template={props.template}
          facts={facts}
          outcome={outcome}
          pollingIntervalInMinutes={settings.pollingIntervalInMinutes}
          probeName={props.probeName}
        />
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
              options={getPollingIntervalOptions()}
              value={{
                value: settings.pollingIntervalInMinutes,
                label: getPollingIntervalLabel(
                  settings.pollingIntervalInMinutes,
                ),
              }}
              onChange={(
                value: DropdownValue | Array<DropdownValue> | null,
              ) => {
                const picked: number = Number(
                  Array.isArray(value) ? value[0] : value,
                );

                if (
                  DISCOVERY_IMPORT_POLLING_INTERVALS_IN_MINUTES.includes(picked)
                ) {
                  props.onSettingsChange({
                    ...settings,
                    pollingIntervalInMinutes: picked,
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
              description="Each device gets its vendor's health OIDs and SNMP tables, such as CPU and fans. You can change them later."
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
            /*
             * The product's loader, in the box the choices will fill, so
             * the step does not jump when they arrive.
             */
            <div
              className="rounded-lg border border-gray-200 py-4"
              data-testid="discovery-import-facts-loading"
              aria-busy="true"
            >
              <CompactLoader />
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
              <div className="overflow-hidden rounded-lg border border-gray-200">
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
                      /*
                       * A plan counts monitors only where there is a plan:
                       * a self-hosted install (issue #5145's) has none.
                       */
                      description: BILLING_ENABLED
                        ? "Each device gets a monitor from the template you pick. Each monitor counts towards your plan."
                        : "Each device gets a monitor from the template you pick.",
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
        monitorRoom={facts?.monitorRoom ?? null}
        canPickMonitors={!choiceLockedReason}
        probeName={props.probeName}
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
  monitorRoom: number | null;
  /*
   * Whether "A monitor for each device" can be picked at all. When it
   * cannot - the plan has no room, or the reader may not create monitors -
   * the summary does not suggest picking a template.
   */
  canPickMonitors?: boolean | undefined;
  // The scan's probe, which a Ping, IP, Port or NTP template's monitors run from.
  probeName?: string | undefined;
}> = (props: {
  outcome: DiscoveryImportOutcome;
  monitorRoom: number | null;
  canPickMonitors?: boolean | undefined;
  probeName?: string | undefined;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const outcome: DiscoveryImportOutcome = props.outcome;

  const lines: Array<{ key: string; text: string; tone?: "warning" }> = [];

  if (outcome.snmpHostCount > 0) {
    lines.push({
      key: "snmp",
      text: translator.translatePlural(
        {
          one: "{{count}} device answered SNMP: it is walked every {{minutes}} min for interfaces, inventory and health, with the credentials that answered it.",
          other:
            "{{count}} devices answered SNMP: they are walked every {{minutes}} min for interfaces, inventory and health, with the credentials that answered them.",
        },
        outcome.snmpHostCount,
        {
          count: translator.formatNumber(outcome.snmpHostCount),
          minutes: outcome.pollingIntervalInMinutes,
        },
      ),
    });
  }

  if (outcome.pingOnlyHostCount > 0) {
    lines.push({
      key: "ping",
      text: translator.translatePlural(
        {
          one: "{{count}} device answered ping only: it is pinged every {{minutes}} min. Add SNMP credentials later to walk it too.",
          other:
            "{{count}} devices answered ping only: they are pinged every {{minutes}} min. Add SNMP credentials later to walk them too.",
        },
        outcome.pingOnlyHostCount,
        {
          count: translator.formatNumber(outcome.pingOnlyHostCount),
          minutes: outcome.pollingIntervalInMinutes,
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
          template: getTemplateChoiceName(translator, outcome.template),
          raises: raises,
        },
      ),
      ...(outcome.raisesIncidents || outcome.raisesAlerts
        ? {}
        : { tone: "warning" as const }),
    });

    /*
     * A Ping, IP, Port or NTP template's monitors check each device's
     * address themselves: from the scan's probe, the one that reached them.
     */
    if (checksDeviceAddress(outcome.template)) {
      lines.push({
        key: "address",
        text: translator.translateTemplate(
          "Each monitor checks its device's address from {{probe}}.",
          { probe: probeValue(props.probeName) },
        ),
      });
    }

    if (outcome.pingOnlyHostsWithoutAlerts > 0) {
      lines.push({
        key: "ping-silent",
        tone: "warning",
        text: translator.translatePlural(
          {
            one: "The {{count}} device that answers ping only will raise nothing: every check of this template that opens an incident or an alert reads an SNMP walk, and it is not walked until it has SNMP credentials.",
            other:
              "The {{count}} devices that answer ping only will raise nothing: every check of this template that opens an incident or an alert reads an SNMP walk, and they are not walked until they have SNMP credentials.",
          },
          outcome.pingOnlyHostsWithoutAlerts,
          {
            count: translator.formatNumber(outcome.pingOnlyHostsWithoutAlerts),
          },
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
      text:
        props.canPickMonitors === false
          ? (translator.translateText(
              "No monitors: nobody is alerted when one of these devices goes down.",
            ) as string)
          : (translator.translateText(
              "No monitors: nobody is alerted when one of these devices goes down. Pick a monitor template, or set up an alert policy later.",
            ) as string),
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
        {lines.map((line: { key: string; text: string; tone?: "warning" }) => {
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
        })}
      </ul>
    </aside>
  );
};

export default DiscoveryImportMonitoringStep;
