import React, { FunctionComponent, ReactElement } from "react";

export enum AlertBannerType {
  Success = "success",
  Warning = "warning",
  Danger = "danger",
  Info = "info",
}

export interface ComponentProps {
  title: string;
  type: AlertBannerType;
  children?: ReactElement | undefined;
  rightElement?: ReactElement | undefined;
  className?: string | undefined;
}

const bannerStyles: Record<
  AlertBannerType,
  { container: string; dot: string; title: string }
> = {
  [AlertBannerType.Success]: {
    container: "bg-emerald-50 border-emerald-200",
    dot: "bg-emerald-500",
    title: "text-emerald-800",
  },
  [AlertBannerType.Warning]: {
    container: "bg-amber-50 border-amber-200",
    dot: "bg-amber-500",
    title: "text-amber-800",
  },
  [AlertBannerType.Danger]: {
    container: "bg-red-50 border-red-200",
    dot: "bg-red-500",
    title: "text-red-800",
  },
  [AlertBannerType.Info]: {
    container: "bg-blue-50 border-blue-200",
    dot: "bg-blue-500",
    title: "text-blue-800",
  },
};

const AlertBanner: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const styles: { container: string; dot: string; title: string } =
    bannerStyles[props.type];

  return (
    <div
      className={`rounded-lg border p-4 ${styles.container} ${props.className || ""}`}
      role="alert"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span
            className={`inline-flex h-3 w-3 rounded-full ${styles.dot}`}
          />
          <span className={`text-lg font-semibold ${styles.title}`}>
            {props.title}
          </span>
        </div>
        {props.rightElement && <div>{props.rightElement}</div>}
      </div>
      {props.children && <div className="mt-2">{props.children}</div>}
    </div>
  );
};

export default AlertBanner;
