import PageComponentProps from "../../PageComponentProps";
import DeviceSecurityEventsEmptyState from "../../../Components/NetworkDevice/DeviceSecurityEventsEmptyState";
import { getDeviceSecurityEventsChip } from "../../../Components/NetworkDevice/DeviceSecurityEventsScope";
import SecurityCaseApi from "../../../Components/SecurityCase/SecurityCaseApi";
import SecurityEventsViewer, {
  SecurityEventsViewerScope,
} from "../../../Components/SecurityEvents/SecurityEventsViewer";
import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import ObjectID from "Common/Types/ObjectID";
import {
  ResourceSecurityScopeJson,
  SecurityConnectionKind,
} from "Common/Types/SecurityCase/SecurityConnection";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";

/*
 * One device's Security Events (issue #5769): the Security Events explorer
 * - search, severity, class and status facets, the time range, the volume
 * chart, each event's panel with the cases, alerts and incidents it led to
 * and the records it names - on the security events about this device, as
 * its Logs page is the Logs explorer on its logs.
 *
 * The events about it are those read from the syslog it sends the probe
 * (a firewall's blocked connections and threats, a VPN's and an
 * administrator's sign-ins) and those from any other source naming it -
 * the ones its Security card on Overview counts. The server says which
 * (POST /security-case/resource-security-scope): it knows the device's
 * names and which of its public addresses are its own, and reads the device
 * with the reader's own permissions. The explorer shows the scope as a
 * locked chip and never reads outside it.
 */
const NetworkDeviceSecurityEvents: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
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

  const [deviceScope, setDeviceScope] =
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
      kind: SecurityConnectionKind.NetworkDevice,
      id: modelId,
    })
      .then((result: ResourceSecurityScopeJson) => {
        if (isCurrent) {
          setDeviceScope(result);
        }
      })
      .catch((err: unknown) => {
        // Never the project's every event: without the scope, nothing is read.
        if (isCurrent) {
          setDeviceScope(null);
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
  }, [modelId.toString(), refusal, isTelemetryDisabled]);

  const viewerScope: SecurityEventsViewerScope | null = useMemo(() => {
    if (!deviceScope) {
      return null;
    }

    return {
      query: deviceScope.scope,
      chip: getDeviceSecurityEventsChip(deviceScope),
      emptyContent: <DeviceSecurityEventsEmptyState modelId={modelId} />,
    };
  }, [deviceScope, modelId.toString()]);

  if (isTelemetryDisabled) {
    return (
      <ErrorMessage message="Looks like you have bought this plan from a reseller. It did not include telemetry features in your plan. Telemetry features are disabled for this project." />
    );
  }

  if (refusal) {
    return <ErrorMessage message={refusal} />;
  }

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (!viewerScope) {
    return (
      <ErrorMessage
        message={
          error || "The security events of this device could not be read."
        }
      />
    );
  }

  return (
    <SecurityEventsViewer
      key={`network-device-security-events-${modelId.toString()}`}
      scope={viewerScope}
    />
  );
};

export default NetworkDeviceSecurityEvents;
