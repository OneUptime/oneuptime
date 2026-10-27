import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { CardButtonSchema } from "Common/UI/Components/Card/Card";
import TestLlmProviderModal from "Common/UI/Components/AI/TestLlmProviderModal";
import {
  getLlmProviderFormSteps,
  getProjectLlmProviderFormFields,
} from "Common/UI/Components/AI/LlmProviderFormFields";
import {
  getLlmProviderShownModelName,
  getLlmProviderShownValue,
  getLlmProviderTypeCopy,
} from "Common/UI/Components/AI/LlmProviderFormCopy";
import LlmProviderTypeLabel from "Common/UI/Components/AI/LlmProviderTypeLabel";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import TestLLMProvider from "Common/UI/Utils/TestLLMProvider";
import LlmProvider from "Common/Models/DatabaseModels/LlmProvider";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green } from "Common/Types/BrandColors";
import PermissionGate, {
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

const LlmProviderView: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [modelId] = useState<ObjectID>(Navigation.getLastParamAsObjectID());

  /*
   * The Additional Parameters are read like the API key, by project owners
   * and admins alone (LlmProvider.additionalParams). Everyone else who reads
   * the provider is shown whether any are saved (hasAdditionalParams), never
   * what they are.
   */
  const canReadAdditionalParams: boolean = PermissionGate.canReadColumn(
    new LlmProvider(),
    "additionalParams",
  );

  const [showTestModal, setShowTestModal] = useState<boolean>(false);

  /*
   * Test is for whoever may change the provider, as the server asks it.
   * Anyone else who may read it sees Test locked, its tooltip saying who
   * may; before the permission snapshot has landed it is not offered. An
   * unlocked Test needs no tooltip: the dialog it opens says what it does,
   * and a tooltip on it popped up again whenever the dialog closed and
   * handed the button its focus back.
   */
  const testGate: PermissionGateResult = TestLLMProvider.getTestGate();

  const testButtons: Array<CardButtonSchema> =
    testGate.isAllowed || testGate.disabledReason
      ? [
          {
            title: "Test",
            icon: IconProp.Play,
            buttonStyle: ButtonStyleType.NORMAL,
            disabled: !testGate.isAllowed,
            tooltip: testGate.isAllowed ? undefined : testGate.disabledReason,
            onClick: () => {
              if (testGate.isAllowed) {
                setShowTestModal(true);
              }
            },
          },
        ]
      : [];

  return (
    <Fragment>
      {/* LLM Provider View  */}
      <CardModelDetail<LlmProvider>
        /*
         * Fetched again when whether the parameters may be read changes: the
         * permission snapshot can land after the first paint.
         */
        key={canReadAdditionalParams ? "with-parameters" : "without-parameters"}
        name="LLM Provider Details"
        cardProps={{
          title: "LLM Provider Details",
          buttons: testButtons,
        }}
        isEditable={true}
        /*
         * The same form the provider was created with: which provider, then
         * only what it needs (LlmProviderFormFields). A blank API Key keeps
         * the one stored.
         */
        formSteps={getLlmProviderFormSteps()}
        formFields={getProjectLlmProviderFormFields()}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 2,
          modelType: LlmProvider,
          id: "model-detail-llm",
          fields: [
            {
              field: {
                _id: true,
              },
              title: "LLM Provider ID",
              fieldType: FieldType.ObjectID,
            },
            {
              field: {
                name: true,
              },
              title: "Name",
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
                llmType: true,
              },
              title: "Provider",
              fieldType: FieldType.Element,
              getElement: (item: LlmProvider): ReactElement => {
                return <LlmProviderTypeLabel llmType={item.llmType} />;
              },
            },
            {
              field: {
                modelName: true,
              },
              title: "Model Name",
              fieldType: FieldType.Element,
              /*
               * Left blank, the model the server asks for: said by name
               * ("gpt-5.1 (default)", or "First model the server lists")
               * rather than "Not specified".
               */
              getElement: (item: LlmProvider): ReactElement => {
                return (
                  <span>
                    {getLlmProviderShownModelName({
                      modelName: item.modelName,
                      llmType: item.llmType,
                      baseUrl: item.baseUrl,
                      translator: translator,
                    })}
                  </span>
                );
              },
            },
            {
              field: {
                baseUrl: true,
              },
              title: "Base URL",
              fieldType: FieldType.Element,
              // Left blank, the provider's own API, by its address.
              getElement: (item: LlmProvider): ReactElement => {
                return (
                  <span className="break-all">
                    {getLlmProviderShownValue({
                      value: item.baseUrl,
                      defaultValue: getLlmProviderTypeCopy(item.llmType)
                        ?.defaultBaseUrl,
                      translator: translator,
                    })}
                  </span>
                );
              },
            },
            canReadAdditionalParams
              ? {
                  field: {
                    additionalParams: true,
                  },
                  title: "Additional Parameters",
                  fieldType: FieldType.JSON,
                  placeholder: "None",
                }
              : {
                  field: {
                    hasAdditionalParams: true,
                  },
                  title: "Additional Parameters",
                  description:
                    "Only project owners and admins can read them, like the API key.",
                  fieldType: FieldType.Boolean,
                  getElement: (item: LlmProvider): ReactElement => {
                    return (
                      <span>
                        {item.hasAdditionalParams
                          ? translator.translateText("Saved")
                          : translator.translateText("None")}
                      </span>
                    );
                  },
                },
            {
              field: {
                isDefault: true,
              },
              title: "Default",
              fieldType: FieldType.Boolean,
              getElement: (item: LlmProvider): ReactElement => {
                if (item.isDefault) {
                  return <Pill text="Default" color={Green} />;
                }
                return <span className="text-gray-400">-</span>;
              },
            },
          ],
          modelId: modelId,
        }}
      />

      <ModelDelete
        modelType={LlmProvider}
        modelId={modelId}
        onDeleteSuccess={() => {
          Navigation.navigate(
            RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_AI_LLM_PROVIDERS] as Route,
              { modelId },
            ),
          );
        }}
      />

      {showTestModal ? (
        <TestLlmProviderModal
          llmProviderId={modelId.toString()}
          headers={ModelAPI.getCommonHeaders()}
          onClose={() => {
            setShowTestModal(false);
          }}
        />
      ) : null}
    </Fragment>
  );
};

export default LlmProviderView;
