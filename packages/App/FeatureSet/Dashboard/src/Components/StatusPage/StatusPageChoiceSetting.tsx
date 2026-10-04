import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import { Yellow } from "Common/Types/BrandColors";
import ObjectID from "Common/Types/ObjectID";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import Pill from "Common/UI/Components/Pill/Pill";
import SaveStatus from "Common/UI/Components/SaveStatus/SaveStatus";
import useSaveOnChange, {
  SaveOnChange,
} from "Common/UI/Components/SaveStatus/useSaveOnChange";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useId,
  useMemo,
} from "react";
import {
  DisplayChoiceColumn,
  DisplayChoiceDefinition,
  DisplayChoiceOption,
  getDisplayChoiceOptions,
  getDisplayChoiceWrite,
} from "./StatusPageDisplaySettingsCopy";
import { getPlanNeededToChange } from "./StatusPageSwitchRow";

/*
 * One pick from a short list for one of a status page's columns - how
 * precise the overall uptime percentage is - that saves the moment it is
 * picked, as the switches and number boxes beside it on the "What your
 * status page shows" card do. It sends its own column alone: the precision
 * used to share an Edit dialog with Show Overall Uptime Percent, and the
 * server refuses a write that carries the Scale plan's switch on a lower
 * plan, so the free precision could not be changed there at all.
 *
 * - "Saving…" and then "Saved" show beside it; a pick the server refuses
 *   goes back to what the page has, with the reason under it.
 * - It is never locked while it saves, so keyboard focus stays on it: a
 *   second pick made before the first is saved is saved after it, and the
 *   page ends up with the last one (useSaveOnChange).
 * - Someone who may not change the column sees it locked, with the
 *   permission that is missing; where a plan has to be upgraded to change
 *   it, the plan's name is beside it.
 */

export interface ComponentProps {
  statusPageId: ObjectID;
  definition: DisplayChoiceDefinition;
  // What the column holds when the row first draws.
  initialValue: string;
  // Told after a new pick is saved.
  onSaved?: ((value: string) => void) | undefined;
  /*
   * The dropdown's wrapper. The row is `${dataTestId}-row`, the "Saved"
   * status `${dataTestId}-status` and a refusal `${dataTestId}-error`.
   */
  dataTestId: string;
}

const StatusPageChoiceSetting: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const labelId: string = `choice-setting-label-${useId()}`;
  const column: DisplayChoiceColumn = props.definition.column;

  const setting: SaveOnChange<string> = useSaveOnChange<string>({
    initialValue: props.initialValue,
    save: async (value: string): Promise<void> => {
      await ModelAPI.updateById<StatusPage>({
        modelType: StatusPage,
        id: props.statusPageId,
        data: getDisplayChoiceWrite(column, value),
      });
    },
    onSaved: props.onSaved,
  });

  /*
   * Read on every render, as a settings switch does: the permissions arrive
   * after the first paint of a fresh sign-in, and a gate kept from then would
   * leave the dropdown locked for someone who may change it.
   */
  const statusPage: StatusPage = useMemo((): StatusPage => {
    return new StatusPage();
  }, []);

  const updateGate: PermissionGateResult = PermissionGate.checkColumnUpdate(
    statusPage,
    column,
  );

  const planNeeded: PlanType | null = getPlanNeededToChange(column);

  // Built from the saved value, so an odd one stays only while the page has it.
  const options: Array<DropdownOption> = useMemo((): Array<DropdownOption> => {
    return getDisplayChoiceOptions(props.definition, setting.savedValue).map(
      (option: DisplayChoiceOption): DropdownOption => {
        return { value: option.value, label: option.label };
      },
    );
  }, [props.definition, setting.savedValue]);

  const selectedOption: DropdownOption | undefined = options.find(
    (option: DropdownOption): boolean => {
      return option.value === setting.value;
    },
  );

  const dropdown: ReactElement = (
    <div className="w-32" data-testid={props.dataTestId}>
      <Dropdown
        options={options}
        value={selectedOption}
        ariaLabelledby={labelId}
        isClearable={false}
        disabled={!updateGate.isAllowed}
        className="relative w-full overflow-visible rounded-md"
        onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
          if (typeof value !== "string" || !updateGate.isAllowed) {
            return;
          }

          setting.change(value);
        }}
      />
    </div>
  );

  return (
    <div data-testid={`${props.dataTestId}-row`}>
      {/*
       * As on a switch's row: the plan's pill sits to the right from sm up,
       * and under the pick on a phone.
       */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2">
          <span id={labelId} className="text-sm text-gray-700">
            {translator.translateText(props.definition.label)}
          </span>
          {updateGate.isAllowed ? (
            dropdown
          ) : (
            <Tooltip text={updateGate.disabledReason}>{dropdown}</Tooltip>
          )}
          <SaveStatus
            state={setting.saveState}
            dataTestId={`${props.dataTestId}-status`}
          />
        </div>
        {planNeeded ? (
          <div className="flex-shrink-0">
            <Pill
              text={translator.translateTemplate("{{planName}} Plan", {
                planName: planNeeded,
              })}
              color={Yellow}
            />
          </div>
        ) : (
          <></>
        )}
      </div>
      {setting.error ? (
        <p
          className="mt-1 text-sm text-red-600"
          role="alert"
          data-testid={`${props.dataTestId}-error`}
        >
          {setting.error}
        </p>
      ) : (
        <></>
      )}
    </div>
  );
};

export default StatusPageChoiceSetting;
