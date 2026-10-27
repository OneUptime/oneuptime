import Card from "Common/UI/Components/Card/Card";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The Push Notifications tab while the server has push turned off
 * (Common/Types/PushNotification/PushNotificationsTurnedOff): what it says
 * in place of the devices, since none can be registered and nothing is
 * pushed to the ones there are. Only a server admin can turn push back on,
 * so it names them, and the person is pointed at the methods that still
 * reach them.
 */

export const PUSH_NOTIFICATIONS_TURNED_OFF_CARD_TEST_ID: string =
  "push-notifications-turned-off-card";

/*
 * Worded as the server words it everywhere else
 * (PUSH_NOTIFICATIONS_TURNED_OFF_MESSAGE), as a key of its own so it is
 * translated with the Dashboard.
 */
export const PUSH_NOTIFICATIONS_TURNED_OFF_NOTICE: string = translationKey(
  "Push notifications are turned off on this server. Your administrator can turn them on in the Admin Dashboard, under Settings > Push Notifications.",
);

export const PUSH_NOTIFICATIONS_TURNED_OFF_HINT: string = translationKey(
  "On-call pages and notifications reach you through your other notification methods, and through any custom channels your administrator set up.",
);

const PushNotificationsTurnedOff: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div data-testid={PUSH_NOTIFICATIONS_TURNED_OFF_CARD_TEST_ID}>
      <Card
        title="Push Notifications"
        description={
          translator.translateText(PUSH_NOTIFICATIONS_TURNED_OFF_NOTICE) ||
          PUSH_NOTIFICATIONS_TURNED_OFF_NOTICE
        }
      >
        <p className="text-sm text-gray-500">
          {translator.translateText(PUSH_NOTIFICATIONS_TURNED_OFF_HINT) ||
            PUSH_NOTIFICATIONS_TURNED_OFF_HINT}
        </p>
      </Card>
    </div>
  );
};

export default PushNotificationsTurnedOff;
