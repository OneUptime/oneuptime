import { SWITCH_TO_PROBE_POLLING_ACTION_TITLE } from "./useBulkSwitchToProbePolling";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import Query from "Common/Types/BaseDatabase/Query";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import NetworkDeviceMonitoringMethod from "Common/Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import ObjectID from "Common/Types/ObjectID";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

export interface ComponentProps {
  /*
   * Fired when the operator asks to see the devices. The page owns the facet
   * bar, so the page is what narrows the list — to Status: Pending, which
   * every unbound device is in (each wearing its "No monitor" pill), and
   * which is the closest chip to "monitor-backed with nothing bound" that
   * exists: no chip owns `monitorId`, and inventing one for a banner would
   * be a second, invisible filter of the kind the facet bar was built to
   * remove.
   */
  onShowUnboundDevices: () => void;
}

/*
 * "N devices have no monitor bound and are never polled."
 *
 * The devices this counts are the ones the old SNMP-first model left behind:
 * monitor-backed (so no probe polls them) with nothing bound (so nothing
 * reports on them either). They read Pending / "No monitor" forever, and
 * with ping-first polling there is no longer any reason for most of them to
 * be monitor-backed at all — a probe would ping them. There is deliberately
 * no migration switching them over (only an operator knows which probe can
 * reach them), so this banner is how the operator finds out they exist and
 * where the bulk action that fixes them is.
 *
 * One COUNT request, no rows: the number is all the banner needs, and a list
 * fetch to get it would be the "download the fleet to render an integer"
 * mistake the summary endpoints were built to remove. Dismissal is for this
 * visit only — the count is the truth, and it changes as devices are
 * switched, so a remembered dismissal would hide a number that has since
 * gone up.
 */
const UnboundDevicesBanner: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [unboundCount, setUnboundCount] = useState<number>(0);
  const [isDismissed, setIsDismissed] = useState<boolean>(false);

  const fetchCount: PromiseVoidFunction = async (): Promise<void> => {
    /*
     * Same guard as the bulk hooks: `projectId: null` is not "every project",
     * it is a filter nothing matches, so the banner would silently count zero
     * and never show.
     */
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!projectId) {
      return;
    }

    try {
      /*
       * Archived devices are left out, matching the list below: a device the
       * operator has already taken off the list is not one they are being
       * asked to fix.
       */
      const count: number = await ModelAPI.count<NetworkDevice>({
        modelType: NetworkDevice,
        query: {
          projectId: projectId,
          isArchived: false,
          monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
          monitorId: new IsNull(),
        } as Query<NetworkDevice>,
      });

      setUnboundCount(count);
    } catch {
      // The banner is supplementary — a failed count hides it, nothing more.
      setUnboundCount(0);
    }
  };

  useEffect(() => {
    fetchCount().catch(() => {
      // handled in fetchCount.
    });
  }, []);

  if (isDismissed || unboundCount <= 0) {
    return <></>;
  }

  const isSingular: boolean = unboundCount === 1;

  return (
    <Alert
      dataTestId="network-device-unbound-devices-banner"
      type={AlertType.WARNING}
      title={
        <span>
          {`${unboundCount} ${isSingular ? "device has" : "devices have"} no monitor bound and ${
            isSingular ? "is" : "are"
          } never polled. Switch ${isSingular ? "it" : "them"} to probe polling to have ${
            isSingular ? "its" : "their"
          } probe ping ${isSingular ? "it" : "them"}: `}
          <button
            type="button"
            data-testid="network-device-unbound-devices-banner-show"
            className="font-medium underline hover:no-underline"
            onClick={props.onShowUnboundDevices}
          >
            show pending devices
          </button>
          {`, select the ones tagged "No monitor", and use ${SWITCH_TO_PROBE_POLLING_ACTION_TITLE}.`}
        </span>
      }
      onClose={(): void => {
        setIsDismissed(true);
      }}
    />
  );
};

export default UnboundDevicesBanner;
