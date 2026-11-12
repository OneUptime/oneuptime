import Span from "Common/Models/AnalyticsModels/Span";
import Service from "Common/Models/DatabaseModels/Service";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import Navigation from "Common/UI/Utils/Navigation";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import { withoutOpenStackCloudName } from "Common/Utils/OpenStack/OpenStackTraces";
import React, { FunctionComponent, ReactElement, useMemo } from "react";
import {
  OpenStackControlPlaneSpans,
  fetchOpenStackControlPlaneSpans,
} from "../../../Pages/OpenStack/Utils/OpenStackTraceReads";
import TraceServiceMap from "../../Traces/TraceServiceMap";
import useOpenStackRead, { OpenStackRead } from "../Part/UseOpenStackRead";
import { getOpenStackTraceRoute } from "./OpenStackTraceARequestCard";

/*
 * The control plane, drawn from the newest traces: which service called which, how often and
 * how long it took. It is what those requests crossed and no more, so it says that: a service
 * no traced request reached is not on it, and that does not mean anything is wrong with it.
 * The services are named without their cloud, because this page is already about one.
 */

const MAP_CAPTION: string = translationKey(
  "Click a service or a call to open the trace of its slowest span.",
);

export interface ComponentProps {
  cloudName: string;
  // Those that cross the most services first.
  traceIds: Array<string>;
}

const OpenStackControlPlaneMapCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const read: OpenStackRead<OpenStackControlPlaneSpans> =
    useOpenStackRead<OpenStackControlPlaneSpans>(() => {
      return fetchOpenStackControlPlaneSpans(props.traceIds);
    }, [props.traceIds.join(",")]);

  const services: Array<Service> = useMemo(() => {
    return (read.data?.services || []).map((service: Service): Service => {
      const named: Service = new Service();
      if (service._id) {
        named._id = service._id;
      }
      if (service.serviceColor) {
        named.serviceColor = service.serviceColor;
      }
      named.name = withoutOpenStackCloudName({
        serviceName: service.name || "",
        cloudName: props.cloudName,
      });

      return named;
    });
  }, [read.data?.services, props.cloudName]);

  const spans: Array<Span> = read.data?.spans || [];

  return (
    <Card
      title="Control plane"
      description="What your widest traces crossed: which service called which, how often and how long it took. A service no traced request reached is not on it, and that says nothing about its health."
    >
      <div data-testid="openstack-control-plane-map">
        {read.isLoading && !read.data ? (
          <PageLoader isVisible={true} />
        ) : read.error ? (
          <ErrorMessage message={read.error} />
        ) : (
          <TraceServiceMap
            spans={spans}
            telemetryServices={services}
            caption={MAP_CAPTION}
            onSpanSelect={(spanId: string) => {
              const span: Span | undefined = spans.find(
                (candidate: Span): boolean => {
                  return candidate.spanId === spanId;
                },
              );

              if (span?.traceId) {
                Navigation.navigate(
                  getOpenStackTraceRoute(span.traceId).addQueryParams({
                    spanId: spanId,
                  }),
                );
              }
            }}
          />
        )}
      </div>
    </Card>
  );
};

export default OpenStackControlPlaneMapCard;
