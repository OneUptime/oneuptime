import OpenStackCloud from "Common/Models/DatabaseModels/OpenStackCloud";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import useOpenStackRead, { OpenStackRead } from "./UseOpenStackRead";

// The name a cloud's metrics carry, which every read of the metric store filters on.
export default function useOpenStackCloudName(
  openStackCloudId: ObjectID,
): string {
  const cloud: OpenStackRead<OpenStackCloud | null> =
    useOpenStackRead<OpenStackCloud | null>(() => {
      return ModelAPI.getItem<OpenStackCloud>({
        modelType: OpenStackCloud,
        id: openStackCloudId,
        select: { name: true },
      });
    }, [openStackCloudId.toString()]);

  return cloud.data?.name || "";
}
