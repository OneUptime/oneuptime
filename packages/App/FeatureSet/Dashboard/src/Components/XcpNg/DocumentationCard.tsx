import React, { FunctionComponent, ReactElement } from "react";
import IconProp from "Common/Types/Icon/IconProp";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import SetupGuideCard, {
  SetupGuideFrameProps,
  SetupGuideRenderContext,
} from "../SetupGuide/SetupGuideCard";
import { SetupGuideContent } from "../SetupGuide/SetupGuide";
import {
  XCP_NG_CONNECT_METHODS,
  getXcpNgSetupGuide,
  resolveXcpNgConnectMethod,
} from "../../Pages/XcpNg/Utils/DocumentationMarkdown";
import { XCP_NG_DOCUMENTATION_TRANSLATIONS } from "../../Pages/XcpNg/Utils/DocumentationTranslations";

export interface ComponentProps extends SetupGuideFrameProps {
  title: string;
  description: string;
  /*
   * The Xen Orchestra the pool is read from (XcpNgPool.xenOrchestraName),
   * on a pool's own Documentation tab: the guide then installs the agent
   * under the same XO_NAME, so a reinstall keeps naming that Xen
   * Orchestra the way the pool's Settings show it. Omitted on the product
   * pages, where the guide suggests a name for a new Xen Orchestra.
   */
  xenOrchestraName?: string | undefined;
}

/*
 * How to connect XCP-ng: turn on Xen Orchestra's OpenMetrics plugin, then
 * run the OneUptime XCP-ng Agent next to Xen Orchestra. One agent reads
 * every pool that Xen Orchestra manages, and each pool appears on its own
 * (by its UUID) when its first data arrives, so the guide asks for no pool
 * name. The guide itself is Pages/XcpNg/Utils/DocumentationMarkdown.ts, in
 * every language through DocumentationTranslations.
 */
const XcpNgDocumentationCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <SetupGuideCard
      title={props.title}
      description={props.description}
      icon={IconProp.XcpNg}
      newKeyName={translationKey("XCP-ng key")}
      optionsLabel="How do you want to install the agent?"
      options={XCP_NG_CONNECT_METHODS}
      keyStepDescription={translationKey(
        "The agent sends your pools' metrics to OneUptime with this key. Pick an existing key or create a new one — the commands below update to use it.",
      )}
      getContent={(context: SetupGuideRenderContext): SetupGuideContent => {
        return getXcpNgSetupGuide({
          oneuptimeUrl: context.oneuptimeUrl,
          apiKey: context.apiKey,
          hasApiKey: context.hasApiKey,
          method: resolveXcpNgConnectMethod(context.option),
          xenOrchestraName: props.xenOrchestraName,
        });
      }}
      translations={XCP_NG_DOCUMENTATION_TRANSLATIONS}
      isBare={props.isBare}
      inputs={props.inputs}
      lastStep={props.lastStep}
    />
  );
};

export default XcpNgDocumentationCard;
