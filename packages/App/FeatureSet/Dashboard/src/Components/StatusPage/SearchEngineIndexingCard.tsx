import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
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
import StatusPageBrandingCopy, {
  SEARCH_ENGINE_INDEXING_SWITCH_TEST_ID,
} from "./StatusPageBrandingCopy";
import StatusPageSwitchRow from "./StatusPageSwitchRow";
import { useCardRuledBodyClassName } from "Common/UI/Components/Card/CardSurface";

/*
 * Search Engine Indexing, on a status page's Branding page: one switch,
 * "Allow Search Engines to Index this Status Page", that saves the moment it
 * is flipped (StatusPageSwitchRow). It used to be a card with an Edit button
 * whose dialog held that one switch: Edit, flip, Save, for a single yes or
 * no.
 *
 * Off, the status page is still open to anyone with its link; OneUptime
 * serves it with a noindex, nofollow robots directive (the meta tag and the
 * X-Robots-Tag header), so search engines leave it out of their results.
 */

export interface ComponentProps {
  statusPageId: ObjectID;
  /*
   * Told whether the switch is on: once the status page is read, whenever
   * the switch moves, and again if a change is refused and it moves back.
   */
  onChange?: ((isOn: boolean) => void) | undefined;
}

export const SEARCH_ENGINE_INDEXING_CARD_TEST_ID: string =
  "status-page-search-engine-indexing";

const SearchEngineIndexingCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const ruledBodyClassName: string = useCardRuledBodyClassName();
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
          enableSearchEngineIndexing: true,
        },
      });

      if (item) {
        // The column defaults to on and is not nullable: only false is off.
        const value: boolean = item.enableSearchEngineIndexing !== false;

        setIsOn(value);
        props.onChange?.(value);
      } else {
        setError(
          translator.translateText(StatusPageBrandingCopy.notFound) ||
            StatusPageBrandingCopy.notFound,
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
      /*
       * A full-bleed row, ruled like the card's own header rule, as on the
       * Channels card and the "What your status page shows" card.
       */
      <div className={ruledBodyClassName}>
        <div className="px-5 py-4 md:px-6">
          <StatusPageSwitchRow
            statusPageId={props.statusPageId}
            column="enableSearchEngineIndexing"
            initialValue={isOn}
            title={StatusPageBrandingCopy.searchEngineIndexingSwitchTitle}
            getDescription={(): string => {
              return StatusPageBrandingCopy.searchEngineIndexingSwitchDescription;
            }}
            onChange={(value: boolean): void => {
              props.onChange?.(value);
            }}
            dataTestId={SEARCH_ENGINE_INDEXING_SWITCH_TEST_ID}
          />
        </div>
      </div>
    );
  };

  return (
    <Card
      title={StatusPageBrandingCopy.searchEngineIndexingTitle}
      description={StatusPageBrandingCopy.searchEngineIndexingDescription}
    >
      <div data-testid={SEARCH_ENGINE_INDEXING_CARD_TEST_ID}>{getBody()}</div>
    </Card>
  );
};

export default SearchEngineIndexingCard;
