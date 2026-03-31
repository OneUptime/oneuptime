import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import DuplicateModel from "Common/UI/Components/DuplicateModel/DuplicateModel";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import Workflow from "Common/Models/DatabaseModels/Workflow";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import UUID from "Common/Utils/UUID";
import ComponentID from "Common/Types/Workflow/ComponentID";
import { JSONObject } from "Common/Types/JSON";
import {
  ComponentType,
  NodeDataProp,
  NodeType,
} from "Common/Types/Workflow/Component";
import { useAsyncEffect } from "use-async-effect";

const Settings: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const [showResetConfirmation, setShowResetConfirmation] =
    useState<boolean>(false);
  const [refresher, setRefresher] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [isWebhookTrigger, setIsWebhookTrigger] = useState<boolean>(false);

  useAsyncEffect(async () => {
    try {
      const workflow: Workflow | null = await ModelAPI.getItem({
        modelType: Workflow,
        id: modelId,
        select: {
          graph: true,
        },
        requestOptions: {},
      });

      if (workflow?.graph && (workflow.graph as JSONObject)["nodes"]) {
        const nodes: Array<JSONObject> = (workflow.graph as JSONObject)[
          "nodes"
        ] as Array<JSONObject>;

        for (const node of nodes) {
          const nodeData: NodeDataProp = node["data"] as any;

          if (
            nodeData.componentType === ComponentType.Trigger &&
            nodeData.nodeType === NodeType.Node &&
            nodeData.metadataId === ComponentID.Webhook
          ) {
            setIsWebhookTrigger(true);
            break;
          }
        }
      }
    } catch {
      // ignore - just don't show the webhook section
    }
  }, []);

  const resetSecretKey: () => void = (): void => {
    setShowResetConfirmation(false);

    ModelAPI.updateById({
      modelType: Workflow,
      id: modelId,
      data: {
        webhookSecretKey: UUID.generate(),
      },
    })
      .then(() => {
        setRefresher(!refresher);
      })
      .catch((err: Error) => {
        setError(API.getFriendlyMessage(err));
      });
  };

  return (
    <Fragment>
      {isWebhookTrigger && (
        <CardModelDetail<Workflow>
          name="Workflow > Webhook Secret Key"
          cardProps={{
            title: "Webhook Secret Key",
            description:
              "This secret key is used to trigger this workflow via webhook. Use this key in the webhook URL instead of the workflow ID for security. You can reset this key if it is compromised.",
            buttons: [
              {
                title: "Reset Secret Key",
                buttonStyle: ButtonStyleType.DANGER_OUTLINE,
                onClick: () => {
                  setShowResetConfirmation(true);
                },
                icon: IconProp.Refresh,
              },
            ],
          }}
          isEditable={false}
          refresher={refresher}
          modelDetailProps={{
            showDetailsInNumberOfColumns: 1,
            modelType: Workflow,
            id: "model-detail-workflow-webhook-secret",
            fields: [
              {
                field: {
                  webhookSecretKey: true,
                },
                fieldType: FieldType.HiddenText,
                title: "Webhook Secret Key",
                placeholder:
                  "No secret key generated yet. Save the workflow to generate one.",
                opts: {
                  isCopyable: true,
                },
              },
            ],
            modelId: modelId,
          }}
        />
      )}

      {showResetConfirmation && (
        <ConfirmModal
          title="Reset Webhook Secret Key"
          description="Are you sure you want to reset the webhook secret key? Any existing integrations using the current key will stop working."
          submitButtonText="Reset Key"
          submitButtonType={ButtonStyleType.DANGER}
          onClose={() => {
            setShowResetConfirmation(false);
          }}
          onSubmit={resetSecretKey}
        />
      )}

      {error && (
        <ConfirmModal
          title="Error"
          description={error}
          submitButtonText="Close"
          submitButtonType={ButtonStyleType.NORMAL}
          onSubmit={() => {
            setError("");
          }}
        />
      )}

      <DuplicateModel
        modelId={modelId}
        modelType={Workflow}
        fieldsToDuplicate={{
          description: true,
          graph: true,
          isEnabled: true,
          labels: true,
        }}
        navigateToOnSuccess={RouteUtil.populateRouteParams(
          new Route(RouteMap[PageMap.WORKFLOWS]?.toString()),
        )}
        fieldsToChange={[
          {
            field: {
              name: true,
            },
            title: "New Workflow Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "New Workflow Name",
            validation: {
              minLength: 2,
            },
          },
        ]}
      />
    </Fragment>
  );
};

export default Settings;
