import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import SideMenu from "Common/UI/Components/SideMenu/SideMenu";
import SideMenuItem from "Common/UI/Components/SideMenu/SideMenuItem";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  isPreviewStatusPage: boolean;
  enableEmailSubscribers: boolean;
  enableSMSSubscribers: boolean;
  enableSlackSubscribers: boolean;
  enableMicrosoftTeamsSubscribers: boolean;
}

const SubscribeSideMenu: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <SideMenu>
      {props.enableEmailSubscribers ? (
        <SideMenuItem
          link={{
            title: "Email",
            to: RouteUtil.populateRouteParams(
              props.isPreviewStatusPage
                ? (RouteMap[PageMap.PREVIEW_SUBSCRIBE_EMAIL] as Route)
                : (RouteMap[PageMap.SUBSCRIBE_EMAIL] as Route),
            ),
          }}
          icon={IconProp.Email}
        />
      ) : (
        <></>
      )}
      {props.enableSMSSubscribers ? (
        <SideMenuItem
          link={{
            title: "SMS",
            to: RouteUtil.populateRouteParams(
              props.isPreviewStatusPage
                ? (RouteMap[PageMap.PREVIEW_SUBSCRIBE_SMS] as Route)
                : (RouteMap[PageMap.SUBSCRIBE_SMS] as Route),
            ),
          }}
          icon={IconProp.SMS}
        />
      ) : (
        <></>
      )}
      {props.enableSlackSubscribers ? (
        <SideMenuItem
          link={{
            title: "Slack",
            to: RouteUtil.populateRouteParams(
              props.isPreviewStatusPage
                ? (RouteMap[PageMap.PREVIEW_SUBSCRIBE_SLACK] as Route)
                : (RouteMap[PageMap.SUBSCRIBE_SLACK] as Route),
            ),
          }}
          icon={IconProp.Slack}
        />
      ) : (
        <></>
      )}
      {props.enableMicrosoftTeamsSubscribers ? (
        <SideMenuItem
          link={{
            title: "MS Teams",
            to: RouteUtil.populateRouteParams(
              props.isPreviewStatusPage
                ? (RouteMap[PageMap.PREVIEW_SUBSCRIBE_MICROSOFT_TEAMS] as Route)
                : (RouteMap[PageMap.SUBSCRIBE_MICROSOFT_TEAMS] as Route),
            ),
          }}
          icon={IconProp.MicrosoftTeams}
        />
      ) : (
        <></>
      )}
      {/* <SideMenuItem
                link={{
                    title: 'Webhooks',
                    to: RouteUtil.populateRouteParams(
                        props.isPreviewStatusPage ? RouteMap[PageMap.PREVIEW_SUBSCRIBE_WEBHOOKS] as Route : RouteMap[PageMap.SUBSCRIBE_WEBHOOKS] as Route
                    ),
                }}
                icon={IconProp.Globe}
                
            /> */}
    </SideMenu>
  );
};

export default SubscribeSideMenu;
