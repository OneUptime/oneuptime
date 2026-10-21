import Monitor from "Common/Models/DatabaseModels/Monitor";
import ObjectID from "Common/Types/ObjectID";
import { announceModelSwitchSaved } from "Common/UI/Components/ModelSwitch/ModelSwitchEvents";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import {
  MutableRefObject,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import { MONITORING_SWITCH_COLUMN } from "./MonitoringSwitchCopy";

/*
 * "Turn monitoring on", wherever a turned-off monitor says so: the banner on
 * its pages and the hero on its overview. It writes what the Monitoring
 * card's switch on the Settings page writes (disableActiveMonitoring:
 * false) and tells that switch, and any banner on the screen, through
 * ModelSwitchEvents - so they all move together.
 *
 * Gated on the column the way the switch is (PermissionGate.
 * checkColumnUpdate): someone who could not flip the switch gets a locked
 * button that says which permission is missing, not a save the server
 * refuses.
 *
 * What it is doing, and why a press failed, belong to the monitor it was
 * pressed for: the page stays mounted when the reader follows a link to
 * another monitor, and that one's banner must not show the first one's
 * error or spinner.
 */

export interface TurnMonitoringOn {
  // Whether the button can be pressed, and if not, why.
  gate: PermissionGateResult;
  isSaving: boolean;
  // Why the last press did not turn it on, or "".
  error: string;
  turnOn: () => void;
}

interface ForMonitor {
  monitorId: string;
  message: string;
}

const useTurnMonitoringOn: (data: {
  monitorId: ObjectID;
  // Told after monitoring is on, to read the monitor again.
  onTurnedOn?: (() => void) | undefined;
}) => TurnMonitoringOn = (data: {
  monitorId: ObjectID;
  onTurnedOn?: (() => void) | undefined;
}): TurnMonitoringOn => {
  // The monitor a save is out for, if any.
  const [savingFor, setSavingFor] = useState<string | null>(null);
  const [failure, setFailure] = useState<ForMonitor | null>(null);

  // Set at once: two presses before the button locks must not save twice.
  const isSavingRef: MutableRefObject<boolean> = useRef<boolean>(false);

  const onTurnedOnRef: MutableRefObject<(() => void) | undefined> = useRef<
    (() => void) | undefined
  >(data.onTurnedOn);
  onTurnedOnRef.current = data.onTurnedOn;

  const monitorIdString: string = data.monitorId.toString();

  const monitor: Monitor = useMemo((): Monitor => {
    return new Monitor();
  }, []);

  const gate: PermissionGateResult = PermissionGate.checkColumnUpdate(
    monitor,
    MONITORING_SWITCH_COLUMN,
  );

  const turnOn: () => void = useCallback((): void => {
    if (isSavingRef.current || !gate.isAllowed) {
      return;
    }

    isSavingRef.current = true;
    setSavingFor(monitorIdString);
    setFailure(null);

    const monitorId: ObjectID = new ObjectID(monitorIdString);

    const save: () => Promise<void> = async (): Promise<void> => {
      try {
        await ModelAPI.updateById<Monitor>({
          modelType: Monitor,
          id: monitorId,
          data: {
            [MONITORING_SWITCH_COLUMN]: false,
          },
        });

        announceModelSwitchSaved({
          modelType: Monitor,
          modelId: monitorId,
          column: MONITORING_SWITCH_COLUMN,
          value: false,
        });

        onTurnedOnRef.current?.();
      } catch (err) {
        setFailure({
          monitorId: monitorIdString,
          message: API.getFriendlyMessage(err),
        });
      }

      isSavingRef.current = false;
      setSavingFor(null);
    };

    void save();
  }, [monitorIdString, gate.isAllowed]);

  return {
    gate,
    isSaving: savingFor === monitorIdString,
    error: failure?.monitorId === monitorIdString ? failure.message : "",
    turnOn,
  };
};

export default useTurnMonitoringOn;
