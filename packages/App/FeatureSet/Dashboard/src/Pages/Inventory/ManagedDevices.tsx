import PageComponentProps from "../PageComponentProps";
import DeviceManagementConnectionsTable from "../../Components/DeviceManagement/DeviceManagementConnectionsTable";
import EsperConnectionFormModal from "../../Components/DeviceManagement/EsperConnectionFormModal";
import ManagedDevicesTable from "../../Components/DeviceManagement/ManagedDevicesTable";
import DeviceManagementConnection from "Common/Models/DatabaseModels/DeviceManagementConnection";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

/*
 * Inventory > Managed Devices: the Android fleet a device management service
 * enrolls (Esper, issue #9586). The project's Esper connections come first -
 * how each is doing and what its last read found - and every device they
 * import under them, each one host in Inventory.
 *
 * A project with no connection sees the connections' empty list, whose one
 * button connects Esper; the devices' list says when devices arrive.
 */

const InventoryManagedDevices: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  const [formConnection, setFormConnection] = useState<
    DeviceManagementConnection | null | undefined
  >(undefined);
  const [refreshToggle, setRefreshToggle] = useState<string>(
    Date.now().toString(),
  );
  const [connectionCount, setConnectionCount] = useState<number | null>(null);

  /*
   * Every write here goes through ModelAPI directly, which ModelTable's own
   * gating never sees, so the affordances are gated up front.
   */
  const updateGate: PermissionGateResult = PermissionGate.check(
    new DeviceManagementConnection(),
    ModelAction.Update,
  );

  const refresh: () => void = (): void => {
    setRefreshToggle(Date.now().toString());
  };

  return (
    <Fragment>
      <DeviceManagementConnectionsTable
        refreshToggle={refreshToggle}
        updateGate={updateGate}
        onConnect={(): void => {
          setFormConnection(null);
        }}
        onEdit={(connection: DeviceManagementConnection): void => {
          setFormConnection(connection);
        }}
        onConnectionsLoaded={(totalCount: number): void => {
          setConnectionCount(totalCount);
        }}
      />

      {/*
       * The devices' list once a connection exists: before that, the
       * connections' empty list is the one thing to do.
       */}
      {connectionCount ? (
        <ManagedDevicesTable refreshToggle={refreshToggle} />
      ) : (
        <></>
      )}

      {formConnection !== undefined ? (
        <EsperConnectionFormModal
          connection={formConnection || undefined}
          onClose={(): void => {
            setFormConnection(undefined);
          }}
          onSaved={(): void => {
            setFormConnection(undefined);
            refresh();
          }}
        />
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default InventoryManagedDevices;
