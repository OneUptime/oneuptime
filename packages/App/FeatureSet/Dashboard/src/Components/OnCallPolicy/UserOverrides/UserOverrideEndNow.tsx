import { formatHandOffInstant } from "../OnCallScheduleLayer/LayerSummary";
import OnCallDutyPolicyUserOverride from "Common/Models/DatabaseModels/OnCallDutyPolicyUserOverride";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import UserOverrideEdit, {
  getUserOverrideEndNowRoute,
} from "Common/Types/OnCallDutyPolicy/UserOverrideEdit";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Toast from "Common/UI/Utils/Toast";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * END NOW (issue #7899): an override under way, ended at once.
 *
 * Coming back early is likely the most common change to an override, and it
 * took the Edit dialog, the date and time picker and today's date and the
 * current minute picked by hand. Now an override in force has End Now - on
 * each row of the User Overrides lists, on a schedule's user overrides card,
 * and under Ends in its Edit dialog - and one short question first, which
 * says what happens to the time left and who is paged from then on:
 *
 *   End the override for Alex Chen now?
 *   Sam Rivera stops covering for Alex Chen now instead of Fri, Nov 20,
 *   17:00. From then on, alerts page Alex Chen again.
 *
 * The server ends it at its own now (POST .../:id/end-now,
 * UserOverrideEdit.getEndNow), so a browser whose clock is a minute out
 * still ends it, as an edit of its end by the reader: the same permission
 * and refusals, and the policy's feed says it changed. It is offered only
 * where it has something to end: not on an override that has not started,
 * which is called off by deleting it, nor on one that has ended.
 */

export const USER_OVERRIDE_END_NOW_ACTION: string = translationKey("End Now");

export const USER_OVERRIDE_END_NOW_TITLE: string = translationKey(
  "End the override for {{name}} now?",
);

export const USER_OVERRIDE_END_NOW_COVERED: string = translationKey(
  "{{cover}} stops covering for {{away}} now instead of {{until}}. From then on, alerts page {{away}} again.",
);

export const USER_OVERRIDE_END_NOW_SKIPPED: string = translationKey(
  "{{away}} stops being skipped now instead of {{until}}. From then on, they take their turns in the rotation again.",
);

export const USER_OVERRIDE_END_NOW_ARIA_LABEL: string = translationKey(
  "End the override for {{name}} now",
);

export const USER_OVERRIDE_ENDED_TOAST: string = translationKey(
  "The override for {{name}} has ended.",
);

// An override End Now is asked about: who is away, who covers, until when.
export interface UserOverrideEndNowTarget {
  id: string;
  startsAt: Date;
  endsAt: Date;
  awayName: string;
  // Nobody: a skip, the rotation covering.
  coverName: string | null;
}

// Whether End Now has something to end: the override is under way.
export const canEndUserOverrideNow: (
  times: { startsAt: Date; endsAt: Date } | null,
  now?: Date | undefined,
) => boolean = (
  times: { startsAt: Date; endsAt: Date } | null,
  now?: Date | undefined,
): boolean => {
  return Boolean(
    times &&
      UserOverrideEdit.getEndNow(times, now || OneUptimeDate.getCurrentDate()),
  );
};

// An override as a list read it, for End Now to ask about.
export const toUserOverrideEndNowTarget: (
  override: OnCallDutyPolicyUserOverride,
) => UserOverrideEndNowTarget | null = (
  override: OnCallDutyPolicyUserOverride,
): UserOverrideEndNowTarget | null => {
  const id: string = override._id?.toString() || "";

  if (!id || !override.startsAt || !override.endsAt) {
    return null;
  }

  const nameOf: (
    user: { name?: unknown; email?: unknown } | undefined,
  ) => string = (
    user: { name?: unknown; email?: unknown } | undefined,
  ): string => {
    return user?.name?.toString() || user?.email?.toString() || "";
  };

  return {
    id: id,
    startsAt: OneUptimeDate.fromString(override.startsAt),
    endsAt: OneUptimeDate.fromString(override.endsAt),
    awayName: nameOf(override.overrideUser),
    coverName: override.routeAlertsToUserId
      ? nameOf(override.routeAlertsToUser) || null
      : null,
  };
};

/*
 * The question End Now asks, in the reader's language: its title names the
 * person away, and its sentence what happens to the time left - until
 * `until`, written as the list beside it writes times - and who is paged
 * from then on.
 */
export const getUserOverrideEndNowQuestion: (data: {
  translator: Translator;
  target: UserOverrideEndNowTarget;
  // The zone the list beside it writes its times in; the reader's when left out.
  timezone?: string | undefined;
}) => { title: string; description: string } = (data: {
  translator: Translator;
  target: UserOverrideEndNowTarget;
  timezone?: string | undefined;
}): { title: string; description: string } => {
  const until: string = formatHandOffInstant(
    data.target.endsAt,
    data.timezone,
    OneUptimeDate.getCurrentDate(),
  );

  return {
    title: data.translator.translateTemplate(USER_OVERRIDE_END_NOW_TITLE, {
      name: data.target.awayName,
    }),
    description: data.target.coverName
      ? data.translator.translateTemplate(USER_OVERRIDE_END_NOW_COVERED, {
          cover: data.target.coverName,
          away: data.target.awayName,
          until: until,
        })
      : data.translator.translateTemplate(USER_OVERRIDE_END_NOW_SKIPPED, {
          away: data.target.awayName,
          until: until,
        }),
  };
};

export const getUserOverrideEndNowUrl: (overrideId: string) => URL = (
  overrideId: string,
): URL => {
  return URL.fromString(APP_API_URL.toString()).addRoute(
    `${new OnCallDutyPolicyUserOverride().getCrudApiPath()!.toString()}${getUserOverrideEndNowRoute(
      overrideId,
    )}`,
  );
};

// Ends the override now; throws what the server answered when it refused.
export const endUserOverrideNow: (overrideId: string) => Promise<void> = async (
  overrideId: string,
): Promise<void> => {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse = await API.post(
    {
      url: getUserOverrideEndNowUrl(overrideId),
      data: {},
      headers: ModelAPI.getCommonHeaders(),
    },
  );

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }
};

// Says, in a toast, that the override has ended.
export const sayUserOverrideEnded: (data: {
  translator: Translator;
  target: UserOverrideEndNowTarget;
}) => void = (data: {
  translator: Translator;
  target: UserOverrideEndNowTarget;
}): void => {
  Toast.success(
    data.translator.translateTemplate(USER_OVERRIDE_ENDED_TOAST, {
      name: data.target.awayName,
    }),
  );
};

export interface ComponentProps {
  target: UserOverrideEndNowTarget;
  timezone?: string | undefined;
  onClose: () => void;
  // Ended: the list reads its overrides again.
  onEnded: () => void;
}

/*
 * The question, as a dialog of its own: for the schedule's user overrides
 * card and the Edit dialog. A list's rows ask it through their action's
 * confirmation instead (getUserOverrideEndNowQuestion).
 */
const UserOverrideEndNowModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isEnding, setIsEnding] = useState<boolean>(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const question: { title: string; description: string } =
    getUserOverrideEndNowQuestion({
      translator: translator,
      target: props.target,
      timezone: props.timezone,
    });

  return (
    <ConfirmModal
      title={question.title}
      isTitleTranslated={true}
      description={question.description}
      submitButtonText={USER_OVERRIDE_END_NOW_ACTION}
      submitButtonType={ButtonStyleType.DANGER}
      isLoading={isEnding}
      error={error}
      onClose={props.onClose}
      onSubmit={() => {
        setIsEnding(true);
        setError(undefined);

        endUserOverrideNow(props.target.id)
          .then(() => {
            setIsEnding(false);
            sayUserOverrideEnded({
              translator: translator,
              target: props.target,
            });
            props.onEnded();
          })
          .catch((err: unknown) => {
            setIsEnding(false);
            setError(API.getFriendlyMessage(err));
          });
      }}
    />
  );
};

export default UserOverrideEndNowModal;
