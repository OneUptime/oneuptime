import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import SideMenu, {
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  modelId: ObjectID;
  hasCustomFields: boolean;
}

const UserViewSideMenu: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const sections: SideMenuSectionProps[] = [
    {
      title: "Overview",
      items: [
        {
          link: {
            title: "Profile",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.USER_VIEW] as Route,
              { modelId: props.modelId },
            ),
          },
          icon: IconProp.User,
        },
      ],
    },
    {
      title: "Membership",
      items: [
        {
          link: {
            title: "Teams",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.USER_VIEW_TEAMS] as Route,
              { modelId: props.modelId },
            ),
          },
          icon: IconProp.Team,
        },
      ],
    },
  ];

  const settingsItems: Array<{
    link: { title: string; to: Route };
    icon: IconProp;
    className?: string;
  }> = [];

  if (props.hasCustomFields) {
    settingsItems.push({
      link: {
        title: "Custom Fields",
        to: RouteUtil.populateRouteParams(
          RouteMap[PageMap.USER_VIEW_CUSTOM_FIELDS] as Route,
          { modelId: props.modelId },
        ),
      },
      icon: IconProp.TableCells,
    });
  }

  settingsItems.push({
    link: {
      title: "Remove from Project",
      to: RouteUtil.populateRouteParams(
        RouteMap[PageMap.USER_VIEW_DELETE] as Route,
        { modelId: props.modelId },
      ),
    },
    icon: IconProp.Trash,
    className: "danger-on-hover",
  });

  sections.push({
    title: "Settings",
    items: settingsItems,
  });

  return <SideMenu sections={sections} />;
};

export default UserViewSideMenu;
