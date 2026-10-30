import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  icon: IconProp;
  text: string;
  // Words already in the reader's language, put together from translated parts.
  isTranslated?: boolean | undefined;
  dataTestId?: string | undefined;
}

/*
 * A small grey chip on a playbook step: how it runs - "Only if step 1 found
 * a known-bad entity", "Needs approval", "Carries on if it fails". The
 * steps editor puts them under each step's card, and a run's steps put the
 * condition under a step it skipped for it, in the same words.
 */
const SecurityPlaybookStepFlag: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <span
      className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-600"
      data-testid={props.dataTestId}
    >
      <Icon icon={props.icon} className="h-3 w-3 flex-shrink-0" />
      {props.isTranslated ? props.text : translator.translateText(props.text)}
    </span>
  );
};

export default SecurityPlaybookStepFlag;
