import Monitor from "Common/Models/DatabaseModels/Monitor";
import IconProp from "Common/Types/Icon/IconProp";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import {
  hasVMwareLegacySwapMonitorSteps,
  updateVMwareLegacySwapMonitorSteps,
} from "Common/Types/Monitor/VMwareLegacySwapMonitors";
import ObjectID from "Common/Types/ObjectID";
import AlertBanner, {
  AlertBannerType,
} from "Common/UI/Components/AlertBanner/AlertBanner";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import Toast from "Common/UI/Utils/Toast";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";

/*
 * A VMware monitor that fires on any memory in the host's swap file (#11468),
 * made from the VM Memory Swapping or Resource Pool Memory Swapped template
 * before it read the swap-out rate, or written by hand the same way. ESXi
 * keeps a swapped page until the guest touches it, so such a monitor pages
 * for weeks after the memory pressure has gone. Nobody's alert is changed
 * behind their back: this banner, at the top of the monitor's Overview and
 * Criteria, says what it fires on and offers the update, which changes only
 * the metric it reads (VMwareLegacySwapMonitors). Someone who may not edit
 * the monitor sees the button locked, with why.
 *
 * It reads its own monitor, as DependencySuppressionWarning does, so a page
 * drops it in with the monitor's id. A failed read draws nothing.
 */

export const VMWARE_LEGACY_SWAP_NOTICE_TEST_ID: string =
  "vmware-legacy-swap-monitor-notice";
export const VMWARE_LEGACY_SWAP_UPDATE_BUTTON_TEST_ID: string =
  "vmware-legacy-swap-monitor-update";

export const VMWARE_LEGACY_SWAP_NOTICE_TITLE: string = translationKey(
  "This monitor fires on swapped memory left from earlier",
);
export const VMWARE_LEGACY_SWAP_NOTICE_TEXT: string = translationKey(
  "It fires on any memory in the host's swap file, which ESXi keeps for weeks after memory pressure has gone. Update it to fire only while the host is swapping memory out now.",
);
export const VMWARE_LEGACY_SWAP_UPDATE_BUTTON: string = translationKey(
  "Update to Swapping Now",
);
export const VMWARE_LEGACY_SWAP_CONFIRM_TITLE: string = translationKey(
  "Update this monitor to swapping now?",
);
export const VMWARE_LEGACY_SWAP_CONFIRM_TEXT: string = translationKey(
  "It will read how fast the host swaps memory out, instead of how much memory sits in the swap file. Its thresholds, incidents, alerts and who is told stay as they are.",
);
export const VMWARE_LEGACY_SWAP_CONFIRM_BUTTON: string =
  translationKey("Update Monitor");
export const VMWARE_LEGACY_SWAP_UPDATED: string = translationKey(
  "Monitor updated to fire on swapping now",
);

export interface ComponentProps {
  monitorId: ObjectID;
  // Bump to read the monitor again, as when its criteria were saved.
  refreshToggle?: string | undefined;
  // Told once the monitor was updated, to read it again.
  onUpdated?: (() => void) | undefined;
}

const VMwareLegacySwapMonitorNotice: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [monitorSteps, setMonitorSteps] = useState<MonitorSteps | null>(null);
  const [isConfirming, setIsConfirming] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [updatedCount, setUpdatedCount] = useState<number>(0);

  const monitorIdString: string = props.monitorId.toString();

  const gate: PermissionGateResult = useMemo((): PermissionGateResult => {
    return PermissionGate.checkColumnUpdate(new Monitor(), "monitorSteps");
  }, []);

  useEffect(() => {
    let cancelled: boolean = false;

    const read: () => Promise<void> = async (): Promise<void> => {
      try {
        const monitor: Monitor | null = await ModelAPI.getItem<Monitor>({
          modelType: Monitor,
          id: props.monitorId,
          select: {
            monitorType: true,
            monitorSteps: true,
          },
        });

        if (cancelled) {
          return;
        }

        setMonitorSteps(
          monitor?.monitorType === MonitorType.VMware && monitor.monitorSteps
            ? MonitorSteps.fromJSON(
                monitor.monitorSteps as unknown as MonitorSteps,
              )
            : null,
        );
      } catch {
        // Advisory only: a failed read draws nothing.
        if (!cancelled) {
          setMonitorSteps(null);
        }
      }
    };

    read().catch(() => {
      // read() answers its own failures.
    });

    return () => {
      cancelled = true;
    };
  }, [monitorIdString, props.refreshToggle, updatedCount]);

  if (!monitorSteps || !hasVMwareLegacySwapMonitorSteps(monitorSteps)) {
    return <></>;
  }

  const update: () => Promise<void> = async (): Promise<void> => {
    setIsSaving(true);
    setError("");

    try {
      await ModelAPI.updateById<Monitor>({
        modelType: Monitor,
        id: props.monitorId,
        data: {
          monitorSteps: updateVMwareLegacySwapMonitorSteps(monitorSteps),
        },
      });

      setIsConfirming(false);
      Toast.success(
        translator.translateText(VMWARE_LEGACY_SWAP_UPDATED) ||
          VMWARE_LEGACY_SWAP_UPDATED,
      );
      setUpdatedCount((count: number): number => {
        return count + 1;
      });
      props.onUpdated?.();
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

  const showButton: boolean = gate.isAllowed || Boolean(gate.disabledReason);

  return (
    <>
      <AlertBanner
        type={AlertBannerType.Warning}
        icon={IconProp.Alert}
        title={VMWARE_LEGACY_SWAP_NOTICE_TITLE}
        dataTestId={VMWARE_LEGACY_SWAP_NOTICE_TEST_ID}
        rightElement={
          showButton ? (
            <Button
              title={VMWARE_LEGACY_SWAP_UPDATE_BUTTON}
              icon={IconProp.Refresh}
              buttonStyle={ButtonStyleType.NORMAL}
              buttonSize={ButtonSize.Small}
              dataTestId={VMWARE_LEGACY_SWAP_UPDATE_BUTTON_TEST_ID}
              disabled={!gate.isAllowed}
              tooltip={gate.disabledReason}
              onClick={() => {
                setError("");
                setIsConfirming(true);
              }}
            />
          ) : undefined
        }
      >
        <p>{translator.translateText(VMWARE_LEGACY_SWAP_NOTICE_TEXT)}</p>
      </AlertBanner>

      {isConfirming ? (
        <ConfirmModal
          title={VMWARE_LEGACY_SWAP_CONFIRM_TITLE}
          // The dialog says it in the reader's words itself.
          description={VMWARE_LEGACY_SWAP_CONFIRM_TEXT}
          submitButtonText={VMWARE_LEGACY_SWAP_CONFIRM_BUTTON}
          isLoading={isSaving}
          error={error || undefined}
          onClose={() => {
            setIsConfirming(false);
            setError("");
          }}
          onSubmit={() => {
            update().catch(() => {
              // update() answers its own failures.
            });
          }}
        />
      ) : (
        <></>
      )}
    </>
  );
};

export default VMwareLegacySwapMonitorNotice;
