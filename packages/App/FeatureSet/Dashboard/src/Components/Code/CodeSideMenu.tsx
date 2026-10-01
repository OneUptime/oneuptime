import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import SideMenu, {
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import React, { FunctionComponent, ReactElement } from "react";
import CodeRepository from "Common/Models/DatabaseModels/CodeRepository";
import { addDeveloperSideMenuSection } from "../DeveloperDocs/DeveloperDocsMenuSection";
import { DeveloperDocsScope } from "../DeveloperDocs/DeveloperDocsPages";

/*
 * The one side menu for the Code product. Tasks (/ai/agents) and Code
 * Repositories (/code-repository) are two route trees but one feature: every
 * task runs in a connected repository, and a repository is only there so
 * tasks have somewhere to open pull requests. Both list pages render this
 * menu, so the Products menu can carry a single Tasks item for the pair.
 */
const CodeSideMenu: FunctionComponent = (): ReactElement => {
  const sections: SideMenuSectionProps[] = [
    {
      title: "Code",
      items: [
        {
          link: {
            title: "Tasks",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.AI_AGENT_TASKS] as Route,
            ),
          },
          icon: IconProp.CPUChip,
        },
        {
          link: {
            title: "Code Repositories",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.CODE_REPOSITORY] as Route,
            ),
          },
          icon: IconProp.Code,
        },
      ],
    },
  ];

  addDeveloperSideMenuSection(sections, {
    modelType: CodeRepository,
    scope: DeveloperDocsScope.List,
  });

  return <SideMenu sections={sections} />;
};

export default CodeSideMenu;
