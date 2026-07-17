import React, { FunctionComponent, ReactElement, ReactNode } from "react";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";

/*
 * The one hint/warning chip idiom for the metric viewer: a quiet rounded
 * chip with a leading icon. Used for the cumulative-counter rate hint,
 * the overlay unit-mismatch warning, formula validation errors, and the
 * explorer's header errors, so every inline caution reads the same way.
 */
export type HintChipVariant = "amber" | "red";

export interface ComponentProps {
  variant?: HintChipVariant | undefined;
  icon?: IconProp | undefined;
  children: ReactNode;
  className?: string | undefined;
}

const VARIANT_CLASSES: Record<HintChipVariant, string> = {
  amber: "border-amber-200 bg-amber-50 text-amber-800",
  red: "border-red-200 bg-red-50 text-red-700",
};

const ICON_CLASSES: Record<HintChipVariant, string> = {
  amber: "text-amber-500",
  red: "text-red-500",
};

const HintChip: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const variant: HintChipVariant = props.variant || "amber";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${
        VARIANT_CLASSES[variant]
      } ${props.className || ""}`}
    >
      <Icon
        icon={
          props.icon || (variant === "red" ? IconProp.Error : IconProp.Info)
        }
        className={`h-3.5 w-3.5 shrink-0 ${ICON_CLASSES[variant]}`}
      />
      {props.children}
    </span>
  );
};

export default HintChip;
