import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import SideMenu, {
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import React, { FunctionComponent, ReactElement } from "react";
import ServerlessFunction from "Common/Models/DatabaseModels/ServerlessFunction";
import { addDeveloperSideMenuSection } from "../../Components/DeveloperDocs/DeveloperDocsMenuSection";
import { DeveloperDocsScope } from "../../Components/DeveloperDocs/DeveloperDocsPages";

const ServerlessSideMenu: FunctionComponent = (): ReactElement => {
  const sections: SideMenuSectionProps[] = [
    {
      title: "Serverless",
      items: [
        {
          link: {
            title: "All Functions",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SERVERLESS_FUNCTIONS] as Route,
            ),
          },
          icon: IconProp.List,
        },
      ],
    },
    {
      title: "Settings",
      defaultCollapsed: true,
      items: [
        {
          link: {
            title: "Owner Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SERVERLESS_SETTINGS_OWNER_RULES] as Route,
            ),
          },
          icon: IconProp.User,
        },
        {
          link: {
            title: "Label Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SERVERLESS_SETTINGS_LABEL_RULES] as Route,
            ),
          },
          icon: IconProp.Tag,
        },
      ],
    },
    /*
     * The way back to archived functions, which the list leaves out. Few visits
     * need it, so it waits in Advanced: folded away until opened, and open by
     * itself on the Archived page.
     */
    {
      title: "Advanced",
      items: [
        {
          link: {
            title: "Archived",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SERVERLESS_ARCHIVED] as Route,
            ),
          },
          icon: IconProp.Archive,
        },
      ],
    },
  ];

  addDeveloperSideMenuSection(sections, {
    modelType: ServerlessFunction,
    scope: DeveloperDocsScope.List,
  });

  return <SideMenu sections={sections} />;
};

export default ServerlessSideMenu;
