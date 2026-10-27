import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import OnCallDutyPolicyStatus from "Common/Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import { OnCallPolicyAiHoldOutcome } from "Common/Types/OnCallDutyPolicy/OnCallPolicyAiHold";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import OnCallDutyPolicyExecutionLog from "Common/Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useState,
} from "react";

/*
 * WHILE ONEUPTIME AI HOLDS THE PAGE (OnCallPolicyAiHold): the AI Investigation
 * card says AI is on it and when paging starts unless AI resolves the record,
 * and offers Page now to anyone who wants a person on it at once. Nothing
 * shows when nothing is held. Read again every few seconds while a page is
 * held, so the notice goes once AI resolves the record or hands it off.
 */

export const AI_HOLD_NOTICE_TEST_ID: string = "ai-hold-notice";

export const AI_HOLD_NOTICE_TITLE: string = translationKey(
  "OneUptime AI is on it",
);

export const AI_HOLD_NOTICE_TEXT: Record<"incident" | "alert", string> = {
  incident: translationKey(
    "On-call paging starts at {{time}} unless OneUptime AI resolves this incident first.",
  ),
  alert: translationKey(
    "On-call paging starts at {{time}} unless OneUptime AI resolves this alert first.",
  ),
};

export const PAGE_NOW_TITLE: string = translationKey("Page now");

// How often the notice reads the hold again while one is held.
export const AI_HOLD_NOTICE_REFRESH_MS: number = 15000;

export interface ComponentProps {
  subjectType: "incident" | "alert";
  subjectId: ObjectID;
}

const AiHoldNotice: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [pagingStartsAt, setPagingStartsAt] = useState<Date | null>(null);
  const [isPaging, setIsPaging] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const readHold: () => Promise<void> = useCallback(async (): Promise<void> => {
    try {
      const result: ListResult<OnCallDutyPolicyExecutionLog> =
        await ModelAPI.getList<OnCallDutyPolicyExecutionLog>({
          modelType: OnCallDutyPolicyExecutionLog,
          query: {
            ...(props.subjectType === "incident"
              ? { triggeredByIncidentId: props.subjectId }
              : { triggeredByAlertId: props.subjectId }),
            status: OnCallDutyPolicyStatus.Waiting,
            aiHoldOutcome: OnCallPolicyAiHoldOutcome.Holding,
          },
          select: { _id: true, pagingStartsAt: true },
          sort: { pagingStartsAt: SortOrder.Ascending },
          limit: 1,
          skip: 0,
        });

      const first: OnCallDutyPolicyExecutionLog | undefined = result.data[0];

      setPagingStartsAt(
        first?.pagingStartsAt
          ? OneUptimeDate.fromString(first.pagingStartsAt)
          : null,
      );
    } catch {
      // A reader who may not read on-call runs sees no notice.
      setPagingStartsAt(null);
    }
  }, [props.subjectType, props.subjectId.toString()]);

  useEffect(() => {
    void readHold();
  }, [readHold]);

  useEffect(() => {
    if (!pagingStartsAt) {
      return;
    }

    const interval: ReturnType<typeof setInterval> = setInterval(() => {
      void readHold();
    }, AI_HOLD_NOTICE_REFRESH_MS);

    return () => {
      clearInterval(interval);
    };
  }, [pagingStartsAt?.getTime(), readHold]);

  const pageNow: () => Promise<void> = async (): Promise<void> => {
    setIsPaging(true);
    setError(null);

    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post<JSONObject>({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            "/ai-first-responder/page-now",
          ),
          data:
            props.subjectType === "incident"
              ? { incidentId: props.subjectId.toString() }
              : { alertId: props.subjectId.toString() },
          headers: ModelAPI.getCommonHeaders(),
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      await readHold();
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsPaging(false);
    }
  };

  if (!pagingStartsAt) {
    return <></>;
  }

  return (
    <div
      className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-indigo-100 bg-indigo-50 px-4 py-3"
      data-testid={AI_HOLD_NOTICE_TEST_ID}
      aria-live="polite"
    >
      <div className="flex min-w-0 items-start gap-2">
        <Icon
          icon={IconProp.Bolt}
          className="mt-0.5 h-4 w-4 flex-shrink-0 text-indigo-500"
        />
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-900">
            {translator.translateText(AI_HOLD_NOTICE_TITLE)}
          </p>
          <p className="text-sm text-gray-700">
            {translator.translateTemplate(
              AI_HOLD_NOTICE_TEXT[props.subjectType],
              {
                time: OneUptimeDate.getLocalTimeString(pagingStartsAt, {
                  use12HourFormat: OneUptimeDate.getUserPrefers12HourFormat(),
                }),
              },
            )}
          </p>
          {error ? (
            <p className="mt-1 text-sm text-red-600" role="alert">
              {error}
            </p>
          ) : (
            <></>
          )}
        </div>
      </div>
      <Button
        title={PAGE_NOW_TITLE}
        buttonStyle={ButtonStyleType.NORMAL}
        buttonSize={ButtonSize.Small}
        icon={IconProp.Call}
        isLoading={isPaging}
        disabled={isPaging}
        dataTestId="ai-hold-page-now"
        onClick={() => {
          void pageNow();
        }}
      />
    </div>
  );
};

export default AiHoldNotice;
