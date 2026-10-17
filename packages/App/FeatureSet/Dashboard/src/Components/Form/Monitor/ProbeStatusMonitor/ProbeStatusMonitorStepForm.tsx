import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import MonitorStepProbeStatusMonitor, {
  MonitorStepProbeStatusMonitorUtil,
} from "Common/Types/Monitor/MonitorStepProbeStatusMonitor";
import Probe from "Common/Models/DatabaseModels/Probe";
import Route from "Common/Types/API/Route";
import Dropdown, {
  DropdownOption,
  DropdownOptionGroup,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Link from "Common/UI/Components/Link/Link";
import { BILLING_ENABLED } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import ProbeUtil from "../../../../Utils/Probe";
import RouteMap, { RouteUtil } from "../../../../Utils/RouteMap";
import PageMap from "../../../../Utils/PageMap";
import ProbeStatusProbeChoices, {
  ProbeStatusProbeChoice,
  ProbeStatusProbeOption,
  ProbeStatusProbeOptionGroup,
  WATCH_PROBE_QUERY_PARAM,
} from "./ProbeStatusProbeChoices";
import Navigation from "Common/UI/Utils/Navigation";

export interface ComponentProps {
  monitorStepProbeStatusMonitor: MonitorStepProbeStatusMonitor;
  onChange: (value: MonitorStepProbeStatusMonitor) => void;
}

/*
 * Step form for Probe Status monitors: which probes to watch. Everything
 * else - what a disconnected probe means, who is told - is the criteria's,
 * which start as "open an incident when a probe disconnects".
 *
 * A new monitor starts watching the probe a "Monitor this probe" link
 * named, else the project's own probes, or on a self-hosted installation
 * with none, its global probes (ProbeStatusProbeChoices.getDefaultProbeIds),
 * so most people only check the picker and move on.
 */
const ProbeStatusMonitorStepForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [probes, setProbes] = useState<Array<ProbeStatusProbeChoice> | null>(
    null,
  );
  const [loadError, setLoadError] = useState<string>("");

  const selectedProbeIds: Array<string> =
    MonitorStepProbeStatusMonitorUtil.normalizeProbeIds(
      props.monitorStepProbeStatusMonitor.probeIds,
    );

  useEffect(() => {
    let isMounted: boolean = true;

    ProbeUtil.getAllProbes()
      .then((allProbes: Array<Probe>): void => {
        if (!isMounted) {
          return;
        }

        const choices: Array<ProbeStatusProbeChoice> = allProbes
          .filter((probe: Probe): boolean => {
            return Boolean(probe._id);
          })
          .map((probe: Probe): ProbeStatusProbeChoice => {
            return {
              id: probe._id!.toString(),
              name: probe.name?.toString() || "Probe",
              isGlobalProbe: Boolean(probe.isGlobalProbe),
            };
          });

        setProbes(choices);

        /*
         * A step only has no probes before it is first saved (saving needs
         * one), so this is a new monitor: start it on the defaults.
         */
        if (selectedProbeIds.length === 0) {
          const defaultProbeIds: Array<string> =
            ProbeStatusProbeChoices.getDefaultProbeIds({
              probes: choices,
              isBillingEnabled: BILLING_ENABLED,
              requestedProbeId: Navigation.getQueryStringByName(
                WATCH_PROBE_QUERY_PARAM,
              ),
            });

          if (defaultProbeIds.length > 0) {
            props.onChange({
              ...props.monitorStepProbeStatusMonitor,
              probeIds: defaultProbeIds,
            });
          }
        }
      })
      .catch((err: Error): void => {
        if (isMounted) {
          setLoadError(API.getFriendlyMessage(err));
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const probesSettingsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.MONITORS_SETTINGS_PROBES] as Route,
  );

  const getPicker: () => ReactElement = (): ReactElement => {
    if (loadError) {
      return (
        <ErrorMessage
          message={translator.translateTemplate(
            "The probes could not be loaded. {{error}}",
            { error: loadError },
          )}
        />
      );
    }

    if (!probes) {
      return <ComponentLoader />;
    }

    const groups: Array<ProbeStatusProbeOptionGroup> =
      ProbeStatusProbeChoices.getOptionGroups({
        probes: probes,
        selectedProbeIds: selectedProbeIds,
      });

    if (groups.length === 0) {
      return (
        <p
          className="mt-2 text-sm text-gray-500"
          data-testid="probe-status-monitor-no-probes"
        >
          {translator.translateText(
            "There is no probe to watch yet. Add a custom probe first.",
          )}{" "}
          <Link className="underline" to={probesSettingsRoute}>
            {translator.translateText("Go to Probes")}
          </Link>
        </p>
      );
    }

    const options: Array<DropdownOptionGroup> = groups.map(
      (group: ProbeStatusProbeOptionGroup): DropdownOptionGroup => {
        return {
          // The picker shows a group's heading as given; options it translates.
          label: translator.translateText(group.label),
          options: group.options.map(
            (option: ProbeStatusProbeOption): DropdownOption => {
              return { value: option.value, label: option.label };
            },
          ),
        };
      },
    );

    const selectedOptions: Array<DropdownOption> =
      ProbeStatusProbeChoices.getSelectedOptions({
        groups: groups,
        selectedProbeIds: selectedProbeIds,
      }).map((option: ProbeStatusProbeOption): DropdownOption => {
        return { value: option.value, label: option.label };
      });

    return (
      <Dropdown
        ariaLabel="Probes to watch"
        isMultiSelect={true}
        placeholder="Select probes"
        options={options}
        value={selectedOptions}
        onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
          const probeIds: Array<string> = (
            Array.isArray(value) ? value : value === null ? [] : [value]
          ).map((item: DropdownValue): string => {
            return item.toString();
          });

          props.onChange({
            ...props.monitorStepProbeStatusMonitor,
            probeIds: MonitorStepProbeStatusMonitorUtil.normalizeProbeIds(
              probeIds,
            ),
          });
        }}
      />
    );
  };

  return (
    <div className="space-y-5" data-testid="probe-status-monitor-step-form">
      <div>
        <FieldLabelElement
          title="Probes"
          description="A probe is disconnected when it has not reported for three minutes, so a quick restart is not an outage."
          required={true}
        />
        {getPicker()}
      </div>
    </div>
  );
};

export default ProbeStatusMonitorStepForm;
