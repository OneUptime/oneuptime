import ResellerPlanNotice from "../Billing/ResellerPlanNotice";
import PageComponentProps from "../../Pages/PageComponentProps";
import SecurityCaseApi from "../SecurityCase/SecurityCaseApi";
import SecurityEventsViewer, {
  SecurityEventsViewerScope,
} from "../SecurityEvents/SecurityEventsViewer";
import ResourceSecurityEventsEmptyState from "./ResourceSecurityEventsEmptyState";
import {
  ResourceSecurityEventsChipWords,
  getResourceSecurityEventsChip,
} from "./ResourceSecurityEventsScope";
import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import ObjectID from "Common/Types/ObjectID";
import {
  ResourceSecurityScopeJson,
  SecurityConnectionKind,
} from "Common/Types/SecurityCase/SecurityConnection";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageSkeleton from "Common/UI/Components/Page/PageSkeleton";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";

/*
 * A RECORD'S OWN SECURITY EVENTS PAGE (#5769, #9547): the Security Events
 * explorer - search, severity, class and status facets, the time range, the
 * volume chart, each event's panel with the cases, alerts and incidents it
 * led to and the records it names - on the security events about one host,
 * Kubernetes cluster or network device, as its Logs page is the Logs
 * explorer on its logs.
 *
 * The events about it are those naming its exact identities, or read from
 * its own logs - the ones its Security card on Overview counts. The server
 * says which (POST /security-case/resource-security-scope): it knows the
 * record's names and which of its public addresses are its own, and reads
 * the record with the reader's own permissions. The explorer shows the
 * scope as a locked chip and never reads outside it: without a scope,
 * nothing is read.
 */

export const RESOURCE_SECURITY_EVENTS_READ_FAILED: string = translationKey(
  "The security events of this record could not be read.",
);

export interface ComponentProps extends PageComponentProps {
  kind: SecurityConnectionKind;
  // The page's own empty state; the shared one, for its kind, when not given.
  emptyContent?: ReactElement | undefined;
  // The chip's words, when the page's record says them its own way (a device's syslog).
  chipWords?: ResourceSecurityEventsChipWords | undefined;
  // What a failed read says, naming the record.
  failedReadMessage?: string | undefined;
}

const ResourceSecurityEventsPage: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const readGate: PermissionGateResult = PermissionGate.check(
    new SecurityEvent(),
    ModelAction.Read,
  );
  // Refused for certain: the gate knows the reader's permissions, and says why.
  const refusal: string | undefined = readGate.isAllowed
    ? undefined
    : readGate.disabledReason;
  const isTelemetryDisabled: boolean =
    props.currentProject?.reseller?.enableTelemetryFeatures === false;

  const [recordScope, setRecordScope] =
    useState<ResourceSecurityScopeJson | null>(null);
  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    if (refusal || isTelemetryDisabled) {
      setIsLoading(false);
      return () => {};
    }

    let isCurrent: boolean = true;

    setIsLoading(true);
    setError("");

    SecurityCaseApi.getResourceSecurityScope({
      kind: props.kind,
      id: modelId,
    })
      .then((result: ResourceSecurityScopeJson) => {
        if (isCurrent) {
          setRecordScope(result);
        }
      })
      .catch((err: unknown) => {
        // Never the project's every event: without the scope, nothing is read.
        if (isCurrent) {
          setRecordScope(null);
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
  }, [props.kind, modelId.toString(), refusal, isTelemetryDisabled]);

  const viewerScope: SecurityEventsViewerScope | null = useMemo(() => {
    if (!recordScope) {
      return null;
    }

    return {
      query: recordScope.scope,
      chip: getResourceSecurityEventsChip(recordScope, props.chipWords),
      emptyContent: props.emptyContent || (
        <ResourceSecurityEventsEmptyState kind={props.kind} />
      ),
    };
  }, [recordScope, props.kind, props.emptyContent, props.chipWords]);

  if (isTelemetryDisabled) {
    return (
      <ResellerPlanNotice
        project={props.currentProject}
        product="Security Events"
      />
    );
  }

  if (refusal) {
    return <ErrorMessage message={refusal} />;
  }

  if (isLoading) {
    return <PageSkeleton shape="table" />;
  }

  if (!viewerScope) {
    return (
      <ErrorMessage
        message={
          error ||
          props.failedReadMessage ||
          RESOURCE_SECURITY_EVENTS_READ_FAILED
        }
      />
    );
  }

  return (
    <SecurityEventsViewer
      key={`${props.kind}-security-events-${modelId.toString()}`}
      scope={viewerScope}
    />
  );
};

export default ResourceSecurityEventsPage;
