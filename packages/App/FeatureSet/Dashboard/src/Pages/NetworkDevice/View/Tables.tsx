import PageComponentProps from "../../PageComponentProps";
import SnmpTableSnapshotCard from "../../../Components/NetworkDevice/SnmpTableSnapshotCard";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import AppLink from "../../../Components/AppLink/AppLink";
import Route from "Common/Types/API/Route";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import {
  SnmpTableDefinition,
  SnmpTableSnapshot,
} from "Common/Types/Monitor/SnmpMonitor/SnmpTable";
import SnmpTableListUtil from "Common/Types/Monitor/SnmpMonitor/SnmpTableListUtil";
import ObjectID from "Common/Types/ObjectID";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * The device's walked SNMP tables - IPsec tunnels, radios, fabric
 * neighbours, fans, power supplies - as of its last successful walk of each.
 * Tables come from the device's OID Collection Template and its own
 * device-specific tables (Settings); this page only shows what was walked.
 */
const NetworkDeviceTables: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [snapshots, setSnapshots] = useState<Array<SnmpTableSnapshot>>([]);
  const [definedTables, setDefinedTables] = useState<
    Array<SnmpTableDefinition>
  >([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchDevice: PromiseVoidFunction = async (): Promise<void> => {
    try {
      const device: NetworkDevice | null =
        await ModelAPI.getItem<NetworkDevice>({
          modelType: NetworkDevice,
          id: modelId,
          select: {
            snmpTableSnapshot: true,
            snmpTables: true,
            oidTemplate: {
              tables: true,
            },
          },
        });

      setSnapshots(device?.snmpTableSnapshot || []);
      setDefinedTables(
        SnmpTableListUtil.resolveEffectiveTables({
          templateTables: device?.oidTemplate?.tables,
          deviceTables: device?.snmpTables,
        }).tables,
      );
      setError("");
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    fetchDevice().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
      setIsLoading(false);
    });
  }, []);

  if (isLoading) {
    return <ComponentLoader />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  const settingsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.NETWORK_DEVICE_VIEW_SETTINGS] as Route,
    { modelId: modelId },
  );

  if (definedTables.length === 0 && snapshots.length === 0) {
    return (
      <EmptyState
        id="network-device-tables-empty"
        icon={IconProp.TableCells}
        title="No SNMP tables on this device"
        description={
          <TranslatedSentence
            template="SNMP tables collect lists the device keeps - one row per IPsec tunnel, Wi-Fi radio, routing neighbour, fan or power supply - and follow rows as they come and go. Link this device to an OID Collection Template that has tables, or add device-specific tables in {{settings}}. The vendor templates for Sophos, Extreme, Cambium, HPE Aruba and Ubiquiti UniFi include them."
            slots={{
              settings: (
                <AppLink to={settingsRoute}>
                  {translator.translateTemplate("Settings")}
                </AppLink>
              ),
            }}
          />
        }
      />
    );
  }

  const walkedKeys: Set<string> = new Set(
    snapshots.map((snapshot: SnmpTableSnapshot): string => {
      return snapshot.key;
    }),
  );

  const waitingTables: Array<SnmpTableDefinition> = definedTables.filter(
    (table: SnmpTableDefinition): boolean => {
      return !walkedKeys.has(table.key);
    },
  );

  return (
    <Fragment>
      {snapshots.map((snapshot: SnmpTableSnapshot): ReactElement => {
        return <SnmpTableSnapshotCard key={snapshot.key} snapshot={snapshot} />;
      })}

      {waitingTables.length > 0 ? (
        <Card
          title="Waiting for the first walk"
          description="These tables are configured but have not been walked yet. They appear after the device's next successful SNMP poll."
        >
          <ul className="list-disc space-y-1 pl-5 text-sm text-gray-700">
            {waitingTables.map((table: SnmpTableDefinition): ReactElement => {
              return <li key={table.key}>{table.name}</li>;
            })}
          </ul>
        </Card>
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default NetworkDeviceTables;
