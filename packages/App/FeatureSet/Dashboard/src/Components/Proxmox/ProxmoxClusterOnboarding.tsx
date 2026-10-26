import React, { ReactElement } from "react";
import ProxmoxCluster from "Common/Models/DatabaseModels/ProxmoxCluster";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  ResourceGuideProps,
  ResourceOnboarding,
} from "../ResourceOnboarding/AddResourceGuide";
import ProxmoxDocumentationCard from "./DocumentationCard";
import PageMap from "../../Utils/PageMap";
import { PROXMOX_EXAMPLE_CLUSTER_NAME } from "../../Pages/Proxmox/Utils/DocumentationMarkdown";

/*
 * Adding a Proxmox cluster: name it, pick how it connects and a key,
 * connect it, and the guide's last step says when its first data arrived.
 * The cluster registers itself under that name (findOrCreateByName).
 */
const PROXMOX_CLUSTER_ONBOARDING: ResourceOnboarding = {
  modelType: ProxmoxCluster,
  addTitle: translationKey("Add Proxmox Cluster"),
  addDescription: translationKey(
    "Connect the cluster with the OneUptime agent or Proxmox VE's native push. It shows up here as soon as its first data arrives.",
  ),
  firstRunTitle: translationKey("Getting Started with Proxmox Monitoring"),
  viewText: translationKey("View cluster"),
  viewPage: PageMap.PROXMOX_CLUSTER_VIEW,
  name: {
    label: translationKey("Cluster name"),
    field: "name",
    example: PROXMOX_EXAMPLE_CLUSTER_NAME,
  },
  renderGuide: (props: ResourceGuideProps): ReactElement => {
    return (
      <ProxmoxDocumentationCard
        title={props.title}
        description={props.description}
        clusterName={props.name}
        isBare={props.isBare}
        inputs={props.inputs}
        lastStep={props.lastStep}
      />
    );
  },
};

export default PROXMOX_CLUSTER_ONBOARDING;
