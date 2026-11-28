import {
  POLICY_MOVE_BUTTON,
  POLICY_MOVE_BUTTON_UNCOUNTED,
  POLICY_MOVE_MONITORS,
  POLICY_MOVE_MONITORS_UNCOUNTED,
  POLICY_MOVE_TITLE,
  RULE_MOVE_BUTTON,
  RULE_MOVE_CHOICE_DESCRIPTIONS,
  RULE_MOVE_CHOICE_TITLES,
  RULE_MOVE_QUESTION,
  RULE_MOVE_TITLE,
  RULE_SAVE_WITHOUT_MOVING_BUTTON,
  RuleMoveChoice,
  SETTINGS_REPLACED,
  WHAT_STAYS,
} from "./MonitorTemplateChangeModel";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import RadioButtons from "Common/UI/Components/RadioButtons/GroupRadioButtons";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { ReactElement, useRef, useState } from "react";

/*
 * BEFORE A POLICY OR A RULE IS POINTED AT ANOTHER TEMPLATE, SAY WHAT HAPPENS
 * TO ITS MONITORS (issues #11452, #11451).
 *
 *   - A network alert policy's monitors move to the template it is pointed
 *     at: one question, which says what changes and what stays, with Move N
 *     Monitors and Save, or Cancel. There is no "don't move": a policy's
 *     monitors follow its template, and replacing them, the old way, lost
 *     their history.
 *   - An auto import rule's devices' monitors can move first (recommended),
 *     or stay where they are while the rule gives each device a second
 *     monitor from the new template: two choices, the first picked, the
 *     button saying which.
 *
 * Asked from a form's onBeforeUpdate, in a dialog over the form, as the drop
 * filter forms ask (useDropFilterImpactConfirmation): a "Cancel" answers
 * null or false, which the form's hook turns into FormSubmitCancelled.
 * One question at a time: a question still open is answered "Cancel".
 */

export interface PolicyMoveQuestion {
  // The template the policy is pointed at, as its name reads.
  templateName: string;
  // How many monitors the policy has; null when that could not be read.
  count: number | null;
}

export interface RuleMoveQuestion {
  templateName: string;
  // The template the rule uses now.
  oldTemplateName: string;
  // How many monitors the rule's devices have from it.
  count: number;
}

type PendingQuestion =
  | {
      kind: "policy";
      question: PolicyMoveQuestion;
      answer: (isConfirmed: boolean) => void;
    }
  | {
      kind: "rule";
      question: RuleMoveQuestion;
      answer: (choice: RuleMoveChoice | null) => void;
    };

export interface MonitorTemplateMoveConfirmation {
  // True to save and move them; false when the person called the save back.
  confirmPolicyMove: (question: PolicyMoveQuestion) => Promise<boolean>;
  // What to do with the rule's monitors; null when the save was called back.
  askRuleMove: (question: RuleMoveQuestion) => Promise<RuleMoveChoice | null>;
  // The dialog, drawn wherever the page puts it.
  confirmation: ReactElement;
}

export default function useMonitorTemplateMoveConfirmation(): MonitorTemplateMoveConfirmation {
  const translator: Translator = useTranslator();
  const [pending, setPending] = useState<PendingQuestion | null>(null);
  const pendingRef: React.MutableRefObject<PendingQuestion | null> =
    useRef<PendingQuestion | null>(null);
  const [ruleChoice, setRuleChoice] = useState<RuleMoveChoice>(
    RuleMoveChoice.MoveFirst,
  );

  // The open question answered "Cancel", so a new one can be asked.
  const dismissOpenQuestion: () => void = (): void => {
    const open: PendingQuestion | null = pendingRef.current;

    pendingRef.current = null;

    if (open?.kind === "policy") {
      open.answer(false);
    } else if (open?.kind === "rule") {
      open.answer(null);
    }
  };

  const ask: (question: PendingQuestion) => void = (
    question: PendingQuestion,
  ): void => {
    dismissOpenQuestion();
    pendingRef.current = question;
    setPending(question);
  };

  const close: () => void = (): void => {
    pendingRef.current = null;
    setPending(null);
  };

  const confirmPolicyMove: MonitorTemplateMoveConfirmation["confirmPolicyMove"] =
    (question: PolicyMoveQuestion): Promise<boolean> => {
      return new Promise<boolean>((resolve: (isConfirmed: boolean) => void) => {
        ask({ kind: "policy", question: question, answer: resolve });
      });
    };

  const askRuleMove: MonitorTemplateMoveConfirmation["askRuleMove"] = (
    question: RuleMoveQuestion,
  ): Promise<RuleMoveChoice | null> => {
    setRuleChoice(RuleMoveChoice.MoveFirst);

    return new Promise<RuleMoveChoice | null>(
      (resolve: (choice: RuleMoveChoice | null) => void) => {
        ask({ kind: "rule", question: question, answer: resolve });
      },
    );
  };

  let confirmation: ReactElement = <></>;

  if (pending?.kind === "policy") {
    const question: PolicyMoveQuestion = pending.question;
    // Said of many when how many could not be read.
    const pluralCount: number = question.count ?? 2;
    const lines: Array<string> = [
      question.count === null
        ? translator.translateTemplate(POLICY_MOVE_MONITORS_UNCOUNTED, {
            templateName: question.templateName,
          })
        : translator.translatePlural(POLICY_MOVE_MONITORS, question.count, {
            count: translator.formatNumber(question.count),
            templateName: question.templateName,
          }),
      translator.translatePlural(SETTINGS_REPLACED, pluralCount),
      translator.translatePlural(WHAT_STAYS, pluralCount),
    ];

    confirmation = (
      <ConfirmModal
        title={translator.translateTemplate(POLICY_MOVE_TITLE, {
          templateName: question.templateName,
        })}
        isTitleTranslated={true}
        description={
          <ul
            className="list-disc space-y-1 ps-5 text-sm text-gray-600"
            data-testid="policy-template-move-confirmation"
          >
            {lines.map((line: string, index: number) => {
              return <li key={index}>{line}</li>;
            })}
          </ul>
        }
        submitButtonText={
          question.count === null
            ? POLICY_MOVE_BUTTON_UNCOUNTED
            : translator.translatePlural(POLICY_MOVE_BUTTON, question.count, {
                count: translator.formatNumber(question.count),
              })
        }
        submitButtonType={ButtonStyleType.PRIMARY}
        onSubmit={() => {
          const answer: (isConfirmed: boolean) => void = pending.answer;
          close();
          answer(true);
        }}
        onClose={() => {
          const answer: (isConfirmed: boolean) => void = pending.answer;
          close();
          answer(false);
        }}
      />
    );
  }

  if (pending?.kind === "rule") {
    const question: RuleMoveQuestion = pending.question;
    const values: Record<string, string> = {
      templateName: question.templateName,
      oldTemplateName: question.oldTemplateName,
    };

    confirmation = (
      <Modal
        title={translator.translateTemplate(RULE_MOVE_TITLE, values)}
        isTitleTranslated={true}
        modalWidth={ModalWidth.Medium}
        submitButtonText={
          ruleChoice === RuleMoveChoice.MoveFirst
            ? translator.translatePlural(RULE_MOVE_BUTTON, question.count, {
                count: translator.formatNumber(question.count),
              })
            : RULE_SAVE_WITHOUT_MOVING_BUTTON
        }
        submitButtonStyleType={ButtonStyleType.PRIMARY}
        onSubmit={() => {
          const answer: (choice: RuleMoveChoice | null) => void =
            pending.answer;
          close();
          answer(ruleChoice);
        }}
        onClose={() => {
          const answer: (choice: RuleMoveChoice | null) => void =
            pending.answer;
          close();
          answer(null);
        }}
      >
        <div className="space-y-4" data-testid="rule-template-move-question">
          <p className="text-sm text-gray-600">
            {translator.translatePlural(RULE_MOVE_QUESTION, question.count, {
              count: translator.formatNumber(question.count),
              oldTemplateName: question.oldTemplateName,
            })}
          </p>
          <RadioButtons
            dataTestId="rule-template-move-choice"
            initialValue={RuleMoveChoice.MoveFirst}
            onChange={(value: string) => {
              setRuleChoice(
                value === RuleMoveChoice.Leave
                  ? RuleMoveChoice.Leave
                  : RuleMoveChoice.MoveFirst,
              );
            }}
            options={[RuleMoveChoice.MoveFirst, RuleMoveChoice.Leave].map(
              (choice: RuleMoveChoice) => {
                return {
                  value: choice,
                  title: translator.translateTemplate(
                    RULE_MOVE_CHOICE_TITLES[choice],
                    values,
                  ),
                  description: translator.translateTemplate(
                    RULE_MOVE_CHOICE_DESCRIPTIONS[choice],
                    values,
                  ),
                };
              },
            )}
          />
        </div>
      </Modal>
    );
  }

  return {
    confirmPolicyMove: confirmPolicyMove,
    askRuleMove: askRuleMove,
    confirmation: confirmation,
  };
}
