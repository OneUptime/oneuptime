import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import { getCurrentProjectBillingMarketplace } from "../../Components/ProjectBalance/ProjectBalanceAccess";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import CloudMarketplace, {
  CloudMarketplaceUtil,
} from "Common/Types/Marketplace/CloudMarketplace";
import ObjectID from "Common/Types/ObjectID";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import TextArea from "Common/UI/Components/TextArea/TextArea";
import { APP_API_URL, BILLING_ENABLED } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "Common/UI/Utils/Permission";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
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

  const translator: Translator = useTranslator();

  /*
   * A project a cloud marketplace bills: deleting it ends OneUptime's
   * billing of it, after a last charge for what it used, but not the
   * purchase on the marketplace - only the buyer can cancel that, there.
   * On Vercel it does end it: the resource is deleted with its project.
   */
  const billingMarketplace: CloudMarketplace | null = BILLING_ENABLED
    ? getCurrentProjectBillingMarketplace()
    : null;

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
    <React.Fragment>
      {/*
       * No red DANGER ZONE banner over the card: the Delete Project card
       * says the same ("Permanently delete <project>. This action cannot be
       * undone."), and its dialog asks for the project's name.
       */}
      {billingMarketplace && (
        <Alert
          type={AlertType.WARNING}
          dataTestId="project-delete-marketplace-notice"
          strongTitle={translator.translateTemplate(
            "Billed through {{marketplace}}",
            {
              marketplace:
                CloudMarketplaceUtil.getDisplayName(billingMarketplace),
            },
          )}
          title={
            /*
             * A Vercel resource is its project: deleting the project deletes
             * the resource on Vercel too, and with it the connected Vercel
             * projects' environment variables.
             */
            billingMarketplace === CloudMarketplace.Vercel
              ? translator.translateText(
                  "Deleting this project stops its billing, after one last charge for its usage so far, and deletes its OneUptime resource on Vercel. The Vercel projects connected to it lose its environment variables at their next deployment.",
                )
              : translator.translateTemplate(
                  "Deleting this project stops its billing, after one last charge for its usage so far. Your OneUptime purchase on {{marketplace}} stays active until you cancel it there.",
                  {
                    marketplace:
                      CloudMarketplaceUtil.getDisplayName(billingMarketplace),
                  },
                )
          }
        />
      )}

      <ModelDelete
        modelType={Project}
        modelId={projectId}
        onDelete={deleteProject}
        /*
         * Deleting the project removes every monitor, incident, status page
         * and byte of telemetry in it, for every member, and nothing brings it
         * back - yet its dialog looked like the one that deletes a label. So
         * Delete stays locked until the project's name has been typed.
         */
        requireTypedName={true}
        {...(props.currentProject?.name &&
        props.currentProject.id?.toString() === projectId.toString()
          ? { itemName: props.currentProject.name }
          : {})}
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
    </React.Fragment>
  );
};

export default Settings;
