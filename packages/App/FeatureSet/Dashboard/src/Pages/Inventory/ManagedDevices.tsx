import PageComponentProps from "../PageComponentProps";
import DeviceManagementConnectionsTable from "../../Components/DeviceManagement/DeviceManagementConnectionsTable";
import DeviceManagerPickerModal from "../../Components/DeviceManagement/DeviceManagerPickerModal";
import EsperConnectionFormModal from "../../Components/DeviceManagement/EsperConnectionFormModal";
import IntuneConnectionFormModal from "../../Components/DeviceManagement/IntuneConnectionFormModal";
import ManagedDevicesTable from "../../Components/DeviceManagement/ManagedDevicesTable";
import SotiConnectionFormModal from "../../Components/DeviceManagement/SotiConnectionFormModal";
import WorkspaceOneConnectionFormModal from "../../Components/DeviceManagement/WorkspaceOneConnectionFormModal";
import DeviceManagementConnection from "Common/Models/DatabaseModels/DeviceManagementConnection";
import DeviceManagementProvider, {
  readDeviceManagementProvider,
} from "Common/Types/DeviceManagement/DeviceManagementProvider";
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
 * Inventory > Managed Devices: the fleets device management services enroll
 * (Esper, issue #9586; Microsoft Intune, #9837; Workspace ONE UEM, #10086;
 * SOTI MobiControl, #10087). The project's connections
 * come first - how each is doing and what its last read found - and every
 * device they import under them, each one host in Inventory.
 *
 * "Connect device manager" asks which service first, then that service's
 * own form. A project with no connection sees the connections' empty list,
 * whose one button does that; the devices' list says when devices arrive.
 */

// The form open: a service's, for a new connection or one to edit.
interface OpenForm {
  provider: DeviceManagementProvider;
  connection?: DeviceManagementConnection | undefined;
}

const InventoryManagedDevices: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  const [isPicking, setIsPicking] = useState<boolean>(false);
  const [form, setForm] = useState<OpenForm | undefined>(undefined);
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

  const closeForm: () => void = (): void => {
    setForm(undefined);
  };

  const onSaved: () => void = (): void => {
    setForm(undefined);
    refresh();
  };

  return (
    <Fragment>
      <DeviceManagementConnectionsTable
        refreshToggle={refreshToggle}
        updateGate={updateGate}
        onConnect={(): void => {
          setIsPicking(true);
        }}
        onEdit={(connection: DeviceManagementConnection): void => {
          setForm({
            provider: readDeviceManagementProvider(connection.provider),
            connection,
          });
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

      {isPicking ? (
        <DeviceManagerPickerModal
          onClose={(): void => {
            setIsPicking(false);
          }}
          onChoose={(provider: DeviceManagementProvider): void => {
            setIsPicking(false);
            setForm({ provider });
          }}
        />
      ) : (
        <></>
      )}

      {form?.provider === DeviceManagementProvider.Intune ? (
        <IntuneConnectionFormModal
          connection={form.connection}
          onClose={closeForm}
          onSaved={onSaved}
        />
      ) : (
        <></>
      )}

      {form?.provider === DeviceManagementProvider.WorkspaceOne ? (
        <WorkspaceOneConnectionFormModal
          connection={form.connection}
          onClose={closeForm}
          onSaved={onSaved}
        />
      ) : (
        <></>
      )}

      {form?.provider === DeviceManagementProvider.Soti ? (
        <SotiConnectionFormModal
          connection={form.connection}
          onClose={closeForm}
          onSaved={onSaved}
        />
      ) : (
        <></>
      )}

      {form?.provider === DeviceManagementProvider.Esper ? (
        <EsperConnectionFormModal
          connection={form.connection}
          onClose={closeForm}
          onSaved={onSaved}
        />
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default InventoryManagedDevices;
