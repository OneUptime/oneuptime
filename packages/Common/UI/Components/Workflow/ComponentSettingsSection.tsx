import Icon from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  useId,
} from "react";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";

/*
 * One section of a workflow step's settings dialog: a small uppercase label
 * with an icon, an optional one-line explanation, and the content.
 *
 * - primary: what someone opens this step for, when that is not one of its
 *   settings (the Webhook trigger's URL). Tinted, so it reads as the place to
 *   start; there is at most one per dialog, and it is always the first.
 * - info: the step's "How to use" help, which is about using the step
 *   rather than one of its settings.
 */
export type ComponentSettingsSectionTone = "default" | "primary" | "info";

export interface ComponentProps {
  /*
   * Names the section: data-testid "workflow-component-section-<id>". Tests
   * read the dialog's section order through it.
   */
  id: string;
  icon: IconProp;
  title: string;
  description?: string | undefined;
  tone?: ComponentSettingsSectionTone | undefined;
  /*
   * Whether something may move the focus here: the dialog's "How to use"
   * button does, so a keyboard or screen reader user lands on the help it
   * scrolled to. Not in the tab order either way.
   */
  isFocusTarget?: boolean | undefined;
  children: ReactNode;
}

interface ToneClasses {
  container: string;
  icon: string;
  title: string;
}

const TONE_CLASSES: Record<ComponentSettingsSectionTone, ToneClasses> = {
  default: {
    container: "rounded-lg border border-gray-200 bg-white p-4",
    icon: "text-gray-400",
    title: "text-gray-500",
  },
  primary: {
    container: "rounded-lg border border-indigo-200 bg-indigo-50/40 p-4",
    icon: "text-indigo-500",
    title: "text-indigo-700",
  },
  info: {
    container: "rounded-lg border border-blue-100 bg-blue-50/40 p-4",
    icon: "text-blue-500",
    title: "text-blue-700",
  },
};

const ComponentSettingsSection: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const headingId: string = useId();
  const tone: ToneClasses = TONE_CLASSES[props.tone || "default"];

  return (
    <section
      className={`${tone.container}${
        props.isFocusTarget
          ? " scroll-mt-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
          : ""
      }`}
      aria-labelledby={headingId}
      tabIndex={props.isFocusTarget ? -1 : undefined}
      data-testid={`workflow-component-section-${props.id}`}
    >
      <div className="mb-3">
        <div className="flex items-center gap-1.5">
          <Icon icon={props.icon} className={`h-3.5 w-3.5 ${tone.icon}`} />
          <h4
            id={headingId}
            className={`text-[11px] font-semibold uppercase tracking-wider ${tone.title}`}
          >
            {translator.translateText(props.title)}
          </h4>
        </div>
        {props.description ? (
          <p className="mt-1 text-xs text-gray-500">
            {translator.translateText(props.description)}
          </p>
        ) : (
          <></>
        )}
      </div>
      {props.children}
    </section>
  );
};

export default ComponentSettingsSection;
