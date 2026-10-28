import { CloudProvider } from "Common/Types/Cloud/CloudPlatform";
import {
  CloudConnectionDefinition,
  getCloudConnectionDefinition,
} from "Common/Types/CloudConnection/CloudConnectionCatalog";
import IconProp from "Common/Types/Icon/IconProp";
import { ProviderLogoSize } from "Common/UI/Components/ProviderLogo/ProviderLogoImage";
import ProviderLogoOrIcon from "Common/UI/Components/ProviderLogo/ProviderLogoOrIcon";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A cloud's official logo on Cloud > Connect (the catalog's logo, drawn by
 * ProviderLogoImage): its tile, its form and its row of the list show the
 * same one, so they read as the same cloud at a glance. A cloud this build
 * does not know is drawn as a cloud. The cloud's name is always written
 * beside it, so the logo is not read out again.
 */

const TILE_SIZES: Readonly<Record<"sm" | "md" | "lg", ProviderLogoSize>> = {
  sm: 24,
  md: 32,
  lg: 40,
};

export interface ComponentProps {
  provider: CloudProvider | string | undefined;
  size?: "sm" | "md" | "lg" | undefined;
}

const CloudConnectionLogo: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const definition: CloudConnectionDefinition | undefined =
    getCloudConnectionDefinition(props.provider);

  return (
    <span
      data-testid={`cloud-connection-logo-${props.provider || "unknown"}`}
      className="inline-flex flex-shrink-0"
    >
      <ProviderLogoOrIcon
        logo={definition?.logo}
        icon={IconProp.Cloud}
        size={TILE_SIZES[props.size || "md"]}
        isDecorative={true}
      />
    </span>
  );
};

export default CloudConnectionLogo;
