import PageComponentProps from "../../PageComponentProps";
import ResourceSecurityEventsEmptyState from "../../../Components/ResourceSecurity/ResourceSecurityEventsEmptyState";
import ResourceSecurityEventsPage, {
  RESOURCE_SECURITY_EVENTS_READ_FAILED,
} from "../../../Components/ResourceSecurity/ResourceSecurityEventsPage";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import { canCloudResourceHaveStreamedLogs } from "Common/Types/Cloud/CloudLogGroups";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { SecurityConnectionKind } from "Common/Types/SecurityCase/SecurityConnection";
import EmptyState, {
  EmptyStateSize,
} from "Common/UI/Components/EmptyState/EmptyState";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageSkeleton from "Common/UI/Components/Page/PageSkeleton";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  canCloudResourceHaveSecurityEvents,
  isCloudResourceNamedByItsId,
} from "Common/Utils/SecurityEvent/LogParsers/CloudAuditResources";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * One cloud resource's Security Events (#9779): the Security Events
 * explorer on the events its cloud's audit log names it in - CloudTrail,
 * the Azure Activity Log, Google Cloud's audit logs, by its own ID - and
 * the ones read from its own logs, the ones its Security card on Overview
 * counts, beside its Logs (ResourceSecurityEventsPage).
 *
 * Its empty state says where its events come from, in its cloud's words.
 * A resource no event can reach - known only by a stand-in name its
 * metrics give it, with no logs of its own and no name or address it
 * answers on - has no menu entry; opened by its address, it says why
 * instead of showing an explorer that would stay empty.
 */

export const CLOUD_RESOURCE_NO_SECURITY_EVENTS_TITLE: string = translationKey(
  "No security events can reach this resource",
);

export const CLOUD_RESOURCE_NO_SECURITY_EVENTS_DESCRIPTION: string =
  translationKey(
    "OneUptime knows it by a name its metrics give it, not by its cloud's own ID, so no audit record names it, and its cloud sends no logs of its own.",
  );

const CloudResourceSecurityEvents: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const [resource, setResource] = useState<CloudResource | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let isCurrent: boolean = true;

    setIsLoading(true);
    setError("");

    ModelAPI.getItem({
      modelType: CloudResource,
      id: modelId,
      select: {
        cloudProvider: true,
        cloudResourceType: true,
        providerResourceId: true,
        cloudEndpoints: true,
      },
    })
      .then((item: CloudResource | null) => {
        if (isCurrent) {
          setResource(item);
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

  if (error || !resource) {
    return (
      <ErrorMessage message={error || RESOURCE_SECURITY_EVENTS_READ_FAILED} />
    );
  }

  if (
    !canCloudResourceHaveSecurityEvents({
      provider: resource.cloudProvider,
      type: resource.cloudResourceType,
      providerResourceId: resource.providerResourceId,
      cloudEndpoints: resource.cloudEndpoints,
    })
  ) {
    return (
      <EmptyState
        id="cloud-resource-no-security-events"
        icon={IconProp.ShieldCheck}
        title={CLOUD_RESOURCE_NO_SECURITY_EVENTS_TITLE}
        description={CLOUD_RESOURCE_NO_SECURITY_EVENTS_DESCRIPTION}
        size={EmptyStateSize.Page}
      />
    );
  }

  return (
    <ResourceSecurityEventsPage
      {...props}
      kind={SecurityConnectionKind.CloudResource}
      emptyContent={
        <ResourceSecurityEventsEmptyState
          kind={SecurityConnectionKind.CloudResource}
          cloudProvider={(resource.cloudProvider || "").toLowerCase()}
          isNamedByAuditLog={isCloudResourceNamedByItsId(
            resource.providerResourceId,
          )}
          hasOwnLogs={canCloudResourceHaveStreamedLogs({
            provider: resource.cloudProvider,
            type: resource.cloudResourceType,
          })}
        />
      }
    />
  );
};

export default CloudResourceSecurityEvents;
