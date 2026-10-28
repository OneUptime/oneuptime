import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import AppLink from "../AppLink/AppLink";
import { CUSTOM_SMTP_CONFIGS_PLACE } from "../NotificationMethods/OwnSendersFold";
import { getRouteToPageAnchor } from "Common/UI/Utils/PageAnchor";
import ProjectSmtpConfig from "Common/Models/DatabaseModels/ProjectSmtpConfig";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  smtp?: ProjectSmtpConfig | undefined;
  onNavigateComplete?: (() => void) | undefined;
}

const CustomSMTPElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  if (!props.smtp) {
    return <span>{translator.translateText("OneUptime Mail Server")}</span>;
  }

  if (props.smtp._id) {
    return (
      <AppLink
        onNavigateComplete={props.onNavigateComplete}
        className="hover:underline"
        /*
         * At the Custom SMTP Configs table, which waits folded under the
         * page's More settings: the link opens it there.
         */
        to={getRouteToPageAnchor(
          RouteUtil.populateRouteParams(
            RouteMap[PageMap.SETTINGS_NOTIFICATION_SETTINGS] as Route,
          ),
          CUSTOM_SMTP_CONFIGS_PLACE,
        )}
      >
        <span>{props.smtp.name}</span>
      </AppLink>
    );
  }

  return <span>{props.smtp.name}</span>;
};

export default CustomSMTPElement;
