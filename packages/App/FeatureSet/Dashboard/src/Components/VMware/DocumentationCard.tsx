import React, { FunctionComponent, ReactElement } from "react";
import IconProp from "Common/Types/Icon/IconProp";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import SetupGuideCard, {
  SetupGuideRenderContext,
} from "../SetupGuide/SetupGuideCard";
import { SetupGuideContent } from "../SetupGuide/SetupGuide";
import {
  VMWARE_INSTALL_METHODS,
  getVMwareSetupGuide,
  resolveVMwareInstallMethod,
} from "../../Pages/VMware/Utils/DocumentationMarkdown";

export interface ComponentProps {
  title: string;
  description: string;
  /*
   * The vCenter being set up (its Documentation tab). Omitted on the product
   * pages, where the guide suggests a name for a new vCenter instead.
   */
  vcenterName?: string | undefined;
}

const VMwareDocumentationCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <SetupGuideCard
      title={props.title}
      description={props.description}
      icon={IconProp.VMware}
      newKeyName={translationKey("VMware key")}
      optionsLabel="How do you want to install the agent?"
      options={VMWARE_INSTALL_METHODS}
      keyStepDescription="The agent sends your vCenter's metrics to OneUptime with this key. Pick an existing key or create a new one — the commands below update to use it."
      getContent={(context: SetupGuideRenderContext): SetupGuideContent => {
        return getVMwareSetupGuide({
          oneuptimeUrl: context.oneuptimeUrl,
          apiKey: context.apiKey,
          hasApiKey: context.hasApiKey,
          method: resolveVMwareInstallMethod(context.option),
          vcenterName: props.vcenterName,
        });
      }}
    />
  );
};

export default VMwareDocumentationCard;
