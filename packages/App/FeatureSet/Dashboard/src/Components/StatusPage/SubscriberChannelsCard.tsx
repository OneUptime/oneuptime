import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import ObjectID from "Common/Types/ObjectID";
import Select from "Common/Types/BaseDatabase/Select";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { BILLING_ENABLED } from "Common/UI/Config";
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
import SubscriberChannelsCopy, {
  getSubscriberChannelNote,
  SUBSCRIBER_CHANNELS,
  SubscriberChannelDefinition,
  SUBSCRIPTION_SWITCH_COLUMNS,
} from "./SubscriberChannelsCopy";
import StatusPageSwitchRow, {
  getSubscriptionSwitchTestId,
} from "./StatusPageSwitchRow";

/*
 * The Channels card on Subscribers -> Subscriber Settings: the one place a
 * status page's Subscribe page and its five channels are switched on and
 * off. One row per switch - its name, one line on what it means, and the
 * switch, which saves at once (StatusPageSwitchRow).
 *
 * Show Subscriber Page comes first: without it there is no Subscribe link
 * on the status page, whatever the channels say. The channels follow in the
 * side menu's order.
 */

export interface ComponentProps {
  statusPageId: ObjectID;
}

export const SUBSCRIBER_CHANNELS_CARD_TEST_ID: string =
  "status-page-subscriber-channels";

const SubscriberChannelsCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [statusPage, setStatusPage] = useState<StatusPage | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const select: Select<StatusPage> = {};

  for (const column of SUBSCRIPTION_SWITCH_COLUMNS) {
    select[column] = true;
  }

  const fetchStatusPage: () => Promise<void> = async (): Promise<void> => {
    setIsLoading(true);
    setError("");

    try {
      const item: StatusPage | null = await ModelAPI.getItem<StatusPage>({
        modelType: StatusPage,
        id: props.statusPageId,
        select: select,
      });

      if (item) {
        setStatusPage(item);
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

    if (error || !statusPage) {
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
      /*
       * Full-bleed rows, ruled like the card's own header rule: the body
       * reaches the card's edges and each row brings its own padding back.
       */
      <div className="-mx-5 -mb-6 divide-y divide-gray-200 border-t border-gray-200 md:-mx-6">
        <div className="px-5 py-4 md:px-6">
          <StatusPageSwitchRow
            statusPageId={props.statusPageId}
            column="showSubscriberPageOnStatusPage"
            /*
             * The column defaults to on (and is not nullable), so only an
             * explicit false is off.
             */
            initialValue={statusPage.showSubscriberPageOnStatusPage !== false}
            title={SubscriberChannelsCopy.subscribePageTitle}
            getDescription={(): string => {
              return SubscriberChannelsCopy.subscribePageDescription;
            }}
            dataTestId={getSubscriptionSwitchTestId(
              "showSubscriberPageOnStatusPage",
            )}
          />
        </div>
        {SUBSCRIBER_CHANNELS.map(
          (channel: SubscriberChannelDefinition): ReactElement => {
            return (
              <div className="px-5 py-4 md:px-6" key={channel.column}>
                <StatusPageSwitchRow
                  statusPageId={props.statusPageId}
                  column={channel.column}
                  initialValue={Boolean(statusPage[channel.column])}
                  title={channel.title}
                  getDescription={(): string => {
                    return channel.description;
                  }}
                  note={getSubscriberChannelNote(channel.method, {
                    isBillingEnabled: BILLING_ENABLED,
                  })}
                  dataTestId={getSubscriptionSwitchTestId(channel.column)}
                />
              </div>
            );
          },
        )}
      </div>
    );
  };

  return (
    <Card
      title={SubscriberChannelsCopy.cardTitle}
      description={SubscriberChannelsCopy.cardDescription}
    >
      <div data-testid={SUBSCRIBER_CHANNELS_CARD_TEST_ID}>{getBody()}</div>
    </Card>
  );
};

export default SubscriberChannelsCard;
