import {
  getMonitoringIntervalOptions,
  getMonitoringIntervalValue,
} from "../../Utils/MonitorIntervalDropdownOptions";
import ProbesAndIntervalCopy, {
  MONITORING_INTERVAL_TEST_ID,
} from "./ProbesAndIntervalCopy";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import SaveStatus, {
  SaveState,
} from "Common/UI/Components/SaveStatus/SaveStatus";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

export interface ComponentProps {
  monitorId: ObjectID;
  monitorType: MonitorType;
  // What the monitor has when the card first draws.
  initialInterval: string | null | undefined;
  // Told after a new interval is saved.
  onSaved?: ((interval: string) => void) | undefined;
}

/*
 * How often a monitor's probes check it, on its Probes & Interval page: one
 * dropdown that saves the moment a new interval is picked. It was a card of
 * its own page with an Edit button, whose dialog held this one dropdown.
 *
 * The dropdown offers what Create Monitor offers the type (no 1 or 2 minutes
 * for Synthetic, Custom Code and SSL monitors), plus whatever the monitor
 * has now, so a monitor already on an interval the list leaves out still
 * shows it (getMonitoringIntervalOptions).
 *
 * - "Saving…" and then "Saved" show beside it; a change the server refuses
 *   goes back to the interval the monitor has, with the reason under it.
 * - It is never locked while it saves, so keyboard focus stays on it: a
 *   second pick made before the first is saved is saved after it, and the
 *   last pick is what the monitor ends up with.
 * - Someone who may not change the monitor's interval sees it locked, with
 *   the permission that is missing.
 */
const MonitoringIntervalCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const errorId: string = `monitoring-interval-error-${useId()}`;

  const initialValue: string | undefined = getMonitoringIntervalValue(
    props.initialInterval,
  );

  // The interval the monitor has, as last read or saved.
  const [savedValue, setSavedValue] = useState<string | undefined>(
    initialValue,
  );
  // What the dropdown shows: the saved interval, or a pick being saved.
  const [selectedValue, setSelectedValue] = useState<string | undefined>(
    initialValue,
  );
  const [saveState, setSaveState] = useState<SaveState>(SaveState.Idle);
  const [error, setError] = useState<string>("");

  /*
   * Set at once, where the state above lands on the next render: whether a
   * save is on its way, what the monitor has, and a pick waiting its turn.
   */
  const isSavingRef: MutableRefObject<boolean> = useRef<boolean>(false);
  const savedValueRef: MutableRefObject<string | undefined> = useRef<
    string | undefined
  >(initialValue);
  const waitingPickRef: MutableRefObject<string | null> = useRef<string | null>(
    null,
  );

  const updateGate: PermissionGateResult = useMemo((): PermissionGateResult => {
    return PermissionGate.checkColumnUpdate(
      new Monitor(),
      "monitoringInterval",
    );
  }, []);

  /*
   * Built from the saved interval, not the pick, so an interval the list
   * would leave out stays on it only while the monitor has it.
   */
  const options: Array<DropdownOption> = useMemo((): Array<DropdownOption> => {
    return getMonitoringIntervalOptions({
      monitorType: props.monitorType,
      currentInterval: savedValue,
    });
  }, [props.monitorType, savedValue]);

  const selectedOption: DropdownOption | undefined = options.find(
    (option: DropdownOption): boolean => {
      return option.value === selectedValue;
    },
  );

  const saveUntilSettled: (value: string) => Promise<void> = async (
    value: string,
  ): Promise<void> => {
    isSavingRef.current = true;

    let next: string | null = value;

    while (next !== null) {
      const interval: string = next;

      if (interval === savedValueRef.current) {
        next = waitingPickRef.current;
        waitingPickRef.current = null;
        continue;
      }

      setSaveState(SaveState.Saving);

      try {
        await ModelAPI.updateById<Monitor>({
          modelType: Monitor,
          id: props.monitorId,
          data: {
            monitoringInterval: interval,
          },
        });

        savedValueRef.current = interval;
        setSavedValue(interval);
        setSaveState(SaveState.Saved);
        props.onSaved?.(interval);
      } catch (err) {
        // Back to what the monitor has, with the reason; a waiting pick is dropped.
        waitingPickRef.current = null;
        setSelectedValue(savedValueRef.current);
        setSaveState(SaveState.Idle);
        setError(API.getFriendlyMessage(err));
        break;
      }

      next = waitingPickRef.current;
      waitingPickRef.current = null;
    }

    isSavingRef.current = false;
  };

  const pick: (value: DropdownValue | Array<DropdownValue> | null) => void = (
    value: DropdownValue | Array<DropdownValue> | null,
  ): void => {
    if (typeof value !== "string" || !updateGate.isAllowed) {
      return;
    }

    setSelectedValue(value);
    setError("");

    if (isSavingRef.current) {
      waitingPickRef.current = value;
      return;
    }

    void saveUntilSettled(value);
  };

  const dropdown: ReactElement = (
    <div className="w-full sm:w-72">
      <Dropdown
        options={options}
        value={selectedOption}
        placeholder={ProbesAndIntervalCopy.intervalPlaceholder}
        ariaLabel={ProbesAndIntervalCopy.intervalLabel}
        isClearable={false}
        disabled={!updateGate.isAllowed}
        dataTestId={MONITORING_INTERVAL_TEST_ID}
        className="relative w-full overflow-visible rounded-md"
        onChange={pick}
      />
    </div>
  );

  return (
    <Card
      title={ProbesAndIntervalCopy.intervalCardTitle}
      description={ProbesAndIntervalCopy.intervalCardDescription}
    >
      {/*
       * A full-bleed row, ruled like the card's own header rule, as on the
       * Monitoring card's switch.
       */}
      <div
        className="-mx-5 -mb-6 border-t border-gray-200 md:-mx-6"
        data-testid={`${MONITORING_INTERVAL_TEST_ID}-card`}
      >
        <div className="px-5 py-4 md:px-6">
          <div
            className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4"
            data-testid={`${MONITORING_INTERVAL_TEST_ID}-row`}
          >
            {updateGate.isAllowed ? (
              dropdown
            ) : (
              <Tooltip text={updateGate.disabledReason}>{dropdown}</Tooltip>
            )}
            <SaveStatus
              state={saveState}
              dataTestId={`${MONITORING_INTERVAL_TEST_ID}-status`}
            />
          </div>
          {error ? (
            <p
              id={errorId}
              className="mt-2 text-sm text-red-600"
              role="alert"
              data-testid={`${MONITORING_INTERVAL_TEST_ID}-error`}
            >
              {error}
            </p>
          ) : (
            <></>
          )}
        </div>
      </div>
    </Card>
  );
};

export default MonitoringIntervalCard;
