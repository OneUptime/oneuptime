import React, { FunctionComponent, ReactElement } from "react";
import IconProp from "Common/Types/Icon/IconProp";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import SetupGuideCard, {
  SetupGuideRenderContext,
} from "../SetupGuide/SetupGuideCard";
import { SetupGuideContent } from "../SetupGuide/SetupGuide";
import {
  STORAGE_ARRAY_PLATFORMS,
  getStorageArrayPlatformForSystem,
  getStorageArraySetupGuide,
  resolveStorageArrayPlatform,
} from "../../Pages/StorageArray/Utils/DocumentationMarkdown";

export interface ComponentProps {
  title: string;
  description: string;
  /*
   * The array being set up (its Documentation tab). Omitted on the product
   * pages, where the guide suggests a name for a new array instead.
   */
  arrayName?: string | undefined;
  /*
   * The array's platform (StorageArray.storageSystem), once it has
   * reported one: the guide then opens on that platform.
   */
  storageSystem?: string | undefined;
}

const StorageArrayDocumentationCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <SetupGuideCard
      title={props.title}
      description={props.description}
      icon={IconProp.StorageArray}
      newKeyName={translationKey("Storage Array key")}
      optionsLabel="Which array are you connecting?"
      options={STORAGE_ARRAY_PLATFORMS}
      initialOption={getStorageArrayPlatformForSystem(props.storageSystem)}
      keyStepDescription="The agent sends your array's metrics to OneUptime with this key. Pick an existing key or create a new one — the commands below update to use it."
      getContent={(context: SetupGuideRenderContext): SetupGuideContent => {
        return getStorageArraySetupGuide({
          oneuptimeUrl: context.oneuptimeUrl,
          apiKey: context.apiKey,
          hasApiKey: context.hasApiKey,
          platform: resolveStorageArrayPlatform(context.option),
          arrayName: props.arrayName,
        });
      }}
    />
  );
};

export default StorageArrayDocumentationCard;
