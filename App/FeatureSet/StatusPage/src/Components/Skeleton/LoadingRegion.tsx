import React, { FunctionComponent, ReactElement } from "react";
import { useTranslation } from "react-i18next";

export interface ComponentProps {
  children: ReactElement | Array<ReactElement>;
  className?: string | undefined;
}

/*
 * Wraps a group of Skeleton blocks and carries the accessibility semantics for
 * the whole group, so the blocks themselves can stay aria-hidden. Screen
 * readers announce "Loading..." once instead of enumerating placeholders.
 */
const LoadingRegion: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { t } = useTranslation();

  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      className={props.className || ""}
    >
      <span className="sr-only">
        {t("a11y.loading", { defaultValue: "Loading..." })}
      </span>
      {props.children}
    </div>
  );
};

export default LoadingRegion;
