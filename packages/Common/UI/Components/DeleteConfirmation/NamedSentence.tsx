import {
  TemplateAround,
  TemplateValues,
  translateTemplateAround,
} from "../../Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A translated sentence with one name in it, drawn in bold: "Are you sure you
 * want to remove {{name}} from this incident?".
 *
 * The bold is what makes "Delete Notify on-call?" read as the workflow and not
 * as two more words of the question, and what lets a name with a question
 * mark or the word "delete" in it be told apart from the sentence around it.
 * The name itself never goes through translation; see translateTemplateAround.
 */

export interface ComponentProps {
  // English template, also the translation key; holds {{<slot>}} once.
  template: string;
  name: string;
  // The placeholder the name fills. Defaults to "name".
  slot?: string | undefined;
  // Other placeholders in the template.
  values?: TemplateValues | undefined;
  // Shown on hover, for a name shortened to fit.
  title?: string | undefined;
  dataTestId?: string | undefined;
}

const NamedSentence: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const around: TemplateAround = translateTemplateAround(
    props.template,
    props.slot || "name",
    props.values,
  );

  return (
    <>
      {around.before}
      <strong
        data-testid={props.dataTestId || "delete-confirmation-name"}
        className="break-words font-semibold text-gray-900"
        title={props.title}
      >
        {props.name}
      </strong>
      {around.after}
    </>
  );
};

export default NamedSentence;
