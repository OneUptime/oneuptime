import useClipboardCopy, {
  ClipboardCopy,
  ClipboardCopyStatus,
} from "../../Utils/UseClipboardCopy";
import React, {
  FunctionComponent,
  MouseEventHandler,
  ReactElement,
} from "react";
import Icon from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import useTranslateValue from "../../Utils/Translation";

export type CopyTextButtonSize = "xs" | "sm" | "md";
export type CopyTextButtonVariant = "ghost" | "soft" | "solid";

export interface ComponentProps {
  textToBeCopied: string;
  className?: string | undefined;
  size?: CopyTextButtonSize; // visual size
  variant?: CopyTextButtonVariant; // visual style
  iconOnly?: boolean; // render only icon without label
  label?: string; // default: "Copy"
  copiedLabel?: string; // default: "Copied!"
  title?: string; // tooltip
}

// How long "Copied!" stays on the button.
export const COPY_TEXT_BUTTON_COPIED_MS: number = 1000;

const SIZE_CLASSES: Record<CopyTextButtonSize, string> = {
  xs: "text-[10px] px-1.5 py-0.5 rounded",
  sm: "text-xs px-2 py-1 rounded-md",
  md: "text-sm px-2.5 py-1.5 rounded-md",
};

/*
 * md is 18px written out: Tailwind's spacing scale has no 4.5, so
 * "w-4.5 h-4.5" matched no rule and the icon was never drawn.
 */
export const COPY_TEXT_BUTTON_ICON_SIZES: Record<CopyTextButtonSize, string> = {
  xs: "w-3.5 h-3.5",
  sm: "w-4 h-4",
  md: "w-[1.125rem] h-[1.125rem]",
};

const VARIANT_CLASSES: Record<CopyTextButtonVariant, string> = {
  ghost:
    "bg-transparent border border-gray-200 text-gray-400 hover:bg-gray-50 hover:text-gray-600",
  soft: "bg-gray-100 text-gray-600 border border-gray-200 hover:bg-gray-200",
  solid:
    "bg-indigo-600 text-white border border-indigo-600 hover:bg-indigo-500",
};

const COPIED_CLASSES: string =
  "bg-emerald-50 border border-emerald-200 text-emerald-600";

const FAILED_CLASSES: string = "bg-red-50 border border-red-200 text-red-600";

/*
 * The box a copy button is drawn in, by its size, its look and what its
 * last copy did. Shared with a copy control drawn beside one - a log row's
 * Copy Link beside its Copy log message (#9944) - so the two look alike.
 */
export function getCopyTextButtonClassName(data: {
  size: CopyTextButtonSize;
  variant: CopyTextButtonVariant;
  status: ClipboardCopyStatus;
}): string {
  const stateClasses: string =
    data.status === ClipboardCopyStatus.Copied
      ? COPIED_CLASSES
      : data.status === ClipboardCopyStatus.Failed
        ? FAILED_CLASSES
        : VARIANT_CLASSES[data.variant];

  return `inline-flex items-center justify-center gap-1 transition-colors duration-150 cursor-pointer select-none ${stateClasses} ${SIZE_CLASSES[data.size]}`;
}

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

  const size: CopyTextButtonSize = props.size || "xs";
  const variant: CopyTextButtonVariant = props.variant || "ghost";
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

  const iconSize: string = COPY_TEXT_BUTTON_ICON_SIZES[size];
  let stateIcon: ReactElement = (
    <Icon icon={IconProp.Copy} className={`${iconSize}`} />
  );
  let stateText: string = "";

  if (copied) {
    stateIcon = (
      <Icon icon={IconProp.Check} className={`${iconSize} text-emerald-400`} />
    );
    stateText = copiedLabel;
  } else if (failed) {
    stateIcon = <Icon icon={IconProp.Alert} className={`${iconSize}`} />;
    stateText = failedLabel;
  }

  return (
    <button
      type="button"
      className={`${getCopyTextButtonClassName({
        size,
        variant,
        status: clipboard.status,
      })} ${props.className || ""}`}
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
