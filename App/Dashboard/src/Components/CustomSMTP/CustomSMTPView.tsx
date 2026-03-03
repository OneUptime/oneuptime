import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import AppLink from "../AppLink/AppLink";
import ProjectSmtpConfig from "Common/Models/DatabaseModels/ProjectSmtpConfig";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  smtp?: ProjectSmtpConfig | undefined;
  onNavigateComplete?: (() => void) | undefined;
}

const CustomSMTPElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (!props.smtp) {
    return <span>OneUptime Mail Server</span>;
  }

  if (props.smtp._id) {
    return (
      <AppLink
        onNavigateComplete={props.onNavigateComplete}
        className="hover:underline"
        to={RouteUtil.populateRouteParams(
          RouteMap[PageMap.SETTINGS_NOTIFICATION_SETTINGS] as Route,
        )}
      >
        <span>{props.smtp.name}</span>
      </AppLink>
    );
  }

  return <span>{props.smtp.name}</span>;
};

export default CustomSMTPElement;
