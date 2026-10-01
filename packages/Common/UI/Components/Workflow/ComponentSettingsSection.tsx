import Icon from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  useId,
} from "react";

/*
 * One section of a workflow step's settings dialog: a small uppercase label
 * with an icon, an optional one-line explanation, and the content.
 *
 * - primary: what someone opens this step for, when that is not one of its
 *   settings (the Webhook trigger's URL). Tinted, so it reads as the place to
 *   start; there is at most one per dialog, and it is always the first.
 * - info: the documentation, which is about a whole family of steps rather
 *   than this one.
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
  const headingId: string = useId();
  const tone: ToneClasses = TONE_CLASSES[props.tone || "default"];

  return (
    <section
      className={tone.container}
      aria-labelledby={headingId}
      data-testid={`workflow-component-section-${props.id}`}
    >
      <div className="mb-3">
        <div className="flex items-center gap-1.5">
          <Icon icon={props.icon} className={`h-3.5 w-3.5 ${tone.icon}`} />
          <h4
            id={headingId}
            className={`text-[11px] font-semibold uppercase tracking-wider ${tone.title}`}
          >
            {props.title}
          </h4>
        </div>
        {props.description ? (
          <p className="mt-1 text-xs text-gray-500">{props.description}</p>
        ) : (
          <></>
        )}
      </div>
      {props.children}
    </section>
  );
};

export default ComponentSettingsSection;
