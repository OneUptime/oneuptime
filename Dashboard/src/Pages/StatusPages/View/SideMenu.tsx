import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import SideMenu from "Common/UI/Components/SideMenu/SideMenu";
import SideMenuItem from "Common/UI/Components/SideMenu/SideMenuItem";
import SideMenuSection from "Common/UI/Components/SideMenu/SideMenuSection";
import ProjectUtil from "Common/UI/Utils/Project";
import Project from "Common/Models/DatabaseModels/Project";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  modelId: ObjectID;
}

const DashboardSideMenu: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const project: Project | null = ProjectUtil.getCurrentProject();

  return (
    <SideMenu>
      <SideMenuSection title="Basic">
        <SideMenuItem
          link={{
            title: "Overview",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.STATUS_PAGE_VIEW] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Info}
        />

        <SideMenuItem
          link={{
            title: "Announcements",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.STATUS_PAGE_VIEW_ANNOUNCEMENTS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Announcement}
        />
        <SideMenuItem
          link={{
            title: "Owners",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.STATUS_PAGE_VIEW_OWNERS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Team}
        />
      </SideMenuSection>

      <SideMenuSection title="Resources">
        <SideMenuItem
          link={{
            title: project?.isFeatureFlagMonitorGroupsEnabled
              ? "Resources"
              : "Monitors",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.STATUS_PAGE_VIEW_RESOURCES] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.AltGlobe}
        />
        <SideMenuItem
          link={{
            title: "Groups",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.STATUS_PAGE_VIEW_GROUPS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Folder}
        />
      </SideMenuSection>

      <SideMenuSection title="Subscribers">
        <SideMenuItem
          link={{
            title: "Email Subscribers",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.STATUS_PAGE_VIEW_EMAIL_SUBSCRIBERS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Email}
        />
        <SideMenuItem
          link={{
            title: "SMS Subscribers",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.STATUS_PAGE_VIEW_SMS_SUBSCRIBERS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.SMS}
        />
        <SideMenuItem
          link={{
            title: "Slack Subscribers",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.STATUS_PAGE_VIEW_SLACK_SUBSCRIBERS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Slack}
        />
        <SideMenuItem
          link={{
            title: "MS Teams Subscribers",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.STATUS_PAGE_VIEW_MICROSOFT_TEAMS_SUBSCRIBERS
              ] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.MicrosoftTeams}
        />

        {/* <SideMenuItem
                    link={{
                        title: 'Webhook Subscribers',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[
                                PageMap.STATUS_PAGE_VIEW_WEBHOOK_SUBSCRIBERS
                            ] as Route,
                             {modelId: props.modelId}
                    ),
                    }}
                    icon={IconProp.Webhook}
                /> */}

        <SideMenuItem
          link={{
            title: "Subscriber Settings",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.STATUS_PAGE_VIEW_SUBSCRIBER_SETTINGS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Settings}
        />
      </SideMenuSection>

      <SideMenuSection title="Notification Logs">
        <SideMenuItem
          link={{
            title: "Notification Logs",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.STATUS_PAGE_VIEW_NOTIFICATION_LOGS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Bell}
        />
      </SideMenuSection>

      <SideMenuSection title="Branding">
        <SideMenuItem
          link={{
            title: "Essential Branding",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.STATUS_PAGE_VIEW_BRANDING] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Image}
        />

        <SideMenuItem
          link={{
            title: "HTML, CSS & JavaScript",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.STATUS_PAGE_VIEW_CUSTOM_HTML_CSS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Code}
        />

        <SideMenuItem
          link={{
            title: "Custom Domains",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.STATUS_PAGE_VIEW_DOMAINS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Globe}
        />

        <SideMenuItem
          link={{
            title: "Header",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.STATUS_PAGE_VIEW_HEADER_STYLE] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.ArrowCircleUp}
        />

        <SideMenuItem
          link={{
            title: "Footer",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.STATUS_PAGE_VIEW_FOOTER_STYLE] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.ArrowCircleDown}
        />

        <SideMenuItem
          link={{
            title: "Overview Page",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.STATUS_PAGE_VIEW_OVERVIEW_PAGE_BRANDING
              ] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.CheckCircle}
        />
      </SideMenuSection>

      <SideMenuSection title="Authentication Security">
        <SideMenuItem
          link={{
            title: "Private Users",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.STATUS_PAGE_VIEW_PRIVATE_USERS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.User}
        />

        <SideMenuItem
          link={{
            title: "SSO",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.STATUS_PAGE_VIEW_SSO] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Lock}
        />

        <SideMenuItem
          link={{
            title: "SCIM",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.STATUS_PAGE_VIEW_SCIM] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Refresh}
        />

        <SideMenuItem
          link={{
            title: "Authentication Settings",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.STATUS_PAGE_VIEW_AUTHENTICATION_SETTINGS
              ] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Settings}
        />
      </SideMenuSection>

      <SideMenuSection title="Advanced">
        <SideMenuItem
          link={{
            title: "Reports",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.STATUS_PAGE_VIEW_REPORTS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.TextFile}
        />

        <SideMenuItem
          link={{
            title: "Custom Fields",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.STATUS_PAGE_VIEW_CUSTOM_FIELDS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.TableCells}
        />

        <SideMenuItem
          link={{
            title: "Advanced Settings",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.STATUS_PAGE_VIEW_SETTINGS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Settings}
        />

        <SideMenuItem
          link={{
            title: "Delete Status Page",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.STATUS_PAGE_VIEW_DELETE] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Trash}
          className="danger-on-hover"
        />
      </SideMenuSection>
    </SideMenu>
  );
};

export default DashboardSideMenu;
