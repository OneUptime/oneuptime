import { TOOL_IMPORT_LOGOS } from "./ToolImportBrand";
import IconProp from "Common/Types/Icon/IconProp";
import ToolImportSource from "Common/Types/ToolImport/ToolImportSource";
import { ProviderLogoSize } from "Common/UI/Components/ProviderLogo/ProviderLogoImage";
import ProviderLogoOrIcon from "Common/UI/Components/ProviderLogo/ProviderLogoOrIcon";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A tool's official mark on its tile (ToolImportBrand says which), so the
 * tools tell apart at a glance - the same mark on the picker, the connect
 * form, the preview, the progress and the earlier imports. The shared
 * marks are part of the installation (never fetched from another address)
 * and drawn in one colour as icons are. A tool this build has no mark for
 * is drawn as an import. The tool's name is always written beside it, so
 * the mark is not read out again.
 */

export type ToolImportLogoSize = "md" | "lg";

const TILE_SIZES: Readonly<Record<ToolImportLogoSize, ProviderLogoSize>> = {
  md: 36,
  lg: 44,
};

export interface ComponentProps {
  source: ToolImportSource;
  size?: ToolImportLogoSize | undefined;
}

const ToolImportLogo: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <span
      data-testid={`tool-import-logo-${props.source}`}
      className="inline-flex flex-shrink-0"
    >
      <ProviderLogoOrIcon
        logo={TOOL_IMPORT_LOGOS[props.source]}
        icon={IconProp.InboxArrowDown}
        size={TILE_SIZES[props.size || "md"]}
        isDecorative={true}
      />
    </span>
  );
};

export default ToolImportLogo;
