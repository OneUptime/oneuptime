import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import Card from "Common/UI/Components/Card/Card";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import React, { FunctionComponent, ReactElement } from "react";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import ResourceMetricsTab from "../../../Components/Infrastructure/ResourceMetricsTab";
import ResourcePartReadError from "../../../Components/ResourcePart/ResourcePartReadError";
import CephPartHero from "../../../Components/Ceph/Part/CephPartHero";
import CephOsdOverview from "../../../Components/Ceph/Part/CephOsdOverview";
import {
  CephPartRoutes,
  getCephPartRoutes,
} from "../../../Components/Ceph/Part/CephPartRoutes";
import useCephPart, {
  CephPart,
} from "../../../Components/Ceph/Part/UseCephPart";
import { CephAssessment, assessCephOsd } from "../Utils/CephHealth";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * An OSD's page: its hero (its state by the cluster's rules, whether Ceph
 * places data on it, its device class, size and placement groups), then its
 * Overview - what about it needs attention, how full it is and how fast it
 * writes, what is open on it, the OSD alerts and its details - and its
 * metrics over time.
 *
 * The route's part (subModelId) is the OSD's `ceph_daemon` name, osd.3 - not
 * a database id - as the Kubernetes pages' routes carry a part's name.
 */
const CephClusterOsdDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(2);
  const osdName: string = Navigation.getLastParamAsString();

  const part: CephPart = useCephPart({
    clusterId: modelId,
    kind: "Osd",
    externalId: osdName,
  });

  if (part.isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (part.error) {
    return <ErrorMessage message={part.error} />;
  }

  if (!part.cluster?.name) {
    return <ErrorMessage message="Cluster not found." />;
  }

  const clusterName: string = part.cluster.name;
  const routes: CephPartRoutes = getCephPartRoutes(modelId);
  const assessment: CephAssessment | null = part.row
    ? assessCephOsd(part.row, {
        now: part.readAt,
        newestSeenAt: part.newestSeenAt,
      })
    : null;

  const buildOsdQuery: (args: {
    variable: string;
    title: string;
    description: string;
    legend: string;
    legendUnit: string;
    metricName: string;
  }) => MetricQueryConfigData = (args: {
    variable: string;
    title: string;
    description: string;
    legend: string;
    legendUnit: string;
    metricName: string;
  }): MetricQueryConfigData => {
    // The charts draw their titles and legends as they are given.
    return {
      metricAliasData: {
        metricVariable: args.variable,
        title: translator.translateText(args.title) || args.title,
        description: args.description,
        legend: translator.translateText(args.legend) || args.legend,
        legendUnit: args.legendUnit,
      },
      metricQueryData: {
        filterData: {
          metricName: args.metricName,
          attributes: {
            "resource.ceph.cluster.name": clusterName,
            ceph_daemon: osdName,
          },
          aggegationType: AggregationType.Avg,
          aggregateBy: {},
        },
      },
    };
  };

  const queryConfigs: Array<MetricQueryConfigData> = [
    buildOsdQuery({
      variable: "osd_apply_latency",
      title: "Apply Latency",
      description: translator.translateTemplate(
        "Average time for {{osdName}} to apply an operation to its backing store (ms).",
        { osdName: osdName },
      ),
      legend: "Apply Latency",
      legendUnit: "ms",
      metricName: "ceph_osd_apply_latency_ms",
    }),
    buildOsdQuery({
      variable: "osd_commit_latency",
      title: "Commit Latency",
      description: translator.translateTemplate(
        "Average time for {{osdName}} to commit an operation to its journal (ms).",
        { osdName: osdName },
      ),
      legend: "Commit Latency",
      legendUnit: "ms",
      metricName: "ceph_osd_commit_latency_ms",
    }),
    buildOsdQuery({
      variable: "osd_stat_bytes_used",
      title: "Bytes Used",
      description: translator.translateTemplate(
        "Bytes used on {{osdName}}'s backing device.",
        { osdName: osdName },
      ),
      legend: "Used",
      legendUnit: "bytes",
      metricName: "ceph_osd_stat_bytes_used",
    }),
    buildOsdQuery({
      variable: "osd_numpg",
      title: "Placement Groups",
      description: translator.translateTemplate(
        "Number of placement groups hosted on {{osdName}}.",
        { osdName: osdName },
      ),
      legend: "PGs",
      legendUnit: "",
      metricName: "ceph_osd_numpg",
    }),
  ];

  const tabs: Array<Tab> = [
    {
      name: "Overview",
      children: part.isLoadingRows ? (
        <PageLoader isVisible={true} />
      ) : part.rowError ? (
        <ResourcePartReadError
          testId="ceph-osd-read-error"
          title="Couldn't load this OSD"
          message={part.rowError}
          onRetry={part.refresh}
        />
      ) : (
        <CephOsdOverview
          clusterId={modelId}
          clusterName={clusterName}
          externalId={osdName}
          row={part.row}
          newestSeenAt={part.newestSeenAt}
          routes={routes}
          now={part.readAt}
        />
      ),
    },
    {
      name: "Metrics",
      children: (
        <Card
          title={translator.translateTemplate("OSD Metrics: {{osdName}}", {
            osdName: osdName,
          })}
          description="Latency, capacity, and placement-group metrics for this OSD."
        >
          <ResourceMetricsTab queryConfigs={queryConfigs} />
        </Card>
      ),
    },
  ];

  return (
    <div data-testid="ceph-osd-page">
      <CephPartHero
        kind="Osd"
        row={part.row}
        externalId={osdName}
        assessment={assessment}
        clusterName={clusterName}
        clusterRoute={routes.clusterRoute}
        now={part.readAt}
      />
      <Tabs tabs={tabs} wrap={true} onTabChange={() => {}} />
    </div>
  );
};

export default CephClusterOsdDetail;
