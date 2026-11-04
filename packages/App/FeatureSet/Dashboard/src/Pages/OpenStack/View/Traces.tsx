import PageComponentProps from "../../PageComponentProps";
import OpenStackCloud from "Common/Models/DatabaseModels/OpenStackCloud";
import ObjectID from "Common/Types/ObjectID";
import CollapsibleSection from "Common/UI/Components/CollapsibleSection/CollapsibleSection";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import {
  OPENSTACK_CLOUD_SPAN_ATTRIBUTE,
  OpenStackTracedServices,
} from "Common/Utils/OpenStack/OpenStackTraces";
import { keyForOpenStackCloud } from "Common/Utils/Telemetry/EntityKey";
import React, { FunctionComponent, ReactElement } from "react";
import useOpenStackRead, {
  OpenStackRead,
} from "../../../Components/OpenStack/Part/UseOpenStackRead";
import OpenStackPartNotice from "../../../Components/OpenStack/Part/OpenStackPartNotice";
import OpenStackControlPlaneMapCard from "../../../Components/OpenStack/Traces/OpenStackControlPlaneMapCard";
import OpenStackTraceARequestCard from "../../../Components/OpenStack/Traces/OpenStackTraceARequestCard";
import OpenStackTracesSetupCard from "../../../Components/OpenStack/Traces/OpenStackTracesSetupCard";
import OpenStackTracesStatusCard from "../../../Components/OpenStack/Traces/OpenStackTracesStatusCard";
import TracesViewer from "../../../Components/Traces/TracesViewer";
import {
  fetchOpenStackServicesThatCanBeTraced,
  fetchOpenStackTracedServices,
} from "../Utils/OpenStackTraceReads";

/*
 * A cloud's traces. OSProfiler is off on a cloud until someone turns it on, and it only traces
 * a request signed with a key, so an empty page is the normal state of a healthy cloud and not
 * a fault: it says what this is and how to turn it on, and nothing else in the product depends
 * on it. A read that failed says so instead, because telling someone their tracing is off when
 * OneUptime could not look would send them to change a config that is fine.
 *
 * Spans are found by the cloud's key and not by being OSProfiler's, so anything else that
 * stamps a cloud's name on its spans lands here too: a scheduled check of a later phase, say.
 */

const OpenStackCloudTraces: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const cloud: OpenStackRead<OpenStackCloud | null> =
    useOpenStackRead<OpenStackCloud | null>(() => {
      return ModelAPI.getItem<OpenStackCloud>({
        modelType: OpenStackCloud,
        id: modelId,
        select: { name: true },
      });
    }, [modelId.toString()]);

  const cloudName: string = cloud.data?.name || "";

  const traced: OpenStackRead<OpenStackTracedServices | null> =
    useOpenStackRead<OpenStackTracedServices | null>(() => {
      return cloudName
        ? fetchOpenStackTracedServices(cloudName)
        : Promise.resolve(null);
    }, [cloudName]);

  const canBeTraced: OpenStackRead<Array<string>> = useOpenStackRead<
    Array<string>
  >(() => {
    return fetchOpenStackServicesThatCanBeTraced(modelId);
  }, [modelId.toString()]);

  if (cloud.isLoading && !cloud.data) {
    return <PageLoader isVisible={true} />;
  }

  if (cloud.error) {
    return <ErrorMessage message={cloud.error} />;
  }

  if (!cloudName) {
    return <ErrorMessage message="Cloud not found." />;
  }

  if (traced.error) {
    return (
      <div data-testid="openstack-traces-read-failed">
        <ErrorMessage
          message={traced.error}
          onRefreshClick={() => {
            traced.reload();
          }}
        />
      </div>
    );
  }

  if (traced.isLoading || !traced.data) {
    return <PageLoader isVisible={true} />;
  }

  const hasTraces: boolean = traced.data.lastSpanAt !== null;

  if (!hasTraces) {
    return (
      <div data-testid="openstack-traces-off">
        <OpenStackPartNotice
          testId="openstack-traces-off-notice"
          tone="neutral"
          text="This cloud has sent no traces yet. That is how every cloud starts, and nothing depends on them: OSProfiler is off until you turn it on, and then it only traces a request you sign with your key. Its OpenTelemetry driver is marked experimental by OpenStack, and OpenStack gives no figure for what it costs, so try it on a cloud that can take it first. These steps turn it on."
        />
        <OpenStackTracesSetupCard cloudName={cloudName} />
        <OpenStackTraceARequestCard openStackCloudId={modelId} />
      </div>
    );
  }

  return (
    <div data-testid="openstack-traces-on">
      <OpenStackTracesStatusCard
        traced={traced.data}
        canBeTraced={canBeTraced.data || []}
      />
      <OpenStackTraceARequestCard openStackCloudId={modelId} />
      <OpenStackControlPlaneMapCard
        cloudName={cloudName}
        traceIds={traced.data.traceIds}
      />
      {/*
       * entityScope is the query scope, as on a host's or a cluster's page: spans match by
       * the bloom-indexed `entityKeys` column, and `attributeFilters` is the read-only chip
       * and the histogram's and the facets' scope.
       */}
      <TracesViewer
        attributeFilters={{
          [OPENSTACK_CLOUD_SPAN_ATTRIBUTE]: cloudName,
        }}
        attributeFilterDisplayKeys={{
          [OPENSTACK_CLOUD_SPAN_ATTRIBUTE]: "Cloud",
        }}
        entityScope={{
          entityKeys: [
            keyForOpenStackCloud(
              ProjectUtil.getCurrentProjectId()!.toString(),
              cloudName,
            ),
          ],
          attributeKey: OPENSTACK_CLOUD_SPAN_ATTRIBUTE,
          attributeValue: cloudName,
        }}
      />
      <CollapsibleSection
        title="Set up another machine"
        collapsedDescription="The collector, the libraries and the config, for each deployment tool."
        defaultCollapsed={true}
        className="mt-6"
      >
        <OpenStackTracesSetupCard cloudName={cloudName} />
      </CollapsibleSection>
    </div>
  );
};

export default OpenStackCloudTraces;
