import { PagingMethodChoice, findMethodChoice } from "./PagingLadderMethods";
import {
  PAGING_LADDER_COPY,
  describeCardKind,
  describePushSettings,
  describeWait,
} from "./PagingLadderWords";
import {
  PagingLadderCell,
  PagingLadderChangedStep,
  PagingLadderDifference,
  PagingLadderStep,
  getPagingLadderStepKey,
} from "Common/Types/NotificationRule/PagingLadder";
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
  const identifier: string = NotificationMethodUtil.getIdentifierText(
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

// A step on one line: its method, when, and how a push sounds.
export const StepChip: FunctionComponent<{
  step: PagingLadderStep;
  methods: ReadonlyArray<PagingMethodChoice>;
  tone?: "neutral" | "added" | "removed" | undefined;
}> = (props: {
  step: PagingLadderStep;
  methods: ReadonlyArray<PagingMethodChoice>;
  tone?: "neutral" | "added" | "removed" | undefined;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const pushSettings: string = describePushSettings(translator, props.step);

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
      <MethodLabel choice={findMethodChoice(props.methods, props.step)} />
      <span className="text-gray-400" aria-hidden="true">
        ·
      </span>
      <span>{describeWait(translator, props.step.notifyAfterMinutes)}</span>
      {pushSettings ? (
        <>
          <span className="text-gray-400" aria-hidden="true">
            ·
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
        ·
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
}> = (props: {
  differences: ReadonlyArray<PagingLadderDifference>;
  methods: ReadonlyArray<PagingMethodChoice>;
  severityColors: Record<string, string>;
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
