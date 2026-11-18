import {
  SERVER_CANNOT_SEND_COPY,
  SERVER_CANNOT_SEND_FIX_WORDS,
  ServerCannotSendChannel,
  getServerCannotSendFixUrl,
} from "../../NotificationMethods/ServerCannotSendPanel";
import {
  PagingMethodColumn,
  getChannelForPagingMethodColumn,
} from "Common/Types/NotificationRule/PagingLadder";
import { OnCallPageChannel } from "Common/Types/OnCallDutyPolicy/OnCallPageChannel";
import { ProjectCanSendAnswer } from "Common/Types/ServerSending/ProjectCanSend";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Pill, { PillSize } from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import UserUtil from "Common/UI/Utils/User";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * STEPS THIS SERVER CAN'T SEND RIGHT NOW (#9446).
 *
 * A self-hosted server sends no email until its admin sets it up, and no
 * SMS or call without a Twilio account or a gateway, the project's own or
 * the server's. Notification Methods says so over the person's addresses
 * and numbers (ServerCannotSendPanel, #6880), and How to Reach Me drew an
 * email, SMS or call step as if it would reach them.
 *
 * Now each such step is marked "Not sent right now", and the ladder says
 * once - not on every step - why, in the very words of Notification
 * Methods, and who can fix it: the server's admin, or, for a master admin,
 * where in the Admin Dashboard. It reads the same three yes-or-noes
 * (GET /project-can-send, useProjectCanSend): never why, nor any setting.
 * Only a plain "no" marks anything; while the answer is on its way, could
 * not be read, or is yes - always, on OneUptime Cloud - the ladder says
 * what it always did. A project whose own Twilio config sends SMS and calls
 * is answered yes for them, so its SMS and call steps are not marked.
 */

// What a step that cannot go out says, beside its method.
export const NOT_SENT_RIGHT_NOW: string = translationKey("Not sent right now");

/*
 * SMS and calls stopped together - no Twilio account or gateway at all -
 * said once: Notification Methods' two sentences side by side would each
 * ask for the same fix.
 */
export const SMS_AND_CALLS_NOT_SENT_COPY: { member: string; admin: string } = {
  member: translationKey(
    "This server can't send SMS or make calls right now, so these numbers get no SMS or calls. Ask your server's admin to set up SMS and calls.",
  ),
  admin: translationKey(
    "This server can't send SMS or make calls right now, so these numbers get no SMS or calls. Set up SMS and calls in the Admin Dashboard.",
  ),
};

export const STEPS_NOT_SENT_NOW_TEST_ID: string = "paging-ladder-not-sent-now";

// The channels of the answer, in the order Notification Methods lists them.
const CHANNELS_BY_ANSWER: ReadonlyArray<{
  channel: OnCallPageChannel;
  isSent: (answer: ProjectCanSendAnswer) => boolean;
  panelChannel: ServerCannotSendChannel;
}> = [
  {
    channel: OnCallPageChannel.Email,
    isSent: (answer: ProjectCanSendAnswer): boolean => {
      return answer.email;
    },
    panelChannel: ServerCannotSendChannel.Email,
  },
  {
    channel: OnCallPageChannel.SMS,
    isSent: (answer: ProjectCanSendAnswer): boolean => {
      return answer.sms;
    },
    panelChannel: ServerCannotSendChannel.SMS,
  },
  {
    channel: OnCallPageChannel.Call,
    isSent: (answer: ProjectCanSendAnswer): boolean => {
      return answer.call;
    },
    panelChannel: ServerCannotSendChannel.Call,
  },
];

/*
 * The channels this server can't send through right now: each one the
 * answer says a plain "no" to. None while it is not known.
 */
export const getChannelsNotSentNow: (
  answer: ProjectCanSendAnswer | null | undefined,
) => Array<OnCallPageChannel> = (
  answer: ProjectCanSendAnswer | null | undefined,
): Array<OnCallPageChannel> => {
  if (!answer) {
    return [];
  }

  return CHANNELS_BY_ANSWER.filter(
    (entry: (typeof CHANNELS_BY_ANSWER)[number]): boolean => {
      return entry.isSent(answer) === false;
    },
  ).map((entry: (typeof CHANNELS_BY_ANSWER)[number]): OnCallPageChannel => {
    return entry.channel;
  });
};

// Whether a step goes out through a channel that can't send right now.
export const isStepNotSentNow: (
  step: { methodColumn: PagingMethodColumn },
  channelsNotSentNow: ReadonlyArray<OnCallPageChannel>,
) => boolean = (
  step: { methodColumn: PagingMethodColumn },
  channelsNotSentNow: ReadonlyArray<OnCallPageChannel>,
): boolean => {
  return channelsNotSentNow.includes(
    getChannelForPagingMethodColumn(step.methodColumn),
  );
};

/*
 * Which of those channels the steps use, each once, in the order
 * Notification Methods lists them: what the ladder has to say why for.
 */
export const getChannelsNotSentNowInSteps: (
  steps: ReadonlyArray<{ methodColumn: PagingMethodColumn }>,
  channelsNotSentNow: ReadonlyArray<OnCallPageChannel>,
) => Array<OnCallPageChannel> = (
  steps: ReadonlyArray<{ methodColumn: PagingMethodColumn }>,
  channelsNotSentNow: ReadonlyArray<OnCallPageChannel>,
): Array<OnCallPageChannel> => {
  return CHANNELS_BY_ANSWER.map(
    (entry: (typeof CHANNELS_BY_ANSWER)[number]): OnCallPageChannel => {
      return entry.channel;
    },
  ).filter((channel: OnCallPageChannel): boolean => {
    return (
      channelsNotSentNow.includes(channel) &&
      steps.some((step: { methodColumn: PagingMethodColumn }): boolean => {
        return getChannelForPagingMethodColumn(step.methodColumn) === channel;
      })
    );
  });
};

// The mark on a step that can't go out: the shared chip, in the warning tone.
export const NotSentNowMark: FunctionComponent = (): ReactElement => {
  return (
    <span
      className="inline-flex flex-none"
      data-testid="paging-ladder-not-sent-now-mark"
    >
      <Pill
        text={NOT_SENT_RIGHT_NOW}
        tone={PillTone.Warning}
        size={PillSize.Small}
      />
    </span>
  );
};

export interface StepsNotSentNowNoticeProps {
  // The channels the steps use that can't send right now (getChannelsNotSentNowInSteps).
  channels: ReadonlyArray<OnCallPageChannel>;
}

// One sentence of the notice: its words, and where a master admin fixes it.
export interface StepsNotSentNowLine {
  // "email", "sms", "call" or "sms-and-call": what it is about.
  key: string;
  words: { member: string; admin: string };
  fixChannel: ServerCannotSendChannel;
}

/*
 * The notice's sentences, in Notification Methods' order: email, then SMS
 * and calls - one sentence for both when both are stopped.
 */
export const getStepsNotSentNowLines: (
  channels: ReadonlyArray<OnCallPageChannel>,
) => Array<StepsNotSentNowLine> = (
  channels: ReadonlyArray<OnCallPageChannel>,
): Array<StepsNotSentNowLine> => {
  const lines: Array<StepsNotSentNowLine> = [];

  if (channels.includes(OnCallPageChannel.Email)) {
    lines.push({
      key: ServerCannotSendChannel.Email,
      words: SERVER_CANNOT_SEND_COPY[ServerCannotSendChannel.Email],
      fixChannel: ServerCannotSendChannel.Email,
    });
  }

  const isSmsStopped: boolean = channels.includes(OnCallPageChannel.SMS);
  const isCallStopped: boolean = channels.includes(OnCallPageChannel.Call);

  if (isSmsStopped && isCallStopped) {
    lines.push({
      key: "sms-and-call",
      words: SMS_AND_CALLS_NOT_SENT_COPY,
      fixChannel: ServerCannotSendChannel.SMS,
    });
  } else if (isSmsStopped) {
    lines.push({
      key: ServerCannotSendChannel.SMS,
      words: SERVER_CANNOT_SEND_COPY[ServerCannotSendChannel.SMS],
      fixChannel: ServerCannotSendChannel.SMS,
    });
  } else if (isCallStopped) {
    lines.push({
      key: ServerCannotSendChannel.Call,
      words: SERVER_CANNOT_SEND_COPY[ServerCannotSendChannel.Call],
      fixChannel: ServerCannotSendChannel.Call,
    });
  }

  return lines;
};

/*
 * Why the marked steps are not sent, once for the page: a sentence a
 * channel, as Notification Methods says it over that channel's list, and
 * who can fix it. Nothing when no step's channel is stopped.
 */
export const StepsNotSentNowNotice: FunctionComponent<
  StepsNotSentNowNoticeProps
> = (props: StepsNotSentNowNoticeProps): ReactElement => {
  const translator: Translator = useTranslator();
  const lines: Array<StepsNotSentNowLine> = getStepsNotSentNowLines(
    props.channels,
  );

  if (lines.length === 0) {
    return <></>;
  }

  const isMasterAdmin: boolean = Boolean(UserUtil.isMasterAdmin());

  return (
    <Alert
      type={AlertType.WARNING}
      // As wide as the steps it is about, as the ladder's other notes are.
      className="max-w-3xl"
      dataTestId={STEPS_NOT_SENT_NOW_TEST_ID}
      title={
        <div className="flex flex-col gap-1">
          {lines.map((line: StepsNotSentNowLine) => {
            return (
              <p
                key={line.key}
                data-testid={`${STEPS_NOT_SENT_NOW_TEST_ID}-${line.key}`}
              >
                {translator.translateText(
                  isMasterAdmin ? line.words.admin : line.words.member,
                )}
                {isMasterAdmin ? (
                  <>
                    {" "}
                    <a
                      href={getServerCannotSendFixUrl(
                        line.fixChannel,
                      ).toString()}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium underline"
                      data-testid={`${STEPS_NOT_SENT_NOW_TEST_ID}-fix`}
                    >
                      {translator.translateText(
                        SERVER_CANNOT_SEND_FIX_WORDS[line.fixChannel],
                      )}
                    </a>
                  </>
                ) : (
                  <></>
                )}
              </p>
            );
          })}
        </div>
      }
    />
  );
};
