import SnmpEngineIdValue from "../Probe/SnmpEngineIdValue";
import {
  DEVICE_PROBE_ENGINE_ID_NOT_REPORTED,
  SNMP_TRAPS_ENGINE_ID_HINT,
  SNMP_TRAPS_FACT_LABELS,
} from "../Probe/SnmpTrapReceiverCopy";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import Probe from "Common/Models/DatabaseModels/Probe";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ObjectID from "Common/Types/ObjectID";
import SnmpTrapReceiverUtil, {
  SnmpTrapReceiverReport,
} from "Common/Types/Probe/SnmpTrapReceiver";
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
 * The SNMPv3 engine ID of the device's probe, where its traps and informs
 * are set up (OneUptime issue #11173): a device that sends SNMPv3 informs
 * authenticates them with it, and some (Cisco IOS) must be given it. A
 * project probe's page shows it too; a global probe has no page a project
 * opens, so a device on one reads it here, from what the probe says of
 * itself to every project that uses it.
 *
 * Read through the device's probe, by the probe's readers: for anyone else
 * nothing is drawn.
 */
const DeviceProbeSnmpEngineId: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [engineId, setEngineId] = useState<string | undefined>(undefined);
  const [isLoaded, setIsLoaded] = useState<boolean>(false);
  /*
   * Nothing to say of a device with no probe, nor of a receiver its probe's
   * operator turned off: neither takes informs at all.
   */
  const [isTakingInforms, setIsTakingInforms] = useState<boolean>(false);

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
              probeId: true,
              probe: {
                _id: true,
                snmpTrapReceiver: true,
              },
            },
          ),
        });

      const report: SnmpTrapReceiverReport | null =
        SnmpTrapReceiverUtil.parseReport(device?.probe?.snmpTrapReceiver);

      setEngineId(report?.isEnabled ? report.engineId : undefined);
      setIsTakingInforms(
        Boolean(device?.probeId || device?.probe) && report?.isEnabled !== false,
      );
      setIsLoaded(true);
    };

    load().catch(() => {
      // A help card's detail: nothing drawn when it cannot be read.
    });
  }, [props.modelId, mayReadReport]);

  if (!mayReadReport || !isLoaded || !isTakingInforms) {
    return <></>;
  }

  if (!engineId) {
    return (
      <p
        className="text-gray-500"
        data-testid="device-probe-snmp-engine-id-not-reported"
      >
        {translator.translateText(DEVICE_PROBE_ENGINE_ID_NOT_REPORTED)}
      </p>
    );
  }

  return (
    <div className="space-y-1" data-testid="device-probe-snmp-engine-id">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium text-gray-900">
          {translator.translateText(SNMP_TRAPS_FACT_LABELS.engineId)}
        </span>
        <SnmpEngineIdValue
          engineId={engineId}
          dataTestId="device-probe-snmp-engine-id-value"
        />
      </div>
      <p className="text-gray-500">
        {translator.translateText(SNMP_TRAPS_ENGINE_ID_HINT)}
      </p>
    </div>
  );
};

export default DeviceProbeSnmpEngineId;
