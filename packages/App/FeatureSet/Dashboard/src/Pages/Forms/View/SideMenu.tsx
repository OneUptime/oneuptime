import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Form from "Common/Models/DatabaseModels/Form";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import SideMenu from "Common/UI/Components/SideMenu/SideMenu";
import SideMenuItem from "Common/UI/Components/SideMenu/SideMenuItem";
import SideMenuSection from "Common/UI/Components/SideMenu/SideMenuSection";
import React, { FunctionComponent, ReactElement } from "react";
import { getDeveloperSideMenuSection } from "../../../Components/DeveloperDocs/DeveloperDocsMenuSection";
import { DeveloperDocsScope } from "../../../Components/DeveloperDocs/DeveloperDocsPages";

export interface ComponentProps {
  modelId: ObjectID;
}

/*
 * A form's menu, in the order a form is set up: build its questions, decide
 * what a submission creates, share its link, then watch what comes in.
 */
const FormViewSideMenu: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <SideMenu>
      <SideMenuSection title="Form">
        <SideMenuItem
          link={{
            title: "Build",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.FORM_VIEW] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.ClipboardDocumentList}
        />
        <SideMenuItem
          link={{
            title: "On Submit",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.FORM_VIEW_ON_SUBMIT] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Bolt}
        />
        <SideMenuItem
          link={{
            title: "Share",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.FORM_VIEW_SHARE] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Link}
        />
        <SideMenuItem
          link={{
            title: "Submissions",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.FORM_VIEW_SUBMISSIONS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.InboxStack}
        />
      </SideMenuSection>

      {getDeveloperSideMenuSection({
        modelType: Form,
        scope: DeveloperDocsScope.View,
        modelId: props.modelId,
      })}

      <SideMenuSection title="Advanced">
        <SideMenuItem
          link={{
            title: "Delete Form",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.FORM_VIEW_DELETE] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Trash}
          className="danger-on-hover"
        />
      </SideMenuSection>
    </SideMenu>
  );
};

export default FormViewSideMenu;
