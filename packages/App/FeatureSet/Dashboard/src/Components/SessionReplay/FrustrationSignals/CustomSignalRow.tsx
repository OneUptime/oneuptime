import { Yellow } from "Common/Types/BrandColors";
import IconProp from "Common/Types/Icon/IconProp";
import { SessionReplayCustomSignal } from "Common/Types/Rum/SessionReplayFrustrationSignals";
import ActionButtonSchema, {
  ActionButtonPlacement,
  RowActionConfirmation,
} from "Common/UI/Components/ActionButton/ActionButtonSchema";
import RowActions from "Common/UI/Components/ActionButton/RowActions";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Pill, { PillSize } from "Common/UI/Components/Pill/Pill";
import SaveStatus, {
  SaveState,
} from "Common/UI/Components/SaveStatus/SaveStatus";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useId, useState } from "react";
import {
  CUSTOM_SIGNAL_TRIGGER_COPY,
  CustomSignalTriggerCopy,
  DELETE_SIGNAL_DESCRIPTION,
  DELETE_SIGNAL_TEXT,
  DELETE_SIGNAL_TITLE,
  EDIT_SIGNAL_TEXT,
  FRUSTRATION_PILL_TEXT,
  MARKER_PILL_TEXT,
} from "./FrustrationSignalsCopy";

/*
 * One signal of the application's own: its name, whether it counts as
 * frustration or only marks the moment, what sets it off ("The page
 * /checkout/error"), its switch, and Edit and Delete in its ⋯ - so the row
 * stays one line of controls at phone width.
 *
 * The switch saves the moment it is flipped, as a built-in signal's does.
 * Delete asks first, in the row's own dialog (RowActions), and says that
 * sessions already recorded keep the signal's markers.
 */

export interface ComponentProps {
  signal: SessionReplayCustomSignal;
  canEdit: boolean;
  isSaving: boolean;
  // Resolves to null once saved, or the reason it was not.
  onSwitch: (isEnabled: boolean) => Promise<string | null>;
  onEdit: () => void;
  onDelete: () => Promise<string | null>;
}

const CustomSignalRow: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const nameId: string = useId();
  const testId: string = `custom-signal-${props.signal.id}`;

  const [pendingIsOn, setPendingIsOn] = useState<boolean | null>(null);
  const [switchState, setSwitchState] = useState<SaveState>(SaveState.Idle);
  const [switchError, setSwitchError] = useState<string>("");

  const isOn: boolean = pendingIsOn ?? props.signal.isEnabled;

  const flip: (value: boolean) => void = (value: boolean): void => {
    if (props.isSaving || !props.canEdit) {
      return;
    }

    setPendingIsOn(value);
    setSwitchError("");
    setSwitchState(SaveState.Saving);

    void props.onSwitch(value).then((problem: string | null): void => {
      setPendingIsOn(null);

      if (problem) {
        setSwitchError(problem);
        setSwitchState(SaveState.Idle);
        return;
      }

      setSwitchState(SaveState.Saved);
    });
  };

  const actions: Array<ActionButtonSchema<SessionReplayCustomSignal>> =
    props.canEdit
      ? [
          {
            title: EDIT_SIGNAL_TEXT,
            icon: IconProp.Edit,
            buttonStyleType: ButtonStyleType.NORMAL,
            placement: ActionButtonPlacement.MoreMenu,
            disabled: props.isSaving,
            onClick: (
              _signal: SessionReplayCustomSignal,
              onCompleteAction: () => void,
            ): void => {
              onCompleteAction();
              props.onEdit();
            },
          },
          {
            title: DELETE_SIGNAL_TEXT,
            icon: IconProp.Trash,
            buttonStyleType: ButtonStyleType.HOVER_DANGER_OUTLINE,
            placement: ActionButtonPlacement.MoreMenu,
            disabled: props.isSaving,
            getConfirmation: (
              signal: SessionReplayCustomSignal,
            ): RowActionConfirmation => {
              return {
                title: DELETE_SIGNAL_TITLE,
                description: translator.translateTemplate(
                  DELETE_SIGNAL_DESCRIPTION,
                  { name: signal.name },
                ),
                submitButtonText: DELETE_SIGNAL_TEXT,
                submitButtonType: ButtonStyleType.DANGER,
              };
            },
            onClick: (
              _signal: SessionReplayCustomSignal,
              onCompleteAction: () => void,
              onError: (error: Error) => void,
            ): void => {
              void props.onDelete().then((problem: string | null): void => {
                if (problem) {
                  onError(new Error(problem));
                  return;
                }

                onCompleteAction();
              });
            },
          },
        ]
      : [];

  const triggerCopy: CustomSignalTriggerCopy =
    CUSTOM_SIGNAL_TRIGGER_COPY[props.signal.trigger];

  return (
    <li className="py-4 first:pt-0 last:pb-0" data-testid={testId}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span
              id={nameId}
              className={`min-w-0 break-words text-sm font-semibold ${
                isOn ? "text-gray-900" : "text-gray-500"
              }`}
              data-testid={`${testId}-name`}
            >
              <bdi>{props.signal.name}</bdi>
            </span>
            <span data-testid={`${testId}-kind`}>
              {props.signal.isFrustration ? (
                <Pill
                  text={FRUSTRATION_PILL_TEXT}
                  color={Yellow}
                  size={PillSize.Small}
                />
              ) : (
                <Pill
                  text={MARKER_PILL_TEXT}
                  color={Yellow}
                  size={PillSize.Small}
                  isMinimal={true}
                />
              )}
            </span>
          </div>
          <p
            className={`mt-1 break-words text-sm ${
              isOn ? "text-gray-600" : "text-gray-500"
            }`}
            data-testid={`${testId}-trigger`}
          >
            <TranslatedSentence
              template={triggerCopy.rowTemplate}
              slots={{
                match: (
                  <code
                    dir="auto"
                    className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-800"
                  >
                    {props.signal.match}
                  </code>
                ),
              }}
            />
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <SaveStatus state={switchState} dataTestId={`${testId}-status`} />
          <Toggle
            value={isOn}
            disabled={!props.canEdit || props.isSaving}
            ariaLabelledby={nameId}
            dataTestId={`${testId}-switch`}
            onChange={(value: boolean): void => {
              if (value !== isOn) {
                flip(value);
              }
            }}
          />
          {actions.length > 0 && (
            <RowActions<SessionReplayCustomSignal>
              item={props.signal}
              actionButtons={actions}
              itemLabel={props.signal.name}
            />
          )}
        </div>
      </div>
      {switchError && (
        <p
          className="mt-2 text-sm text-red-700"
          role="alert"
          data-testid={`${testId}-error`}
        >
          {switchError}
        </p>
      )}
    </li>
  );
};

export default CustomSignalRow;
