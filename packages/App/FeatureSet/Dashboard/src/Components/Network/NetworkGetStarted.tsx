import AddProbeModal, { AddProbeModalProbe } from "./AddProbeModal";
import {
  ALERTS_STEP_DESCRIPTION,
  ALERTS_STEP_DONE,
  ALERTS_STEP_TITLE,
  DEVICES_STEP_TITLE,
  NetworkProbeFacts,
  NetworkProbeSetupKind,
  PROBE_STEP_CONNECTED_MANY,
  PROBE_STEP_CONNECTED_ONE,
  PROBE_STEP_DESCRIPTION,
  PROBE_STEP_SERVER_PROBE_NOTE,
  PROBE_STEP_TITLE,
  PROBE_STEP_WAITING,
} from "./NetworkProbeSetup";
import {
  NetworkQuickAction,
  getNetworkQuickActionRoute,
} from "./NetworkQuickActions";
import useNetworkProbes, { NetworkProbesState } from "./useNetworkProbes";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import AppLink from "../AppLink/AppLink";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import Navigation from "Common/UI/Utils/Navigation";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * What the Network Overview shows before there is anything on it: the way
 * from "I have a network" to "I see my devices", in the order it has to be
 * walked.
 *
 *   1. Put a probe on your network. Every device is pinged and read by a
 *      probe that can reach it, and on a new project there is none: the
 *      Add Device and scan forms used to offer no probe at all, or only
 *      OneUptime's internet probes, which cannot reach a 10.x address. So
 *      this step comes first, adds the probe without leaving Network
 *      (AddProbeModal), and turns green on its own once the probe checks in.
 *   2. Bring your devices in: discover a whole network, or add one device,
 *      each one click from its form (the quick-action links).
 *   3. Get told when a device goes down: one alert policy covers every
 *      device, the ones added later too.
 *
 * Each step says what it is for, so nobody has to know what a "probe" or a
 * "discovery scan" is to walk it. The steps are never locked: OneUptime's
 * own probe on a self-hosted server may already reach the devices, and a
 * person who knows better can always go straight to step 2.
 */

interface GetStartedChoice {
  action: NetworkQuickAction;
  icon: IconProp;
  title: string;
  description: string;
  actionText: string;
  dataTestId: string;
}

const CHOICES: Array<GetStartedChoice> = [
  {
    action: NetworkQuickAction.DiscoverDevices,
    icon: IconProp.Search,
    title: "Discover devices",
    description:
      "Scan an address range, see what answers, and pick the devices to add. Best for a whole network or a new site.",
    actionText: "Start a scan",
    dataTestId: "network-get-started-discover",
  },
  {
    action: NetworkQuickAction.AddDevice,
    icon: IconProp.Add,
    title: "Add one device",
    description:
      "Add a switch, router, firewall or anything else by its IP address or hostname.",
    actionText: "Add a device",
    dataTestId: "network-get-started-add",
  },
];

export interface ComponentProps {
  /*
   * How many alert policies are on: null when they could not be read (a role
   * without access to them), and the alert step then claims nothing.
   */
  enabledAlertPolicyCount: number | null;
  /*
   * The page was opened to add a probe (?open=add-probe, the probe fields'
   * "Add a probe" link): the dialog opens at once. The page reads the
   * address and takes the action back out of it.
   */
  isAddProbeRequested?: boolean | undefined;
}

interface StepMarkerProps {
  number: number;
  isDone: boolean;
}

const StepMarker: FunctionComponent<StepMarkerProps> = (
  props: StepMarkerProps,
): ReactElement => {
  if (props.isDone) {
    return (
      <div
        className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600"
        data-testid="network-first-run-step-done"
      >
        <Icon icon={IconProp.Check} className="h-4 w-4" />
      </div>
    );
  }

  return (
    <div
      className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-indigo-50 text-sm font-semibold text-indigo-700"
      aria-hidden="true"
    >
      {props.number}
    </div>
  );
};

/*
 * The probe the "How to run it" link opens the dialog on: the first one that
 * is added and not running yet.
 */
function getWaitingProbe(
  waiting: Array<NetworkProbeFacts>,
): AddProbeModalProbe | null {
  const probe: NetworkProbeFacts | undefined = waiting[0];

  return probe ? { id: probe.id, name: probe.name } : null;
}

const NetworkGetStarted: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const probes: NetworkProbesState = useNetworkProbes();

  /*
   * The dialog, and the probe it opens on: none for a new probe, one for
   * "How to run it". Opened at once when the page was opened to add a probe
   * (?open=add-probe, the probe fields' "Add a probe" link).
   */
  const [dialog, setDialog] = useState<{
    probe: AddProbeModalProbe | null;
  } | null>(props.isAddProbeRequested ? { probe: null } : null);

  const probeKind: NetworkProbeSetupKind | null = probes.setup
    ? probes.setup.kind
    : null;
  const isProbeDone: boolean = probeKind === NetworkProbeSetupKind.Connected;
  const waitingProbe: AddProbeModalProbe | null = probes.setup
    ? getWaitingProbe(probes.setup.waiting)
    : null;
  const areAlertsOn: boolean =
    props.enabledAlertPolicyCount !== null && props.enabledAlertPolicyCount > 0;

  type GetProbeStatusFunction = () => ReactElement | null;

  const getProbeStatus: GetProbeStatusFunction = (): ReactElement | null => {
    if (!probes.setup) {
      return null;
    }

    if (probes.setup.kind === NetworkProbeSetupKind.Connected) {
      const connected: Array<NetworkProbeFacts> = probes.setup.connected;

      return (
        <p
          className="mt-2 text-sm font-medium text-emerald-700"
          data-testid="network-first-run-probe-status"
        >
          {connected.length === 1
            ? translator.translateTemplate(PROBE_STEP_CONNECTED_ONE, {
                name: connected[0]?.name || "",
              })
            : translator.translatePlural(
                PROBE_STEP_CONNECTED_MANY,
                connected.length,
              )}
        </p>
      );
    }

    if (probes.setup.kind === NetworkProbeSetupKind.Waiting && waitingProbe) {
      return (
        <p
          className="mt-2 flex items-start gap-2 text-sm text-gray-700"
          data-testid="network-first-run-probe-status"
        >
          <span className="relative mt-1.5 flex h-2 w-2 flex-shrink-0">
            <span className="absolute inline-flex h-full w-full rounded-full bg-indigo-500 opacity-75 motion-safe:animate-ping"></span>
            <span className="relative inline-flex h-2 w-2 rounded-full bg-indigo-500"></span>
          </span>
          <span>
            {translator.translateTemplate(PROBE_STEP_WAITING, {
              name: waitingProbe.name,
            })}
          </span>
        </p>
      );
    }

    if (probes.hasServerProbe) {
      return (
        <p
          className="mt-2 text-sm text-gray-500"
          data-testid="network-first-run-server-probe"
        >
          {translator.translateText(PROBE_STEP_SERVER_PROBE_NOTE)}
        </p>
      );
    }

    return null;
  };

  type GetProbeActionFunction = () => ReactElement | null;

  const getProbeAction: GetProbeActionFunction = (): ReactElement | null => {
    if (!probes.canAddProbe || probes.isLoading || isProbeDone) {
      return null;
    }

    if (probeKind === NetworkProbeSetupKind.Waiting && waitingProbe) {
      return (
        <Button
          title="How to run it"
          icon={IconProp.Code}
          buttonStyle={ButtonStyleType.NORMAL}
          dataTestId="network-first-run-run-probe"
          onClick={() => {
            setDialog({ probe: waitingProbe });
          }}
        />
      );
    }

    return (
      <Button
        title="Add a probe"
        icon={IconProp.Add}
        buttonStyle={ButtonStyleType.PRIMARY}
        dataTestId="network-first-run-add-probe"
        onClick={() => {
          setDialog({ probe: null });
        }}
      />
    );
  };

  const alertPoliciesRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.NETWORK_DEVICE_SETTINGS_ALERT_POLICIES] as Route,
  );

  return (
    <Card
      title="Bring your network in"
      description="See every switch, router and firewall you run - whether it is up, how it is wired, and when something goes wrong."
    >
      <ol className="space-y-8" data-testid="network-first-run-steps">
        <li className="flex gap-4" data-testid="network-first-run-step-probe">
          <StepMarker number={1} isDone={isProbeDone} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-gray-900">
                  {translator.translateText(PROBE_STEP_TITLE)}
                </h3>
                {!isProbeDone && (
                  <p className="mt-1 text-sm text-gray-500">
                    {translator.translateText(PROBE_STEP_DESCRIPTION)}
                  </p>
                )}
                {getProbeStatus()}
              </div>
              <div className="flex-shrink-0">{getProbeAction()}</div>
            </div>
          </div>
        </li>

        <li className="flex gap-4" data-testid="network-first-run-step-devices">
          <StepMarker number={2} isDone={false} />
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold text-gray-900">
              {translator.translateText(DEVICES_STEP_TITLE)}
            </h3>
            <div
              data-testid="network-get-started"
              className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2"
            >
              {CHOICES.map((choice: GetStartedChoice): ReactElement => {
                return (
                  <button
                    key={choice.action}
                    type="button"
                    data-testid={choice.dataTestId}
                    className="group flex h-full flex-col items-start rounded-lg border border-gray-200 bg-white p-5 text-left shadow-sm transition hover:border-gray-300 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                    onClick={() => {
                      Navigation.navigate(
                        getNetworkQuickActionRoute(choice.action),
                      );
                    }}
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50">
                      <Icon
                        icon={choice.icon}
                        className="h-5 w-5 text-indigo-600"
                      />
                    </div>
                    <div className="mt-4 text-base font-semibold text-gray-900">
                      {translator.translateText(choice.title)}
                    </div>
                    <div className="mt-1 flex-1 text-sm text-gray-500">
                      {translator.translateText(choice.description)}
                    </div>
                    <div className="mt-4 flex items-center gap-1 text-sm font-medium text-indigo-600">
                      {translator.translateText(choice.actionText)}
                      <Icon icon={IconProp.ArrowRight} className="h-4 w-4" />
                    </div>
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-sm text-gray-500">
              {translator.translateText(
                "Every device is pinged by its probe, so it has a status within minutes. Give it SNMP credentials and you also see its interfaces, traffic and health.",
              )}
            </p>
          </div>
        </li>

        <li className="flex gap-4" data-testid="network-first-run-step-alerts">
          <StepMarker number={3} isDone={areAlertsOn} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-gray-900">
                  {translator.translateText(ALERTS_STEP_TITLE)}
                </h3>
                {areAlertsOn ? (
                  <p
                    className="mt-2 text-sm font-medium text-emerald-700"
                    data-testid="network-first-run-alerts-status"
                  >
                    {translator.translateText(ALERTS_STEP_DONE)}
                  </p>
                ) : (
                  <p className="mt-1 text-sm text-gray-500">
                    {translator.translateText(ALERTS_STEP_DESCRIPTION)}
                  </p>
                )}
              </div>
              {!areAlertsOn && (
                <div
                  className="flex-shrink-0"
                  data-testid="network-first-run-set-up-alerts"
                >
                  <AppLink
                    to={alertPoliciesRoute}
                    className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:underline"
                  >
                    <span>{translator.translateText("Set up alerts")}</span>
                    <Icon icon={IconProp.ArrowRight} className="h-4 w-4" />
                  </AppLink>
                </div>
              )}
            </div>
          </div>
        </li>
      </ol>

      {dialog ? (
        <AddProbeModal
          probe={dialog.probe || undefined}
          onClose={() => {
            setDialog(null);
            probes.refresh().catch(() => {
              // refresh reports its own failures.
            });
          }}
          onProbeChanged={() => {
            probes.refresh().catch(() => {
              // refresh reports its own failures.
            });
          }}
        />
      ) : (
        <></>
      )}
    </Card>
  );
};

export default NetworkGetStarted;
