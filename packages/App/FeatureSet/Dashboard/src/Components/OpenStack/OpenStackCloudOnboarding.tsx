import React, { ReactElement } from "react";
import OpenStackCloud from "Common/Models/DatabaseModels/OpenStackCloud";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  ResourceGuideProps,
  ResourceOnboarding,
} from "../ResourceOnboarding/AddResourceGuide";
import OpenStackDocumentationCard from "./DocumentationCard";
import PageMap from "../../Utils/PageMap";
import { OPENSTACK_EXAMPLE_CLOUD_NAME } from "../../Pages/OpenStack/Utils/DocumentationMarkdown";

/*
 * Adding an OpenStack cloud: name it, pick how the agent installs and a key,
 * create its credential, and the guide's last step says when its first data
 * arrived. The cloud registers itself under that name (findOrCreateByName).
 */
const OPENSTACK_CLOUD_ONBOARDING: ResourceOnboarding = {
  modelType: OpenStackCloud,
  addTitle: translationKey("Add OpenStack Cloud"),
  addDescription: translationKey(
    "Connect the cloud with the OneUptime OpenStack agent. It shows up here as soon as its first data arrives.",
  ),
  viewText: translationKey("View cloud"),
  viewPage: PageMap.OPENSTACK_CLOUD_VIEW,
  name: {
    label: translationKey("Cloud name"),
    field: "name",
    example: OPENSTACK_EXAMPLE_CLOUD_NAME,
  },
  renderGuide: (props: ResourceGuideProps): ReactElement => {
    return (
      <OpenStackDocumentationCard
        title={props.title}
        description={props.description}
        cloudName={props.name}
        isBare={props.isBare}
        inputs={props.inputs}
        lastStep={props.lastStep}
      />
    );
  },
};

export default OPENSTACK_CLOUD_ONBOARDING;
