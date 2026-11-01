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
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import OnCallDutyPolicyExecutionLog from "Common/Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import { shouldAttemptRead } from "../../Utils/OverviewSection";
import InvestigationNotice, {
  NOTICE_ICON_CLASS_NAME,
} from "./InvestigationNotice";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * WHILE ONEUPTIME AI HOLDS THE PAGE (OnCallPolicyAiHold): the AI Investigation
 * card says AI is on it and when paging starts unless AI resolves the record,
 * and offers Page now to anyone who wants a person on it at once. Nothing
 * shows when nothing is held. Read again every few seconds while a page is
 * held, so the notice goes once AI resolves the record or hands it off.
 *
 * Read only for a reader who may read on-call runs. One who certainly may
 * not (the permission snapshot says so) is spared the read, as the page's
 * other cards spare theirs (shouldAttemptRead): the server would refuse it
 * on every incident and alert they open, and they see no notice either way.
 *
 * Drawn the way the card says everything that is not the report
 * (InvestigationNotice): a mark, a sentence and a quieter line, and Page now
 * under them. It used to be a tinted, bordered box - a card inside the card,
 * which the card's one-frame rule leaves out, and louder than the report.
 *
 * Page now takes the permission to page an on-call policy by hand (create
 * an on-call run), as the server asks it (AiFirstResponderAPI). Someone the
 * permission snapshot certainly refuses - a Viewer, an On-Call Viewer - sees
 * it locked, saying why, as every locked action does, instead of pressing
 * it and being refused. While the snapshot is on its way it can be pressed:
 * the server decides.
 *
 * Only the newest read's answer lands. The read every 15 seconds could be
 * on its way when Page now was pressed, answer after Page now's own read,
 * and bring the notice back for up to 15 seconds; and the card stays
 * mounted when the page moves to another record, where the last record's
 * hold is not this one's.
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

export const PAGE_NOW_TEST_ID: string = "ai-hold-page-now";

// Why Page now is locked: the first sentence, then what would allow it.
export const PAGE_NOW_LOCKED_SENTENCE: string = translationKey(
  "You do not have permission to page on-call policies.",
);

// How often the notice reads the hold again while one is held.
export const AI_HOLD_NOTICE_REFRESH_MS: number = 15000;

export interface ComponentProps {
  subjectType: "incident" | "alert";
  subjectId: ObjectID;
}

// The hold read last, and the record it was read for.
interface ReadHold {
  subjectKey: string;
  pagingStartsAt: Date | null;
}

const AiHoldNotice: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  /*
   * While the permission snapshot is still on its way there is no reason
   * given, and the notice asks: the server decides.
   */
  const mayReadHold: boolean = shouldAttemptRead(
    PermissionGate.check(new OnCallDutyPolicyExecutionLog(), ModelAction.Read),
  );
  // Page now's lock: only a definite refusal locks it (see above).
  const pageNowGate: PermissionGateResult = PermissionGate.check(
    new OnCallDutyPolicyExecutionLog(),
    ModelAction.Create,
    { sentence: PAGE_NOW_LOCKED_SENTENCE },
  );
  const pageNowLockedReason: string | undefined = shouldAttemptRead(pageNowGate)
    ? undefined
    : pageNowGate.disabledReason;

  const subjectKey: string = `${props.subjectType}:${props.subjectId.toString()}`;
  const [hold, setHold] = useState<ReadHold | null>(null);
  const [isPaging, setIsPaging] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * A count bumped by every read, and by Page now: a read's answer lands
   * only if nothing was read or pressed since it was asked.
   */
  const readCountRef: MutableRefObject<number> = useRef<number>(0);
  // While Page now is on its way the read every 15 seconds waits.
  const isPagingRef: MutableRefObject<boolean> = useRef<boolean>(false);

  const pagingStartsAt: Date | null =
    mayReadHold && hold && hold.subjectKey === subjectKey
      ? hold.pagingStartsAt
      : null;

  const readHold: () => Promise<void> = useCallback(async (): Promise<void> => {
    readCountRef.current += 1;
    const readNumber: number = readCountRef.current;
    let startsAt: Date | null = null;

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

      startsAt = first?.pagingStartsAt
        ? OneUptimeDate.fromString(first.pagingStartsAt)
        : null;
    } catch {
      /*
       * Refused - a reader the snapshot could not yet rule out - or failed:
       * no notice.
       */
      startsAt = null;
    }

    // Something was read or pressed since: this answer is not the news.
    if (readNumber !== readCountRef.current) {
      return;
    }

    setHold({ subjectKey: subjectKey, pagingStartsAt: startsAt });
  }, [subjectKey]);

  useEffect(() => {
    if (!mayReadHold) {
      return;
    }

    void readHold();
  }, [readHold, mayReadHold]);

  useEffect(() => {
    if (!pagingStartsAt) {
      return;
    }

    const interval: ReturnType<typeof setInterval> = setInterval(() => {
      if (isPagingRef.current) {
        return;
      }

      void readHold();
    }, AI_HOLD_NOTICE_REFRESH_MS);

    return () => {
      clearInterval(interval);
    };
  }, [pagingStartsAt?.getTime(), readHold]);

  const pageNow: () => Promise<void> = async (): Promise<void> => {
    // Whatever was being read when Page now was pressed is old news now.
    readCountRef.current += 1;
    isPagingRef.current = true;
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
      isPagingRef.current = false;
      setIsPaging(false);
    }
  };

  if (!pagingStartsAt) {
    return <></>;
  }

  return (
    // Read out as it changes, without taking the reader's focus.
    <div data-testid={AI_HOLD_NOTICE_TEST_ID} aria-live="polite">
      <InvestigationNotice
        indicator={
          <Icon
            icon={IconProp.Bolt}
            className={`${NOTICE_ICON_CLASS_NAME} text-indigo-500`}
          />
        }
        title={AI_HOLD_NOTICE_TITLE}
        actionsTestId="ai-hold-notice-actions"
        actions={
          <>
            {/*
             * Button's own margin is for a dialog's footer: here it would
             * only push Page now off the line's start - the locked one's
             * too, inside the wrapper that carries its reason.
             */}
            <div className="flex-shrink-0 [&>*>button]:ml-0 [&>*>button]:md:ml-0 [&>button]:ml-0 [&>button]:md:ml-0">
              <Button
                title={PAGE_NOW_TITLE}
                buttonStyle={ButtonStyleType.NORMAL}
                buttonSize={ButtonSize.Small}
                icon={IconProp.Call}
                isLoading={isPaging}
                disabled={isPaging || Boolean(pageNowLockedReason)}
                tooltip={pageNowLockedReason}
                dataTestId={PAGE_NOW_TEST_ID}
                onClick={() => {
                  if (pageNowLockedReason) {
                    return;
                  }

                  void pageNow();
                }}
              />
            </div>
            {error ? (
              <p
                className="text-sm leading-6 text-red-600"
                role="alert"
                data-testid="ai-hold-page-now-error"
              >
                {error}
              </p>
            ) : (
              <></>
            )}
          </>
        }
      >
        {translator.translateTemplate(AI_HOLD_NOTICE_TEXT[props.subjectType], {
          time: OneUptimeDate.getLocalTimeString(pagingStartsAt, {
            use12HourFormat: OneUptimeDate.getUserPrefers12HourFormat(),
          }),
        })}
      </InvestigationNotice>
    </div>
  );
};

export default AiHoldNotice;
