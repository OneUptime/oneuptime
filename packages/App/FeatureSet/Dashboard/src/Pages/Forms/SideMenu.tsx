import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Form from "Common/Models/DatabaseModels/Form";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import SideMenu, {
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import React, { ReactElement } from "react";
import { addDeveloperSideMenuSection } from "../../Components/DeveloperDocs/DeveloperDocsMenuSection";
import { DeveloperDocsScope } from "../../Components/DeveloperDocs/DeveloperDocsPages";

/*
 * The Forms product's menu: the forms themselves, and every submission made
 * through any of them. There is no Settings section: a form carries its own
 * settings (On Submit, Share), so there is nothing project-wide to set.
 */
const FormsSideMenu: () => ReactElement = (): ReactElement => {
  const sections: SideMenuSectionProps[] = [
    {
      title: "Forms",
      items: [
        {
          link: {
            title: "Forms",
            to: RouteUtil.populateRouteParams(RouteMap[PageMap.FORMS] as Route),
          },
          icon: IconProp.ClipboardDocumentList,
        },
        {
          link: {
            title: "Submissions",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.FORMS_SUBMISSIONS] as Route,
            ),
          },
          icon: IconProp.InboxStack,
        },
      ],
    },
  ];

  addDeveloperSideMenuSection(sections, {
    modelType: Form,
    scope: DeveloperDocsScope.List,
  });

  return <SideMenu sections={sections} />;
};

export default FormsSideMenu;
