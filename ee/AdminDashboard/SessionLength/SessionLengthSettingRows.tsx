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
import {
  saveSessionLengthChange,
  SessionLengthChange,
} from "./SessionLengthSettingsAPI";
import {
  SessionLengthColumn,
  SessionLengthKind,
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
 * A length's row reads as a form field does: what it sets, what the pick
 * means, then the dropdown, with "Saved" after it. So every dropdown on the
 * page starts at the same edge as the switch above them, and "Saved"
 * appearing never moves the dropdown or the words beside it.
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
  change: SessionLengthChange,
) => Promise<boolean>;

// What each of the page's cards (SessionLengthCard, SsoSignInsCard) is handed.
export interface SessionLengthCardProps {
  settings: SessionLengthSettings;
  isLocked: boolean;
  confirmChange: ConfirmSessionLengthChange;
  onSaved: (change: SessionLengthChange) => void;
}

export interface DropdownRowProps {
  column: SessionLengthColumn;
  kind: SessionLengthKind;
  // English, translated where it is drawn.
  label: string;
  /*
   * English, translated where it is drawn: what the row belongs to, named
   * before its label to a screen reader. SSO Sign-ins' rows repeat the
   * labels of the rows above, so without it two dropdowns on the page would
   * have one name.
   */
  nameContext?: string | undefined;
  // What the server holds now.
  initialValue: number | null;
  isLocked: boolean;
  confirmChange: ConfirmSessionLengthChange;
  onSaved: (change: SessionLengthChange) => void;
}

export const SessionLengthDropdownRow: FunctionComponent<DropdownRowProps> = (
  props: DropdownRowProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const labelId: string = `session-length-label-${useId()}`;
  const contextId: string = `session-length-context-${useId()}`;
  const descriptionId: string = `session-length-description-${useId()}`;
  const testId: string = getSessionLengthRowTestId(props.column);
  const isLength: boolean = props.kind === SessionLengthKind.Length;

  const setting: SaveOnChange<number | null> = useSaveOnChange<number | null>({
    initialValue: props.initialValue,
    save: async (value: number | null): Promise<void> => {
      await saveSessionLengthChange({ [props.column]: value });
    },
    onSaved: (value: number | null): void => {
      props.onSaved({ [props.column]: value });
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
      .confirmChange({ [props.column]: value })
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
      {/*
       * Hidden, yet part of the dropdown's name: the card's title already
       * says it to everyone reading the page.
       */}
      {props.nameContext ? (
        <span id={contextId} hidden data-testid={`${testId}-name-context`}>
          {translator.translateText(props.nameContext)}
        </span>
      ) : (
        <></>
      )}
      <span
        id={labelId}
        className="block text-sm font-medium text-gray-900"
        data-testid={`${testId}-label`}
      >
        {translator.translateText(props.label)}
      </span>
      <p
        id={descriptionId}
        className="mt-1 text-sm text-gray-500"
        data-testid={`${testId}-description`}
      >
        {translator.translateText(description)}
      </p>
      {/*
       * The dropdown, and "Saved" after it - on a phone under it, where the
       * dropdown takes the whole width.
       */}
      <div className="mt-3 flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-3">
        <div className="w-full sm:w-48" data-testid={`${testId}-dropdown`}>
          <Dropdown
            options={options}
            value={selectedOption}
            ariaLabelledby={
              props.nameContext ? `${contextId} ${labelId}` : labelId
            }
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
        <SaveStatus state={setting.saveState} dataTestId={`${testId}-status`} />
      </div>
      {setting.error ? (
        <p
          className="mt-2 text-sm text-red-600"
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
  /*
   * The lengths every sign-in has now: SSO sign-ins start at them when the
   * switch is turned on.
   */
  sessionLengthInMinutes: number | null;
  sessionIdleTimeoutInMinutes: number | null;
  isLocked: boolean;
  confirmChange: ConfirmSessionLengthChange;
  onSaved: (change: SessionLengthChange) => void;
}

export const SEPARATE_SSO_SWITCH_TEST_ID: string =
  "session-length-separate-sso";

/*
 * What flipping the switch writes. Turned on, SSO sign-ins start at the
 * lengths every sign-in has now, so turning it on signs nobody out and lets
 * nobody stay longer: until a different length is picked under it, SSO
 * sign-ins last as they did. (Their columns could hold lengths from an
 * earlier time it was on, or none - which would be No limit and 30 days.)
 * Turned off, SSO sign-ins follow the lengths above again, and their own
 * are left as they are, unused.
 */
export const getSeparateSsoChange: (
  isOn: boolean,
  lengths: Pick<
    SessionLengthSettings,
    "sessionLengthInMinutes" | "sessionIdleTimeoutInMinutes"
  >,
) => SessionLengthChange = (
  isOn: boolean,
  lengths: Pick<
    SessionLengthSettings,
    "sessionLengthInMinutes" | "sessionIdleTimeoutInMinutes"
  >,
): SessionLengthChange => {
  if (!isOn) {
    return { useSeparateSsoSessionLengths: false };
  }

  return {
    useSeparateSsoSessionLengths: true,
    ssoSessionLengthInMinutes: lengths.sessionLengthInMinutes,
    ssoSessionIdleTimeoutInMinutes: lengths.sessionIdleTimeoutInMinutes,
  };
};

export const SessionLengthSeparateSsoRow: FunctionComponent<SwitchRowProps> = (
  props: SwitchRowProps,
): ReactElement => {
  const getChange: (isOn: boolean) => SessionLengthChange = (
    isOn: boolean,
  ): SessionLengthChange => {
    return getSeparateSsoChange(isOn, {
      sessionLengthInMinutes: props.sessionLengthInMinutes,
      sessionIdleTimeoutInMinutes: props.sessionIdleTimeoutInMinutes,
    });
  };

  const setting: SaveOnChange<boolean> = useSaveOnChange<boolean>({
    initialValue: props.initialValue,
    save: async (value: boolean): Promise<void> => {
      await saveSessionLengthChange(getChange(value));
    },
    onSaved: (value: boolean): void => {
      props.onSaved(getChange(value));
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
              .confirmChange(getChange(value))
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
