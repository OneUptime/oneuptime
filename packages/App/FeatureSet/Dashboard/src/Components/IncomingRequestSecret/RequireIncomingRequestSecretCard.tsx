import Monitor from "Common/Models/DatabaseModels/Monitor";
import Project from "Common/Models/DatabaseModels/Project";
import OneUptimeDate from "Common/Types/Date";
import { INCOMING_REQUEST_WITHOUT_SECRET_WINDOW_HOURS } from "Common/Types/Monitor/IncomingMonitor/IncomingRequestSecret";
import ObjectID from "Common/Types/ObjectID";
import ModelSwitchCard from "Common/UI/Components/ModelSwitch/ModelSwitchCard";
import { ModelSwitchConfirmation } from "Common/UI/Components/ModelSwitch/ModelSwitchRow";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import IncomingRequestSecretsCopy, {
  CONFIRM_TURN_ON_REFUSED_MONITORS,
  REQUIRE_INCOMING_REQUEST_SECRET_COLUMN,
  REQUIRE_INCOMING_REQUEST_SECRET_SWITCH_TEST_ID,
} from "./IncomingRequestSecretsCopy";
import { getRequestsWithoutSecretQuery } from "./RequestsWithoutSecretTable";

/*
 * "Require a secret on every request", at the top of Monitors -> Settings ->
 * Incoming Request Secrets: one switch that saves the moment it is flipped
 * (Project.requireIncomingRequestSecret).
 *
 * Turning it on asks first. It can be turned off again, but what happens
 * while it is on cannot be taken back: a sender that does not send a secret
 * yet is refused from that moment, its monitor stops hearing from it, and a
 * heartbeat criteria pages someone. Turning it off asks nothing - nothing is
 * refused that was accepted before. The server refuses turning it on while
 * the project has no secret, and the switch says why and moves back.
 *
 * The question names what turning it on refuses (issue #8564): how many
 * Incoming Request monitors are on the list of requests without a secret
 * (RequestsWithoutSecretTable's own query), counted when the card is drawn
 * and each time the secrets' list loads again. With none on it, it says so
 * only when the list has watched for less than its day - a sender that calls
 * less often may not have called yet. A count that cannot be read leaves the
 * question as it always was: it never stops the switch.
 */

export interface ComponentProps {
  projectId: ObjectID;
  /*
   * Since when requests have been checked for a secret (getCheckingSince):
   * null while the project has no secret, undefined until the secrets load.
   */
  checkingSince?: Date | null | undefined;
  /*
   * Changes each time the page's list of secrets loads: the count of
   * monitors that would be refused is read again then.
   */
  secretsLoadCount?: number | undefined;
}

// What the question knows when the switch is turned on.
export interface RequireIncomingRequestSecretTurnOnContext {
  /*
   * How many Incoming Request monitors got a request without a valid secret
   * in the last day; null when that could not be read (or not yet).
   */
  refusedMonitorCount: number | null;
  checkingSince: Date | null | undefined;
  translator: Translator;
  now?: Date | undefined;
}

export const getRequireIncomingRequestSecretConfirmation: (
  isTurningOn: boolean,
  context?: RequireIncomingRequestSecretTurnOnContext | undefined,
) => ModelSwitchConfirmation | undefined = (
  isTurningOn: boolean,
  context?: RequireIncomingRequestSecretTurnOnContext | undefined,
): ModelSwitchConfirmation | undefined => {
  if (!isTurningOn) {
    return undefined;
  }

  const confirmation: ModelSwitchConfirmation = {
    title: IncomingRequestSecretsCopy.confirmTurnOnTitle,
    description: IncomingRequestSecretsCopy.confirmTurnOnDescription,
    submitButtonText: IncomingRequestSecretsCopy.confirmTurnOnButton,
  };

  if (!context || context.refusedMonitorCount === null) {
    return confirmation;
  }

  if (context.refusedMonitorCount > 0) {
    return {
      ...confirmation,
      warning: context.translator.translatePlural(
        CONFIRM_TURN_ON_REFUSED_MONITORS,
        context.refusedMonitorCount,
      ),
    };
  }

  const windowStart: Date = OneUptimeDate.addRemoveHours(
    context.now || OneUptimeDate.getCurrentDate(),
    -INCOMING_REQUEST_WITHOUT_SECRET_WINDOW_HOURS,
  );

  if (
    context.checkingSince &&
    context.checkingSince.getTime() > windowStart.getTime()
  ) {
    return {
      ...confirmation,
      warning: context.translator.translateText(
        IncomingRequestSecretsCopy.confirmTurnOnCheckingLessThanADay,
      ),
    };
  }

  return confirmation;
};

/*
 * How many of the project's Incoming Request monitors are on the list of
 * requests without a secret now, or null when that cannot be read (a reader
 * who may not read monitors, a failed request).
 */
export const countMonitorsRefusedOnceRequired: (
  projectId: ObjectID,
) => Promise<number | null> = async (
  projectId: ObjectID,
): Promise<number | null> => {
  try {
    return await ModelAPI.count<Monitor>({
      modelType: Monitor,
      query: getRequestsWithoutSecretQuery({ projectId }),
    });
  } catch {
    return null;
  }
};

const RequireIncomingRequestSecretCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [refusedMonitorCount, setRefusedMonitorCount] = useState<number | null>(
    null,
  );

  const projectIdString: string = props.projectId.toString();

  useEffect(() => {
    let isCurrent: boolean = true;

    void countMonitorsRefusedOnceRequired(props.projectId).then(
      (count: number | null): void => {
        if (isCurrent) {
          setRefusedMonitorCount(count);
        }
      },
    );

    return () => {
      isCurrent = false;
    };
  }, [projectIdString, props.secretsLoadCount]);

  return (
    <ModelSwitchCard<Project>
      modelType={Project}
      modelId={props.projectId}
      column={REQUIRE_INCOMING_REQUEST_SECRET_COLUMN}
      cardId="require-a-secret"
      cardTitle={IncomingRequestSecretsCopy.requirementCardTitle}
      cardDescription={IncomingRequestSecretsCopy.requirementCardDescription}
      title={IncomingRequestSecretsCopy.switchTitle}
      getDescription={(isOn: boolean): string => {
        return isOn
          ? IncomingRequestSecretsCopy.switchOnDescription
          : IncomingRequestSecretsCopy.switchOffDescription;
      }}
      note={IncomingRequestSecretsCopy.switchNote}
      getConfirmation={(
        isTurningOn: boolean,
      ): ModelSwitchConfirmation | undefined => {
        return getRequireIncomingRequestSecretConfirmation(isTurningOn, {
          refusedMonitorCount,
          checkingSince: props.checkingSince,
          translator,
        });
      }}
      dataTestId={REQUIRE_INCOMING_REQUEST_SECRET_SWITCH_TEST_ID}
    />
  );
};

export default RequireIncomingRequestSecretCard;
