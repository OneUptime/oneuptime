import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import ObjectID from "Common/Types/ObjectID";
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
import SubscriberChoicesCopy, {
  getSubscriberChoiceDescription,
  getSubscriberChoiceSwitchTestId,
  getSubscriberChoiceTitle,
  SUBSCRIBER_CHOICE_COLUMNS,
  SUBSCRIBER_CHOICES_CARD_TEST_ID,
  SubscriberChoiceColumn,
} from "./SubscriberChoicesCopy";
import StatusPageSwitchRow from "./StatusPageSwitchRow";

/*
 * Subscriber Choices, on Subscribers -> Subscriber Settings: whether a
 * visitor who subscribes picks which parts of the page they hear about,
 * and which kinds of event. One switch each, saved the moment it is
 * flipped (StatusPageSwitchRow), with the plan it needs beside it on a
 * plan that cannot turn it on. See SubscriberChoicesCopy for why it is a
 * card of its own.
 */

export interface ComponentProps {
  statusPageId: ObjectID;
}

const SubscriberChoicesCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const ruledListClassName: string = useCardRuledListClassName();
  const translator: Translator = useTranslator();
  const [statusPage, setStatusPage] = useState<StatusPage | null>(null);
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
          allowSubscribersToChooseResources: true,
          allowSubscribersToChooseEventTypes: true,
        },
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
      <div className={ruledListClassName}>
        {SUBSCRIBER_CHOICE_COLUMNS.map(
          (column: SubscriberChoiceColumn): ReactElement => {
            return (
              <div className="px-5 py-4 md:px-6" key={column}>
                <StatusPageSwitchRow
                  statusPageId={props.statusPageId}
                  column={column}
                  // Both columns default to off: only an explicit true is on.
                  initialValue={statusPage[column] === true}
                  title={getSubscriberChoiceTitle(column)}
                  getDescription={(isOn: boolean): string => {
                    return getSubscriberChoiceDescription(column, isOn);
                  }}
                  dataTestId={getSubscriberChoiceSwitchTestId(column)}
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
      title={SubscriberChoicesCopy.cardTitle}
      description={SubscriberChoicesCopy.cardDescription}
    >
      <div data-testid={SUBSCRIBER_CHOICES_CARD_TEST_ID}>{getBody()}</div>
    </Card>
  );
};

export default SubscriberChoicesCard;
