import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Navigation from "Common/UI/Utils/Navigation";
import ProxmoxCluster from "Common/Models/DatabaseModels/ProxmoxCluster";
import CephCluster from "Common/Models/DatabaseModels/CephCluster";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import ArchiveResourceCard from "../../../Components/TelemetryResource/ArchiveResourceCard";
import ResourceDetailsCard from "../../../Components/TelemetryResource/ResourceDetailsCard";
import TelemetryResourceRetentionSettings from "../../../Components/TelemetryResource/TelemetryResourceRetentionSettings";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

const ProxmoxClusterSettings: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <ResourceDetailsCard<ProxmoxCluster>
        modelType={ProxmoxCluster}
        modelId={modelId}
        id="proxmox-cluster-details"
        title="Cluster Details"
        description="How this resource is named, described and labelled everywhere it appears."
        nameField={{
          title: "Name",
          description:
            "Must match the proxmox.cluster.name the Proxmox Agent reports. Telemetry is matched to this cluster by it: rename it on the agent too, or the agent's next report creates a new cluster.",
          placeholder: "pve-production",
        }}
        descriptionField={{
          placeholder: "Production Proxmox cluster running in US East",
        }}
      />
      {/*
       * WI-28: hyperconverged PVE ↔ Ceph cross-link. Manual link ONLY —
       * pve-exporter exposes no Ceph fsid, so there is no honest
       * auto-link heuristic. The linked cluster's health/capacity render
       * as a card on the Proxmox overview (without affecting the Proxmox
       * health badge).
       */}
      <CardModelDetail<ProxmoxCluster>
        name="Ceph Storage Link"
        cardProps={{
          title: "Ceph Storage Link",
          description:
            "Running Ceph under this Proxmox cluster? Link the OneUptime Ceph cluster that backs its storage to get a Ceph health and capacity card on the Proxmox overview. The link is manual — Proxmox metrics carry no Ceph cluster identity.",
        }}
        isEditable={true}
        editButtonText="Edit Link"
        formFields={[
          {
            field: {
              cephCluster: true,
            },
            title: "Ceph Cluster",
            description:
              "The OneUptime Ceph cluster backing this Proxmox cluster's storage. Leave empty to unlink. Ceph health never changes the Proxmox health badge — the two products alert separately.",
            fieldType: FormFieldSchemaType.Dropdown,
            required: false,
            placeholder: "Not linked",
            dropdownModal: {
              type: CephCluster,
              labelField: "name",
              valueField: "_id",
            },
          },
        ]}
        modelDetailProps={{
          modelType: ProxmoxCluster,
          id: "proxmox-cluster-ceph-link",
          modelId: modelId,
          fields: [
            {
              field: {
                cephCluster: {
                  name: true,
                },
              },
              title: "Ceph Cluster",
              fieldType: FieldType.Element,
              getElement: (item: ProxmoxCluster): ReactElement => {
                return (
                  <span>
                    {item.cephCluster?.name ||
                      translator.translateText("Not linked")}
                  </span>
                );
              },
            },
          ],
        }}
      />
      <TelemetryResourceRetentionSettings<ProxmoxCluster>
        modelType={ProxmoxCluster}
        modelId={modelId}
        resourceName="Proxmox cluster"
        modelDetailIdPrefix="model-detail-proxmox-cluster"
      />
      <ArchiveResourceCard<ProxmoxCluster>
        modelType={ProxmoxCluster}
        modelId={modelId}
        singularName="cluster"
        listRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.PROXMOX_CLUSTERS] as Route,
        )}
      />
    </Fragment>
  );
};

export default ProxmoxClusterSettings;
