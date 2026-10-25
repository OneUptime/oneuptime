import React, { ReactElement } from "react";
import CephCluster from "Common/Models/DatabaseModels/CephCluster";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  ResourceGuideProps,
  ResourceOnboarding,
} from "../ResourceOnboarding/AddResourceGuide";
import CephDocumentationCard from "./DocumentationCard";
import PageMap from "../../Utils/PageMap";
import { CEPH_EXAMPLE_CLUSTER_NAME } from "../../Pages/Ceph/Utils/DocumentationMarkdown";

/*
 * Adding a Ceph cluster: name it, pick how the agent is installed and a
 * key, start it, and the guide's last step says when it connected. The
 * cluster registers itself under that name (findOrCreateByName).
 */
const CEPH_CLUSTER_ONBOARDING: ResourceOnboarding = {
  modelType: CephCluster,
  addTitle: translationKey("Add Ceph Cluster"),
  addDescription: translationKey(
    "Run the OneUptime Ceph agent next to the cluster. The cluster shows up here as soon as the agent connects.",
  ),
  firstRunTitle: translationKey("Getting Started with Ceph Monitoring"),
  viewText: translationKey("View cluster"),
  viewPage: PageMap.CEPH_CLUSTER_VIEW,
  name: {
    label: translationKey("Cluster name"),
    field: "name",
    example: CEPH_EXAMPLE_CLUSTER_NAME,
  },
  renderGuide: (props: ResourceGuideProps): ReactElement => {
    return (
      <CephDocumentationCard
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

export default CEPH_CLUSTER_ONBOARDING;
