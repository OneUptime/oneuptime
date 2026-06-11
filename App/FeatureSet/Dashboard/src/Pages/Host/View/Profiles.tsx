import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import Host from "Common/Models/DatabaseModels/Host";
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
import { keyForHost } from "Common/Utils/Telemetry/EntityKey";

const HostProfiles: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [host, setHost] = useState<Host | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");
    try {
      const item: Host | null = await ModelAPI.getItem({
        modelType: Host,
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
    if (host?.hostIdentifier) {
      q["entityScope"] = {
        entityKeys: [
          keyForHost(
            ProjectUtil.getCurrentProjectId()!.toString(),
            host.hostIdentifier,
          ),
        ],
        attributeKey: "resource.host.name",
        attributeValue: host.hostIdentifier,
      };
    }
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

  return (
    <Fragment>
      <ProfileTable
        profileQuery={profileQuery}
        noItemsMessage="No performance profiles found for this host."
      />
    </Fragment>
  );
};

export default HostProfiles;
