import ToolImportSource from "Common/Types/ToolImport/ToolImportSource";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A tile that tells the tools apart at a glance: the tool's initial on a
 * square in a colour of its own. Drawn rather than loaded, so it needs no
 * request and reads the same in both themes (white on a solid colour).
 *
 * A tool added to ToolImportSource gets its colour and initial here.
 */

export type ToolImportLogoSize = "md" | "lg";

const TILE_CLASS: Record<ToolImportLogoSize, string> = {
  md: "h-9 w-9",
  lg: "h-11 w-11",
};

export const TOOL_IMPORT_LOGOS: Record<
  ToolImportSource,
  { color: string; initial: string }
> = {
  [ToolImportSource.OpsGenie]: { color: "#2563EB", initial: "O" },
  [ToolImportSource.IncidentIo]: { color: "#E5484D", initial: "i" },
};

export interface ComponentProps {
  source: ToolImportSource;
  size?: ToolImportLogoSize | undefined;
}

const ToolImportLogo: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const logo: { color: string; initial: string } = TOOL_IMPORT_LOGOS[
    props.source
  ] || { color: "#6B7280", initial: "?" };

  return (
    <svg
      viewBox="0 0 32 32"
      className={`flex-shrink-0 ${TILE_CLASS[props.size || "md"]}`}
      aria-hidden="true"
      focusable="false"
      data-testid={`tool-import-logo-${props.source}`}
    >
      <rect width="32" height="32" rx="8" fill={logo.color} />
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
        {logo.initial}
      </text>
    </svg>
  );
};

export default ToolImportLogo;
