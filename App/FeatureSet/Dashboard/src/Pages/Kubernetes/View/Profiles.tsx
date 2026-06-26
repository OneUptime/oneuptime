import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ProfileTable from "../../../Components/Profiles/ProfileTable";
import Query from "Common/Types/BaseDatabase/Query";
import Profile from "Common/Models/AnalyticsModels/Profile";
import ProjectUtil from "Common/UI/Utils/Project";
import { keyForKubernetesCluster } from "Common/Utils/Telemetry/EntityKey";

const KubernetesClusterProfiles: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [cluster, setCluster] = useState<KubernetesCluster | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");
    try {
      const item: KubernetesCluster | null = await ModelAPI.getItem({
        modelType: KubernetesCluster,
        id: modelId,
        select: {
          clusterIdentifier: true,
          name: true,
        },
      });

      if (!item?.clusterIdentifier) {
        setError("Cluster not found.");
        setIsLoading(false);
        return;
      }

      setCluster(item);
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

  const profileQuery: Query<Profile> = useMemo(() => {
    /*
     * `any` sidesteps a TS2589 deep-instantiation on Query<Profile>:
     * "entityScope" is a synthetic query key the Query generic does not
     * model — same workaround the Host/Docker logs pages use.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q: any = {};
    /*
     * entityScope is the sole scope predicate (contract C4 — compiled by
     * StatementGenerator to hasAny(entityKeys, [...]) OR the attribute
     * equality): new rows ride the bloom-indexed `entityKeys` membership
     * column, pre-column rows (no backfill, empty array) still match via
     * the attribute fallback inside the same OR. Do not AND a separate
     * `attributes` equality on top — that collapses the OR to the
     * attribute side and turns the indexed path into dead weight. Drop
     * the attributeKey/attributeValue fallback once deploy-date + max
     * retention has passed.
     */
    if (cluster?.clusterIdentifier) {
      q["entityScope"] = {
        entityKeys: [
          keyForKubernetesCluster(
            ProjectUtil.getCurrentProjectId()!.toString(),
            cluster.clusterIdentifier,
          ),
        ],
        attributeKey: "resource.k8s.cluster.name",
        attributeValue: cluster.clusterIdentifier,
      };
    }
    return q as Query<Profile>;
  }, [cluster?.clusterIdentifier]);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!cluster?.clusterIdentifier) {
    return <ErrorMessage message="Cluster not found." />;
  }

  /*
   * No aggregate flame graph on this tab (unlike the Service / Host
   * profile tabs): the flamegraph endpoint scopes rows by
   * primaryEntityId, but profiles captured inside a cluster carry the
   * KubernetesCluster row id there only when the batch has no
   * service.name — SDK and per-target eBPF profiles route to Service
   * rows instead (see OtelIngestBaseService.selectPrimaryEntity).
   * The table below scopes by entityScope (cluster entity key OR the
   * cluster-name attribute) and so shows the full set; a
   * primaryEntityId-scoped graph would silently omit most of it. Skip
   * the graph until the endpoint can scope by entity keys.
   */
  return (
    <Fragment>
      <ProfileTable
        profileQuery={profileQuery}
        noItemsMessage="No performance profiles found for this cluster."
      />
    </Fragment>
  );
};

export default KubernetesClusterProfiles;
