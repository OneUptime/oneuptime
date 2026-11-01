import PageComponentProps from "../PageComponentProps";
import CloudAppsTable from "../../Components/AppPlatforms/CloudAppsTable";
import CLOUD_ENVIRONMENT_ONBOARDING from "../../Components/Cloud/CloudEnvironmentOnboarding";
import CLOUD_ENVIRONMENT_SHOWCASE from "../../Components/Cloud/CloudEnvironmentShowcase";
import AddResourceModal from "../../Components/ResourceOnboarding/AddResourceModal";
import ResourceShowcaseCard from "../../Components/ResourceShowcase/ResourceShowcaseCard";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { CloudResourceKind } from "Common/Types/Cloud/CloudResourceKind";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * App Platforms > All Apps: every app on every platform - an ECS service, a
 * Cloud Run service, a Container App, an App Service app - one row each,
 * with whether it runs, the revision it runs, and its requests, errors and
 * latency. The apps of archived environments are left out, as the
 * environments are.
 *
 * A project with no environment yet sees what the product does and the way
 * to connect one, as All Environments shows it.
 */
const AppPlatformsApps: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const [environments, setEnvironments] = useState<Map<
    string,
    CloudResource
  > | null>(null);
  const [error, setError] = useState<string>("");
  const [attempt, setAttempt] = useState<number>(0);
  const [isAddOpen, setIsAddOpen] = useState<boolean>(false);

  useEffect(() => {
    let ignore: boolean = false;
    setError("");

    ModelAPI.getList<CloudResource>({
      modelType: CloudResource,
      query: {
        isArchived: false,
        cloudResourceKind: CloudResourceKind.Environment,
      },
      select: {
        name: true,
        cloudPlatform: true,
        cloudProvider: true,
        cloudRegion: true,
        cloudAccountId: true,
      },
      sort: { name: SortOrder.Ascending },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
    })
      .then((result: { data: Array<CloudResource> }): void => {
        if (ignore) {
          return;
        }

        const byId: Map<string, CloudResource> = new Map<
          string,
          CloudResource
        >();

        for (const environment of result.data) {
          if (environment._id) {
            byId.set(environment._id.toString(), environment);
          }
        }

        setEnvironments(byId);
      })
      .catch((err: Error): void => {
        if (!ignore) {
          setError(API.getFriendlyMessage(err));
        }
      });

    return (): void => {
      ignore = true;
    };
  }, [attempt]);

  if (error) {
    return (
      <ErrorMessage
        message={error}
        onRefreshClick={() => {
          setAttempt((count: number): number => {
            return count + 1;
          });
        }}
      />
    );
  }

  if (!environments) {
    return <PageLoader isVisible={true} />;
  }

  if (environments.size === 0) {
    return (
      <Fragment>
        <ResourceShowcaseCard
          showcase={CLOUD_ENVIRONMENT_SHOWCASE}
          addButton={{
            title: CLOUD_ENVIRONMENT_ONBOARDING.addTitle,
            onClick: () => {
              setIsAddOpen(true);
            },
          }}
        />
        {isAddOpen ? (
          <AddResourceModal
            onboarding={CLOUD_ENVIRONMENT_ONBOARDING}
            onClose={() => {
              setIsAddOpen(false);
            }}
            onConnected={() => {
              // The new environment's apps are read with it.
              setAttempt((count: number): number => {
                return count + 1;
              });
            }}
          />
        ) : (
          <></>
        )}
      </Fragment>
    );
  }

  return <CloudAppsTable id="app-platforms-apps-table" environments={environments} />;
};

export default AppPlatformsApps;
