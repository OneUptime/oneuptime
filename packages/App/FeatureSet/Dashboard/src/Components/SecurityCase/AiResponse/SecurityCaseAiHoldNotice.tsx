import SecurityCaseApi from "../SecurityCaseApi";
import { AI_HOLD_NOTICE_TITLE, PAGE_NOW_TITLE } from "../../AI/AiHoldNotice";
import SecurityCase from "Common/Models/DatabaseModels/SecurityCase";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { SecurityCaseAiHoldOutcome } from "Common/Types/SecurityCase/SecurityCaseAiHold";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import { ErrorInSentence } from "Common/UI/Components/ErrorMessage/ErrorSentence";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
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
 * WHILE ONEUPTIME AI RESPONDS FIRST TO THE CASE (#10353): the first thing
 * on the case's page says "OneUptime AI is on it", when people are alerted
 * unless it contains the case first, and Page now - one click, the card's
 * one action - for anyone who wants people on it at once. The incident
 * side's words (AiHoldNotice), so the hold reads the same everywhere.
 *
 * Read again every 15 seconds while the case is held, so the notice goes
 * as soon as the hold ends; the page then reads the case again
 * (onChanged), and its OneUptime AI card says how the hold ended. Nothing
 * shows for a case that is not held.
 *
 * Page now alerts people, so it takes a role that can work security cases,
 * as the server asks (SecurityCaseAPI); someone the permission snapshot
 * refuses sees it locked, saying why. Only the newest read's answer lands:
 * a read on its way when Page now was pressed must not bring the notice
 * back.
 */

export const SECURITY_CASE_AI_HOLD_NOTICE_TEST_ID: string =
  "security-case-ai-hold-notice";

export const SECURITY_CASE_AI_HOLD_NOTICE_TEXT: string = translationKey(
  "People are alerted at {{time}} unless OneUptime AI contains this case first.",
);

// How often the notice reads the hold again while the case is held.
export const SECURITY_CASE_AI_HOLD_NOTICE_REFRESH_MS: number = 15000;

export interface ComponentProps {
  caseId: ObjectID;
  // The hold ended: the page reads the case again.
  onChanged?: (() => void) | undefined;
}

const SecurityCaseAiHoldNotice: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [holdUntil, setHoldUntil] = useState<Date | null>(null);
  const [isPaging, setIsPaging] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  // A count bumped by every read and by Page now: only the newest answer lands.
  const readCountRef: MutableRefObject<number> = useRef<number>(0);
  // Whether the last read found the case held, to tell the page once it is not.
  const wasHeldRef: MutableRefObject<boolean> = useRef<boolean>(false);

  const gate: PermissionGateResult = PermissionGate.check(
    new SecurityCase(),
    ModelAction.Update,
  );

  const readHold: () => Promise<void> = useCallback(async (): Promise<void> => {
    readCountRef.current += 1;
    const readNumber: number = readCountRef.current;
    let until: Date | null = null;

    try {
      const securityCase: SecurityCase | null =
        await ModelAPI.getItem<SecurityCase>({
          modelType: SecurityCase,
          id: props.caseId,
          select: { _id: true, aiHoldOutcome: true, aiHoldUntil: true },
        });

      until =
        securityCase?.aiHoldOutcome === SecurityCaseAiHoldOutcome.Holding &&
        securityCase.aiHoldUntil
          ? OneUptimeDate.fromString(securityCase.aiHoldUntil)
          : null;
    } catch {
      // Refused or failed: no notice.
      until = null;
    }

    if (readNumber !== readCountRef.current) {
      return;
    }

    setHoldUntil(until);

    if (wasHeldRef.current && !until) {
      props.onChanged?.();
    }

    wasHeldRef.current = Boolean(until);
  }, [props.caseId.toString()]);

  useEffect(() => {
    wasHeldRef.current = false;
    void readHold();
  }, [readHold]);

  useEffect(() => {
    if (!holdUntil) {
      return;
    }

    const interval: ReturnType<typeof setInterval> = setInterval(() => {
      if (!isPaging) {
        void readHold();
      }
    }, SECURITY_CASE_AI_HOLD_NOTICE_REFRESH_MS);

    return () => {
      clearInterval(interval);
    };
  }, [holdUntil?.getTime(), readHold, isPaging]);

  const pageNow: () => Promise<void> = async (): Promise<void> => {
    // Whatever was being read when Page now was pressed is old news now.
    readCountRef.current += 1;
    setIsPaging(true);
    setError("");

    try {
      await SecurityCaseApi.pageNowForAiHold(props.caseId);
      await readHold();
    } catch (err) {
      setError(API.getFriendlyMessage(err));
      // The hold may have ended meanwhile: read it again.
      await readHold();
    } finally {
      setIsPaging(false);
    }
  };

  if (!holdUntil) {
    return <></>;
  }

  return (
    // Read out as it changes, without taking the reader's focus.
    <div data-testid={SECURITY_CASE_AI_HOLD_NOTICE_TEST_ID} aria-live="polite">
      <Card
        title={AI_HOLD_NOTICE_TITLE}
        description={
          <>
            {translator.translateTemplate(SECURITY_CASE_AI_HOLD_NOTICE_TEXT, {
              time: OneUptimeDate.getLocalTimeString(holdUntil, {
                use12HourFormat: OneUptimeDate.getUserPrefers12HourFormat(),
              }),
            })}
          </>
        }
        buttons={[
          {
            title: PAGE_NOW_TITLE,
            // What the notice is there for: the card's one action.
            buttonStyle: ButtonStyleType.PRIMARY,
            icon: IconProp.Call,
            isLoading: isPaging,
            disabled: isPaging || !gate.isAllowed,
            tooltip: gate.isAllowed ? undefined : gate.disabledReason,
            onClick: () => {
              if (!gate.isAllowed) {
                return;
              }

              void pageNow();
            },
          },
        ]}
      >
        {error ? (
          <p
            className="text-sm text-red-600"
            role="alert"
            data-testid={`${SECURITY_CASE_AI_HOLD_NOTICE_TEST_ID}-error`}
          >
            <ErrorInSentence message={error} showWhereToLook={true} />
          </p>
        ) : (
          <></>
        )}
      </Card>
    </div>
  );
};

export default SecurityCaseAiHoldNotice;
