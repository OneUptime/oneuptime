import { describeToolImportNote } from "./ToolImportText";
import IconProp from "Common/Types/Icon/IconProp";
import { ToolImportNote } from "Common/Types/ToolImport/ToolImportNote";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * What will not come over exactly as it was in the tool, one line each,
 * under an item of the preview or the report. A note this build has no
 * sentence for is left out rather than shown as a code.
 */

export interface ComponentProps {
  notes: Array<ToolImportNote>;
  toolTitle: string;
  dataTestId?: string | undefined;
}

const ToolImportNoteList: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement | null => {
  const translator: Translator = useTranslator();

  const sentences: Array<string> = props.notes
    .map((note: ToolImportNote): string => {
      return describeToolImportNote(note, translator, props.toolTitle);
    })
    .filter((sentence: string): boolean => {
      return sentence.length > 0;
    });

  if (sentences.length === 0) {
    return null;
  }

  return (
    <ul className="mt-1 space-y-1" data-testid={props.dataTestId}>
      {sentences.map((sentence: string, index: number): ReactElement => {
        return (
          <li
            key={`${index}-${sentence}`}
            className="flex items-start gap-1.5 text-sm text-gray-600"
          >
            <div className="mt-0.5 flex-shrink-0 text-amber-500">
              <Icon icon={IconProp.InformationCircle} className="h-4 w-4" />
            </div>
            <span>{sentence}</span>
          </li>
        );
      })}
    </ul>
  );
};

export default ToolImportNoteList;
