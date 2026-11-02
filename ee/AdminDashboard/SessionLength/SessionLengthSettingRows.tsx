import SessionLengthCopy, {
  fromChoiceValue,
  getChoiceText,
  getIdleChoices,
  getIdleDescription,
  getLengthChoices,
  getLengthDescription,
  getSeparateDescription,
  getSessionLengthRowTestId,
  DEFAULT_CHOICE_VALUE,
  SessionLengthChoice,
  toIdleChoiceValue,
  toLengthChoiceValue,
} from "./SessionLengthCopy";
import { saveSessionLengthSetting } from "./SessionLengthSettingsAPI";
import {
  SessionLengthColumn,
  SessionLengthKind,
  SessionLengthSettingColumn,
  SessionLengthSettings,
} from "Common/Types/UserSession/SessionLength";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import SaveStatus from "Common/UI/Components/SaveStatus/SaveStatus";
import useSaveOnChange, {
  SaveOnChange,
} from "Common/UI/Components/SaveStatus/useSaveOnChange";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useId,
  useMemo,
  useState,
} from "react";

/*
 * The Session Length page's rows: a dropdown for each length, and the
 * switch that gives SSO sign-ins lengths of their own. Each saves the
 * moment it is picked (useSaveOnChange), with "Saving…" and then "Saved"
 * beside it, and a pick the server refuses goes back to what is set, with
 * the reason under it - as the status pages' Reader Sessions card does.
 *
 * Before a pick is saved the page is asked (confirmChange): a change that
 * signs people out at once - everyone already signed in, or idle, for
 * longer than it allows - is saved only once the master admin confirms it.
 * The row shows the pick while it is asked, and goes back if it is not
 * confirmed.
 *
 * While the license does not allow changing the lengths (isLocked), only
 * the default can be picked: what is set can always be removed.
 */

export type ConfirmSessionLengthChange = (
  column: SessionLengthSettingColumn,
  value: number | boolean | null,
) => Promise<boolean>;

// What each of the page's cards (SessionLengthCard, SsoSignInsCard) is handed.
export interface SessionLengthCardProps {
  settings: SessionLengthSettings;
  isLocked: boolean;
  confirmChange: ConfirmSessionLengthChange;
  onSaved: (
    column: SessionLengthSettingColumn,
    value: number | boolean | null,
  ) => void;
}

export interface DropdownRowProps {
  column: SessionLengthColumn;
  kind: SessionLengthKind;
  // English, translated where it is drawn.
  label: string;
  // What the server holds now.
  initialValue: number | null;
  isLocked: boolean;
  confirmChange: ConfirmSessionLengthChange;
  onSaved: (column: SessionLengthSettingColumn, value: number | null) => void;
}

export const SessionLengthDropdownRow: FunctionComponent<DropdownRowProps> = (
  props: DropdownRowProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const labelId: string = `session-length-label-${useId()}`;
  const descriptionId: string = `session-length-description-${useId()}`;
  const testId: string = getSessionLengthRowTestId(props.column);
  const isLength: boolean = props.kind === SessionLengthKind.Length;

  const setting: SaveOnChange<number | null> = useSaveOnChange<number | null>({
    initialValue: props.initialValue,
    save: async (value: number | null): Promise<void> => {
      await saveSessionLengthSetting(props.column, value);
    },
    onSaved: (value: number | null): void => {
      props.onSaved(props.column, value);
    },
  });

  // A pick waiting for the page to say whether it may be saved.
  const [pending, setPending] = useState<{ value: number | null } | null>(null);

  const shownValue: number | null = pending ? pending.value : setting.value;

  const toChoiceValue: (value: number | null) => number = isLength
    ? toLengthChoiceValue
    : toIdleChoiceValue;

  // Built from the saved value, so a length set elsewhere stays offered.
  const options: Array<DropdownOption> = useMemo((): Array<DropdownOption> => {
    const choices: Array<SessionLengthChoice> = isLength
      ? getLengthChoices(setting.savedValue)
      : getIdleChoices(setting.savedValue);
    const savedChoiceValue: number = toChoiceValue(setting.savedValue);

    return choices.map((choice: SessionLengthChoice): DropdownOption => {
      return {
        value: choice.value,
        label: getChoiceText(choice, translator),
        isInPageDirection: true,
        /*
         * Locked by the license: only the default, which removes what is
         * set - and what is set, which stays shown.
         */
        isDisabled:
          props.isLocked &&
          choice.value !== DEFAULT_CHOICE_VALUE &&
          choice.value !== savedChoiceValue,
      };
    });
  }, [setting.savedValue, translator, props.isLocked, isLength]);

  const selectedOption: DropdownOption | undefined = options.find(
    (option: DropdownOption): boolean => {
      return option.value === toChoiceValue(shownValue);
    },
  );

  const description: string = isLength
    ? getLengthDescription(shownValue)
    : getIdleDescription(shownValue);

  const pick: (value: number | null) => void = (value: number | null): void => {
    setPending({ value });

    props
      .confirmChange(props.column, value)
      .then((isConfirmed: boolean): void => {
        setPending(null);

        if (isConfirmed) {
          setting.change(value);
        }
      })
      .catch((): void => {
        setPending(null);
      });
  };

  return (
    <div data-testid={testId}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <span
          id={labelId}
          className="min-w-0 text-sm font-medium text-gray-900"
        >
          {translator.translateText(props.label)}
        </span>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="w-full sm:w-44" data-testid={`${testId}-dropdown`}>
            <Dropdown
              options={options}
              value={selectedOption}
              ariaLabelledby={labelId}
              ariaDescribedby={descriptionId}
              isClearable={false}
              className="relative w-full overflow-visible rounded-md"
              onChange={(
                value: DropdownValue | Array<DropdownValue> | null,
              ): void => {
                if (typeof value !== "number") {
                  return;
                }

                pick(fromChoiceValue(value));
              }}
            />
          </div>
          <SaveStatus
            state={setting.saveState}
            dataTestId={`${testId}-status`}
          />
        </div>
      </div>
      <p
        id={descriptionId}
        className="mt-1 text-sm text-gray-500"
        data-testid={`${testId}-description`}
      >
        {translator.translateText(description)}
      </p>
      {setting.error ? (
        <p
          className="mt-1 text-sm text-red-600"
          role="alert"
          data-testid={`${testId}-error`}
        >
          {setting.error}
        </p>
      ) : (
        <></>
      )}
    </div>
  );
};

export interface SwitchRowProps {
  initialValue: boolean;
  isLocked: boolean;
  confirmChange: ConfirmSessionLengthChange;
  onSaved: (column: SessionLengthSettingColumn, value: boolean) => void;
}

export const SEPARATE_SSO_SWITCH_TEST_ID: string =
  "session-length-separate-sso";

export const SessionLengthSeparateSsoRow: FunctionComponent<SwitchRowProps> = (
  props: SwitchRowProps,
): ReactElement => {
  const setting: SaveOnChange<boolean> = useSaveOnChange<boolean>({
    initialValue: props.initialValue,
    save: async (value: boolean): Promise<void> => {
      await saveSessionLengthSetting("useSeparateSsoSessionLengths", value);
    },
    onSaved: (value: boolean): void => {
      props.onSaved("useSeparateSsoSessionLengths", value);
    },
  });

  const [pending, setPending] = useState<{ value: boolean } | null>(null);
  const isOn: boolean = pending ? pending.value : setting.value;

  // Locked by the license, it can only be turned off.
  const isLocked: boolean = props.isLocked && !setting.savedValue;

  return (
    <div
      className="flex flex-col sm:flex-row sm:items-start sm:justify-between"
      data-testid={`${SEPARATE_SSO_SWITCH_TEST_ID}-row`}
    >
      <div className="min-w-0 flex-1">
        <Toggle
          title={SessionLengthCopy.separateTitle}
          description={getSeparateDescription(isOn)}
          value={isOn}
          disabled={isLocked}
          error={setting.error || undefined}
          dataTestId={SEPARATE_SSO_SWITCH_TEST_ID}
          onChange={(value: boolean): void => {
            if (isLocked) {
              return;
            }

            setPending({ value });

            props
              .confirmChange("useSeparateSsoSessionLengths", value)
              .then((isConfirmed: boolean): void => {
                setPending(null);

                if (isConfirmed) {
                  setting.change(value);
                }
              })
              .catch((): void => {
                setPending(null);
              });
          }}
        />
      </div>
      <SaveStatus
        state={setting.saveState}
        className="mt-1 ps-14 sm:mt-0 sm:ps-0 sm:ms-4"
        dataTestId={`${SEPARATE_SSO_SWITCH_TEST_ID}-status`}
      />
    </div>
  );
};
