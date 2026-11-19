import PageComponentProps from "../../PageComponentProps";
import ResourceSecurityEventsEmptyState from "../../../Components/ResourceSecurity/ResourceSecurityEventsEmptyState";
import ResourceSecurityEventsPage, {
  RESOURCE_SECURITY_EVENTS_READ_FAILED,
} from "../../../Components/ResourceSecurity/ResourceSecurityEventsPage";
import ServerlessFunction from "Common/Models/DatabaseModels/ServerlessFunction";
import ObjectID from "Common/Types/ObjectID";
import { SecurityConnectionKind } from "Common/Types/SecurityCase/SecurityConnection";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageSkeleton from "Common/UI/Components/Page/PageSkeleton";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import {
  canServerlessFunctionBeNamedByAuditLog,
  getServerlessFunctionCloudResourceId,
} from "Common/Utils/SecurityEvent/LogParsers/CloudAuditResources";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * One serverless function's Security Events (#9780): the Security Events
 * explorer on the events read from its own logs and traces - the lines and
 * spans its Logs and Traces pages show, by its faas.name, whatever service
 * they are filed under - and, where its telemetry says its account, the
 * events its cloud's audit log names it in by its ARN or resource name:
 * the ones its Security card on Overview counts (ResourceSecurityEventsPage).
 *
 * Its empty state says which of those it can have: a function whose ID its
 * telemetry does not say in full is told what to set, an Azure function -
 * whose ID holds a resource group no telemetry reports - is read by its
 * logs and traces alone.
 */
const ServerlessFunctionSecurityEvents: FunctionComponent<
  PageComponentProps
> = (props: PageComponentProps): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const [serverlessFunction, setServerlessFunction] =
    useState<ServerlessFunction | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let isCurrent: boolean = true;

    setIsLoading(true);
    setError("");

    ModelAPI.getItem({
      modelType: ServerlessFunction,
      id: modelId,
      select: {
        functionIdentifier: true,
        cloudProvider: true,
        cloudPlatform: true,
        cloudRegion: true,
        cloudAccountId: true,
      },
    })
      .then((item: ServerlessFunction | null) => {
        if (isCurrent) {
          setServerlessFunction(item);
        }
      })
      .catch((err: unknown) => {
        if (isCurrent) {
          setError(API.getFriendlyMessage(err));
        }
      })
      .finally(() => {
        if (isCurrent) {
          setIsLoading(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [modelId.toString()]);

  if (isLoading) {
    return <PageSkeleton shape="table" />;
  }

  if (error || !serverlessFunction) {
    return (
      <ErrorMessage message={error || RESOURCE_SECURITY_EVENTS_READ_FAILED} />
    );
  }

  return (
    <ResourceSecurityEventsPage
      {...props}
      kind={SecurityConnectionKind.ServerlessFunction}
      emptyContent={
        <ResourceSecurityEventsEmptyState
          kind={SecurityConnectionKind.ServerlessFunction}
          isNamedByAuditLog={Boolean(
            getServerlessFunctionCloudResourceId({
              functionIdentifier: serverlessFunction.functionIdentifier,
              cloudProvider: serverlessFunction.cloudProvider,
              cloudPlatform: serverlessFunction.cloudPlatform,
              cloudRegion: serverlessFunction.cloudRegion,
              cloudAccountId: serverlessFunction.cloudAccountId,
            }),
          )}
          canBeNamedByAuditLog={canServerlessFunctionBeNamedByAuditLog({
            cloudProvider: serverlessFunction.cloudProvider,
            cloudPlatform: serverlessFunction.cloudPlatform,
          })}
        />
      }
    />
  );
};

export default ServerlessFunctionSecurityEvents;
