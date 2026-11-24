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
 * A form's menu, in the order a form is set up: build its questions, give
 * it templates to start from, decide what a submission creates, share its
 * link - and put it on your own domain - then watch what comes in.
 * Duplicating the form, who changed it (Audit Logs) and deleting it are
 * under Advanced.
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
            title: "Templates",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.FORM_VIEW_TEMPLATES] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.DocumentDuplicate}
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
            title: "Custom Domains",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.FORM_VIEW_CUSTOM_DOMAINS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Globe}
        />
        {/*
         * Who signs in to the form's link, when only people who sign in can
         * open it (#10249).
         */}
        <SideMenuItem
          link={{
            title: "Private Users",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.FORM_VIEW_PRIVATE_USERS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.User}
        />
        <SideMenuItem
          link={{
            title: "Single Sign-On",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.FORM_VIEW_SINGLE_SIGN_ON] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Lock}
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
            title: "Duplicate Form",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.FORM_VIEW_DUPLICATE] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Copy}
        />
        <SideMenuItem
          link={{
            title: "Audit Logs",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.FORM_VIEW_AUDIT_LOGS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.List}
        />
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
