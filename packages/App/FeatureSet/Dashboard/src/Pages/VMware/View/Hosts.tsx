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
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import { VMwareHostsTable } from "../../../Components/VMware/VMwareResourceTables";
import { getVMwarePartRoutes } from "../../../Components/VMware/Part/VMwarePartRoutes";

/*
 * Every ESXi host of the vCenter: whether vCenter can reach it - Connected,
 * Not responding, Powered off, In standby - coloured by what needs attention
 * on it, with why under it, and how busy it is. The Postgres inventory
 * (VMwareResource, kind Host), with the datacenters' rows beside it: a host
 * that reports no usage is told apart by its datacenter's counts
 * (VMwareHealth).
 */

const VMwareVCenterHosts: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [hosts, setHosts] = useState<Array<VMwareResourceModel>>([]);
  const [datacenters, setDatacenters] = useState<Array<VMwareResourceModel>>(
    [],
  );
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");
    try {
      const [hostRows, datacenterRows]: [
        Array<VMwareResourceModel>,
        Array<VMwareResourceModel>,
      ] = await Promise.all([
        fetchVMwareInventoryRows({
          vmwareVCenterId: modelId,
          kind: VMwareResourceKind.Host,
        }),
        fetchVMwareInventoryRows({
          vmwareVCenterId: modelId,
          kind: VMwareResourceKind.Datacenter,
        }),
      ]);

      setHosts(hostRows);
      setDatacenters(datacenterRows);
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

  return (
    <VMwareHostsTable
      error={error}
      rows={hosts}
      context={{
        datacenters: datacenters,
        hosts: hosts,
        now: OneUptimeDate.getCurrentDate(),
      }}
      scope="vcenter"
      onRefreshClick={() => {
        fetchData().catch(() => {});
      }}
      getViewRoute={(externalId: string) => {
        return getVMwarePartRoutes(modelId).getPartRoute(
          VMwareResourceKind.Host,
          externalId,
        );
      }}
    />
  );
};

export default VMwareVCenterHosts;
