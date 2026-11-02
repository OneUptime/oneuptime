import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import VMwareResourceModel from "Common/Models/DatabaseModels/VMwareResource";
import OneUptimeDate from "Common/Types/Date";
import {
  VMwareResourceKind,
  fetchVMwareInventoryRows,
} from "../Utils/VMwareResourceUtils";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import { VMwareVirtualMachinesTable } from "../../../Components/VMware/VMwareResourceTables";
import { getVMwarePartRoutes } from "../../../Components/VMware/Part/VMwarePartRoutes";

/*
 * Every virtual machine and VM template of the vCenter: Running, Powered off
 * or Template, coloured by what needs attention on it (the host swaps it,
 * balloons it or makes it wait for a CPU) with why under it, and its
 * current usage - or Disconnected, on a host vCenter cannot reach. The
 * Postgres inventory (VMwareResource): the VMs, with the hosts and the
 * datacenters that say which hosts vCenter has lost; power state is
 * inferred per collection, since the receiver sends CPU only for
 * powered-on VMs.
 */

const VMwareVCenterVirtualMachines: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [rows, setRows] = useState<Array<VMwareResourceModel>>([]);
  const [hostRows, setHostRows] = useState<Array<VMwareResourceModel>>([]);
  const [datacenterRows, setDatacenterRows] = useState<
    Array<VMwareResourceModel>
  >([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const [vms, hosts, datacenters]: [
        Array<VMwareResourceModel>,
        Array<VMwareResourceModel>,
        Array<VMwareResourceModel>,
      ] = await Promise.all([
        fetchVMwareInventoryRows({
          vmwareVCenterId: modelId,
          kind: VMwareResourceKind.VirtualMachine,
        }),
        fetchVMwareInventoryRows({
          vmwareVCenterId: modelId,
          kind: VMwareResourceKind.Host,
        }),
        fetchVMwareInventoryRows({
          vmwareVCenterId: modelId,
          kind: VMwareResourceKind.Datacenter,
        }),
      ]);
      setRows(vms);
      setHostRows(hosts);
      setDatacenterRows(datacenters);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchData().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  return (
    <VMwareVirtualMachinesTable
      rows={rows}
      context={{
        datacenters: datacenterRows,
        hosts: hostRows,
        now: OneUptimeDate.getCurrentDate(),
      }}
      scope="vcenter"
      onRefreshClick={() => {
        fetchData().catch(() => {});
      }}
      getViewRoute={(externalId: string) => {
        return getVMwarePartRoutes(modelId).getPartRoute(
          VMwareResourceKind.VirtualMachine,
          externalId,
        );
      }}
    />
  );
};

export default VMwareVCenterVirtualMachines;
