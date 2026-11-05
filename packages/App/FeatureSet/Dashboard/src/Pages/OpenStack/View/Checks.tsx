import PageComponentProps from "../../PageComponentProps";
import OpenStackCloud from "Common/Models/DatabaseModels/OpenStackCloud";
import OpenStackCloudCheck from "Common/Models/DatabaseModels/OpenStackCloudCheck";
import ObjectID from "Common/Types/ObjectID";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useRef,
} from "react";
import OpenStackApiChecksCard from "../../../Components/OpenStack/Checks/OpenStackApiChecksCard";
import OpenStackLifecycleCheckCard from "../../../Components/OpenStack/Checks/OpenStackLifecycleCheckCard";
import useOpenStackRead, {
  OpenStackRead,
} from "../../../Components/OpenStack/Part/UseOpenStackRead";

/*
 * A cloud checked from outside it: whether a user can get a token and a service answers, and
 * whether an instance boots. A check's row is only there once someone has turned one on. It is read
 * again every minute, because that is how often a probe says something new.
 */

const RELOAD_EVERY_IN_MS: number = 60_000;

const OpenStackCloudChecks: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const cloud: OpenStackRead<OpenStackCloud | null> =
    useOpenStackRead<OpenStackCloud | null>(() => {
      return ModelAPI.getItem<OpenStackCloud>({
        modelType: OpenStackCloud,
        id: modelId,
        select: {
          name: true,
          collectionMethod: true,
          authUrl: true,
          isCredentialSet: true,
          collectionProbeId: true,
        },
      });
    }, [modelId.toString()]);

  const check: OpenStackRead<OpenStackCloudCheck | null> =
    useOpenStackRead<OpenStackCloudCheck | null>(async () => {
      const list: ListResult<OpenStackCloudCheck> =
        await ModelAPI.getList<OpenStackCloudCheck>({
          modelType: OpenStackCloudCheck,
          query: { openStackCloudId: modelId },
          limit: 1,
          skip: 0,
          select: {
            _id: true,
            authUrl: true,
            isCredentialSet: true,
            isApiCheckEnabled: true,
            apiCheckIntervalInMinutes: true,
            lastApiCheckAt: true,
            apiCheckResult: true,
            isLifecycleCheckEnabled: true,
            lifecycleCheckIntervalInMinutes: true,
            lifecycleProjectName: true,
            lifecycleRecords: true,
            isSweepPending: true,
            isOsProfilerKeySet: true,
            checkError: true,
          },
          sort: {},
        });

      return list.data[0] || null;
    }, [modelId.toString()]);

  const reload: MutableRefObject<() => void> = useRef<() => void>(check.reload);
  reload.current = check.reload;

  useEffect(() => {
    const timer: ReturnType<typeof setInterval> = setInterval(() => {
      reload.current();
    }, RELOAD_EVERY_IN_MS);

    return () => {
      clearInterval(timer);
    };
  }, []);

  if (cloud.error) {
    return (
      <ErrorMessage
        message={cloud.error}
        onRefreshClick={() => {
          cloud.reload();
        }}
      />
    );
  }

  if (cloud.isLoading && !cloud.data) {
    return <PageLoader isVisible={true} />;
  }

  if (!cloud.data) {
    return <ErrorMessage message="Cloud not found." />;
  }

  // Never read as "off": someone would turn on a check that is already on.
  if (check.error && !check.data) {
    return (
      <div data-testid="openstack-checks-read-failed">
        <ErrorMessage
          message={check.error}
          onRefreshClick={() => {
            check.reload();
          }}
        />
      </div>
    );
  }

  if (check.isLoading && !check.data) {
    return <PageLoader isVisible={true} />;
  }

  const canEdit: boolean = PermissionGate.check(
    new OpenStackCloudCheck(),
    ModelAction.Update,
  ).isAllowed;

  return (
    <div className="space-y-6" data-testid="openstack-checks">
      <OpenStackApiChecksCard
        openStackCloudId={modelId}
        cloud={cloud.data}
        check={check.data}
        canEdit={canEdit}
        onChanged={check.reload}
      />
      <OpenStackLifecycleCheckCard
        openStackCloudId={modelId}
        cloud={cloud.data}
        check={check.data}
        canEdit={canEdit}
        onChanged={check.reload}
      />
    </div>
  );
};

export default OpenStackCloudChecks;
