import {
  CASE_SEVERITY_CHOICES,
  CASE_SEVERITY_NEVER,
} from "./SecurityEventConnectionFormModal";
import SecurityLogSource from "Common/Models/DatabaseModels/SecurityLogSource";
import ObjectID from "Common/Types/ObjectID";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import SaveStatus from "Common/UI/Components/SaveStatus/SaveStatus";
import useSaveOnChange, {
  SaveOnChange,
} from "Common/UI/Components/SaveStatus/useSaveOnChange";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useId, useMemo } from "react";

export const SECURITY_LOGS_CASE_SEVERITY_TEST_ID: string =
  "security-logs-case-severity";

// The dropdown's box: the card's width on a phone, 18rem from sm up.
export const SECURITY_LOGS_CASE_SEVERITY_DROPDOWN_CLASS_NAME: string =
  "w-full sm:w-[18rem]";

/*
 * Whole labels, each looked up on its own: a connection's, but for logs,
 * and short enough to read whole in the dropdown in every language - "Never
 * - keep them as events only" was cut after its second word in French and
 * Russian ("Jamais - les garder comme...").
 */
export const SECURITY_LOGS_CASE_SEVERITY_LABELS: Record<string, string> = {
  Critical: translationKey("Critical only"),
  High: translationKey("High and above"),
  Medium: translationKey("Medium and above"),
  Low: translationKey("Low and above"),
  [CASE_SEVERITY_NEVER]: translationKey("Never - events only"),
};

/*
 * What the dropdown is for, under it. The kinds it is about are the
 * Security devices group listed below it (CEF, LEEF and the firewalls' own
 * syslog), so it names them by that group rather than listing them again.
 */
export const SECURITY_LOGS_CASE_SEVERITY_DESCRIPTION: string = translationKey(
  "Threats your security devices report at or above this severity open security cases, grouped by user, host or address.",
);

/*
 * What the dropdown shows for what Your logs has: "Never" for the empty
 * value that opens no case, the value itself otherwise - an odd one written
 * through the API too, so the dropdown never claims a choice nobody saved.
 */
export function getYourLogsCaseSeverityChoice(
  stored: string | undefined | null,
): string {
  const value: string = (stored || "").trim();

  return value || CASE_SEVERITY_NEVER;
}

// What a choice writes: "Never" is the empty value.
export function getYourLogsCaseSeverityWrite(choice: string): string {
  return choice === CASE_SEVERITY_NEVER ? "" : choice;
}

export function getYourLogsCaseSeverityOptions(
  savedChoice: string,
): Array<DropdownOption> {
  const choices: Array<string> = CASE_SEVERITY_CHOICES.includes(savedChoice)
    ? CASE_SEVERITY_CHOICES
    : [...CASE_SEVERITY_CHOICES, savedChoice];

  return choices.map((choice: string): DropdownOption => {
    const label: string | undefined =
      SECURITY_LOGS_CASE_SEVERITY_LABELS[choice];

    return label
      ? { value: choice, label }
      : { value: choice, label: choice, isUserContent: true };
  });
}

export interface ComponentProps {
  sourceId: ObjectID;
  // What the column holds when the row first draws.
  initialValue: string | undefined | null;
}

/*
 * "Open cases from": the least severity at which a threat a security
 * product wrote in the logs - a firewall's or an IDS's, in CEF, LEEF or its
 * vendor's own syslog - opens a security case, as a connection's alerts do
 * (Server/Utils/SecurityCase/SecurityLogCases.ts). It saves the moment it
 * is picked, as the switch above it does: "Saving…" and "Saved" beside it,
 * a pick the server refuses goes back with the reason under it, and whoever
 * may not change it sees it locked and why.
 */
const SecurityLogsCaseSeverity: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const uniqueId: string = useId();
  const labelId: string = `security-logs-case-severity-label-${uniqueId}`;
  const descriptionId: string = `security-logs-case-severity-description-${uniqueId}`;

  const setting: SaveOnChange<string> = useSaveOnChange<string>({
    initialValue: getYourLogsCaseSeverityChoice(props.initialValue),
    save: async (choice: string): Promise<void> => {
      await ModelAPI.updateById<SecurityLogSource>({
        modelType: SecurityLogSource,
        id: props.sourceId,
        data: { caseMinimumSeverity: getYourLogsCaseSeverityWrite(choice) },
      });
    },
  });

  /*
   * Read on every render: the permissions arrive after the first paint of a
   * fresh sign-in, and a gate kept from then would leave it locked.
   */
  const model: SecurityLogSource = useMemo((): SecurityLogSource => {
    return new SecurityLogSource();
  }, []);
  const gate: PermissionGateResult = PermissionGate.checkColumnUpdate(
    model,
    "caseMinimumSeverity",
  );

  // Built from the saved choice, so an odd one stays only while Your logs has it.
  const options: Array<DropdownOption> = useMemo((): Array<DropdownOption> => {
    return getYourLogsCaseSeverityOptions(setting.savedValue);
  }, [setting.savedValue]);

  const selected: DropdownOption | undefined = options.find(
    (option: DropdownOption): boolean => {
      return option.value === setting.value;
    },
  );

  /*
   * Wide enough for every label on one line, in every language: 18rem
   * leaves about 225px for the value, and the longest, French's "Jamais -
   * événements seulement", is 213px in Inter. On a phone it takes the
   * card's width, under its label.
   */
  const dropdown: ReactElement = (
    <div
      className={SECURITY_LOGS_CASE_SEVERITY_DROPDOWN_CLASS_NAME}
      data-testid={SECURITY_LOGS_CASE_SEVERITY_TEST_ID}
    >
      <Dropdown
        options={options}
        value={selected}
        ariaLabelledby={labelId}
        ariaDescribedby={descriptionId}
        isClearable={false}
        disabled={!gate.isAllowed}
        className="relative w-full overflow-visible rounded-md"
        onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
          if (typeof value !== "string" || !gate.isAllowed) {
            return;
          }

          setting.change(value);
        }}
      />
    </div>
  );

  return (
    <div data-testid={`${SECURITY_LOGS_CASE_SEVERITY_TEST_ID}-row`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span id={labelId} className="text-sm font-medium text-gray-900">
          {translator.translateText("Open cases from")}
        </span>
        {gate.isAllowed ? (
          dropdown
        ) : (
          <Tooltip text={gate.disabledReason}>{dropdown}</Tooltip>
        )}
        <SaveStatus
          state={setting.saveState}
          dataTestId={`${SECURITY_LOGS_CASE_SEVERITY_TEST_ID}-status`}
        />
      </div>
      {/* As a switch's description reads on the same card. */}
      <p
        id={descriptionId}
        className="mt-1 text-sm text-gray-500"
        data-testid={`${SECURITY_LOGS_CASE_SEVERITY_TEST_ID}-description`}
      >
        {translator.translateText(SECURITY_LOGS_CASE_SEVERITY_DESCRIPTION)}
      </p>
      {setting.error ? (
        <p
          className="mt-1 text-sm text-red-600"
          role="alert"
          data-testid={`${SECURITY_LOGS_CASE_SEVERITY_TEST_ID}-error`}
        >
          {setting.error}
        </p>
      ) : (
        <></>
      )}
    </div>
  );
};

export default SecurityLogsCaseSeverity;
