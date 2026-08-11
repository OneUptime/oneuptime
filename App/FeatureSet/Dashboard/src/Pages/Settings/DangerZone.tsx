import ProjectUtil from "Common/UI/Utils/Project";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import DashboardSideMenu from "./SideMenu";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import Page from "Common/UI/Components/Page/Page";
import TextArea from "Common/UI/Components/TextArea/TextArea";
import { APP_API_URL, BILLING_ENABLED } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "Common/UI/Utils/Permission";
import Project from "Common/Models/DatabaseModels/Project";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import React, { FunctionComponent, ReactElement, useState } from "react";

export interface ComponentProps extends PageComponentProps {
  onProjectDeleted: () => void;
}

const Settings: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const projectId: ObjectID = new ObjectID(
    ProjectUtil.getCurrentProjectId()?.toString() || "",
  );

  /*
   * Why the customer is leaving. Only asked on SaaS - there is nobody to
   * follow up with on a self-hosted install, and nowhere it would be recorded.
   */
  const [deletionReason, setDeletionReason] = useState<string>("");

  type DeleteProjectFunction = () => Promise<void>;

  /*
   * The generic DELETE has nowhere to carry the reason, so deletes go through
   * the project's own endpoint instead. Permissions are unchanged - the server
   * still runs the delete through the same permission checks.
   */
  const deleteProject: DeleteProjectFunction = async (): Promise<void> => {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post({
        url: URL.fromString(APP_API_URL.toString())
          .addRoute(new Project().getCrudApiPath()!)
          .addRoute(`/${projectId.toString()}/delete-project`),
        data: {
          data: {
            deletionReason: deletionReason,
          },
        },
        /*
         * The tenantid header is what the server resolves this request's
         * project permissions from - API.post does not add it the way
         * ModelAPI does, and without it the delete is refused.
         */
        headers: ModelAPI.getCommonHeaders(),
      });

    if (response.isFailure()) {
      throw response;
    }
  };

  return (
    <Page
      title={"Project Settings"}
      breadcrumbLinks={[
        {
          title: "Project",
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
        },
        {
          title: "Settings",
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.SETTINGS] as Route,
          ),
        },
        {
          title: "Danger Zone",
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.SETTINGS_DANGERZONE] as Route,
          ),
        },
      ]}
      sideMenu={<DashboardSideMenu />}
    >
      <Alert
        type={AlertType.DANGER}
        strongTitle="DANGER ZONE"
        title="Deleting your project will delete it permanently and there is no way to recover. "
      />

      <ModelDelete
        modelType={Project}
        modelId={projectId}
        onDelete={deleteProject}
        confirmationContent={
          BILLING_ENABLED ? (
            <div>
              <FieldLabelElement
                title="Why are you deleting this project?"
                htmlFor="project-deletion-reason"
                description="Optional. Telling us what went wrong helps us make OneUptime better."
              />
              <div className="mt-2">
                <TextArea
                  id="project-deletion-reason"
                  dataTestId="project-deletion-reason"
                  value={deletionReason}
                  placeholder="It would be great to know why you're leaving..."
                  onChange={(value: string) => {
                    setDeletionReason(value);
                  }}
                />
              </div>
            </div>
          ) : undefined
        }
        onDeleteSuccess={() => {
          ProjectUtil.clearCurrentProject();
          PermissionUtil.clearProjectPermissions();
          props.onProjectDeleted();
        }}
      />
    </Page>
  );
};

export default Settings;
