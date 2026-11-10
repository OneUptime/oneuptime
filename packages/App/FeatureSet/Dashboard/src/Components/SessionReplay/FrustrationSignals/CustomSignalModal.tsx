import IconProp from "Common/Types/Icon/IconProp";
import {
  getSessionReplayCustomSignalMatchMaxLength,
  SESSION_REPLAY_MAX_CUSTOM_SIGNAL_NAME_LENGTH,
  SessionReplayCustomSignal,
  SessionReplayCustomSignalTrigger,
} from "Common/Types/Rum/SessionReplayFrustrationSignals";
import CardSelect, {
  CardSelectOption,
} from "Common/UI/Components/CardSelect/CardSelect";
import Input from "Common/UI/Components/Input/Input";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useId, useState } from "react";
import {
  ADD_SIGNAL_TITLE,
  COUNTS_AS_FRUSTRATION_OFF_COPY,
  COUNTS_AS_FRUSTRATION_ON_COPY,
  COUNTS_AS_FRUSTRATION_TITLE,
  CUSTOM_SIGNAL_TRIGGER_COPY,
  CUSTOM_SIGNAL_TRIGGERS,
  CustomSignalDraft,
  CustomSignalDraftProblems,
  EDIT_SIGNAL_TITLE,
  getCustomSignalDraftProblems,
  makeCustomSignalId,
  SAVE_SIGNAL_TEXT,
  SelectorCheck,
  SIGNAL_NAME_HINT,
  SIGNAL_NAME_LABEL,
  SIGNAL_NAME_PLACEHOLDER,
  SIGNAL_TRIGGER_LABEL,
} from "./FrustrationSignalsCopy";

/*
 * Adds a signal of the application's own, or changes one: its name, what
 * sets it off (a click, a page, an event from the page's code or an error),
 * the one thing that names it - a selector, a path, an event name or a
 * piece of an error's text, each asked for in its own words - and whether
 * it counts as frustration.
 *
 * What is typed for each kind is kept while another is looked at, so
 * picking Page and going back to Click does not lose a selector. Nothing is
 * said about a field until Save is pressed once; from then on each field
 * says what is wrong with it as it is typed in. The server checks again
 * (SessionReplayFrustrationSettingsValidation) and its reason, if it
 * refuses, is shown above the buttons.
 */

export interface ComponentProps {
  // The signal being changed, or null to add one.
  signal: SessionReplayCustomSignal | null;
  // The names of the application's other signals, which this one may not take.
  otherNames: Array<string>;
  // Resolves to null once saved, or the reason it was not.
  onSave: (signal: SessionReplayCustomSignal) => Promise<string | null>;
  onClose: () => void;
  // A test seam: the browser's own reading of a selector.
  acceptsSelector?: SelectorCheck | undefined;
}

export const TRIGGER_ICONS: Record<SessionReplayCustomSignalTrigger, IconProp> =
  {
    click: IconProp.CursorArrowRays,
    page: IconProp.Window,
    event: IconProp.Code,
    error: IconProp.Bug,
  };

/*
 * The box around each field: Input's own, 8px under the field's hint
 * rather than its 8px over and 4px under. "relative" is what holds the
 * error's icon inside the box: without it the icon sat at the dialog's
 * far edge, half way down the dialog.
 */
const FIELD_BOX_CLASS_NAME: string =
  "relative mt-2 w-full rounded-md shadow-sm";

type MatchTexts = Record<SessionReplayCustomSignalTrigger, string>;

function getStartingMatches(
  signal: SessionReplayCustomSignal | null,
): MatchTexts {
  const matches: MatchTexts = { click: "", page: "", event: "", error: "" };

  if (signal) {
    matches[signal.trigger] = signal.match;
  }

  return matches;
}

const CustomSignalModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const fieldId: string = useId();
  const nameId: string = `${fieldId}-name`;
  const nameHintId: string = `${fieldId}-name-hint`;
  const triggerLabelId: string = `${fieldId}-trigger`;
  const matchId: string = `${fieldId}-match`;
  const matchHintId: string = `${fieldId}-match-hint`;

  const [name, setName] = useState<string>(props.signal?.name ?? "");
  const [trigger, setTrigger] = useState<SessionReplayCustomSignalTrigger>(
    props.signal?.trigger ?? "click",
  );
  const [matches, setMatches] = useState<MatchTexts>(
    getStartingMatches(props.signal),
  );
  const [isFrustration, setIsFrustration] = useState<boolean>(
    props.signal?.isFrustration ?? true,
  );
  const [hasTriedToSave, setHasTriedToSave] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string>("");

  const draft: CustomSignalDraft = {
    name: name,
    trigger: trigger,
    match: matches[trigger],
    isFrustration: isFrustration,
  };

  const problems: CustomSignalDraftProblems = hasTriedToSave
    ? getCustomSignalDraftProblems(
        draft,
        props.otherNames,
        translator,
        props.acceptsSelector,
      )
    : { name: null, match: null };

  const triggerOptions: Array<CardSelectOption> = CUSTOM_SIGNAL_TRIGGERS.map(
    (value: SessionReplayCustomSignalTrigger): CardSelectOption => {
      return {
        value: value,
        title: CUSTOM_SIGNAL_TRIGGER_COPY[value].title,
        description: CUSTOM_SIGNAL_TRIGGER_COPY[value].description,
        icon: TRIGGER_ICONS[value],
      };
    },
  );

  const save: () => void = (): void => {
    if (isSaving) {
      return;
    }

    setHasTriedToSave(true);
    setSaveError("");

    const found: CustomSignalDraftProblems = getCustomSignalDraftProblems(
      draft,
      props.otherNames,
      translator,
      props.acceptsSelector,
    );

    if (found.name || found.match) {
      return;
    }

    const next: SessionReplayCustomSignal = {
      id: props.signal?.id || makeCustomSignalId(),
      name: draft.name.trim(),
      trigger: draft.trigger,
      match: draft.match.trim(),
      isFrustration: draft.isFrustration,
      isEnabled: props.signal ? props.signal.isEnabled : true,
    };

    setIsSaving(true);

    void props.onSave(next).then((problem: string | null): void => {
      setIsSaving(false);

      if (problem) {
        setSaveError(problem);
        return;
      }

      props.onClose();
    });
  };

  return (
    <Modal
      title={props.signal ? EDIT_SIGNAL_TITLE : ADD_SIGNAL_TITLE}
      submitButtonText={SAVE_SIGNAL_TEXT}
      modalWidth={ModalWidth.Medium}
      isLoading={isSaving}
      error={saveError || undefined}
      onSubmit={save}
      onClose={(): void => {
        if (!isSaving) {
          props.onClose();
        }
      }}
    >
      <div className="space-y-6" data-testid="custom-signal-form">
        <div>
          <label
            htmlFor={nameId}
            className="block text-sm font-medium text-gray-900"
          >
            {translator.translateText(SIGNAL_NAME_LABEL)}
          </label>
          <p id={nameHintId} className="mt-1 text-sm text-gray-500">
            {translator.translateText(SIGNAL_NAME_HINT)}
          </p>
          <Input
            id={nameId}
            value={name}
            placeholder={SIGNAL_NAME_PLACEHOLDER}
            maxLength={SESSION_REPLAY_MAX_CUSTOM_SIGNAL_NAME_LENGTH}
            outerDivClassName={FIELD_BOX_CLASS_NAME}
            ariaDescribedby={nameHintId}
            dataTestId="custom-signal-name"
            error={problems.name || undefined}
            onChange={(value: string): void => {
              setName(value);
            }}
            onEnterPress={save}
          />
        </div>

        <div>
          <p
            id={triggerLabelId}
            className="block text-sm font-medium text-gray-900"
          >
            {translator.translateText(SIGNAL_TRIGGER_LABEL)}
          </p>
          <div className="mt-2">
            <CardSelect
              options={triggerOptions}
              value={trigger}
              layout="list"
              ariaLabelledby={triggerLabelId}
              dataTestId="custom-signal-trigger"
              onChange={(value: string): void => {
                setTrigger(value as SessionReplayCustomSignalTrigger);
              }}
            />
          </div>
        </div>

        <div>
          <label
            htmlFor={matchId}
            className="block text-sm font-medium text-gray-900"
          >
            {translator.translateText(
              CUSTOM_SIGNAL_TRIGGER_COPY[trigger].matchLabel,
            )}
          </label>
          <p id={matchHintId} className="mt-1 text-sm text-gray-500">
            {translator.translateText(
              CUSTOM_SIGNAL_TRIGGER_COPY[trigger].matchHint,
            )}
          </p>
          <Input
            id={matchId}
            value={matches[trigger]}
            placeholder={CUSTOM_SIGNAL_TRIGGER_COPY[trigger].matchPlaceholder}
            maxLength={getSessionReplayCustomSignalMatchMaxLength(trigger)}
            outerDivClassName={FIELD_BOX_CLASS_NAME}
            ariaDescribedby={matchHintId}
            dataTestId="custom-signal-match"
            disableSpellCheck={true}
            error={problems.match || undefined}
            onChange={(value: string): void => {
              setMatches((current: MatchTexts): MatchTexts => {
                return { ...current, [trigger]: value };
              });
            }}
            onEnterPress={save}
          />
        </div>

        <Toggle
          title={COUNTS_AS_FRUSTRATION_TITLE}
          description={
            isFrustration
              ? COUNTS_AS_FRUSTRATION_ON_COPY
              : COUNTS_AS_FRUSTRATION_OFF_COPY
          }
          value={isFrustration}
          dataTestId="custom-signal-frustration"
          onChange={(value: boolean): void => {
            setIsFrustration(value);
          }}
        />
      </div>
    </Modal>
  );
};

export default CustomSignalModal;
