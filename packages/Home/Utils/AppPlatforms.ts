import {
  CloudProvider,
  MANAGED_CLOUD_PLATFORMS,
  ManagedCloudPlatform,
  ManagedCloudPlatformDescriptor,
  getCloudProviderLabel,
} from "Common/Types/Cloud/CloudPlatform";

/*
 * The App Platforms product page (/product/app-platforms) lists the
 * platforms the product reads, from the product's own catalog
 * (MANAGED_CLOUD_PLATFORMS): the platform an environment is filed under in
 * the Dashboard is a row of that catalog, so the page cannot promise one the
 * product does not know, or leave one out. Each platform links to the docs
 * page that sets it up.
 */

export interface AppPlatformCard {
  // The cloud.platform value the platform's telemetry carries ("aws_ecs").
  platform: string;
  // "AWS ECS / Fargate": the platform as its users call it.
  name: string;
  provider: CloudProvider;
  providerLabel: string;
  // The docs page that walks the platform's setup.
  docsUrl: string;
}

export interface AppPlatformProviderGroup {
  provider: CloudProvider;
  label: string;
  platforms: Array<AppPlatformCard>;
}

export interface AppPlatformsPageContent {
  platforms: Array<AppPlatformCard>;
  providers: Array<AppPlatformProviderGroup>;
}

// The three container platforms have a docs page each; the rest share one.
const PLATFORM_DOCS: Readonly<Partial<Record<ManagedCloudPlatform, string>>> = {
  [ManagedCloudPlatform.AwsEcs]: "/docs/telemetry/cloud-aws-ecs",
  [ManagedCloudPlatform.GcpCloudRun]: "/docs/telemetry/cloud-gcp-cloud-run",
  [ManagedCloudPlatform.AzureContainerApps]:
    "/docs/telemetry/cloud-azure-container-apps",
};

export const OTHER_PLATFORMS_DOCS_URL: string =
  "/docs/telemetry/cloud-other-platforms";

// The providers in the order the page draws them.
const PROVIDER_ORDER: ReadonlyArray<CloudProvider> = [
  CloudProvider.AWS,
  CloudProvider.GCP,
  CloudProvider.Azure,
];

export function getAppPlatformCards(): Array<AppPlatformCard> {
  return MANAGED_CLOUD_PLATFORMS.map(
    (descriptor: ManagedCloudPlatformDescriptor): AppPlatformCard => {
      return {
        platform: descriptor.platform,
        name: descriptor.productName,
        provider: descriptor.provider,
        providerLabel: getCloudProviderLabel(descriptor.provider),
        docsUrl: PLATFORM_DOCS[descriptor.platform] || OTHER_PLATFORMS_DOCS_URL,
      };
    },
  );
}

export function getAppPlatformsPageContent(): AppPlatformsPageContent {
  const platforms: Array<AppPlatformCard> = getAppPlatformCards();

  return {
    platforms: platforms,
    providers: PROVIDER_ORDER.map(
      (provider: CloudProvider): AppPlatformProviderGroup => {
        return {
          provider: provider,
          label: getCloudProviderLabel(provider),
          platforms: platforms.filter((card: AppPlatformCard): boolean => {
            return card.provider === provider;
          }),
        };
      },
    ).filter((group: AppPlatformProviderGroup): boolean => {
      return group.platforms.length > 0;
    }),
  };
}
