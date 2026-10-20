import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import {
  EXTERNAL_MCP_SERVER_SWITCH_COPY,
  getExternalMcpServerAuthTitle,
} from "../../Components/ExternalMcpServer/ExternalMcpServerCopy";
import {
  getExternalMcpServerFormFields,
  getExternalMcpServerFormSteps,
} from "../../Components/ExternalMcpServer/ExternalMcpServerFormFields";
import ExternalMcpServerToolsCard from "../../Components/ExternalMcpServer/ExternalMcpServerToolsCard";
import ExternalMcpServer from "Common/Models/DatabaseModels/ExternalMcpServer";
import ExternalMcpServerAuthType, {
  readExternalMcpServerAuthType,
} from "Common/Types/AI/ExternalMcpServer/ExternalMcpServerAuthType";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import ModelSwitchCard from "Common/UI/Components/ModelSwitch/ModelSwitchCard";
import { ModelSwitchConfirmation } from "Common/UI/Components/ModelSwitch/ModelSwitchRow";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

/*
 * Turning a server off asks first: OneUptime AI stops using it at once,
 * and fixes waiting for approval that use it can no longer be approved.
 * Turning it back on saves at once.
 */
export const getTurnOffExternalMcpServerConfirmation: (
  isTurningOn: boolean,
) => ModelSwitchConfirmation | undefined = (
  isTurningOn: boolean,
): ModelSwitchConfirmation | undefined => {
  if (isTurningOn) {
    return undefined;
  }

  return {
    title: EXTERNAL_MCP_SERVER_SWITCH_COPY.confirmOffTitle,
    description: EXTERNAL_MCP_SERVER_SWITCH_COPY.confirmOffDescription,
    submitButtonText: EXTERNAL_MCP_SERVER_SWITCH_COPY.confirmOffButton,
    submitButtonType: ButtonStyleType.DANGER,
  };
};

const isAuthType: (
  item: ExternalMcpServer,
  authType: ExternalMcpServerAuthType,
) => boolean = (
  item: ExternalMcpServer,
  authType: ExternalMcpServerAuthType,
): boolean => {
  return readExternalMcpServerAuthType(item.authType) === authType;
};

/*
 * An external MCP server's page: what it is and how OneUptime signs in
 * (editable with the form it was added with - a secret left empty keeps the
 * stored one, and none is ever shown), whether OneUptime AI may use it, and
 * the tools it offers as last read, with Test connection.
 */
const ExternalMcpServerView: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [modelId] = useState<ObjectID>(Navigation.getLastParamAsObjectID());

  return (
    <Fragment>
      <CardModelDetail<ExternalMcpServer>
        name="External MCP Server Details"
        cardProps={{
          title: "MCP Server Details",
          description: "Where the server is, and how OneUptime signs in to it.",
        }}
        isEditable={true}
        formSteps={getExternalMcpServerFormSteps()}
        formFields={getExternalMcpServerFormFields()}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 2,
          modelType: ExternalMcpServer,
          id: "model-detail-external-mcp-server",
          fields: [
            {
              field: {
                name: true,
              },
              title: "Name",
            },
            {
              field: {
                url: true,
              },
              title: "URL",
              fieldType: FieldType.Element,
              getElement: (item: ExternalMcpServer): ReactElement => {
                return (
                  <span className="break-all font-mono text-sm">
                    {item.url || ""}
                  </span>
                );
              },
            },
            {
              field: {
                description: true,
              },
              title: "Description",
              placeholder: "No description provided.",
            },
            {
              field: {
                authType: true,
              },
              title: "Authentication",
              fieldType: FieldType.Element,
              getElement: (item: ExternalMcpServer): ReactElement => {
                return (
                  <span>
                    {translator.translateText(
                      getExternalMcpServerAuthTitle(item.authType),
                    )}
                  </span>
                );
              },
            },
            {
              field: {
                headerNames: true,
              },
              title: "Request Headers",
              description:
                "The headers OneUptime sends. Their values are never shown.",
              fieldType: FieldType.Element,
              showIf: (item: ExternalMcpServer): boolean => {
                return isAuthType(item, ExternalMcpServerAuthType.Headers);
              },
              getElement: (item: ExternalMcpServer): ReactElement => {
                return (
                  <span className="break-all font-mono text-sm">
                    {item.headerNames || "-"}
                  </span>
                );
              },
            },
            {
              field: {
                oauthTokenUrl: true,
              },
              title: "Token URL",
              fieldType: FieldType.Element,
              showIf: (item: ExternalMcpServer): boolean => {
                return isAuthType(
                  item,
                  ExternalMcpServerAuthType.OAuthClientCredentials,
                );
              },
              getElement: (item: ExternalMcpServer): ReactElement => {
                return (
                  <span className="break-all font-mono text-sm">
                    {item.oauthTokenUrl || "-"}
                  </span>
                );
              },
            },
            {
              field: {
                oauthClientId: true,
              },
              title: "Client ID",
              showIf: (item: ExternalMcpServer): boolean => {
                return isAuthType(
                  item,
                  ExternalMcpServerAuthType.OAuthClientCredentials,
                );
              },
            },
            {
              field: {
                oauthScope: true,
              },
              title: "Scope",
              placeholder: "None",
              showIf: (item: ExternalMcpServer): boolean => {
                return isAuthType(
                  item,
                  ExternalMcpServerAuthType.OAuthClientCredentials,
                );
              },
            },
            // On the card's ID line, for the API and Terraform.
            {
              field: {
                _id: true,
              },
              title: "ID",
              fieldType: FieldType.ObjectID,
            },
          ],
          modelId: modelId,
        }}
      />

      <div className="mt-5">
        <ModelSwitchCard<ExternalMcpServer>
          modelType={ExternalMcpServer}
          modelId={modelId}
          column="isEnabled"
          cardTitle={EXTERNAL_MCP_SERVER_SWITCH_COPY.cardTitle}
          cardDescription={EXTERNAL_MCP_SERVER_SWITCH_COPY.cardDescription}
          title={EXTERNAL_MCP_SERVER_SWITCH_COPY.title}
          getDescription={(isOn: boolean): string => {
            return isOn
              ? EXTERNAL_MCP_SERVER_SWITCH_COPY.on
              : EXTERNAL_MCP_SERVER_SWITCH_COPY.off;
          }}
          getConfirmation={getTurnOffExternalMcpServerConfirmation}
          dataTestId="external-mcp-server-enabled"
        />
      </div>

      <div className="mt-5">
        <ExternalMcpServerToolsCard serverId={modelId} />
      </div>

      <ModelDelete
        modelType={ExternalMcpServer}
        modelId={modelId}
        onDeleteSuccess={() => {
          Navigation.navigate(
            RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_AI_EXTERNAL_MCP_SERVERS] as Route,
              { modelId },
            ),
          );
        }}
      />
    </Fragment>
  );
};

export default ExternalMcpServerView;
