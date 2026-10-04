import IconProp from "../../../Types/Icon/IconProp";
import useTranslateValue from "../../Utils/Translation";
import { translationKey } from "../../Utils/TranslateTemplate";
import FoldedSection from "../FoldedSection/FoldedSection";
import { FoldedSectionItem } from "../FoldedSection/FoldedSectionItem";
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

/*
 * A form's folded section (FormFieldCollapsibleSection), drawn as a
 * FoldedSection: "More fields" (getAdvancedFormSection) and every other
 * section a form folds its fields into - "Subscriber Notifications",
 * "Layout", "Add a public note".
 *
 * Folded, its header says what is inside:
 *   - a section that lists its fields (More fields, whose title says
 *     nothing of what it holds) names them, the set ones as chips that say
 *     what they are set to, with its summary sentences under them;
 *   - any other section shows its summary sentences when it has them - they
 *     say what is set already - and otherwise the chips of its set fields;
 *   - a section that says it is configured but has no set field to show
 *     (its own isConfigured knows better than its fields) says
 *     "Configured".
 */

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
   * True when left out. A More fields section passes false and stays
   * folded, showing what is set on its header instead (see
   * FormFieldCollapsibleSection.openWhenConfigured).
   */
  openWhenConfigured?: boolean | undefined;
  hasError: boolean;
  validationAttempt: number;
  className: string;
  /*
   * What the folded fields are set to (FormFieldCollapsibleSection
   * .getSummary): whole English sentences, each looked up on its own, shown
   * on the folded header.
   */
  summary?: Array<string> | undefined;
  /*
   * The section's fields as the folded header lists them
   * (Forms/Utils/FoldedFormFields): every field, set or not, in order.
   */
  items?: Array<FoldedSectionItem> | undefined;
  // List every field while folded (More fields), not only the set ones.
  listFieldsWhileFolded?: boolean | undefined;
  icon?: IconProp | undefined;
  children: ReactElement;
}

export const CONFIGURED_BADGE: string = translationKey("Configured");

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

  const allItems: Array<FoldedSectionItem> = props.items || [];

  /*
   * A section that lists its fields shows them all. Any other section shows
   * its sentences when it has them - they already say what is set - and
   * otherwise only its set fields.
   */
  const items: Array<FoldedSectionItem> = props.listFieldsWhileFolded
    ? allItems
    : summary
      ? []
      : allItems.filter((item: FoldedSectionItem): boolean => {
          return item.isSet;
        });

  const hasSetItem: boolean = items.some((item: FoldedSectionItem) => {
    return item.isSet;
  });

  return (
    <FoldedSection
      title={props.title}
      description={props.description}
      icon={props.icon}
      items={items}
      summary={summary || undefined}
      badge={
        props.isConfigured && !hasSetItem && !summary
          ? CONFIGURED_BADGE
          : undefined
      }
      className={props.className}
      isCollapsed={isCollapsed}
      onToggle={setIsCollapsed}
    >
      {/* Keep editors mounted without leaving collapsed controls focusable. */}
      <div hidden={isCollapsed}>{props.children}</div>
    </FoldedSection>
  );
};

export default CollapsibleFormSection;
