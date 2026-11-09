import Monitor from "Common/Models/DatabaseModels/Monitor";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import API from "Common/UI/Utils/API/API";
import PermissionGate, {
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import MonitorGroupMonitoring, {
  MonitorGroupMonitoringState,
  MonitorGroupMonitoringSummary,
} from "Common/Utils/Monitor/MonitorGroupMonitoring";
import { MONITORING_SWITCH_COLUMN } from "../Monitor/MonitoringSwitchCopy";
import { setMonitorGroupMonitoring } from "./MonitorGroupMonitoringAPI";
import MonitorGroupMonitoringCopy, {
  MONITOR_GROUP_MONITORING_CARD_TEST_ID,
  MONITOR_GROUP_MONITORING_ERROR_TEST_ID,
  MONITOR_GROUP_MONITORING_STATE_TEST_ID,
  MONITOR_GROUP_TURN_MONITORING_OFF_TEST_ID,
  MONITOR_GROUP_TURN_MONITORING_ON_TEST_ID,
} from "./MonitorGroupMonitoringCopy";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useMemo,
  useRef,
  useState,
} from "react";

/*
 * "Monitoring", on a monitor group's Overview (issue #6401): how many of the
 * group's monitors are checked, with Turn off monitoring and Turn
 * monitoring on for every one of them at once (MonitorGroupMonitoringCopy).
 *
 * The buttons show what can be done: Turn off monitoring while any monitor
 * is checked, Turn monitoring on while any is not - both while the group is
 * mixed. Turning it off asks first, in the words a monitor's own switch
 * uses; turning it on saves at once. Gated on the column a monitor's switch
 * writes: someone who could not flip that switch sees the buttons locked,
 * with why.
 *
 * The page holds the summary and hands it in, so its Current Status reads
 * the same counts; the card tells it the group's monitors as they are once
 * the switch is turned (onChange).
 */

export interface ComponentProps {
  monitorGroupId: ObjectID;
  summary: MonitorGroupMonitoringSummary;
  onChange: (summary: MonitorGroupMonitoringSummary) => void;
}

// What the card says about the group's monitors, in the reader's language.
export const getMonitorGroupMonitoringLine: (
  summary: MonitorGroupMonitoringSummary,
  translator: Translator,
) => string = (
  summary: MonitorGroupMonitoringSummary,
  translator: Translator,
): string => {
  const translate: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };

  switch (MonitorGroupMonitoring.getState(summary)) {
    case MonitorGroupMonitoringState.Off:
      return translate(MonitorGroupMonitoringCopy.offLine);
    case MonitorGroupMonitoringState.Mixed:
      return translator.translateTemplate(
        MonitorGroupMonitoringCopy.mixedLine,
        {
          off: summary.monitoringOffCount,
          total: summary.monitorCount,
        },
      );
    default:
      return translate(MonitorGroupMonitoringCopy.onLine);
  }
};

type Saving = "on" | "off" | null;

const MonitorGroupMonitoringCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const [isConfirmingOff, setIsConfirmingOff] = useState<boolean>(false);
  const [saving, setSaving] = useState<Saving>(null);
  // Why turning monitoring on failed: said on the card.
  const [error, setError] = useState<string>("");
  // Why turning it off failed: said in the dialog that asked.
  const [confirmError, setConfirmError] = useState<string>("");

  // Set at once: two presses before the button locks must not save twice.
  const isSavingRef: MutableRefObject<boolean> = useRef<boolean>(false);

  const monitor: Monitor = useMemo((): Monitor => {
    return new Monitor();
  }, []);

  const gate: PermissionGateResult = PermissionGate.checkColumnUpdate(
    monitor,
    MONITORING_SWITCH_COLUMN,
  );

  const state: MonitorGroupMonitoringState = MonitorGroupMonitoring.getState(
    props.summary,
  );

  const turn: (isMonitoringOn: boolean) => Promise<void> = async (
    isMonitoringOn: boolean,
  ): Promise<void> => {
    if (isSavingRef.current || !gate.isAllowed) {
      return;
    }

    isSavingRef.current = true;
    setSaving(isMonitoringOn ? "on" : "off");
    setError("");
    setConfirmError("");

    try {
      const summary: MonitorGroupMonitoringSummary =
        await setMonitorGroupMonitoring({
          monitorGroupId: props.monitorGroupId,
          isMonitoringOn: isMonitoringOn,
        });

      setIsConfirmingOff(false);
      props.onChange(summary);
    } catch (err) {
      const message: string = API.getFriendlyMessage(err);
      const translated: string = translator.translateText(message) || message;

      if (isMonitoringOn) {
        setError(translated);
      } else {
        setConfirmError(translated);
      }
    }

    isSavingRef.current = false;
    setSaving(null);
  };

  /*
   * Hidden only while there is nothing honest to say about the buttons:
   * the permission snapshot has not arrived yet (PermissionGate).
   */
  const showButtons: boolean = gate.isAllowed || Boolean(gate.disabledReason);

  const buttons: Array<ReactElement> = [];

  if (showButtons && state !== MonitorGroupMonitoringState.On) {
    buttons.push(
      <Button
        key="turn-monitoring-on"
        title={MonitorGroupMonitoringCopy.turnOnButton}
        icon={IconProp.Play}
        buttonStyle={ButtonStyleType.NORMAL}
        buttonSize={ButtonSize.Small}
        dataTestId={MONITOR_GROUP_TURN_MONITORING_ON_TEST_ID}
        isLoading={saving === "on"}
        disabled={!gate.isAllowed || saving !== null}
        tooltip={gate.disabledReason}
        onClick={() => {
          void turn(true);
        }}
      />,
    );
  }

  if (showButtons && state !== MonitorGroupMonitoringState.Off) {
    buttons.push(
      <Button
        key="turn-monitoring-off"
        title={MonitorGroupMonitoringCopy.turnOffButton}
        icon={IconProp.Pause}
        buttonStyle={ButtonStyleType.NORMAL}
        buttonSize={ButtonSize.Small}
        dataTestId={MONITOR_GROUP_TURN_MONITORING_OFF_TEST_ID}
        disabled={!gate.isAllowed || saving !== null}
        tooltip={gate.disabledReason}
        onClick={() => {
          setError("");
          setConfirmError("");
          setIsConfirmingOff(true);
        }}
      />,
    );
  }

  return (
    <>
      <Card
        title={MonitorGroupMonitoringCopy.cardTitle}
        description={MonitorGroupMonitoringCopy.cardDescription}
        buttons={buttons}
      >
        <div data-testid={MONITOR_GROUP_MONITORING_CARD_TEST_ID}>
          <p
            className="text-sm text-gray-700"
            data-testid={MONITOR_GROUP_MONITORING_STATE_TEST_ID}
          >
            {getMonitorGroupMonitoringLine(props.summary, translator)}
          </p>
          {error ? (
            <p
              className="mt-2 text-sm text-red-600"
              role="alert"
              data-testid={MONITOR_GROUP_MONITORING_ERROR_TEST_ID}
            >
              {error}
            </p>
          ) : (
            <></>
          )}
        </div>
      </Card>

      {isConfirmingOff ? (
        <ConfirmModal
          title={MonitorGroupMonitoringCopy.turnOffConfirmTitle}
          description={MonitorGroupMonitoringCopy.turnOffConfirmDescription}
          submitButtonText={MonitorGroupMonitoringCopy.turnOffButton}
          submitButtonType={ButtonStyleType.DANGER}
          isLoading={saving === "off"}
          error={confirmError || undefined}
          onSubmit={() => {
            void turn(false);
          }}
          onClose={() => {
            if (isSavingRef.current) {
              return;
            }

            setIsConfirmingOff(false);
            setConfirmError("");
          }}
        />
      ) : (
        <></>
      )}
    </>
  );
};

export default MonitorGroupMonitoringCard;
