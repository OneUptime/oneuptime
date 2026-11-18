import { mayCreateMonitor } from "./WebsiteDownApi";
import { WEBSITE_DOWN_COPY } from "./WebsiteDownSetup";
import AppLink from "../../AppLink/AppLink";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import MonitorType from "Common/Types/Monitor/MonitorType";
import Icon from "Common/UI/Components/Icon/Icon";
import {
  GuidedSetupEntryPoint,
  withGuidedSetupEntryPoint,
} from "Common/UI/Utils/GuidedSetupEvents";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * THE GUIDED SETUP, OFFERED ON CREATE MONITOR (#7054).
 *
 * Someone who picks Website or API on Create Monitor most often wants to
 * know when it is down: the guided setup "Know when my website or API is
 * down" does that whole job - the monitor, who is told and a test page - on
 * one page, where Create Monitor makes the monitor alone. So under the
 * picked type, one quiet line says so, with the way there. Only for those
 * two types, only for whoever may create a monitor, and only on a plain
 * Create Monitor: not over a template's monitor, a metric chart's or a
 * network device's, which are other jobs.
 */

export const WEBSITE_DOWN_SETUP_OFFER_TEST_ID: string =
  "website-down-setup-offer";

// The types whose job the guided setup does.
export const isWebsiteDownSetupOfferedFor: (
  monitorType: MonitorType | null | undefined,
) => boolean = (monitorType: MonitorType | null | undefined): boolean => {
  return monitorType === MonitorType.Website || monitorType === MonitorType.API;
};

export interface ComponentProps {
  monitorType: MonitorType | null | undefined;
  // False where Create Monitor does another job (a template, a seeded query).
  isOffered: boolean;
}

const linkClassName: string =
  "text-sm font-medium text-indigo-600 hover:text-indigo-800 underline-offset-2 hover:underline";

const WebsiteDownSetupOffer: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  if (
    !props.isOffered ||
    !isWebsiteDownSetupOfferedFor(props.monitorType) ||
    !mayCreateMonitor()
  ) {
    return <></>;
  }

  return (
    <div
      className="mt-3 flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3"
      data-testid={WEBSITE_DOWN_SETUP_OFFER_TEST_ID}
    >
      <Icon
        icon={IconProp.LightBulb}
        className="mt-0.5 h-4 w-4 flex-none text-gray-500"
      />
      <div className="min-w-0 flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="text-sm text-gray-700">
          {translator.translateText(WEBSITE_DOWN_COPY.createMonitorOffer)}
        </p>
        <AppLink
          to={
            new Route(
              withGuidedSetupEntryPoint(
                RouteUtil.populateRouteParams(
                  RouteMap[PageMap.MONITOR_GUIDED_SETUP] as Route,
                ).toString(),
                GuidedSetupEntryPoint.CreateMonitor,
              ),
            )
          }
          className={linkClassName}
          dataTestId="website-down-setup-offer-link"
        >
          {translator.translateText(WEBSITE_DOWN_COPY.guidedSetup) || ""}
        </AppLink>
      </div>
    </div>
  );
};

export default WebsiteDownSetupOffer;
