import SnmpTrapRefusalList from "../Probe/SnmpTrapRefusalList";
import {
  DEVICE_SNMP_TRAP_EDIT_CREDENTIALS,
  DEVICE_SNMP_TRAP_REFUSALS_DESCRIPTION,
  DEVICE_SNMP_TRAP_REFUSALS_TITLE,
  DEVICE_SNMP_TRAP_VIEW_PROBE,
} from "../Probe/SnmpTrapReceiverCopy";
import AppLink from "../AppLink/AppLink";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import Probe from "Common/Models/DatabaseModels/Probe";
import Route from "Common/Types/API/Route";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ObjectID from "Common/Types/ObjectID";
import SnmpTrapReceiverUtil, {
  SnmpTrapRefusal,
} from "Common/Types/Probe/SnmpTrapReceiver";
import NetworkDeviceOtherAddressesUtil from "Common/Utils/NetworkDevice/NetworkDeviceOtherAddresses";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "Common/UI/Utils/PermissionGate";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

export interface ComponentProps {
  modelId: ObjectID;
}

/*
 * A device's own refused SNMPv3 traps, on its pages (OneUptime issue
 * #11005): its probe counts every SNMPv3 trap it refuses by source address
 * (Probe.snmpTrapReceiver), and the ones from this device's addresses - its
 * hostname, when that is an address, and its Other Addresses - are said
 * here, with what to change and the way to change it. Nothing shows while
 * the device's traps are taken: a banner is for something to act on.
 *
 * Read through the device's probe, which holds the report to the probe's
 * own readers (#11234): the select is sent for each reader without what
 * they may not read, and a viewer who may not read the probe's report sees
 * nothing here.
 */
const DeviceSnmpTrapRefusals: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [refusals, setRefusals] = useState<Array<SnmpTrapRefusal>>([]);
  const [probeId, setProbeId] = useState<ObjectID | null>(null);
  const [isDismissed, setIsDismissed] = useState<boolean>(false);

  const mayReadReport: boolean =
    !PermissionGate.hasPermissionSnapshot() ||
    PermissionGate.canReadColumn(new Probe(), "snmpTrapReceiver");

  useEffect(() => {
    if (!mayReadReport) {
      return;
    }

    const load: PromiseVoidFunction = async (): Promise<void> => {
      const device: NetworkDevice | null =
        await ModelAPI.getItem<NetworkDevice>({
          modelType: NetworkDevice,
          id: props.modelId,
          select: PermissionGate.getSelectReadableThroughRelations(
            NetworkDevice,
            {
              hostname: true,
              otherAddresses: true,
              probeId: true,
              probe: {
                _id: true,
                snmpTrapReceiver: true,
              },
            },
          ),
        });

      if (!device) {
        return;
      }

      setProbeId(device.probeId || device.probe?.id || null);
      setRefusals(
        SnmpTrapReceiverUtil.getRefusalsFromAddresses(
          SnmpTrapReceiverUtil.parseReport(device.probe?.snmpTrapReceiver),
          [
            device.hostname,
            ...NetworkDeviceOtherAddressesUtil.parse(device.otherAddresses)
              .addresses,
          ],
        ),
      );
    };

    load().catch(() => {
      /*
       * A notice about refused traps: when it cannot be read, the rest of
       * the page says what failed. No notice is the right fallback here.
       */
    });
  }, [props.modelId, mayReadReport]);

  if (!mayReadReport || isDismissed || refusals.length === 0) {
    return <></>;
  }

  const settingsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.NETWORK_DEVICE_VIEW_SETTINGS] as Route,
    { modelId: props.modelId },
  );

  return (
    <Alert
      type={AlertType.WARNING}
      className="mb-4"
      dataTestId="device-snmp-trap-refusals"
      strongTitle={translator.translatePlural(
        DEVICE_SNMP_TRAP_REFUSALS_TITLE,
        SnmpTrapReceiverUtil.countRefused(refusals),
      )}
      onClose={() => {
        setIsDismissed(true);
      }}
      title={
        <div className="space-y-3">
          <p>
            {translator.translateText(DEVICE_SNMP_TRAP_REFUSALS_DESCRIPTION)}
          </p>
          <SnmpTrapRefusalList
            refusals={refusals}
            dataTestId="device-snmp-trap-refusal-list"
          />
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <AppLink
              to={settingsRoute}
              className="font-medium text-indigo-600 hover:underline"
            >
              {translator.translateText(DEVICE_SNMP_TRAP_EDIT_CREDENTIALS) ||
                ""}
            </AppLink>
            {probeId && (
              <AppLink
                to={RouteUtil.populateRouteParams(
                  RouteMap[PageMap.MONITORS_SETTINGS_PROBE_VIEW] as Route,
                  { modelId: probeId },
                )}
                className="font-medium text-indigo-600 hover:underline"
              >
                {translator.translateText(DEVICE_SNMP_TRAP_VIEW_PROBE) || ""}
              </AppLink>
            )}
          </div>
        </div>
      }
    />
  );
};

export default DeviceSnmpTrapRefusals;
