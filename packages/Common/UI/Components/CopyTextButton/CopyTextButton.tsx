import useClipboardCopy, { ClipboardCopy } from "../../Utils/UseClipboardCopy";
import React, {
  FunctionComponent,
  MouseEventHandler,
  ReactElement,
} from "react";
import Icon from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import useTranslateValue from "../../Utils/Translation";

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

// How long "Copied!" stays on the button.
export const COPY_TEXT_BUTTON_COPIED_MS: number = 1000;

/*
 * Copies the text, and says what happened: "Copied!" only once it is on the
 * clipboard, "Copy failed" when the browser refused (a plain-http page
 * whose older copy command was refused too, a locked-down frame) - never a
 * tick over an empty clipboard, and never silence (issue #5132).
 */
const CopyTextButton: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const clipboard: ClipboardCopy = useClipboardCopy({
    copiedForMs: COPY_TEXT_BUTTON_COPIED_MS,
  });
  const copied: boolean = clipboard.isCopied;
  const failed: boolean = clipboard.isFailed;

  const size: "xs" | "sm" | "md" = props.size || "xs";
  const variant: "ghost" | "soft" | "solid" = props.variant || "ghost";
  const { translateString } = useTranslateValue();
  const label: string =
    translateString(props.label || "Copy") || props.label || "Copy";
  const title: string | undefined = translateString(props.title);
  // Said in the reader's language, like the label it stands in for.
  const copiedLabel: string =
    translateString(props.copiedLabel || "Copied!") ||
    props.copiedLabel ||
    "Copied!";
  const failedLabel: string = translateString("Copy failed") || "Copy failed";

  const handleCopy: MouseEventHandler<HTMLButtonElement> = async (
    event: React.MouseEvent<HTMLButtonElement, MouseEvent>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    await clipboard.copy(props.textToBeCopied);
  };

  const sizeClasses: Record<typeof size, string> = {
    xs: "text-[10px] px-1.5 py-0.5 rounded",
    sm: "text-xs px-2 py-1 rounded-md",
    md: "text-sm px-2.5 py-1.5 rounded-md",
  } as const;

  /*
   * md is 18px written out: Tailwind's spacing scale has no 4.5, so
   * "w-4.5 h-4.5" matched no rule and the icon was never drawn.
   */
  const iconSizes: Record<typeof size, string> = {
    xs: "w-3.5 h-3.5",
    sm: "w-4 h-4",
    md: "w-[1.125rem] h-[1.125rem]",
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

  const failedClasses: string = "bg-red-50 border border-red-200 text-red-600";

  let stateClasses: string = variantClasses[variant];
  let stateIcon: ReactElement = (
    <Icon icon={IconProp.Copy} className={`${iconSizes[size]}`} />
  );
  let stateText: string = "";

  if (copied) {
    stateClasses = copiedClasses;
    stateIcon = (
      <Icon
        icon={IconProp.Check}
        className={`${iconSizes[size]} text-emerald-400`}
      />
    );
    stateText = copiedLabel;
  } else if (failed) {
    stateClasses = failedClasses;
    stateIcon = <Icon icon={IconProp.Alert} className={`${iconSizes[size]}`} />;
    stateText = failedLabel;
  }

  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-1 transition-colors duration-150 cursor-pointer select-none ${stateClasses} ${sizeClasses[size]} ${props.className || ""}`}
      onClick={handleCopy}
      onKeyDown={(e: React.KeyboardEvent<HTMLButtonElement>) => {
        if (e.key === "Enter" || e.key === " ") {
          handleCopy(e as unknown as React.MouseEvent<HTMLButtonElement>);
        }
      }}
      title={failed ? failedLabel : title || label}
      aria-label={title || label}
      data-copy-state={clipboard.status}
    >
      {/* Icon */}
      <span aria-hidden="true" className="flex items-center justify-center">
        {stateIcon}
      </span>
      {/*
       * The label says what happened, and a screen reader hears it said.
       * With no label, the words are there for the screen reader alone.
       */}
      {props.iconOnly ? (
        <span className="sr-only" aria-live="polite">
          {stateText}
        </span>
      ) : (
        <span aria-live="polite">{stateText || label}</span>
      )}
    </button>
  );
};

export default CopyTextButton;
