import { CloudProvider } from "Common/Types/Cloud/CloudPlatform";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A cloud's mark on Cloud > Connect: a cloud on the provider's colour, so a
 * tile and a row of the list read as the same cloud at a glance. A plain
 * mark, not the provider's logo.
 */

const MARK_COLOURS: Record<CloudProvider, string> = {
  [CloudProvider.AWS]: "bg-orange-600 text-white",
  [CloudProvider.Azure]: "bg-sky-600 text-white",
  [CloudProvider.GCP]: "bg-emerald-600 text-white",
};

export interface ComponentProps {
  provider: CloudProvider | string | undefined;
  size?: "sm" | "md" | "lg" | undefined;
}

const CloudConnectionLogo: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const size: "sm" | "md" | "lg" = props.size || "md";
  const box: string =
    size === "lg" ? "h-10 w-10" : size === "sm" ? "h-6 w-6" : "h-8 w-8";
  const glyph: string =
    size === "lg" ? "h-5 w-5" : size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";
  const colours: string =
    MARK_COLOURS[props.provider as CloudProvider] || "bg-gray-200 text-gray-600";

  return (
    <span
      aria-hidden="true"
      data-testid={`cloud-connection-logo-${props.provider || "unknown"}`}
      className={`inline-flex flex-shrink-0 items-center justify-center rounded-lg ${box} ${colours}`}
    >
      <Icon icon={IconProp.Cloud} className={glyph} />
    </span>
  );
};

export default CloudConnectionLogo;
