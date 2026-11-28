import React, { ReactElement } from "react";
import XcpNgPool from "Common/Models/DatabaseModels/XcpNgPool";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  ResourceGuideProps,
  ResourceOnboarding,
} from "../ResourceOnboarding/AddResourceGuide";
import XcpNgDocumentationCard from "./DocumentationCard";
import PageMap from "../../Utils/PageMap";

/*
 * Adding XCP-ng: turn on Xen Orchestra's OpenMetrics plugin, run the agent
 * next to Xen Orchestra with a key, and the guide's last step says when the
 * first pool's data arrived. One agent reads every pool its Xen Orchestra
 * manages, and each pool registers itself by its UUID, named as Xen
 * Orchestra names it (pool_name), so the guide asks for no name.
 */
const XCP_NG_POOL_ONBOARDING: ResourceOnboarding = {
  modelType: XcpNgPool,
  addTitle: translationKey("Add XCP-ng Pool"),
  addDescription: translationKey(
    "Turn on Xen Orchestra's OpenMetrics plugin and run the OneUptime XCP-ng Agent next to it. Every pool that Xen Orchestra manages shows up here as soon as its first data arrives.",
  ),
  viewText: translationKey("View pool"),
  viewPage: PageMap.XCP_NG_POOL_VIEW,
  renderGuide: (props: ResourceGuideProps): ReactElement => {
    return (
      <XcpNgDocumentationCard
        title={props.title}
        description={props.description}
        isBare={props.isBare}
        inputs={props.inputs}
        lastStep={props.lastStep}
      />
    );
  },
};

export default XCP_NG_POOL_ONBOARDING;
