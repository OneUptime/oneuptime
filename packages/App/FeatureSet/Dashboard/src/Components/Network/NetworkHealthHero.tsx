import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import AppLink from "../AppLink/AppLink";
import {
  NETWORK_HEALTH_PENDING_NOTE,
  NetworkHealthTone,
  NetworkHealthVerdict,
  getPendingNoteCount,
} from "./NetworkHealthVerdict";
import {
  NetworkQuickAction,
  getNetworkQuickActionRoute,
} from "./NetworkQuickActions";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import Navigation from "Common/UI/Utils/Navigation";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The top of the Network Overview: one sentence that says whether the
 * network is healthy and, when it is not, what is wrong (NetworkHealthVerdict),
 * whether anything alerts on it, and the two ways to bring more of it in.
 *
 * The tiles and lists below it have the detail; this is the answer someone
 * opens Network for, said before they have to read anything else.
 */

export interface ComponentProps {
  verdict: NetworkHealthVerdict;
  devicesPending: number;
  /*
   * How many enabled alert policies the project has, or null when that
   * could not be read (no permission, a failed request): the line about
   * alerting is then left out rather than guessed.
   */
  enabledAlertPolicyCount: number | null;
}

interface ToneStyle {
  icon: IconProp;
  // The round tile behind the icon, and the icon's colour.
  tileClassName: string;
  iconClassName: string;
}

// Classes Theme.css remaps for dark mode (semantic tints, not dark: variants).
const TONE_STYLES: Record<NetworkHealthTone, ToneStyle> = {
  [NetworkHealthTone.Critical]: {
    icon: IconProp.Error,
    tileClassName: "bg-red-50",
    iconClassName: "text-red-600",
  },
  [NetworkHealthTone.Warning]: {
    icon: IconProp.Alert,
    tileClassName: "bg-amber-50",
    iconClassName: "text-amber-600",
  },
  [NetworkHealthTone.Waiting]: {
    icon: IconProp.Clock,
    tileClassName: "bg-gray-100",
    iconClassName: "text-gray-500",
  },
  [NetworkHealthTone.Healthy]: {
    icon: IconProp.CheckCircle,
    tileClassName: "bg-emerald-50",
    iconClassName: "text-emerald-600",
  },
};

const NetworkHealthHero: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const style: ToneStyle = TONE_STYLES[props.verdict.tone];
  const pendingNoteCount: number = getPendingNoteCount(
    props.verdict,
    props.devicesPending,
  );

  const alertPoliciesRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.NETWORK_DEVICE_SETTINGS_ALERT_POLICIES] as Route,
  );

  return (
    <div
      data-testid="network-health-hero"
      data-tone={props.verdict.tone}
      className="mb-5 rounded-lg bg-white p-5 shadow sm:p-6"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <div
            className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full ${style.tileClassName}`}
          >
            <Icon
              icon={style.icon}
              className={`h-6 w-6 ${style.iconClassName}`}
            />
          </div>
          <div className="min-w-0">
            <h2
              data-testid="network-health-headline"
              className="text-lg font-semibold leading-7 text-gray-900"
            >
              {translator.translatePlural(
                props.verdict.headline,
                props.verdict.headlineCount,
              )}
            </h2>
            <p
              data-testid="network-health-detail"
              className="mt-1 text-sm text-gray-500"
            >
              {translator.translatePlural(
                props.verdict.detail,
                props.verdict.detailCount,
              )}
              {pendingNoteCount > 0 ? (
                <span data-testid="network-health-pending-note">
                  {" "}
                  {translator.translatePlural(
                    NETWORK_HEALTH_PENDING_NOTE,
                    pendingNoteCount,
                  )}
                </span>
              ) : (
                <></>
              )}
            </p>
            {props.enabledAlertPolicyCount !== null ? (
              <div
                data-testid="network-health-alerting"
                className="mt-3 flex items-start gap-2 text-sm"
              >
                <Icon
                  icon={IconProp.Bell}
                  className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400"
                />
                <p className="text-gray-600">
                  {props.enabledAlertPolicyCount > 0
                    ? translator.translatePlural(
                        {
                          one: "{{count}} alert policy raises incidents for this network.",
                          other:
                            "{{count}} alert policies raise incidents for this network.",
                        },
                        props.enabledAlertPolicyCount,
                      )
                    : translator.translateText(
                        "No alert policy yet. Turn one on to raise an incident when a device goes down.",
                      )}{" "}
                  <span data-testid="network-health-alerting-link">
                    <AppLink
                      to={alertPoliciesRoute}
                      className="font-medium text-indigo-600 hover:underline"
                    >
                      {(props.enabledAlertPolicyCount > 0
                        ? translator.translateText("Alert Policies")
                        : translator.translateText("Set up alerts")) || ""}
                    </AppLink>
                  </span>
                </p>
              </div>
            ) : (
              <></>
            )}
          </div>
        </div>
        <div className="flex flex-shrink-0 flex-wrap gap-2 self-end lg:self-auto lg:justify-end">
          <Button
            title="Discover Devices"
            icon={IconProp.Search}
            buttonStyle={ButtonStyleType.NORMAL}
            dataTestId="network-overview-discover-devices"
            onClick={() => {
              Navigation.navigate(
                getNetworkQuickActionRoute(NetworkQuickAction.DiscoverDevices),
              );
            }}
          />
          <Button
            title="Add Device"
            icon={IconProp.Add}
            buttonStyle={ButtonStyleType.PRIMARY}
            dataTestId="network-overview-add-device"
            onClick={() => {
              Navigation.navigate(
                getNetworkQuickActionRoute(NetworkQuickAction.AddDevice),
              );
            }}
          />
        </div>
      </div>
    </div>
  );
};

export default NetworkHealthHero;
