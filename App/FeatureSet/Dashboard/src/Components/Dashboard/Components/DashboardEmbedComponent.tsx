import React, { FunctionComponent, ReactElement } from "react";
import DashboardEmbedComponent from "Common/Types/Dashboard/DashboardComponents/DashboardEmbedComponent";
import { DashboardBaseComponentProps } from "./DashboardBaseComponent";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import DashboardVariableInterpolation from "Common/Utils/Dashboard/VariableInterpolation";

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardEmbedComponent;
}

const SAFE_PROTOCOLS: ReadonlyArray<string> = ["http:", "https:"];

const sanitizeUrl: (raw: string) => string | null = (
  raw: string,
): string | null => {
  if (!raw || raw.trim().length === 0) {
    return null;
  }
  const trimmed: string = raw.trim();
  /*
   * Block javascript: / data: / file: schemes — only allow http(s).
   * Without this, an embed panel becomes an XSS vector for anyone with
   * edit access on a dashboard others can view.
   */
  try {
    const parsed: URL = new URL(trimmed);
    if (!SAFE_PROTOCOLS.includes(parsed.protocol)) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
};

const DashboardEmbedComponentElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const interpolatedUrl: string =
    DashboardVariableInterpolation.interpolateString(
      props.component.arguments.url || "",
      props.dashboardVariables || [],
    );
  const url: string | null = sanitizeUrl(interpolatedUrl);

  if (!url) {
    return (
      <div className="flex flex-col items-center justify-center w-full h-full gap-1.5">
        <div className="w-10 h-10 rounded-full bg-indigo-50 flex items-center justify-center">
          <Icon
            icon={IconProp.ExternalLink}
            className="h-5 w-5 text-indigo-300"
          />
        </div>
        <p className="text-xs font-medium text-gray-500">
          {props.component.arguments.title || "Embed Panel"}
        </p>
        <p className="text-xs text-gray-400 text-center max-w-48">
          {interpolatedUrl
            ? "URL must use http or https"
            : "Click to set the embed URL"}
        </p>
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col">
      {props.component.arguments.title && (
        <div className="flex items-center justify-between mb-2 px-1">
          <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">
            {props.component.arguments.title}
          </span>
        </div>
      )}
      <iframe
        title={props.component.arguments.title || "Embed"}
        src={url}
        className="flex-1 w-full rounded-md border border-gray-100 bg-white"
        sandbox={
          props.component.arguments.sandbox
            ? "allow-same-origin allow-scripts"
            : undefined
        }
        /*
         * referrerpolicy and loading help both privacy and perf without
         * breaking common embed targets.
         */
        referrerPolicy="no-referrer"
        loading="lazy"
      />
    </div>
  );
};

export default DashboardEmbedComponentElement;
