import { DATA_STATUS_SENTENCES, DATA_STATUS_WORDS } from "./RuleLibraryCopy";
import { LibraryRuleDataStatus } from "./RuleLibraryUtil";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Whether the project sends the events a rule reads, as a dot and a word:
 * a filled green dot and "Receiving" when some arrived in the last week, a
 * hollow grey one and "Not receiving" when none did. The sentence behind it
 * is the dot's tooltip. Nothing while it is not known: a page that could
 * not read the events says that once, not on every row.
 */

export interface ComponentProps {
  status: LibraryRuleDataStatus;
  dataTestId?: string | undefined;
}

const RuleLibraryDataStatus: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  if (props.status === LibraryRuleDataStatus.Unknown) {
    return <></>;
  }

  const isReceived: boolean = props.status === LibraryRuleDataStatus.Received;

  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-normal text-gray-500"
      title={translator.translateText(DATA_STATUS_SENTENCES[props.status])}
      data-testid={props.dataTestId}
      data-status={props.status}
    >
      <span
        aria-hidden="true"
        className={`h-2 w-2 flex-none rounded-full ${
          isReceived ? "bg-emerald-500" : "border border-gray-400 bg-white"
        }`}
      />
      {translator.translateText(DATA_STATUS_WORDS[props.status])}
    </span>
  );
};

export default RuleLibraryDataStatus;
