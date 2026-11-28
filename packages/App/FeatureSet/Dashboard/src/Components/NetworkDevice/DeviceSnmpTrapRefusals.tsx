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
import GlobalProbeSnmpTrapReport from "Common/Models/DatabaseModels/GlobalProbeSnmpTrapReport";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import Probe from "Common/Models/DatabaseModels/Probe";
import Route from "Common/Types/API/Route";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ObjectID from "Common/Types/ObjectID";
import SnmpTrapReceiverUtil, {
  SnmpTrapReceiverReport,
  SnmpTrapRefusal,
} from "Common/Types/Probe/SnmpTrapReceiver";
import NetworkDeviceOtherAddressesUtil from "Common/Utils/NetworkDevice/NetworkDeviceOtherAddresses";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import ListResult from "Common/Types/BaseDatabase/ListResult";
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
 * A device's own refused SNMPv3 traps, on its pages (OneUptime issues
 * #11005, #11173, #11406): its probe counts every SNMPv3 trap it refuses by
 * source address, OneUptime keeps each with the devices it came from - the
 * devices that have the address as their hostname, one of their Other
 * Addresses, or what their DNS name resolves to, as traps are matched - and
 * this device's are said here, with what to change and the way to change
 * it. So a device added by its DNS name sees its refusals too, though the
 * page resolves no names. Nothing shows while the device's traps are taken:
 * a banner is for something to act on.
 *
 * A project's own probe keeps its whole report (Probe.snmpTrapReceiver),
 * read through the device's probe, which holds it to the probe's own
 * readers (#11234): the select is sent for each reader without what they
 * may not read, and a viewer who may not read the probe's report sees
 * nothing here. A global probe serves many projects, so this project's
 * share of what it refused is kept apart (GlobalProbeSnmpTrapReport), read
 * by the same readers, and the probe has no page of its own here: an inform
 * sent to another engine ID says the probe's engine ID in place of View
 * Probe.
 */
/*
 * This project's share of a global probe's report: its refused SNMPv3
 * traps, kept for it alone, beside what the probe says of itself. None yet
 * reads as none refused.
 */
async function readGlobalProbeShare(data: {
  probeId: ObjectID;
  probeReport: SnmpTrapReceiverReport | null;
}): Promise<SnmpTrapReceiverReport | null> {
  const shares: ListResult<GlobalProbeSnmpTrapReport> =
    await ModelAPI.getList<GlobalProbeSnmpTrapReport>({
      modelType: GlobalProbeSnmpTrapReport,
      query: {
        probeId: data.probeId,
      },
      select: {
        _id: true,
        refusals: true,
      },
      limit: 1,
      skip: 0,
      sort: {},
    });

  return SnmpTrapReceiverUtil.parseReport({
    ...(data.probeReport || { isEnabled: true }),
    isEnabled: true,
    refusals: shares.data[0]?.refusals || [],
  });
}

const DeviceSnmpTrapRefusals: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [refusals, setRefusals] = useState<Array<SnmpTrapRefusal>>([]);
  const [probeId, setProbeId] = useState<ObjectID | null>(null);
  const [isGlobalProbe, setIsGlobalProbe] = useState<boolean>(false);
  const [probeEngineId, setProbeEngineId] = useState<string | undefined>(
    undefined,
  );
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
                isGlobalProbe: true,
                snmpTrapReceiver: true,
              },
            },
          ),
        });

      if (!device) {
        return;
      }

      const deviceProbeId: ObjectID | null =
        device.probeId || device.probe?.id || null;
      const probeReport: SnmpTrapReceiverReport | null =
        SnmpTrapReceiverUtil.parseReport(device.probe?.snmpTrapReceiver);
      const isOnGlobalProbe: boolean = Boolean(device.probe?.isGlobalProbe);

      let report: SnmpTrapReceiverReport | null = probeReport;

      if (isOnGlobalProbe && deviceProbeId) {
        report = await readGlobalProbeShare({
          probeId: deviceProbeId,
          probeReport: probeReport,
        });
      }

      setProbeId(deviceProbeId);
      setIsGlobalProbe(isOnGlobalProbe);
      setProbeEngineId(probeReport?.engineId);
      setRefusals(
        SnmpTrapReceiverUtil.getRefusalsOfDevice(report, {
          deviceId: props.modelId.toString(),
          addresses: [
            device.hostname,
            ...NetworkDeviceOtherAddressesUtil.parse(device.otherAddresses)
              .addresses,
          ],
        }),
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
            probeEngineId={probeEngineId}
          />
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <AppLink
              to={settingsRoute}
              className="font-medium text-indigo-600 hover:underline"
            >
              {translator.translateText(DEVICE_SNMP_TRAP_EDIT_CREDENTIALS) ||
                ""}
            </AppLink>
            {probeId && !isGlobalProbe && (
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
