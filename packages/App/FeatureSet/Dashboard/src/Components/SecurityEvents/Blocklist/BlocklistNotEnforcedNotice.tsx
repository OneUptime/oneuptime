import AppLink from "../../AppLink/AppLink";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import {
  BLOCKLIST_TEST_IDS,
  CANNOT_TELL_ENFORCEMENT,
  NOTHING_ENFORCES_DESCRIPTION,
  NOTHING_ENFORCES_TITLE,
  OPEN_CLOUD_CONNECTIONS,
  OPEN_SECURITY_CONNECTIONS,
} from "./BlocklistCopy";
import Route from "Common/Types/API/Route";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * What the Blocklist says above its list while nothing enforces it
 * (#10338): its blocks are recorded and blocked nowhere, and where to
 * connect what would enforce them - a security connection (Cloudflare, a
 * firewall's feed) or a cloud connection (AWS WAF, Azure WAF, Cloud Armor).
 * Shown only then: a project with a destination sees its chips instead, row
 * by row. When OneUptime could not read where the blocks are enforced, it
 * says that, rather than that nothing enforces them.
 */
export interface ComponentProps {
  cannotTell: boolean;
}

const BlocklistNotEnforcedNotice: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  if (props.cannotTell) {
    return (
      <Alert
        type={AlertType.WARNING}
        title={CANNOT_TELL_ENFORCEMENT}
        dataTestId={BLOCKLIST_TEST_IDS.notice}
        className="mb-5"
      />
    );
  }

  return (
    <Alert
      type={AlertType.WARNING}
      dataTestId={BLOCKLIST_TEST_IDS.notice}
      className="mb-5"
      title={
        <div className="space-y-1">
          <p className="font-medium">
            {translator.translateText(NOTHING_ENFORCES_TITLE)}
          </p>
          <p>{translator.translateText(NOTHING_ENFORCES_DESCRIPTION)}</p>
          <p className="flex flex-wrap gap-x-4 gap-y-1">
            <AppLink
              to={RouteUtil.populateRouteParams(
                RouteMap[PageMap.SECURITY_EVENTS_CONNECTIONS] as Route,
              )}
              className="font-medium underline"
            >
              {translator.translateText(OPEN_SECURITY_CONNECTIONS) ||
                OPEN_SECURITY_CONNECTIONS}
            </AppLink>
            <AppLink
              to={RouteUtil.populateRouteParams(
                RouteMap[PageMap.CLOUD_CONNECT] as Route,
              )}
              className="font-medium underline"
            >
              {translator.translateText(OPEN_CLOUD_CONNECTIONS) ||
                OPEN_CLOUD_CONNECTIONS}
            </AppLink>
          </p>
        </div>
      }
    />
  );
};

export default BlocklistNotEnforcedNotice;
