import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import ObjectID from "Common/Types/ObjectID";
import { isServerAlertPushOnByDefault } from "Common/Types/ServerSending/ServerAlerts";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import { BILLING_ENABLED } from "Common/UI/Config";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * WHERE MASTER ADMINS ARE TOLD WHEN THE SERVER'S EMAIL OR GLOBAL PROBES STOP
 * (#6879, Types/ServerSending/ServerAlerts).
 *
 * The banner says "Email is failing" to whoever opens the product; this is
 * for when nobody does. A worker job tells master admins when the server's
 * email stops working, or every global probe stops reporting, and once
 * more when it works again - by a push to their own devices, by an SMS to
 * the number given here and, for the probes, by the Admin Notification
 * Email above. Never through the channel that stopped, never to a project
 * member, at most once an hour. Push is on until turned off on a
 * self-hosted server; OneUptime Cloud sends nothing until its operator
 * chooses.
 */

export const SERVER_ALERTS_CARD_TEST_ID: string = "server-alerts";

export const SERVER_ALERTS_COPY: {
  title: string;
  description: string;
  editButton: string;
  phoneTitle: string;
  phoneDescription: string;
  pushTitle: string;
  pushDescription: string;
  on: string;
  off: string;
  none: string;
} = {
  title: translationKey("Outage Notifications"),
  description: translationKey(
    "When this server's email stops working, or every global probe stops reporting, master admins are told, and once more when it works again: never through the channel that stopped, and at most once an hour. The Admin Notification Email is told about the probes too.",
  ),
  editButton: translationKey("Edit Outage Notifications"),
  phoneTitle: translationKey("Text This Number"),
  phoneDescription: translationKey(
    "An SMS goes to this number through this server's own SMS settings. Leave it empty to send none.",
  ),
  pushTitle: translationKey("Push to Master Admins' Devices"),
  pushDescription: translationKey(
    "A push notification goes to every device a master admin signed in to the OneUptime app on.",
  ),
  on: translationKey("On"),
  off: translationKey("Off"),
  none: translationKey("None"),
};

// Whether push is on, as the job reads it: nobody chose means the default.
export const isServerAlertPushOn: (value: unknown) => boolean = (
  value: unknown,
): boolean => {
  return typeof value === "boolean"
    ? value
    : isServerAlertPushOnByDefault(BILLING_ENABLED);
};

const ServerAlertsCard: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div data-testid={SERVER_ALERTS_CARD_TEST_ID}>
      <CardModelDetail<GlobalConfig>
        name="Outage Notifications"
        cardProps={{
          title: SERVER_ALERTS_COPY.title,
          description: SERVER_ALERTS_COPY.description,
        }}
        isEditable={true}
        editButtonText={SERVER_ALERTS_COPY.editButton}
        editModalTitle={SERVER_ALERTS_COPY.editButton}
        formFields={[
          {
            field: {
              serverAlertPhoneNumber: true,
            },
            title: SERVER_ALERTS_COPY.phoneTitle,
            description: SERVER_ALERTS_COPY.phoneDescription,
            fieldType: FormFieldSchemaType.Phone,
            required: false,
          },
          {
            field: {
              isServerAlertPushOn: true,
            },
            title: SERVER_ALERTS_COPY.pushTitle,
            description: SERVER_ALERTS_COPY.pushDescription,
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            defaultValue: isServerAlertPushOnByDefault(BILLING_ENABLED),
            startsOnDefaultWhenEmpty: true,
          },
        ]}
        modelDetailProps={{
          modelType: GlobalConfig,
          id: "model-detail-server-alerts",
          fields: [
            {
              field: {
                serverAlertPhoneNumber: true,
              },
              title: SERVER_ALERTS_COPY.phoneTitle,
              fieldType: FieldType.Phone,
              placeholder: SERVER_ALERTS_COPY.none,
            },
            {
              field: {
                isServerAlertPushOn: true,
              },
              title: SERVER_ALERTS_COPY.pushTitle,
              fieldType: FieldType.Element,
              getElement: (item: GlobalConfig): ReactElement => {
                return (
                  <span className="text-sm text-gray-900">
                    {translator.translateText(
                      isServerAlertPushOn(item.isServerAlertPushOn)
                        ? SERVER_ALERTS_COPY.on
                        : SERVER_ALERTS_COPY.off,
                    )}
                  </span>
                );
              },
            },
          ],
          modelId: ObjectID.getZeroObjectID(),
        }}
      />
    </div>
  );
};

export default ServerAlertsCard;
