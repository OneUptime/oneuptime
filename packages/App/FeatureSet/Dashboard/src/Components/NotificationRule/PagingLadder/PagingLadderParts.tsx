import { PagingMethodChoice, findMethodChoice } from "./PagingLadderMethods";
import {
  PAGING_LADDER_COPY,
  describeCardKind,
  describePushSettings,
  describeWait,
} from "./PagingLadderWords";
import { NOT_SENT_RIGHT_NOW, isStepNotSentNow } from "./StepsNotSentNow";
import { NOTIFIED_VIA_CHANNEL_ICONS } from "../../OnCallPolicy/ExecutionLogs/NotifiedVia";
import IconProp from "Common/Types/Icon/IconProp";
import {
  PagingLadderCell,
  PagingLadderChangedStep,
  PagingLadderDifference,
  PagingLadderStep,
  PagingMethodColumn,
  getChannelForPagingMethodColumn,
  getPagingLadderStepKey,
} from "Common/Types/NotificationRule/PagingLadder";
import { OnCallPageChannel } from "Common/Types/OnCallDutyPolicy/OnCallPageChannel";
import Icon from "Common/UI/Components/Icon/Icon";
import InlineSeparator from "Common/UI/Components/InlineSeparator/InlineSeparator";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import PhoneNumberText from "Common/UI/Components/PhoneNumber/PhoneNumberText";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import NotificationMethodUtil, {
  NOTIFICATION_METHOD_LINE,
} from "Common/UI/Utils/NotificationMethodUtil";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The small pieces How to Reach Me draws (#6820): a method as the grid
 * names it, a step as a chip, a card as its tab and severity, and what a
 * card that differs from the ladder does instead.
 */

// A rule names a method this page cannot name: deleted, or not in readiness.
export const UNKNOWN_METHOD_LABEL: string = translationKey(
  "A notification method this page cannot name",
);

/*
 * A method's icon, as the person's notification settings, On-Call
 * Readiness and an on-call run's "Notified via" draw its kind: a phone for
 * a call, a bell for a push. Read from the step's column, so a method the
 * page cannot name still shows what kind it is.
 */
export const getMethodIcon: (step: {
  methodColumn: PagingMethodColumn;
}) => IconProp = (step: { methodColumn: PagingMethodColumn }): IconProp => {
  return (
    NOTIFIED_VIA_CHANNEL_ICONS[
      getChannelForPagingMethodColumn(step.methodColumn)
    ] || IconProp.Notification
  );
};

/*
 * A method's icon in a small tile, at the start of its row. Left out on a
 * phone, where the row needs the room for the method's name.
 */
export const MethodIcon: FunctionComponent<{
  step: { methodColumn: PagingMethodColumn };
}> = (props: { step: { methodColumn: PagingMethodColumn } }): ReactElement => {
  return (
    <span
      className="max-sm:hidden h-7 w-7 flex-none items-center justify-center rounded-md bg-gray-50 text-gray-500 ring-1 ring-inset ring-gray-200 sm:flex"
      aria-hidden="true"
      data-testid="paging-ladder-method-icon"
    >
      <Icon icon={getMethodIcon(props.step)} className="h-4 w-4" />
    </span>
  );
};

/*
 * "SMS: +15550100" as the cards below name it (#7178): one sentence of the
 * reader's language (NOTIFICATION_METHOD_LINE) - the method's name is
 * theirs, "Phone call" and never the shared "Call", and so is the colon -
 * with the number kept in its own direction on a page read right to left
 * and an unnamed device in the reader's words.
 */
export const MethodLabel: FunctionComponent<{
  choice: PagingMethodChoice | undefined;
}> = (props: { choice: PagingMethodChoice | undefined }): ReactElement => {
  const translator: Translator = useTranslator();

  if (!props.choice) {
    return (
      <span className="italic text-gray-500" data-testid="paging-ladder-method">
        {translator.translateText(UNKNOWN_METHOD_LABEL)}
      </span>
    );
  }

  const { channel } = props.choice;
  const name: ReactElement = (
    <span className="font-medium text-gray-900">
      {NotificationMethodUtil.getMethodName(translator, channel)}
    </span>
  );
  // A channel of the project's default: its name alone (#7449).
  const identifier: string = props.choice.isChannelOnly
    ? ""
    : NotificationMethodUtil.getIdentifierText(
        translator,
        channel,
        props.choice.identifier,
      );

  return (
    <span className="min-w-0 break-words" data-testid="paging-ladder-method">
      {identifier ? (
        <TranslatedSentence
          template={NOTIFICATION_METHOD_LINE}
          slots={{
            label: name,
            identifier: NotificationMethodUtil.isPhoneNumberChannel(channel) ? (
              <PhoneNumberText phoneNumber={identifier} />
            ) : (
              <IsolatedText text={identifier} />
            ),
          }}
          renderText={(text: string): ReactElement => {
            // The colon, quieter than the name and the identifier.
            return <span className="text-gray-400">{text}</span>;
          }}
        />
      ) : (
        name
      )}
    </span>
  );
};

/*
 * A step on one line: its method, when, and how a push sounds. A step this
 * server can't send right now (#9446) carries the warning icon, named for a
 * screen reader; why is said once on the page (StepsNotSentNowNotice).
 */
export const StepChip: FunctionComponent<{
  step: PagingLadderStep;
  methods: ReadonlyArray<PagingMethodChoice>;
  tone?: "neutral" | "added" | "removed" | undefined;
  channelsNotSentNow?: ReadonlyArray<OnCallPageChannel> | undefined;
}> = (props: {
  step: PagingLadderStep;
  methods: ReadonlyArray<PagingMethodChoice>;
  tone?: "neutral" | "added" | "removed" | undefined;
  channelsNotSentNow?: ReadonlyArray<OnCallPageChannel> | undefined;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const pushSettings: string = describePushSettings(translator, props.step);
  const isNotSentNow: boolean = isStepNotSentNow(
    props.step,
    props.channelsNotSentNow || [],
  );

  const toneClassName: string =
    props.tone === "added"
      ? "border-emerald-200 bg-emerald-50"
      : props.tone === "removed"
        ? "border-gray-200 bg-gray-50 line-through decoration-gray-400"
        : "border-gray-200 bg-white";

  return (
    <span
      className={`inline-flex max-w-full flex-wrap items-center gap-x-1.5 rounded-md border px-2 py-0.5 text-sm text-gray-700 ${toneClassName}`}
      data-testid="paging-ladder-step-chip"
    >
      {isNotSentNow ? (
        <span
          className="inline-flex flex-none items-center text-amber-600"
          data-testid="paging-ladder-step-chip-not-sent-now"
        >
          <Icon icon={IconProp.Alert} className="h-3.5 w-3.5" />
          <span className="sr-only">
            {translator.translateText(NOT_SENT_RIGHT_NOW)}
          </span>
        </span>
      ) : (
        <></>
      )}
      <MethodLabel choice={findMethodChoice(props.methods, props.step)} />
      <span className="text-gray-400" aria-hidden="true">
        <InlineSeparator markOnly />
      </span>
      <span>{describeWait(translator, props.step.notifyAfterMinutes)}</span>
      {pushSettings ? (
        <>
          <span className="text-gray-400" aria-hidden="true">
            <InlineSeparator markOnly />
          </span>
          <span className="text-gray-500">{pushSettings}</span>
        </>
      ) : (
        <></>
      )}
    </span>
  );
};

// A card as the grid titles it: its kind, then its severity in its colour.
export const CardName: FunctionComponent<{
  cell: PagingLadderCell;
  color?: string | undefined;
}> = (props: {
  cell: PagingLadderCell;
  color?: string | undefined;
}): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <span
      className="inline-flex flex-wrap items-center gap-x-1.5 font-medium text-gray-900"
      data-testid="paging-ladder-card-name"
    >
      <span>{describeCardKind(translator, props.cell)}</span>
      <span className="text-gray-400" aria-hidden="true">
        <InlineSeparator markOnly />
      </span>
      <span className="inline-flex items-center gap-1.5">
        {props.color ? (
          <span
            aria-hidden="true"
            className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
            style={{ backgroundColor: props.color }}
          ></span>
        ) : (
          <></>
        )}
        <IsolatedText text={props.cell.severityName} />
      </span>
    </span>
  );
};

/*
 * What every card that differs from the ladder does instead, one card a
 * row: "Incidents · Critical — Also: Call · At once".
 */
export const DifferencesList: FunctionComponent<{
  differences: ReadonlyArray<PagingLadderDifference>;
  methods: ReadonlyArray<PagingMethodChoice>;
  severityColors: Record<string, string>;
  channelsNotSentNow?: ReadonlyArray<OnCallPageChannel> | undefined;
}> = (props: {
  differences: ReadonlyArray<PagingLadderDifference>;
  methods: ReadonlyArray<PagingMethodChoice>;
  severityColors: Record<string, string>;
  channelsNotSentNow?: ReadonlyArray<OnCallPageChannel> | undefined;
}): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <ul
      className="divide-y divide-gray-100"
      data-testid="paging-ladder-differences"
    >
      {props.differences.map((difference: PagingLadderDifference) => {
        return (
          <li
            key={`${difference.cell.ruleType}|${difference.cell.severityId}`}
            className="flex flex-col gap-1.5 py-2.5 sm:flex-row sm:items-start sm:gap-4"
            data-testid="paging-ladder-difference"
          >
            <div className="sm:w-64 sm:flex-none">
              <CardName
                cell={difference.cell}
                color={props.severityColors[difference.cell.severityId]}
              />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              {difference.isMuted ? (
                <p className="text-sm text-gray-600">
                  {translator.translateText(PAGING_LADDER_COPY.muted)}
                </p>
              ) : (
                <></>
              )}
              {difference.extra.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm text-gray-500">
                    {translator.translateText(PAGING_LADDER_COPY.also)}
                  </span>
                  {difference.extra.map((step: PagingLadderStep) => {
                    return (
                      <StepChip
                        key={getPagingLadderStepKey(step)}
                        step={step}
                        methods={props.methods}
                        tone="added"
                        channelsNotSentNow={props.channelsNotSentNow}
                      />
                    );
                  })}
                </div>
              ) : (
                <></>
              )}
              {difference.missing.length > 0 && !difference.isMuted ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm text-gray-500">
                    {translator.translateText(PAGING_LADDER_COPY.not)}
                  </span>
                  {difference.missing.map((step: PagingLadderStep) => {
                    return (
                      <StepChip
                        key={getPagingLadderStepKey(step)}
                        step={step}
                        methods={props.methods}
                        tone="removed"
                      />
                    );
                  })}
                </div>
              ) : (
                <></>
              )}
              {difference.changed.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm text-gray-500">
                    {translator.translateText(PAGING_LADDER_COPY.pushDiffers)}
                  </span>
                  {difference.changed.map(
                    (changed: PagingLadderChangedStep) => {
                      return (
                        <StepChip
                          key={getPagingLadderStepKey(changed.step)}
                          step={changed.step}
                          methods={props.methods}
                          channelsNotSentNow={props.channelsNotSentNow}
                        />
                      );
                    },
                  )}
                </div>
              ) : (
                <></>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
};
