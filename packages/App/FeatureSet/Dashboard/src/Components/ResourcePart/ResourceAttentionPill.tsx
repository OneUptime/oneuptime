import React, { FunctionComponent, ReactElement, useId, useState } from "react";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import ResourceAttentionDialog, {
  ComponentProps as ResourceAttentionDialogProps,
} from "./ResourceAttentionDialog";
import { ResourcePartTone } from "./ResourcePartTypes";

/*
 * A COUNT OR A STATE THAT SAYS WHAT AND WHY WHEN IT IS PRESSED.
 *
 * "3 Failed", "2 CrashLoopBackOff", "Degraded": a resource's hero says how
 * it is doing in pills. One that says something is wrong is a button that
 * opens the list of what (ResourceAttentionDialog) - each part, why, since
 * when, a step from its page - where it was a pill with an (i) that only
 * said what the word means (#9537).
 *
 * It looks like the pills beside it (a name's Connected, a part's status:
 * a dot, its words, in its tone's wash and ring), with a chevron that says
 * it opens something, a deeper wash under the pointer and a focus ring for
 * a keyboard. A screen reader hears its words, that it opens a dialog, and
 * what a press shows (hint).
 */

export const RESOURCE_ATTENTION_PILL_TONE_CLASS_NAMES: Record<
  ResourcePartTone,
  { badge: string; dot: string; hover: string }
> = {
  positive: {
    badge: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    dot: "bg-emerald-500",
    hover: "hover:bg-emerald-100",
  },
  warning: {
    badge: "bg-amber-50 text-amber-700 ring-amber-200",
    dot: "bg-amber-500",
    hover: "hover:bg-amber-100",
  },
  danger: {
    badge: "bg-red-50 text-red-700 ring-red-200",
    dot: "bg-red-500",
    hover: "hover:bg-red-100",
  },
  neutral: {
    badge: "bg-gray-50 text-gray-600 ring-gray-200",
    dot: "bg-gray-400",
    hover: "hover:bg-gray-100",
  },
};

// The pill's frame, the same as the hero's other pills, and a button's states.
export const RESOURCE_ATTENTION_PILL_CLASS_NAME: string =
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1 [@media(pointer:coarse)]:py-1";

export interface ComponentProps {
  /*
   * Its words, in the reader's language already: "Degraded", or a count
   * and its word drawn as the hero draws them (a bold count, a word).
   */
  label: string | ReactElement;
  tone: ResourcePartTone;
  // The button's test id; the dialog's is `${testId}-dialog`.
  testId: string;
  /*
   * What a press shows, in English, for a screen reader and on hover:
   * "Show which pods and why".
   */
  hint: string;
  // What the dialog lists and says (ResourceAttentionDialog).
  dialog: Omit<ResourceAttentionDialogProps, "onClose" | "testId">;
  // More of the button's data attributes, for a page's tests.
  dataAttributes?: Record<string, string> | undefined;
}

const ResourceAttentionPill: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const hintId: string = useId();
  const classNames: { badge: string; dot: string; hover: string } =
    RESOURCE_ATTENTION_PILL_TONE_CLASS_NAMES[props.tone];
  const hint: string = translator.translateText(props.hint) || props.hint;

  return (
    <>
      {/*
       * Its words name it; the hint describes it, from a node that is
       * always there, and shows under the pointer.
       */}
      <button
        type="button"
        data-testid={props.testId}
        data-tone={props.tone}
        {...(props.dataAttributes || {})}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-describedby={hintId}
        title={hint}
        onClick={() => {
          setIsOpen(true);
        }}
        className={`${RESOURCE_ATTENTION_PILL_CLASS_NAME} ${classNames.badge} ${classNames.hover}`}
      >
        <span
          className={`h-1.5 w-1.5 flex-none rounded-full ${classNames.dot}`}
          aria-hidden="true"
        />
        <span className="inline-flex items-center gap-1.5">{props.label}</span>
        <Icon
          icon={IconProp.ChevronRight}
          className="h-3 w-3 flex-none opacity-70"
        />
      </button>
      <span id={hintId} hidden={true}>
        {hint}
      </span>
      {isOpen ? (
        <ResourceAttentionDialog
          {...props.dialog}
          testId={`${props.testId}-dialog`}
          onClose={() => {
            setIsOpen(false);
          }}
        />
      ) : (
        <></>
      )}
    </>
  );
};

export default ResourceAttentionPill;
