import useTranslateValue from "../../Utils/Translation";
import CollapsibleSection from "../CollapsibleSection/CollapsibleSection";
import {
  OpenFormSectionsContext,
  ReportFormSectionOpenFunction,
} from "./Utils/OpenFormSections";
import React, {
  FunctionComponent,
  ReactElement,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useState,
} from "react";

export interface ComponentProps {
  title: string;
  description?: string | undefined;
  /*
   * The section's id (FormFieldCollapsibleSection.id). The dialog the form
   * is in is told when the section opens and folds, so it can grow to fit
   * what opening it shows (Forms/Utils/OpenFormSections.ts).
   */
  sectionId?: string | undefined;
  isConfigured: boolean;
  /*
   * Whether being configured opens the section: when the form opens with a
   * value in it, and when a default arrives after the fields have loaded.
   * True when left out. An Advanced section passes false and stays folded,
   * saying "Configured" on its header instead (see
   * FormFieldCollapsibleSection.openWhenConfigured).
   */
  openWhenConfigured?: boolean | undefined;
  hasError: boolean;
  validationAttempt: number;
  className: string;
  /*
   * What the folded fields are set to (FormFieldCollapsibleSection
   * .getSummary): whole English sentences, each looked up on its own, shown
   * under the title while the section is folded in place of "Configured".
   */
  summary?: Array<string> | undefined;
  children: ReactElement;
}

const CollapsibleFormSection: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const openWhenConfigured: boolean = props.openWhenConfigured !== false;
  const [isCollapsed, setIsCollapsed] = useState<boolean>(
    openWhenConfigured ? !props.isConfigured : true,
  );

  const reportSectionOpen: ReportFormSectionOpenFunction | null = useContext(
    OpenFormSectionsContext,
  );
  const instanceId: string = useId();

  /*
   * Before paint, so a dialog that grows for what the section shows is
   * never drawn a frame too narrow - a section that starts open included.
   * Folded again, or gone (another step, the dialog closing), it says so.
   */
  useLayoutEffect(() => {
    if (!reportSectionOpen || !props.sectionId) {
      return undefined;
    }

    const sectionId: string = props.sectionId;

    reportSectionOpen({
      instanceId: instanceId,
      sectionId: sectionId,
      isOpen: !isCollapsed,
    });

    return () => {
      reportSectionOpen({
        instanceId: instanceId,
        sectionId: sectionId,
        isOpen: false,
      });
    };
  }, [isCollapsed, reportSectionOpen, props.sectionId, instanceId]);

  useEffect(() => {
    // Field defaults can arrive after the form has loaded its field definitions.
    if (openWhenConfigured && props.isConfigured) {
      setIsCollapsed(false);
    }
  }, [props.isConfigured]);

  useEffect(() => {
    if (props.hasError) {
      setIsCollapsed(false);
    }
  }, [props.hasError, props.validationAttempt]);

  // Each sentence on its own: a locale translates sentences, not a paragraph.
  const summary: string = (props.summary || [])
    .filter((sentence: string): boolean => {
      return Boolean(sentence && sentence.trim());
    })
    .map((sentence: string): string => {
      return translateString(sentence) ?? sentence;
    })
    .join(" ");

  return (
    <CollapsibleSection
      title={translateString(props.title) ?? props.title}
      description={
        props.description
          ? translateString(props.description) ?? props.description
          : undefined
      }
      collapsedDescription={summary || undefined}
      variant="bordered"
      className={props.className}
      isCollapsed={isCollapsed}
      onToggle={setIsCollapsed}
      badge={
        // A summary already says what is set; the badge would only repeat it.
        props.isConfigured && !summary
          ? translateString("Configured") ?? "Configured"
          : undefined
      }
    >
      {/* Keep editors mounted without leaving collapsed controls focusable. */}
      <div hidden={isCollapsed}>{props.children}</div>
    </CollapsibleSection>
  );
};

export default CollapsibleFormSection;
