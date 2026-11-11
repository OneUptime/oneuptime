import AppLink from "../AppLink/AppLink";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import OnCallTestPageApi from "./OnCallTestPageApi";
import {
  ACKNOWLEDGED_BY_SENTENCES,
  CHANNEL_NAMES,
  DELIVERY_STATUS_WORDS,
  OnCallTestPageFixLink,
  RESULT_STATUS_WORDS,
  STEP_STATUS_WORDS,
  getFixLink,
} from "./OnCallTestPageWords";
import Route from "Common/Types/API/Route";
import Color from "Common/Types/Color";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import {
  OnCallTestPageDelivery,
  OnCallTestPageResult,
  OnCallTestPageStatus,
  OnCallTestPageStep,
  isOnCallTestPageResultFinal,
} from "Common/Types/OnCallDutyPolicy/OnCallTestPage";
import Icon from "Common/UI/Components/Icon/Icon";
import Pill, { PillSize } from "Common/UI/Components/Pill/Pill";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * WHAT BECAME OF A TEST PAGE, AS IT HAPPENS (OnCallTestPageResult): the
 * chain - each person paged, or each target that reached nobody, and every
 * message to them: by what, to where, sent, delivered or failed, with the
 * reason the message's log gives and a link to where it is fixed. It asks
 * again every few seconds until the test is acknowledged or over.
 *
 * Shown in the dialog the test was sent from, and on its own wherever a
 * page wants it - a guided setup that ends with a test page.
 */

export const TEST_PAGE_RESULT_POLL_INTERVAL_IN_MS: number = 3000;

/*
 * How long past its answer window a result is still asked for: its last
 * messages' providers answer a little after it ends.
 */
const POLL_GRACE_IN_MS: number = 2 * 60 * 1000;

export interface ComponentProps {
  executionLogId: string;
  // Told each time a result is read: a guided setup moves on once it works.
  onResult?: ((result: OnCallTestPageResult) => void) | undefined;
  // For tests: how often to ask again.
  pollIntervalInMs?: number | undefined;
}

// "14 seconds", "3 minutes": how long acknowledging took.
export function describeAnswerTime(
  translator: Translator,
  seconds: number,
): string {
  const whole: number = Math.max(0, Math.round(seconds));

  if (whole < 120) {
    return translator.translatePlural(
      { one: "{{count}} second", other: "{{count}} seconds" },
      whole,
    );
  }

  return translator.translatePlural(
    { one: "{{count}} minute", other: "{{count}} minutes" },
    Math.round(whole / 60),
  );
}

// The sentence under the result's headline.
export function getResultSentence(
  translator: Translator,
  result: OnCallTestPageResult,
): string {
  if (result.status === OnCallTestPageStatus.Acknowledged) {
    const name: string =
      result.acknowledgedByName || translator.translateText("Someone") || "";

    if (
      result.acknowledgedChannel &&
      typeof result.acknowledgedAfterSeconds === "number"
    ) {
      return translator.translateTemplate(
        ACKNOWLEDGED_BY_SENTENCES[result.acknowledgedChannel],
        {
          name: name,
          time: describeAnswerTime(translator, result.acknowledgedAfterSeconds),
        },
      );
    }

    return translator.translateTemplate("{{name}} acknowledged it.", {
      name: name,
    });
  }

  if (result.status === OnCallTestPageStatus.Paging) {
    return translator.translateTemplate(
      "Acknowledge it from the email, SMS, call or chat message to finish the test. It ends on its own at {{time}}.",
      {
        time: OneUptimeDate.getLocalTimeString(
          OneUptimeDate.fromString(result.endsAt),
        ),
      },
    );
  }

  return result.statusMessage;
}

const DeliveryLine: FunctionComponent<{
  delivery: OnCallTestPageDelivery;
}> = (props: { delivery: OnCallTestPageDelivery }): ReactElement => {
  const translator: Translator = useTranslator();
  const delivery: OnCallTestPageDelivery = props.delivery;
  const status: { text: string; color: Color } =
    DELIVERY_STATUS_WORDS[delivery.status];
  const channelName: string = delivery.channel
    ? translator.translateText(CHANNEL_NAMES[delivery.channel]) ||
      CHANNEL_NAMES[delivery.channel]
    : translator.translateText("Notification rule") || "";
  const fix: OnCallTestPageFixLink | null = delivery.fix
    ? getFixLink({ fix: delivery.fix, channel: delivery.channel })
    : null;
  const isFailed: boolean = delivery.status === "Failed";

  return (
    <li
      className="flex flex-col gap-1 py-2"
      data-testid="test-page-delivery"
      data-status={delivery.status}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-sm font-medium text-gray-900">{channelName}</span>
        {delivery.address ? (
          <span className="min-w-0 break-all text-sm text-gray-500">
            {delivery.address}
          </span>
        ) : (
          <></>
        )}
        <Pill
          text={translator.translateText(status.text) || status.text}
          color={status.color}
          size={PillSize.Small}
        />
      </div>
      {isFailed && delivery.statusMessage ? (
        <p className="text-sm text-gray-600 break-words">
          {delivery.statusMessage}
        </p>
      ) : (
        <></>
      )}
      {fix ? (
        <AppLink
          to={RouteUtil.populateRouteParams(RouteMap[fix.pageMap] as Route)}
          className="inline-flex w-fit items-center gap-1 text-sm font-medium text-indigo-700 hover:text-indigo-800"
        >
          <>
            <span>{translator.translateText(fix.text) || fix.text}</span>
            <Icon icon={IconProp.ChevronRight} className="h-3.5 w-3.5" />
          </>
        </AppLink>
      ) : (
        <></>
      )}
      {!delivery.canAcknowledge &&
      delivery.channel &&
      !isFailed &&
      delivery.status !== "Acknowledged" ? (
        <p className="text-xs text-gray-500">
          {translator.translateText(
            "A test can't be acknowledged from this one. It shows the message arrives.",
          )}
        </p>
      ) : (
        <></>
      )}
    </li>
  );
};

const StepBlock: FunctionComponent<{
  step: OnCallTestPageStep;
}> = (props: { step: OnCallTestPageStep }): ReactElement => {
  const translator: Translator = useTranslator();
  const step: OnCallTestPageStep = props.step;
  const status: { text: string; color: Color } =
    STEP_STATUS_WORDS[step.status];

  const through: Array<string> = [];

  if (step.levelOrder) {
    through.push(
      step.levelName ||
        translator.translateTemplate("Level {{order}}", {
          order: step.levelOrder,
        }),
    );
  }

  if (step.teamName) {
    through.push(
      translator.translateTemplate("Team {{name}}", { name: step.teamName }),
    );
  }

  if (step.scheduleName) {
    through.push(
      translator.translateTemplate("Schedule {{name}}", {
        name: step.scheduleName,
      }),
    );
  }

  if (step.coveringForName) {
    through.push(
      translator.translateTemplate("Covering for {{name}}", {
        name: step.coveringForName,
      }),
    );
  }

  return (
    <div
      className="rounded-lg border border-gray-200 px-4 py-3"
      data-testid="test-page-step"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-gray-900">
            {step.userName ||
              translator.translateText("Nobody paged here") ||
              ""}
          </p>
          {through.length > 0 ? (
            <p className="text-xs text-gray-500">{through.join(" · ")}</p>
          ) : (
            <></>
          )}
        </div>
        <Pill
          text={translator.translateText(status.text) || status.text}
          color={status.color}
          size={PillSize.Small}
        />
      </div>
      {step.deliveries.length === 0 && step.statusMessage ? (
        <p className="mt-2 text-sm text-gray-600 break-words">
          {step.statusMessage}
        </p>
      ) : (
        <></>
      )}
      {step.deliveries.length > 0 ? (
        <ul className="mt-1 divide-y divide-gray-100">
          {step.deliveries.map((delivery: OnCallTestPageDelivery) => {
            return <DeliveryLine key={delivery.id} delivery={delivery} />;
          })}
        </ul>
      ) : (
        <></>
      )}
    </div>
  );
};

// A test's result, drawn: the headline, its sentence, and the chain.
export const TestPageResultView: FunctionComponent<{
  result: OnCallTestPageResult;
}> = (props: { result: OnCallTestPageResult }): ReactElement => {
  const translator: Translator = useTranslator();
  const result: OnCallTestPageResult = props.result;
  const status: { title: string; color: Color } =
    RESULT_STATUS_WORDS[result.status];

  return (
    <div
      className="flex flex-col gap-3"
      data-testid="test-page-result"
      data-status={result.status}
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <Pill
            text={translator.translateText(status.title) || status.title}
            color={status.color}
            isPulsing={result.status === OnCallTestPageStatus.Paging}
          />
        </div>
        <p className="text-sm text-gray-700 break-words">
          {getResultSentence(translator, result)}
        </p>
      </div>
      {result.steps.length > 0 ? (
        <div className="flex flex-col gap-2">
          {result.steps.map((step: OnCallTestPageStep) => {
            return <StepBlock key={step.id} step={step} />;
          })}
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

/*
 * A test's result, read and read again: every few seconds while it is
 * paging, and not after it is acknowledged or over.
 */
const TestPageResult: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [result, setResult] = useState<OnCallTestPageResult | null>(null);
  const [error, setError] = useState<string>("");
  const timer: React.MutableRefObject<ReturnType<typeof setTimeout> | null> =
    useRef<ReturnType<typeof setTimeout> | null>(null);
  const onResult: React.MutableRefObject<ComponentProps["onResult"]> =
    useRef<ComponentProps["onResult"]>(props.onResult);

  onResult.current = props.onResult;

  useEffect(() => {
    let isActive: boolean = true;

    const read: () => Promise<void> = async (): Promise<void> => {
      let next: OnCallTestPageResult | null = null;

      try {
        next = await OnCallTestPageApi.getResult(props.executionLogId);

        if (!isActive) {
          return;
        }

        setResult(next);
        setError("");
        onResult.current?.(next);
      } catch (err) {
        if (!isActive) {
          return;
        }

        setError(
          (err as Error)?.message ||
            translator.translateText("The result can't be read right now.") ||
            "",
        );
      }

      const isOver: boolean = Boolean(
        next &&
          (isOnCallTestPageResultFinal(next) ||
            Date.now() >
              OneUptimeDate.fromString(next.endsAt).getTime() +
                POLL_GRACE_IN_MS),
      );

      if (isActive && !isOver) {
        timer.current = setTimeout(
          read,
          props.pollIntervalInMs || TEST_PAGE_RESULT_POLL_INTERVAL_IN_MS,
        );
      }
    };

    void read();

    return () => {
      isActive = false;

      if (timer.current) {
        clearTimeout(timer.current);
      }
    };
  }, [props.executionLogId]);

  if (!result) {
    return (
      <div className="text-sm text-gray-500" data-testid="test-page-result">
        {error ||
          translator.translateText("Sending the test page...") ||
          ""}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <TestPageResultView result={result} />
      {error ? <p className="text-xs text-red-600">{error}</p> : <></>}
    </div>
  );
};

export default TestPageResult;
