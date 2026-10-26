import PageMap from "../../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../../Utils/RouteMap";
import { getDeveloperSideMenuSection } from "../../../../Components/DeveloperDocs/DeveloperDocsMenuSection";
import { DeveloperDocsScope } from "../../../../Components/DeveloperDocs/DeveloperDocsPages";
import CloudAccount from "Common/Models/DatabaseModels/CloudAccount";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import SideMenu from "Common/UI/Components/SideMenu/SideMenu";
import SideMenuItem from "Common/UI/Components/SideMenu/SideMenuItem";
import SideMenuSection from "Common/UI/Components/SideMenu/SideMenuSection";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  modelId: ObjectID;
}

const CloudAccountSideMenu: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const populate: (page: PageMap) => Route = (page: PageMap): Route => {
    return RouteUtil.populateRouteParams(RouteMap[page] as Route, {
      modelId: props.modelId,
    });
  };

  return (
    <SideMenu>
      <SideMenuSection title="Basic">
        <SideMenuItem
          link={{
            title: "Overview",
            to: populate(PageMap.CLOUD_ACCOUNT_VIEW),
          }}
          icon={IconProp.Info}
        />
        <SideMenuItem
          link={{
            title: "Resources",
            to: populate(PageMap.CLOUD_ACCOUNT_VIEW_RESOURCES),
          }}
          icon={IconProp.SquareStack}
        />
        <SideMenuItem
          link={{
            title: "Topology",
            to: populate(PageMap.CLOUD_ACCOUNT_VIEW_TOPOLOGY),
          }}
          icon={IconProp.FlowDiagram}
        />
      </SideMenuSection>

      <SideMenuSection title="Activity">
        <SideMenuItem
          link={{
            title: "Changes",
            to: populate(PageMap.CLOUD_ACCOUNT_VIEW_CHANGES),
          }}
          icon={IconProp.Activity}
        />
      </SideMenuSection>

      <SideMenuSection title="Settings">
        <SideMenuItem
          link={{
            title: "Settings",
            to: populate(PageMap.CLOUD_ACCOUNT_VIEW_SETTINGS),
          }}
          icon={IconProp.Settings}
        />
      </SideMenuSection>

      {getDeveloperSideMenuSection({
        modelType: CloudAccount,
        scope: DeveloperDocsScope.View,
        modelId: props.modelId,
      })}

      <SideMenuSection title="Advanced">
        <SideMenuItem
          link={{
            title: "Delete Account",
            to: populate(PageMap.CLOUD_ACCOUNT_VIEW_DELETE),
          }}
          icon={IconProp.Trash}
          className="danger-on-hover"
        />
      </SideMenuSection>
    </SideMenu>
  );
};

export default CloudAccountSideMenu;
