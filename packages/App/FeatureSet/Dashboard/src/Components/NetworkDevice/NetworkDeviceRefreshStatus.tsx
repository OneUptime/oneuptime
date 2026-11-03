import IconProp from "Common/Types/Icon/IconProp";
import Route from "Common/Types/API/Route";
import Icon, { SizeProp } from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import {
  RefreshStatusLinkKind,
  RefreshStatusTone,
  RefreshStatusWords,
  getRefreshStatusWords,
} from "./NetworkDeviceRefreshWords";
import { UseNetworkDeviceRefreshResult } from "./useNetworkDeviceRefresh";
import AppLink from "../AppLink/AppLink";
import { getMerakiConnectionsRoute } from "../NetworkTraffic/Meraki/MerakiUrlState";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";

/*
 * One line under a card's header, while a device is read again and once it
 * has been: a clock while its readers are at it (the Refresh button above
 * already turns - one spinner is enough), a green tick when it was read,
 * amber when its probe could not reach it or has not read it, red when the
 * refresh could not be asked for. Announced to a screen reader as it
 * changes. Nothing at all before anyone presses Refresh.
 *
 * A line that says Meraki has not read the device yet ends with a link to
 * the Meraki connection, on the network's Traffic page: its status says
 * why (a refused key, a connection turned off), and its row has the way on.
 */

// Where a status line's link goes.
function getRefreshStatusLinkRoute(kind: RefreshStatusLinkKind): Route {
  switch (kind) {
    case RefreshStatusLinkKind.MerakiConnections:
    default:
      return getMerakiConnectionsRoute(
        RouteUtil.populateRouteParams(
          RouteMap[PageMap.NETWORK_TRAFFIC] as Route,
        ),
      );
  }
}

export interface ComponentProps {
  refresh: UseNetworkDeviceRefreshResult;
  testId?: string | undefined;
  className?: string | undefined;
}

const TONE_CLASS_NAMES: Record<RefreshStatusTone, string> = {
  progress: "text-gray-600",
  done: "text-emerald-700",
  warning: "text-amber-700",
  error: "text-red-700",
};

export const REFRESH_STATUS_ICONS: Record<RefreshStatusTone, IconProp> = {
  progress: IconProp.Clock,
  done: IconProp.CheckCircle,
  warning: IconProp.ExclaimationCircle,
  error: IconProp.ExclaimationCircle,
};

const NetworkDeviceRefreshStatus: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const testId: string = props.testId || "network-device-refresh-status";

  if (props.refresh.error) {
    return (
      <div
        role="alert"
        className={`flex items-start gap-x-1.5 text-sm ${TONE_CLASS_NAMES.error} ${props.className || ""}`.trim()}
        data-testid={testId}
        data-tone="error"
      >
        <Icon
          icon={REFRESH_STATUS_ICONS.error}
          size={SizeProp.Small}
          className="mt-0.5 h-4 w-4 flex-none"
        />
        <span className="min-w-0 break-words">{props.refresh.error}</span>
      </div>
    );
  }

  const words: RefreshStatusWords | undefined = getRefreshStatusWords({
    answer: props.refresh.answer,
    standing: props.refresh.standing,
  });

  if (!words) {
    return <></>;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex items-start gap-x-1.5 text-sm ${TONE_CLASS_NAMES[words.tone]} ${props.className || ""}`.trim()}
      data-testid={testId}
      data-tone={words.tone}
    >
      <Icon
        icon={REFRESH_STATUS_ICONS[words.tone]}
        size={SizeProp.Small}
        className="mt-0.5 h-4 w-4 flex-none"
      />
      <span className="min-w-0 break-words">
        {translator.translateTemplate(words.template, words.values)}
        {words.link ? (
          <>
            {" "}
            <AppLink
              to={getRefreshStatusLinkRoute(words.link.kind)}
              className="font-medium text-indigo-600 underline-offset-2 hover:text-indigo-700 hover:underline focus:outline-none focus-visible:underline"
            >
              <span data-testid={`${testId}-link`}>
                {translator.translateText(words.link.title)}
              </span>
            </AppLink>
          </>
        ) : (
          <></>
        )}
      </span>
    </div>
  );
};

export default NetworkDeviceRefreshStatus;
