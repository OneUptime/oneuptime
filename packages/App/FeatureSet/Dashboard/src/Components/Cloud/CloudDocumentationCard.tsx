import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ResourceDocumentationCard from "../TelemetryResource/ResourceDocumentationCard";
import {
  DEFAULT_CLOUD_DOC_PLATFORM,
  DocVars,
  getCloudDocMarkdownForPlatform,
} from "../TelemetryResource/documentationMarkdown";
import Dropdown, {
  DropdownOption,
  DropdownOptionGroup,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import {
  CLOUD_PROVIDER_LABELS,
  CloudProvider,
  MANAGED_CLOUD_PLATFORMS,
  ManagedCloudPlatform,
  ManagedCloudPlatformDescriptor,
  isManagedCloudPlatform,
} from "Common/Types/Cloud/CloudPlatform";

/*
 * The "Connect a managed cloud environment" guide, with a platform picker.
 *
 * Contract used by Pages/Cloud/CloudResources.tsx (empty state) and
 * Pages/Cloud/View/Documentation.tsx (per-environment tab):
 *
 *   - `initialPlatform` pre-selects the picker (an environment's own
 *     cloud.platform, when known); an unknown or missing value falls back to
 *     the default platform (AWS ECS).
 *   - The rendered guide is per platform: console navigation steps, the
 *     collector / SDK configuration, networking and IAM notes, and how to
 *     verify, followed by a link to the full docs page for that platform.
 *
 * The picker's options come from the shared platform registry, so it can
 * only ever offer a platform ingest accepts, and adding a platform to the
 * registry adds it here without touching this file.
 */
export interface ComponentProps {
  title: string;
  description: string;
  initialPlatform?: string | undefined;
}

const toDropdownOption: (
  descriptor: ManagedCloudPlatformDescriptor,
) => DropdownOption = (
  descriptor: ManagedCloudPlatformDescriptor,
): DropdownOption => {
  return {
    value: descriptor.platform,
    label: descriptor.productName,
    description: descriptor.description,
  };
};

/*
 * Grouped by provider (AWS, Google Cloud, Azure) in registry order. Eight
 * flat entries are readable, but the grouping is what lets someone who only
 * knows "we are on Azure" find their platform without reading all eight.
 */
const PLATFORM_OPTION_GROUPS: Array<DropdownOptionGroup> = Object.values(
  CloudProvider,
).map((provider: CloudProvider): DropdownOptionGroup => {
  return {
    label: CLOUD_PROVIDER_LABELS[provider],
    options: MANAGED_CLOUD_PLATFORMS.filter(
      (descriptor: ManagedCloudPlatformDescriptor): boolean => {
        return descriptor.provider === provider;
      },
    ).map(toDropdownOption),
  };
});

const PLATFORM_OPTIONS: Array<DropdownOption> =
  MANAGED_CLOUD_PLATFORMS.map(toDropdownOption);

/*
 * The value comes from a database column, so it may be empty (an environment
 * created by hand that ingest has not matched yet) or something ingest would
 * not accept. Neither should blank the guide.
 */
const resolvePlatform: (
  candidate: string | null | undefined,
) => ManagedCloudPlatform = (
  candidate: string | null | undefined,
): ManagedCloudPlatform => {
  if (isManagedCloudPlatform(candidate)) {
    return candidate as ManagedCloudPlatform;
  }
  return DEFAULT_CLOUD_DOC_PLATFORM;
};

const CloudDocumentationCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [platform, setPlatform] = useState<ManagedCloudPlatform>(
    resolvePlatform(props.initialPlatform),
  );

  /*
   * The environment page renders this card only after the environment has
   * loaded, so `initialPlatform` is normally known at mount. This covers a
   * parent that learns the platform later — the picker follows it, but a
   * choice the reader already made is never overridden by an unknown value.
   */
  useEffect(() => {
    if (isManagedCloudPlatform(props.initialPlatform)) {
      setPlatform(props.initialPlatform as ManagedCloudPlatform);
    }
  }, [props.initialPlatform]);

  const selectedOption: DropdownOption | undefined = PLATFORM_OPTIONS.find(
    (option: DropdownOption): boolean => {
      return option.value === platform;
    },
  );

  const buildMarkdown: (vars: DocVars) => string = (vars: DocVars): string => {
    return getCloudDocMarkdownForPlatform(vars, platform);
  };

  return (
    <div>
      <div className="mb-4 rounded-lg border border-gray-200 bg-white px-4 py-3">
        <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
          Cloud platform
        </label>
        <Dropdown
          options={PLATFORM_OPTION_GROUPS}
          value={selectedOption}
          onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
            if (typeof value === "string" && isManagedCloudPlatform(value)) {
              setPlatform(value as ManagedCloudPlatform);
            }
          }}
          placeholder="Select a cloud platform"
          ariaLabel="Select cloud platform"
          dataTestId="cloud-platform-picker"
        />
        <p className="mt-2 text-xs text-gray-500">
          The guide below is specific to the selected platform: where the
          settings go in its console, whether a sidecar collector is needed, and
          the IAM and networking that has to be in place.
        </p>
      </div>
      <ResourceDocumentationCard
        title={props.title}
        description={props.description}
        buildMarkdown={buildMarkdown}
      />
    </div>
  );
};

export default CloudDocumentationCard;
