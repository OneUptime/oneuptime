import {
  TOOL_IMPORT_BRANDS,
  TOOL_IMPORT_FALLBACK_BRAND,
  ToolImportBrand,
} from "./ToolImportBrand";
import ToolImportSource from "Common/Types/ToolImport/ToolImportSource";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A tile that tells the tools apart at a glance: the tool's initial on a
 * square in a colour of its own (ToolImportBrand). Drawn rather than
 * loaded, so it needs no request and reads the same in both themes (white
 * on a solid colour).
 */

export type ToolImportLogoSize = "md" | "lg";

const TILE_CLASS: Record<ToolImportLogoSize, string> = {
  md: "h-9 w-9",
  lg: "h-11 w-11",
};

export interface ComponentProps {
  source: ToolImportSource;
  size?: ToolImportLogoSize | undefined;
}

const ToolImportLogo: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const brand: ToolImportBrand =
    TOOL_IMPORT_BRANDS[props.source] || TOOL_IMPORT_FALLBACK_BRAND;

  return (
    <svg
      viewBox="0 0 32 32"
      className={`flex-shrink-0 ${TILE_CLASS[props.size || "md"]}`}
      aria-hidden="true"
      focusable="false"
      data-testid={`tool-import-logo-${props.source}`}
    >
      <rect width="32" height="32" rx="8" fill={brand.color} />
      <text
        x="16"
        y="16"
        dy="0.35em"
        textAnchor="middle"
        fontSize="17"
        fontWeight="700"
        fontFamily="Inter, ui-sans-serif, system-ui, sans-serif"
        fill="#FFFFFF"
      >
        {brand.initial}
      </text>
    </svg>
  );
};

export default ToolImportLogo;
