import Clipboard from "../../Utils/Clipboard";
import React, {
  FunctionComponent,
  MouseEventHandler,
  ReactElement,
} from "react";
import Icon from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";

export interface ComponentProps {
  textToBeCopied: string;
  className?: string | undefined;
  size?: "xs" | "sm" | "md"; // visual size
  variant?: "ghost" | "soft" | "solid"; // visual style
  iconOnly?: boolean; // render only icon without label
  label?: string; // default: "Copy"
  copiedLabel?: string; // default: "Copied!"
  title?: string; // tooltip
}

const CopyTextButton: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [copied, setCopied] = React.useState(false);

  const size: "xs" | "sm" | "md" = props.size || "xs";
  const variant: "ghost" | "soft" | "solid" = props.variant || "ghost";
  const label: string = props.label || "Copy";
  const copiedLabel: string = props.copiedLabel || "Copied!";

  const handleCopy: MouseEventHandler<HTMLButtonElement> = async (
    event: React.MouseEvent<HTMLButtonElement, MouseEvent>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    await Clipboard.copyToClipboard(props.textToBeCopied);
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
    }, 1000);
  };

  const sizeClasses: Record<typeof size, string> = {
    xs: "text-[10px] px-1.5 py-0.5 rounded",
    sm: "text-xs px-2 py-1 rounded-md",
    md: "text-sm px-2.5 py-1.5 rounded-md",
  } as const;

  const iconSizes: Record<typeof size, string> = {
    xs: "w-3.5 h-3.5",
    sm: "w-4 h-4",
    md: "w-4.5 h-4.5",
  } as const;

  const variantClasses: Record<typeof variant, string> = {
    ghost:
      "bg-transparent border border-gray-200 text-gray-400 hover:bg-gray-50 hover:text-gray-600",
    soft: "bg-gray-100 text-gray-600 border border-gray-200 hover:bg-gray-200",
    solid:
      "bg-indigo-600 text-white border border-indigo-600 hover:bg-indigo-500",
  } as const;

  const copiedClasses: string =
    "bg-emerald-50 border border-emerald-200 text-emerald-600";

  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-1 transition-colors duration-150 cursor-pointer select-none ${
        copied ? copiedClasses : variantClasses[variant]
      } ${sizeClasses[size]} ${props.className || ""}`}
      onClick={handleCopy}
      onKeyDown={(e: React.KeyboardEvent<HTMLButtonElement>) => {
        if (e.key === "Enter" || e.key === " ") {
          handleCopy(e as unknown as React.MouseEvent<HTMLButtonElement>);
        }
      }}
      title={props.title || label}
      aria-label={props.title || label}
    >
      {/* Icon */}
      <span aria-hidden="true" className="flex items-center justify-center">
        {copied ? (
          <Icon
            icon={IconProp.Check}
            className={`${iconSizes[size]} text-emerald-400`}
          />
        ) : (
          <Icon icon={IconProp.Copy} className={`${iconSizes[size]}`} />
        )}
      </span>
      {/* Label (optional) */}
      {!props.iconOnly && <span>{copied ? copiedLabel : label}</span>}
    </button>
  );
};

export default CopyTextButton;
