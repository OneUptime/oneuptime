import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import CallAndSmsProviders, {
  CALL_AND_SMS_GATEWAY_URL_TITLE,
  CALL_AND_SMS_PROVIDER_TITLE,
  CallAndSmsProvider,
} from "Common/Types/CallAndSMS/CallAndSmsProvider";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * The first card on Settings > Call and SMS: what carries the server's SMS
 * and calls (Common/Types/CallAndSMS/CallAndSmsProvider). Twilio - the
 * account on the card below, what every installation sent through - or the
 * installation's own gateway: a URL OneUptime posts each SMS and call to,
 * signed with a secret made for the admin when the gateway is first saved
 * (GlobalConfigService). Projects with a Twilio config of their own still
 * send through it, as the card says.
 *
 * Asked first, as the Twilio card asks what its account is used for: then
 * only what that answer needs. The secret waits under More fields, since it
 * is made for the admin; clearing it and saving makes a new one. Send test
 * posts one request to the gateway as saved, to nobody
 * (CallAndSmsGatewayTest).
 */

export const CALL_AND_SMS_GATEWAY_CARD_TEST_ID: string =
  "call-and-sms-gateway-card";

// Where Send test asks the server to try the gateway.
export const CALL_AND_SMS_GATEWAY_TEST_PATH: string =
  "/global-config/call-and-sms-gateway/test";

const advancedSection: FormFieldCollapsibleSection<GlobalConfig> =
  getAdvancedFormSection<GlobalConfig>();

// Whether the form's answer is the installation's own gateway.
const isGatewayChosen: (values: FormValues<GlobalConfig>) => boolean = (
  values: FormValues<GlobalConfig>,
): boolean => {
  return CallAndSmsProviders.isGateway(values.callAndSmsProvider);
};

// Whether a saved config sends through the installation's own gateway.
const sendsThroughGateway: (item: GlobalConfig) => boolean = (
  item: GlobalConfig,
): boolean => {
  return CallAndSmsProviders.isGateway(item.callAndSmsProvider);
};

const CallAndSmsGatewayCard: FunctionComponent = (): ReactElement => {
  const [isTestShown, setIsTestShown] = useState<boolean>(false);
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [testMessage, setTestMessage] = useState<string>("");
  const [testError, setTestError] = useState<string>("");

  const sendTest: () => Promise<void> = async (): Promise<void> => {
    setIsTestShown(true);
    setIsTesting(true);
    setTestMessage("");
    setTestError("");

    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            CALL_AND_SMS_GATEWAY_TEST_PATH,
          ),
          data: {},
        });

      if (response instanceof HTTPErrorResponse || response.isFailure()) {
        setTestError(API.getFriendlyMessage(response));
      } else {
        const data: JSONObject = response.data as JSONObject;
        const message: string = (data["statusMessage"] as string) || "";

        if (data["ok"]) {
          setTestMessage(message);
        } else {
          setTestError(message);
        }
      }
    } catch (err) {
      setTestError(API.getFriendlyMessage(err));
    }

    setIsTesting(false);
  };

  return (
    <div data-testid={CALL_AND_SMS_GATEWAY_CARD_TEST_ID}>
      <CardModelDetail<GlobalConfig>
        name="SMS and Call Provider"
        cardProps={{
          title: "SMS and Call Provider",
          description:
            "What OneUptime sends SMS and calls through: the Twilio account below, or your own gateway. Projects with a Twilio config of their own still send through it.",
          buttons: [
            {
              title: "Send Test",
              buttonStyle: ButtonStyleType.NORMAL,
              icon: IconProp.Play,
              onClick: () => {
                void sendTest();
              },
            },
          ],
        }}
        isEditable={true}
        editButtonText="Edit Provider"
        editModalTitle="Edit Provider"
        formFields={[
          {
            field: {
              callAndSmsProvider: true,
            },
            title: CALL_AND_SMS_PROVIDER_TITLE,
            fieldType: FormFieldSchemaType.RadioButton,
            required: true,
            // Twilio where nothing is stored, as every installation sent through.
            defaultValue: CallAndSmsProvider.Twilio,
            hideColumnDescription: true,
            radioButtonOptions: [
              {
                title: "Twilio",
                description:
                  "SMS and calls go out through the Twilio account below.",
                value: CallAndSmsProvider.Twilio,
              },
              {
                title: "Your own gateway",
                description:
                  "OneUptime posts each SMS and call to a URL you run, which sends it through your own provider. Nothing goes through Twilio.",
                value: CallAndSmsProvider.Gateway,
              },
            ],
          },
          {
            field: {
              callAndSmsGatewayUrl: true,
            },
            title: CALL_AND_SMS_GATEWAY_URL_TITLE,
            fieldType: FormFieldSchemaType.URL,
            required: true,
            placeholder: "https://sms-gateway.example.com/oneuptime",
            description:
              "OneUptime posts each SMS and call here as a signed JSON request. It can be on your private network.",
            showIf: isGatewayChosen,
          },
          {
            field: {
              callAndSmsGatewaySecret: true,
            },
            title: "Signing Secret",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            collapsibleSection: advancedSection,
            description:
              "Made for you when you save. Your gateway checks the X-OneUptime-Signature header of every request with it. Clear it and save to make a new one.",
            showIf: isGatewayChosen,
          },
        ]}
        modelDetailProps={{
          modelType: GlobalConfig,
          id: "model-detail-call-and-sms-gateway",
          fields: [
            {
              field: {
                callAndSmsProvider: true,
              },
              title: CALL_AND_SMS_PROVIDER_TITLE,
              fieldType: FieldType.Element,
              getElement: (item: GlobalConfig): ReactElement => {
                return (
                  <span>
                    {sendsThroughGateway(item) ? "Your own gateway" : "Twilio"}
                  </span>
                );
              },
            },
            {
              field: {
                callAndSmsGatewayUrl: true,
              },
              title: CALL_AND_SMS_GATEWAY_URL_TITLE,
              placeholder: "None",
              showIf: sendsThroughGateway,
            },
            {
              field: {
                callAndSmsGatewaySecret: true,
              },
              title: "Signing Secret",
              fieldType: FieldType.HiddenText,
              description:
                "Your gateway checks the X-OneUptime-Signature header of every request with this secret.",
              placeholder: "None",
              showIf: sendsThroughGateway,
            },
          ],
          modelId: ObjectID.getZeroObjectID(),
        }}
      />

      {isTestShown ? (
        <ConfirmModal
          title="Send test: SMS and call gateway"
          error={testError}
          description={
            isTesting
              ? "Sending a test request…"
              : testMessage ||
                (testError ? "" : "Sending a test request to your gateway.")
          }
          submitButtonText={"Close"}
          isLoading={isTesting}
          onSubmit={() => {
            setIsTestShown(false);
            setTestMessage("");
            setTestError("");
          }}
        />
      ) : (
        <></>
      )}
    </div>
  );
};

export default CallAndSmsGatewayCard;
