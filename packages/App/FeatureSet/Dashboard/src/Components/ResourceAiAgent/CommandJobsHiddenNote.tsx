import { COMMAND_JOBS_HIDDEN_NOTE } from "./CommandJobsHidden";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The quiet line over a cluster's or a resource's commands that says how
 * many of them the reader may not read, and why (CommandJobsHidden, #9155).
 * Nothing when the card leaves nothing out.
 */

export interface ComponentProps {
  count: number;
  dataTestId?: string | undefined;
}

const CommandJobsHiddenNote: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  if (props.count <= 0) {
    return <></>;
  }

  return (
    <p
      className="mb-3 flex items-start gap-2 text-sm text-gray-500"
      data-testid={props.dataTestId}
    >
      <Icon
        icon={IconProp.Lock}
        className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400"
      />
      <span>
        {translator.translatePlural(COMMAND_JOBS_HIDDEN_NOTE, props.count)}
      </span>
    </p>
  );
};

export default CommandJobsHiddenNote;
