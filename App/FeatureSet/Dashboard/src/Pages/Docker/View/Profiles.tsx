import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import DockerHost from "Common/Models/DatabaseModels/DockerHost";
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

const DockerHostProfiles: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [host, setHost] = useState<DockerHost | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");
    try {
      const item: DockerHost | null = await ModelAPI.getItem({
        modelType: DockerHost,
        id: modelId,
        select: {
          hostIdentifier: true,
          name: true,
        },
      });

      if (!item?.hostIdentifier) {
        setError("Host not found.");
        setIsLoading(false);
        return;
      }

      setHost(item);
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
     * `any` sidesteps a TS2589 deep-instantiation on Query<Profile> with
     * inline attribute maps — same workaround the Host/Docker logs pages use.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q: any = {
      /*
       * Docker hosts scope by resource attribute only — there is no
       * entity-key builder for Docker hosts (see
       * Common/Utils/Telemetry/EntityKey), so no entityScope predicate
       * here. This mirrors the Docker logs / traces pages.
       */
      attributes: {
        "resource.host.name": host?.hostIdentifier || "",
      },
    };
    return q as Query<Profile>;
  }, [host?.hostIdentifier]);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!host?.hostIdentifier) {
    return <ErrorMessage message="Host not found." />;
  }

  /*
   * No aggregate flame graph on this tab (unlike the Service / Host
   * profile tabs): the flamegraph endpoint scopes rows by
   * primaryEntityId, but profiles produced on a Docker host rarely
   * carry the DockerHost row id there — batches with a resolvable
   * container name are routed to per-container Service rows, and only
   * the degenerate "container.id with no name" batches land on the
   * DockerHost id (see OtelIngestBaseService.selectPrimaryEntity).
   * The table below scopes by the resource.host.name attribute and so
   * shows the full set; a primaryEntityId-scoped graph would silently
   * omit most of it. Skip the graph until the endpoint can scope by
   * attributes / entity keys.
   */
  return (
    <Fragment>
      <ProfileTable
        profileQuery={profileQuery}
        noItemsMessage="No performance profiles found for this Docker host."
      />
    </Fragment>
  );
};

export default DockerHostProfiles;
