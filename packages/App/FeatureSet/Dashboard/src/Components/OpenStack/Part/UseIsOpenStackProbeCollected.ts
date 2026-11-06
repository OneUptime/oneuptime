import OpenStackCloud from "Common/Models/DatabaseModels/OpenStackCloud";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { isOpenStackProbeCollected } from "../OpenStackProbeCollectionView";
import useOpenStackRead, { OpenStackRead } from "./UseOpenStackRead";

/*
 * Whether a probe collects this cloud, for a page whose advice depends on it: there is no agent
 * to run troubleshoot.sh on, and no exporter to change a flag on, when a probe reads it. Until it
 * is known, or if it can't be, the advice is the agent's, as most clouds' is.
 */
export default function useIsOpenStackProbeCollected(
  openStackCloudId: ObjectID,
): boolean {
  const cloud: OpenStackRead<OpenStackCloud | null> =
    useOpenStackRead<OpenStackCloud | null>(() => {
      return ModelAPI.getItem<OpenStackCloud>({
        modelType: OpenStackCloud,
        id: openStackCloudId,
        select: { collectionMethod: true },
      });
    }, [openStackCloudId.toString()]);

  return isOpenStackProbeCollected(cloud.data);
}
