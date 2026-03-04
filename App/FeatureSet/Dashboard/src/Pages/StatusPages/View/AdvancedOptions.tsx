import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import SideMenu from "./SideMenu";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import ModelPage from "Common/UI/Components/Page/ModelPage";
import Navigation from "Common/UI/Utils/Navigation";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FieldType from "Common/UI/Components/Types/FieldType";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import OneUptimeDate from "Common/Types/Date";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import Card from "Common/UI/Components/Card/Card";
import { APP_API_URL } from "Common/UI/Config";

const StatusPageAdvancedOptions: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const [showRegenerateTokenModal, setShowRegenerateTokenModal] =
    useState<boolean>(false);
  const [isRegenerating, setIsRegenerating] = useState<boolean>(false);

  const regenerateToken: () => Promise<void> = async (): Promise<void> => {
    setIsRegenerating(true);
    try {
      // Generate a new random token
      const newToken: string =
        OneUptimeDate.getCurrentDate().getTime().toString() +
        Math.random().toString(36).substring(2, 15);

      await ModelAPI.updateById<StatusPage>({
        id: modelId,
        modelType: StatusPage,
        data: {
          embeddedOverallStatusToken: newToken,
        },
      });

      setShowRegenerateTokenModal(false);
      window.location.reload();
    } catch {
      // Error will be handled by ModelAPI
    } finally {
      setIsRegenerating(false);
    }
  };

  const badgeUrl: string = `${APP_API_URL}/status-page/badge/${modelId.toString()}?token={TOKEN_PLACEHOLDER}`;

  return (
    <ModelPage
      title="Status Page"
      modelType={StatusPage}
      modelId={modelId}
      modelNameField="name"
      breadcrumbLinks={[
        {
          title: "Project",
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route, {
            modelId,
          }),
        },
        {
          title: "Status Pages",
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.STATUS_PAGES] as Route,
            { modelId },
          ),
        },
        {
          title: "View Status Page",
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.STATUS_PAGE_VIEW] as Route,
            { modelId },
          ),
        },
        {
          title: "Advanced Settings",
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.STATUS_PAGE_VIEW_ADVANCED_OPTIONS] as Route,
            { modelId },
          ),
        },
      ]}
      sideMenu={<SideMenu modelId={modelId} />}
    >
      <Fragment>
        <CardModelDetail<StatusPage>
          name="Status Page > Embedded Status Badge"
          cardProps={{
            title: "Embedded Status Badge",
            description:
              "Enable a lightweight status badge that can be embedded on external websites. The badge displays the current overall status of your status page.",
          }}
          editButtonText="Edit Settings"
          isEditable={true}
          formFields={[
            {
              field: {
                enableEmbeddedOverallStatus: true,
              },
              title: "Enable Embedded Status Badge",
              fieldType: FormFieldSchemaType.Toggle,
              required: false,
              description:
                "When enabled, you can embed a status badge on external websites using the badge URL with the security token.",
            },
          ]}
          modelDetailProps={{
            showDetailsInNumberOfColumns: 1,
            modelType: StatusPage,
            id: "model-detail-status-page-embedded-badge",
            fields: [
              {
                field: {
                  enableEmbeddedOverallStatus: true,
                },
                fieldType: FieldType.Boolean,
                title: "Enable Embedded Status Badge",
              },
              {
                field: {
                  embeddedOverallStatusToken: true,
                },
                fieldType: FieldType.Text,
                title: "Security Token",
                placeholder: "No token generated yet",
                description:
                  "This token is required to access the badge. Keep it secure.",
              },
            ],
            modelId: modelId,
          }}
        />

        <Card
          title="Badge Usage"
          description="Use the following examples to embed your status badge on external websites, documentation, or dashboards."
        >
          <div className="space-y-6">
            <div>
              <Button
                title="Regenerate Token"
                buttonStyle={ButtonStyleType.NORMAL}
                icon={IconProp.Refresh}
                onClick={() => {
                  setShowRegenerateTokenModal(true);
                }}
              />
              <p className="mt-2 text-sm text-gray-500">
                Regenerating the token will invalidate any existing embedded
                badges.
              </p>
            </div>

            <div>
              <h3 className="text-lg font-medium mb-2">Badge Preview</h3>
              <img src={badgeUrl} alt="Status Badge" className="mb-4" />
            </div>

            <div>
              <h3 className="text-lg font-medium mb-2">HTML Embed</h3>
              <pre className="bg-gray-100 p-4 rounded-md overflow-x-auto">
                <code>{`<img src="${badgeUrl}" alt="Status Badge" />`}</code>
              </pre>
            </div>

            <div>
              <h3 className="text-lg font-medium mb-2">Markdown Embed</h3>
              <pre className="bg-gray-100 p-4 rounded-md overflow-x-auto">
                <code>{`![Status](${badgeUrl})`}</code>
              </pre>
            </div>

            <div>
              <h3 className="text-lg font-medium mb-2">Markdown with Link</h3>
              <pre className="bg-gray-100 p-4 rounded-md overflow-x-auto">
                <code>{`[![Status](${badgeUrl})](https://your-status-page-url.com)`}</code>
              </pre>
            </div>

            <div>
              <h3 className="text-lg font-medium mb-2">Use Cases</h3>
              <ul className="list-disc list-inside space-y-2 text-sm text-gray-700">
                <li>Add to your company website to show real-time status</li>
                <li>Include in project README.md files on GitHub</li>
                <li>Embed in documentation sites</li>
                <li>Display on internal dashboards</li>
                <li>Include in status emails or reports</li>
              </ul>
            </div>

            <div className="bg-yellow-50 border border-yellow-200 rounded-md p-4">
              <h4 className="text-sm font-medium text-yellow-800 mb-2">
                Security Note
              </h4>
              <p className="text-sm text-yellow-700">
                Keep your security token confidential. Anyone with the token can
                access your status badge. If you suspect the token has been
                compromised, regenerate it immediately.
              </p>
            </div>
          </div>
        </Card>

        {showRegenerateTokenModal && (
          <ConfirmModal
            title="Regenerate Security Token"
            description="Are you sure you want to regenerate the security token? This will invalidate the current token and any existing embedded badges will stop working until you update them with the new token."
            onClose={() => {
              setShowRegenerateTokenModal(false);
            }}
            submitButtonText="Regenerate Token"
            onSubmit={regenerateToken}
            isLoading={isRegenerating}
          />
        )}
      </Fragment>
    </ModelPage>
  );
};

export default StatusPageAdvancedOptions;
