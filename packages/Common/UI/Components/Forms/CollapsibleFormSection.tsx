import useTranslateValue from "../../Utils/Translation";
import CollapsibleSection from "../CollapsibleSection/CollapsibleSection";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

export interface ComponentProps {
  title: string;
  description?: string | undefined;
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

  return (
    <CollapsibleSection
      title={translateString(props.title) ?? props.title}
      description={
        props.description
          ? translateString(props.description) ?? props.description
          : undefined
      }
      variant="bordered"
      className={props.className}
      isCollapsed={isCollapsed}
      onToggle={setIsCollapsed}
      badge={
        props.isConfigured
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
