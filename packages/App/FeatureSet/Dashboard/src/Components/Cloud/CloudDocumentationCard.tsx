import React, { FunctionComponent, ReactElement } from "react";
import IconProp from "Common/Types/Icon/IconProp";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import SetupGuideCard, {
  SetupGuideRenderContext,
} from "../SetupGuide/SetupGuideCard";
import { SetupGuideContent } from "../SetupGuide/SetupGuide";
import {
  CLOUD_PLATFORM_OPTIONS,
  getCloudSetupGuide,
  resolveCloudPlatform,
} from "./CloudSetupGuide";

/*
 * The "Connect a managed cloud environment" guide, with a platform picker.
 *
 * Contract used by Pages/Cloud/CloudResources.tsx (empty state) and
 * Pages/Cloud/View/Documentation.tsx (per-environment tab):
 *
 *   - `initialPlatform` pre-selects the picker (an environment's own
 *     cloud.platform, when known); an unknown or missing value falls back to
 *     the default platform (AWS ECS), and a valid one the page learns later
 *     moves the picker without ever overriding a choice with an unknown one.
 *   - The guide below the picker is that platform's alone: storing the token
 *     as a secret, the service or task settings, and how to verify, with
 *     networking and troubleshooting folded away.
 *
 * The picker's options come from the shared platform registry, so it can
 * only ever offer a platform ingest accepts.
 */
export interface ComponentProps {
  title: string;
  description: string;
  initialPlatform?: string | undefined;
}

const CloudDocumentationCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <SetupGuideCard
      title={props.title}
      description={props.description}
      icon={IconProp.Cloud}
      newKeyName={translationKey("Cloud key")}
      optionsLabel="Where does your app run?"
      options={CLOUD_PLATFORM_OPTIONS}
      initialOption={props.initialPlatform}
      getContent={(context: SetupGuideRenderContext): SetupGuideContent => {
        return getCloudSetupGuide({
          oneuptimeUrl: context.oneuptimeUrl,
          apiKey: context.apiKey,
          platform: resolveCloudPlatform(context.option),
        });
      }}
    />
  );
};

export default CloudDocumentationCard;
