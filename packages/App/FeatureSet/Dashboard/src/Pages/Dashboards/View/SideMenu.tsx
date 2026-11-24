import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import SideMenu from "Common/UI/Components/SideMenu/SideMenu";
import SideMenuItem from "Common/UI/Components/SideMenu/SideMenuItem";
import SideMenuSection from "Common/UI/Components/SideMenu/SideMenuSection";
import React, { FunctionComponent, ReactElement } from "react";
import DashboardModel from "Common/Models/DatabaseModels/Dashboard";
import { getDeveloperSideMenuSection } from "../../../Components/DeveloperDocs/DeveloperDocsMenuSection";
import { DeveloperDocsScope } from "../../../Components/DeveloperDocs/DeveloperDocsPages";

export interface ComponentProps {
  modelId: ObjectID;
}

const DashboardSideMenu: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <SideMenu>
      <SideMenuSection title="Basic">
        <SideMenuItem
          link={{
            title: "Dashboard",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.DASHBOARD_VIEW] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Window}
        />

        <SideMenuItem
          link={{
            title: "Overview",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.DASHBOARD_VIEW_OVERVIEW] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Info}
        />

        {/*
         * Who can view the dashboard: one choice, also opened from the
         * dashboard's own ⋯ menu (Share). At the old Authentication page's
         * address, so links and bookmarks still land on it.
         */}
        <SideMenuItem
          link={{
            title: "Sharing",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.DASHBOARD_VIEW_AUTHENTICATION_SETTINGS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Share}
        />
      </SideMenuSection>

      {/*
       * Branding and Custom Domains change only the public link: how it
       * looks and the address it is served on - and Private Users and
       * Single Sign-On who signs in to it (#10250). A dashboard only people
       * in the project can view has no public link, so the section says
       * what it is for and starts folded, and each page says when the
       * dashboard is not shared publicly (DashboardPublicOnlySettings,
       * #9134) or does not ask its visitors to sign in
       * (DashboardSignInOnlySettings).
       */}
      <SideMenuSection title="Public Link" defaultCollapsed={true}>
        <SideMenuItem
          link={{
            title: "Branding",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.DASHBOARD_VIEW_BRANDING] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Image}
        />

        <SideMenuItem
          link={{
            title: "Custom Domains",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.DASHBOARD_VIEW_CUSTOM_DOMAINS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Globe}
        />

        {/*
         * Who signs in to the public link when only people who sign in can
         * view the dashboard (#10250): its private users, and its single
         * sign-on - with the icons a status page's Security section uses for
         * the same two pages. Each says when the dashboard does not ask its
         * visitors to sign in (DashboardSignInOnlySettings).
         */}
        <SideMenuItem
          link={{
            title: "Private Users",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.DASHBOARD_VIEW_PRIVATE_USERS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.User}
        />

        <SideMenuItem
          link={{
            title: "Single Sign-On",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.DASHBOARD_VIEW_SINGLE_SIGN_ON] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Lock}
        />
      </SideMenuSection>

      {getDeveloperSideMenuSection({
        modelType: DashboardModel,
        scope: DeveloperDocsScope.View,
        modelId: props.modelId,
      })}

      <SideMenuSection title="Advanced">
        <SideMenuItem
          link={{
            title: "Settings",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.DASHBOARD_VIEW_SETTINGS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Settings}
        />

        {/*
         * Who owns the dashboard, with the other pages that change it. It
         * was a section of its own, under a heading of its own name (#9134).
         */}
        <SideMenuItem
          link={{
            title: "Owners",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.DASHBOARD_VIEW_OWNERS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Team}
        />
        <SideMenuItem
          link={{
            title: "Audit Logs",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.DASHBOARD_VIEW_AUDIT_LOGS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.List}
        />

        <SideMenuItem
          link={{
            title: "Delete Dashboard",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.DASHBOARD_VIEW_DELETE] as Route,
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
