import SecurityCaseApi from "../SecurityCase/SecurityCaseApi";
import {
  DETECTION_RULE_AI_DRAFT_DESCRIPTION_MAX_LENGTH,
  DetectionRuleAiDraftCopy,
  canDraftDetectionRule,
} from "./DetectionRuleAiDraftCopy";
import useAiOffered from "../../Utils/UseAiOffered";
import IconProp from "Common/Types/Icon/IconProp";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import TextArea from "Common/UI/Components/TextArea/TextArea";
import API from "Common/UI/Utils/API/API";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useId, useState } from "react";

export const DETECTION_RULE_AI_DRAFT_TEST_ID: string =
  "detection-rule-ai-draft";

export interface ComponentProps {
  /*
   * Puts the drafted YAML into the form, the way typing it would: the rule
   * is named after its title (the field's onChange) and the form counts it
   * as the person's own edit.
   */
  onDraft: (sigmaRuleYaml: string) => void;
  // Whether the form already holds a rule the draft would replace.
  hasRule: boolean;
}

/*
 * DRAFT WITH AI, under the Detection Rules form's Sigma YAML: describe what
 * to catch in a sentence, and OneUptime AI writes the Sigma rule into the
 * form - checked as a saved rule is, so it is one the form will take - for
 * the person to read, change and save. Nothing is saved by drafting.
 *
 * One quiet button until it is wanted; open, a box for the description and
 * one action, with an x beside its question to put it away (the dialog has
 * its own Cancel). Not drawn with the project's AI off.
 */
const DetectionRuleAiDraft: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const isAiOffered: boolean = useAiOffered();
  const labelId: string = useId();
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [description, setDescription] = useState<string>("");
  const [isDrafting, setIsDrafting] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [didDraft, setDidDraft] = useState<boolean>(false);

  if (!isAiOffered) {
    return <></>;
  }

  const draft: () => Promise<void> = async (): Promise<void> => {
    if (!canDraftDetectionRule(description) || isDrafting) {
      return;
    }

    setIsDrafting(true);
    setError("");

    try {
      const result: { sigmaRuleYaml: string; title: string } =
        await SecurityCaseApi.draftDetectionRule(description.trim());

      if (!result.sigmaRuleYaml) {
        setError(
          translator.translateText(DetectionRuleAiDraftCopy.emptyDraft) || "",
        );
      } else {
        props.onDraft(result.sigmaRuleYaml);
        setDidDraft(true);
        setIsOpen(false);
      }
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsDrafting(false);
  };

  if (!isOpen) {
    return (
      <div
        className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1"
        data-testid={DETECTION_RULE_AI_DRAFT_TEST_ID}
      >
        <button
          type="button"
          data-testid="detection-rule-ai-draft-open"
          onClick={() => {
            setIsOpen(true);
          }}
          className="-ml-2.5 inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-gray-600 transition hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          <Icon icon={IconProp.Sparkles} className="h-4 w-4 text-violet-500" />
          <span>
            {translator.translateText(
              didDraft || props.hasRule
                ? DetectionRuleAiDraftCopy.openAgainButton
                : DetectionRuleAiDraftCopy.openButton,
            )}
          </span>
        </button>
        {didDraft ? (
          <span
            className="text-xs text-gray-500"
            role="status"
            data-testid="detection-rule-ai-draft-done"
          >
            {translator.translateText(DetectionRuleAiDraftCopy.drafted)}
          </span>
        ) : (
          <></>
        )}
      </div>
    );
  }

  return (
    <div
      className="mt-3 w-full space-y-2 border-t border-gray-100 pt-3"
      data-testid={DETECTION_RULE_AI_DRAFT_TEST_ID}
    >
      <div className="flex items-center justify-between gap-3">
        {/* The mark beside the label, not in it: Icon draws a div. */}
        <div className="flex min-w-0 items-center gap-1.5">
          <Icon
            icon={IconProp.Sparkles}
            className="h-4 w-4 flex-shrink-0 text-violet-500"
          />
          <label
            id={labelId}
            className="min-w-0 text-sm font-medium text-gray-900"
          >
            {translator.translateText(DetectionRuleAiDraftCopy.label)}
          </label>
        </div>
        <button
          type="button"
          aria-label={translator.translateText(
            DetectionRuleAiDraftCopy.closeButton,
          )}
          title={translator.translateText(DetectionRuleAiDraftCopy.closeButton)}
          disabled={isDrafting}
          onClick={() => {
            setIsOpen(false);
            setError("");
          }}
          data-testid="detection-rule-ai-draft-cancel"
          className="-my-1 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Icon icon={IconProp.Close} className="h-4 w-4" />
        </button>
      </div>
      <TextArea
        ariaLabelledby={labelId}
        value={description}
        autoGrow={true}
        rows={2}
        autoFocus={true}
        placeholder={DetectionRuleAiDraftCopy.placeholder}
        dataTestId="detection-rule-ai-draft-description"
        onChange={(value: string) => {
          setDescription(
            value.slice(0, DETECTION_RULE_AI_DRAFT_DESCRIPTION_MAX_LENGTH),
          );
        }}
      />
      {props.hasRule ? (
        <p className="text-xs text-gray-500">
          {translator.translateText(DetectionRuleAiDraftCopy.replaces)}
        </p>
      ) : (
        <></>
      )}
      {error ? (
        <p
          role="alert"
          className="break-words text-sm text-red-600"
          data-testid="detection-rule-ai-draft-error"
        >
          {error}
        </p>
      ) : (
        <></>
      )}
      <div>
        <Button
          title={DetectionRuleAiDraftCopy.draftButton}
          icon={IconProp.Sparkles}
          buttonStyle={ButtonStyleType.PRIMARY}
          buttonSize={ButtonSize.Small}
          className="!ml-0"
          isLoading={isDrafting}
          disabled={!canDraftDetectionRule(description) || isDrafting}
          onClick={() => {
            void draft();
          }}
          dataTestId="detection-rule-ai-draft-submit"
        />
      </div>
    </div>
  );
};

export default DetectionRuleAiDraft;
