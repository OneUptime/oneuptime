import ObjectID from "Common/Types/ObjectID";
import { fetchOpenStackNetworkAgentNames } from "../../../Pages/OpenStack/Utils/OpenStackPartData";
import {
  OpenStackNetworkBackend,
  getOpenStackNetworkBackend,
} from "../../../Pages/OpenStack/Utils/OpenStackPartFacts";
import useOpenStackRead, { OpenStackRead } from "./UseOpenStackRead";

/*
 * Which network backend a cloud runs, from what its agents list says and never from a
 * setting. Until that is known, and when it can't be, a router's agents read Not reported.
 */
export default function useOpenStackNetworkBackend(
  openStackCloudId: ObjectID,
): OpenStackNetworkBackend {
  const names: OpenStackRead<Array<string>> = useOpenStackRead<Array<string>>(
    () => {
      return fetchOpenStackNetworkAgentNames(openStackCloudId);
    },
    [openStackCloudId.toString()],
  );

  return names.data ? getOpenStackNetworkBackend(names.data) : "unknown";
}
