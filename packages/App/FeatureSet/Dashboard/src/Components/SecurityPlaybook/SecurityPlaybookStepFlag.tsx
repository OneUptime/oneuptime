import IconProp from "Common/Types/Icon/IconProp";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
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
  return (
    <Pill
      text={props.text}
      isUserContent={props.isTranslated}
      tone={PillTone.Neutral}
      icon={props.icon}
      dataTestId={props.dataTestId}
    />
  );
};

export default SecurityPlaybookStepFlag;
