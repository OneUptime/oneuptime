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
 * Code's side menu on its first page: the repositories (Code is
 * repositories first - each repository's page holds its tasks), and the
 * Developer pages for code repositories (Terraform, API, AI Assistants).
 */
const CodeSideMenu: FunctionComponent = (): ReactElement => {
  const sections: SideMenuSectionProps[] = [
    {
      title: "Code",
      items: [
        {
          link: {
            title: "Repositories",
            to: RouteUtil.populateRouteParams(RouteMap[PageMap.CODE] as Route),
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
