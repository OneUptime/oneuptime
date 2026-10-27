import Card from "Common/UI/Components/Card/Card";
import { PUSH_NOTIFICATIONS_TURNED_OFF_MESSAGE } from "Common/Types/PushNotification/PushNotificationsTurnedOff";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The Push Notifications tab while the server has push turned off
 * (PushNotificationsTurnedOff): what it says in place of the devices, since
 * none can be registered and nothing is pushed to the ones there are. Only
 * a server admin can turn push back on, so it names them, and the person is
 * pointed at the methods that still reach them.
 */

export const PUSH_NOTIFICATIONS_TURNED_OFF_CARD_TEST_ID: string =
  "push-notifications-turned-off-card";

const PushNotificationsTurnedOff: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div data-testid={PUSH_NOTIFICATIONS_TURNED_OFF_CARD_TEST_ID}>
      <Card
        title="Push Notifications"
        description={translator.translateText(
          PUSH_NOTIFICATIONS_TURNED_OFF_MESSAGE,
        )}
      >
        <p className="text-sm text-gray-500">
          {translator.translateText(
            "On-call pages and notifications reach you through your other notification methods, and through any custom channels your administrator set up.",
          )}
        </p>
      </Card>
    </div>
  );
};

export default PushNotificationsTurnedOff;
