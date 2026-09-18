import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import SideMenu, {
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import {
  IDENTITY_REQUIRED_PLAN,
  isEnterpriseFeatureEligible,
} from "../../../Enterprise/EnterpriseEligibility";
import React, { FunctionComponent, ReactElement, useMemo } from "react";

export interface ComponentProps {
  modelId: ObjectID;
}

/*
 * Whether the team's Compliance item is shown: exactly when the Compliance
 * page (Pages/Teams/View/Compliance) would show the feature rather than its
 * upsell - the same check, at the same tier. On the Cloud that is the
 * project's plan (Scale and above: TeamComplianceSetting is sold at Scale),
 * self-hosted it is the Enterprise Edition. The item is hidden rather than
 * pointed at an upsell, as it always was.
 */
export const isTeamComplianceMenuItemVisible: () => boolean = (): boolean => {
  return isEnterpriseFeatureEligible(IDENTITY_REQUIRED_PLAN);
};

const TeamViewSideMenu: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const isComplianceEnterpriseEligible: boolean = useMemo(() => {
    return isTeamComplianceMenuItemVisible();
  }, []);

  const sections: SideMenuSectionProps[] = [
    {
      title: "Overview",
      items: [
        {
          link: {
            title: "Team Details",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.TEAM_VIEW] as Route,
              { modelId: props.modelId },
            ),
          },
          icon: IconProp.Info,
        },
      ],
    },
    {
      title: "Members & Access",
      items: [
        {
          link: {
            title: "Members",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.TEAM_VIEW_MEMBERS] as Route,
              { modelId: props.modelId },
            ),
          },
          icon: IconProp.Team,
        },
        {
          link: {
            title: "Permissions",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.TEAM_VIEW_PERMISSIONS] as Route,
              { modelId: props.modelId },
            ),
          },
          icon: IconProp.Lock,
        },
        {
          link: {
            title: "Block Permissions",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.TEAM_VIEW_BLOCK_PERMISSIONS] as Route,
              { modelId: props.modelId },
            ),
          },
          icon: IconProp.ShieldExclamation,
        },
      ],
    },
    {
      title: "On-Call",
      items: [
        {
          link: {
            title: "On-Call Schedules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.TEAM_VIEW_ON_CALL_SCHEDULES] as Route,
              { modelId: props.modelId },
            ),
          },
          icon: IconProp.Calendar,
        },
      ],
    },
  ];

  if (isComplianceEnterpriseEligible) {
    sections.push({
      title: "Compliance",
      items: [
        {
          link: {
            title: "Compliance",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.TEAM_VIEW_COMPLIANCE] as Route,
              { modelId: props.modelId },
            ),
          },
          icon: IconProp.ShieldCheck,
        },
      ],
    });
  }

  sections.push({
    title: "Settings",
    items: [
      {
        link: {
          title: "Custom Fields",
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.TEAM_VIEW_CUSTOM_FIELDS] as Route,
            { modelId: props.modelId },
          ),
        },
        icon: IconProp.TableCells,
      },
      {
        link: {
          title: "Delete Team",
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.TEAM_VIEW_DELETE] as Route,
            { modelId: props.modelId },
          ),
        },
        icon: IconProp.Trash,
        className: "danger-on-hover",
      },
    ],
  });

  return <SideMenu sections={sections} />;
};

export default TeamViewSideMenu;
