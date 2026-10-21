import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import ObjectID from "Common/Types/ObjectID";
import {
  isSendingSubscriberNotifications,
  SUBSCRIBER_NOTIFICATIONS_COLUMN,
} from "Common/Types/StatusPage/SubscriberNotificationsSwitch";
import Card from "Common/UI/Components/Card/Card";
import { useCardRuledListClassName } from "Common/UI/Components/Card/CardSurface";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import SubscriberNotificationsCopy, {
  getSubscriberNotificationsDescription,
  SUBSCRIBER_NOTIFICATIONS_CARD_TEST_ID,
  SUBSCRIBER_NOTIFICATIONS_SWITCH_TEST_ID,
} from "./SubscriberNotificationsCopy";
import StatusPageSwitchRow from "./StatusPageSwitchRow";

/*
 * The Notifications card on Subscribers -> Subscriber Settings: Send
 * Notifications to Subscribers, one switch that saves the moment it is
 * flipped (StatusPageSwitchRow). Off, the status page sends its subscribers
 * nothing at all; on, they are told as their subscriptions say. The Channels
 * card below it decides only how visitors sign up.
 */

export interface ComponentProps {
  statusPageId: ObjectID;
  // Told after the switch is saved, with whether it is now on.
  onSaved?: ((isOn: boolean) => void) | undefined;
}

const SubscriberNotificationsCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const ruledListClassName: string = useCardRuledListClassName();
  const translator: Translator = useTranslator();
  const [isOn, setIsOn] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchStatusPage: () => Promise<void> = async (): Promise<void> => {
    setIsLoading(true);
    setError("");

    try {
      const item: StatusPage | null = await ModelAPI.getItem<StatusPage>({
        modelType: StatusPage,
        id: props.statusPageId,
        select: {
          [SUBSCRIBER_NOTIFICATIONS_COLUMN]: true,
        },
      });

      if (item) {
        setIsOn(isSendingSubscriberNotifications(item));
      } else {
        setError(
          translator.translateText("Status page not found.") ||
            "Status page not found.",
        );
      }
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    void fetchStatusPage();
  }, [props.statusPageId.toString()]);

  const getBody: () => ReactElement = (): ReactElement => {
    if (isLoading) {
      return <ComponentLoader />;
    }

    if (error || isOn === null) {
      return (
        <ErrorMessage
          message={error}
          onRefreshClick={() => {
            void fetchStatusPage();
          }}
        />
      );
    }

    return (
      <div className={ruledListClassName}>
        <div className="px-5 py-4 md:px-6">
          <StatusPageSwitchRow
            statusPageId={props.statusPageId}
            column={SUBSCRIBER_NOTIFICATIONS_COLUMN}
            initialValue={isOn}
            title={SubscriberNotificationsCopy.switchTitle}
            getDescription={getSubscriberNotificationsDescription}
            onSaved={props.onSaved}
            dataTestId={SUBSCRIBER_NOTIFICATIONS_SWITCH_TEST_ID}
          />
        </div>
      </div>
    );
  };

  return (
    <Card
      title={SubscriberNotificationsCopy.cardTitle}
      description={SubscriberNotificationsCopy.cardDescription}
    >
      <div data-testid={SUBSCRIBER_NOTIFICATIONS_CARD_TEST_ID}>{getBody()}</div>
    </Card>
  );
};

export default SubscriberNotificationsCard;
