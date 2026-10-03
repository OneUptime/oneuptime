import RumApplication from "Common/Models/DatabaseModels/RumApplication";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import { getEffectiveSessionReplayRetentionDays } from "./SessionReplayRetention";

export interface ComponentProps {
  rumApplicationId: ObjectID;
}

// The card's body, where the one line is.
export const SESSION_REPLAY_RETENTION_CARD_ID: string =
  "rum-application-session-replay-retention";

/**
 * How long this application's session replays are kept, on its Settings
 * page, read-only.
 *
 * Replay retention is edited in one place: the application's Replay Policy
 * page (Edit Policy > Limits), next to the masking, consent and sampling it
 * belongs with. This card used to be a second editor for the same column,
 * kept so every retention control on the Settings page could be found
 * together. Two editors for one setting meant two places to look and two
 * descriptions to keep in step, so the Settings page keeps the finding and
 * loses the editing: it says how long recordings are kept and its one
 * button opens the Replay Policy page.
 */
const SessionReplayRetentionSettingsCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [retentionInDays, setRetentionInDays] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  /*
   * The page builds a new ObjectID on every render, so the read follows the
   * id's value, not its identity.
   */
  const modelIdString: string = props.rumApplicationId.toString();

  useEffect(() => {
    let isCancelled: boolean = false;

    setIsLoading(true);
    setError("");

    ModelAPI.getItem<RumApplication>({
      modelType: RumApplication,
      id: new ObjectID(modelIdString),
      select: {
        sessionReplayRetentionInDays: true,
      },
    })
      .then((item: RumApplication | null): void => {
        if (isCancelled) {
          return;
        }

        if (!item) {
          setError(translator.translateText("RUM application not found."));
        } else {
          setRetentionInDays(
            getEffectiveSessionReplayRetentionDays(
              item.sessionReplayRetentionInDays,
            ),
          );
        }

        setIsLoading(false);
      })
      .catch((err: unknown): void => {
        if (isCancelled) {
          return;
        }

        setError(API.getFriendlyMessage(err));
        setIsLoading(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [modelIdString]);

  const replayPolicyRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_SETTINGS] as Route,
    { modelId: new ObjectID(modelIdString) },
  );

  let body: ReactElement;

  if (isLoading) {
    body = <ComponentLoader />;
  } else if (error || retentionInDays === null) {
    body = <ErrorMessage message={error} />;
  } else {
    body = (
      <p
        className="text-sm text-gray-900"
        data-testid="session-replay-retention-line"
      >
        {translator.translatePlural(
          {
            one: "Session replays are kept for {{count}} day.",
            other: "Session replays are kept for {{count}} days.",
          },
          retentionInDays,
        )}
      </p>
    );
  }

  return (
    <Card
      title="Session Replay Retention"
      buttons={[
        {
          title: "Edit on Replay Policy",
          icon: IconProp.Edit,
          buttonStyle: ButtonStyleType.NORMAL,
          onClick: (): void => {
            Navigation.navigate(replayPolicyRoute);
          },
        },
      ]}
    >
      <div
        id={SESSION_REPLAY_RETENTION_CARD_ID}
        data-testid="session-replay-retention"
      >
        {body}
      </div>
    </Card>
  );
};

export default SessionReplayRetentionSettingsCard;
