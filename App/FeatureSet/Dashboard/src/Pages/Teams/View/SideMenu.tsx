import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import SideMenu, {
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import { isEnterpriseFeatureEligible } from "../../../Components/EnterpriseEdition/EnterpriseFeatureUpgrade";
import React, { FunctionComponent, ReactElement, useMemo } from "react";

export interface ComponentProps {
  modelId: ObjectID;
}

const TeamViewSideMenu: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const isComplianceEnterpriseEligible: boolean = useMemo(() => {
    return isEnterpriseFeatureEligible();
  }, []);

  const sections: SideMenuSectionProps[] = [
    {
      title: "Overview",
      items: [
        {
          link: {
            title: "Team Details",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_TEAM_VIEW] as Route,
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
              RouteMap[PageMap.SETTINGS_TEAM_VIEW_MEMBERS] as Route,
              { modelId: props.modelId },
            ),
          },
          icon: IconProp.Team,
        },
        {
          link: {
            title: "Permissions",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_TEAM_VIEW_PERMISSIONS] as Route,
              { modelId: props.modelId },
            ),
          },
          icon: IconProp.Lock,
        },
        {
          link: {
            title: "Block Permissions",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_TEAM_VIEW_BLOCK_PERMISSIONS] as Route,
              { modelId: props.modelId },
            ),
          },
          icon: IconProp.ShieldExclamation,
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
              RouteMap[PageMap.SETTINGS_TEAM_VIEW_COMPLIANCE] as Route,
              { modelId: props.modelId },
            ),
          },
          icon: IconProp.ShieldCheck,
        },
      ],
    });
  }

  sections.push({
    title: "Danger Zone",
    items: [
      {
        link: {
          title: "Delete Team",
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.SETTINGS_TEAM_VIEW_DELETE] as Route,
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
