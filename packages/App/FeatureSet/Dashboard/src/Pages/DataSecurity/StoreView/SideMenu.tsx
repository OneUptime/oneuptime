import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import DataSecurityIssue from "Common/Models/DatabaseModels/DataSecurityIssue";
import Route from "Common/Types/API/Route";
import DataSecurityIssueStatus from "Common/Types/DataSecurity/DataSecurityIssueStatus";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { BadgeType } from "Common/UI/Components/Badge/Badge";
import CountModelSideMenuItem from "Common/UI/Components/SideMenu/CountModelSideMenuItem";
import SideMenu from "Common/UI/Components/SideMenu/SideMenu";
import SideMenuItem from "Common/UI/Components/SideMenu/SideMenuItem";
import SideMenuSection from "Common/UI/Components/SideMenu/SideMenuSection";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  modelId: ObjectID;
}

/*
 * One data store's pages, in the order its questions are asked: what it is
 * and how it is doing (Overview), what is inside it, who can reach it, what
 * to fix (Issues, with how many are open), where its data goes, and the
 * scans that read it. Its owners and settings are set up once, so they fold;
 * Delete closes the menu under Advanced.
 */
const DataStoreViewSideMenu: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  const routeOf: (page: PageMap) => Route = (page: PageMap): Route => {
    return RouteUtil.populateRouteParams(RouteMap[page] as Route, {
      modelId: props.modelId,
    });
  };

  return (
    <SideMenu>
      <SideMenuSection title="Data Store">
        <SideMenuItem
          link={{
            title: "Overview",
            to: routeOf(PageMap.DATA_SECURITY_STORE_VIEW),
          }}
          icon={IconProp.Info}
        />
        <SideMenuItem
          link={{
            title: "What's Inside",
            to: routeOf(PageMap.DATA_SECURITY_STORE_VIEW_INSIDE),
          }}
          icon={IconProp.Fingerprint}
        />
        <SideMenuItem
          link={{
            title: "Who Can Reach It",
            to: routeOf(PageMap.DATA_SECURITY_STORE_VIEW_ACCESS),
          }}
          icon={IconProp.Key}
        />
        <CountModelSideMenuItem<DataSecurityIssue>
          link={{
            title: "Issues",
            to: routeOf(PageMap.DATA_SECURITY_STORE_VIEW_ISSUES),
          }}
          icon={IconProp.ShieldExclamation}
          badgeType={BadgeType.DANGER}
          modelType={DataSecurityIssue}
          countQuery={{
            projectId: projectId!,
            dataStoreId: props.modelId,
            status: DataSecurityIssueStatus.Open,
          }}
        />
        <SideMenuItem
          link={{
            title: "Data Flows",
            to: routeOf(PageMap.DATA_SECURITY_STORE_VIEW_FLOWS),
          }}
          icon={IconProp.Share}
        />
        <SideMenuItem
          link={{
            title: "Scans",
            to: routeOf(PageMap.DATA_SECURITY_STORE_VIEW_SCANS),
          }}
          icon={IconProp.MagnifyingGlass}
        />
      </SideMenuSection>

      <SideMenuSection title="Settings">
        <SideMenuItem
          link={{
            title: "Owners",
            to: routeOf(PageMap.DATA_SECURITY_STORE_VIEW_OWNERS),
          }}
          icon={IconProp.Team}
        />
        <SideMenuItem
          link={{
            title: "Settings",
            to: routeOf(PageMap.DATA_SECURITY_STORE_VIEW_SETTINGS),
          }}
          icon={IconProp.Settings}
        />
      </SideMenuSection>

      <SideMenuSection title="Advanced">
        <SideMenuItem
          link={{
            title: "Delete Data Store",
            to: routeOf(PageMap.DATA_SECURITY_STORE_VIEW_DELETE),
          }}
          icon={IconProp.Trash}
          className="danger-on-hover"
        />
      </SideMenuSection>
    </SideMenu>
  );
};

export default DataStoreViewSideMenu;
