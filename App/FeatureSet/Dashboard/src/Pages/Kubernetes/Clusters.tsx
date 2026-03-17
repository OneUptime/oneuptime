import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";

const KubernetesClusters: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <ModelTable<KubernetesCluster>
        modelType={KubernetesCluster}
        id="kubernetes-clusters-table"
        userPreferencesKey="kubernetes-clusters-table"
        isDeleteable={false}
        isEditable={false}
        isCreateable={true}
        name="Kubernetes Clusters"
        isViewable={true}
        filters={[]}
        cardProps={{
          title: "Kubernetes Clusters",
          description:
            "Clusters being monitored in this project. Install the OneUptime kubernetes-agent Helm chart to connect a cluster.",
        }}
        noItemsMessage="No Kubernetes clusters connected yet."
        showViewIdButton={true}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "production-us-east",
          },
          {
            field: {
              clusterIdentifier: true,
            },
            title: "Cluster Identifier",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "production-us-east-1",
            description:
              "This should match the clusterName value in your kubernetes-agent Helm chart.",
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Production cluster running in US East",
          },
        ]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: {
              clusterIdentifier: true,
            },
            title: "Cluster Identifier",
            type: FieldType.Text,
          },
          {
            field: {
              otelCollectorStatus: true,
            },
            title: "Status",
            type: FieldType.Text,
          },
          {
            field: {
              nodeCount: true,
            },
            title: "Nodes",
            type: FieldType.Number,
          },
          {
            field: {
              podCount: true,
            },
            title: "Pods",
            type: FieldType.Number,
          },
          {
            field: {
              provider: true,
            },
            title: "Provider",
            type: FieldType.Text,
          },
        ]}
        onViewPage={(item: KubernetesCluster): Promise<Route> => {
          return Promise.resolve(
            new Route(
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW] as Route,
                {
                  modelId: item._id,
                },
              ).toString(),
            ),
          );
        }}
      />
    </Fragment>
  );
};

export default KubernetesClusters;
