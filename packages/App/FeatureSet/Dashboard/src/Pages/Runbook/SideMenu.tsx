import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import SideMenu, {
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import React, { ReactElement } from "react";
import Runbook from "Common/Models/DatabaseModels/Runbook";
import { addDeveloperSideMenuSection } from "../../Components/DeveloperDocs/DeveloperDocsMenuSection";
import { DeveloperDocsScope } from "../../Components/DeveloperDocs/DeveloperDocsPages";

const RunbookSideMenu: () => ReactElement = (): ReactElement => {
  const sections: SideMenuSectionProps[] = [
    {
      title: "Runbooks",
      items: [
        {
          link: {
            title: "Runbooks",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.RUNBOOKS] as Route,
            ),
          },
          icon: IconProp.BookOpen,
        },
        {
          link: {
            title: "Executions",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.RUNBOOKS_EXECUTIONS] as Route,
            ),
          },
          icon: IconProp.Play,
        },
      ],
    },
    /*
     * Runners sit in the open, not folded into Settings: a Bash, SSH or
     * Kubernetes step cannot run without one, and this is where people come
     * to see whether theirs is still connected. The AI pages that need a
     * Runner (code fixes, remediation commands) link straight to these too.
     */
    {
      title: "Runners",
      items: [
        {
          link: {
            title: "Runners",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.RUNBOOKS_RUNNERS] as Route,
            ),
          },
          icon: IconProp.Terminal,
        },
        {
          link: {
            title: "Credentials",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.RUNBOOKS_RUNNER_CREDENTIALS] as Route,
            ),
          },
          icon: IconProp.Key,
        },
      ],
    },
    {
      title: "Settings",
      defaultCollapsed: true,
      items: [
        {
          link: {
            title: "Secrets",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.RUNBOOKS_SECRETS] as Route,
            ),
          },
          icon: IconProp.Lock,
        },
        {
          link: {
            title: "Owner Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.RUNBOOKS_SETTINGS_OWNER_RULES] as Route,
            ),
          },
          icon: IconProp.User,
        },
        {
          link: {
            title: "Label Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.RUNBOOKS_SETTINGS_LABEL_RULES] as Route,
            ),
          },
          icon: IconProp.Tag,
        },
      ],
    },
  ];

  addDeveloperSideMenuSection(sections, {
    modelType: Runbook,
    scope: DeveloperDocsScope.List,
  });

  return <SideMenu sections={sections} />;
};

export default RunbookSideMenu;
