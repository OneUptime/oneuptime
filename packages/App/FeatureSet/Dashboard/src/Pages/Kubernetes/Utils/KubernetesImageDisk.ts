import KubernetesResourceModel from "Common/Models/DatabaseModels/KubernetesResource";
import NotNull from "Common/Types/BaseDatabase/NotNull";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * Whether some node of a cluster keeps its container images on a disk of its
 * own (#10056). A node's row holds a reading of its image filesystem only
 * then: ingest writes one when a scrape shows it is not the root filesystem,
 * and clears it when it is (isSeparateKubernetesImageFs). The Nodes list
 * draws its Image Disk column from the same rows, and the cluster's
 * recommendations offer Node Image Disk Almost Full on it.
 */
export async function hasKubernetesClusterSeparateImageDisk(
  kubernetesClusterId: ObjectID,
): Promise<boolean> {
  const count: number = await ModelAPI.count<KubernetesResourceModel>({
    modelType: KubernetesResourceModel,
    query: {
      kubernetesClusterId: kubernetesClusterId,
      kind: "Node",
      latestImageFsCapacityBytes: new NotNull(),
    },
  });

  return count > 0;
}
