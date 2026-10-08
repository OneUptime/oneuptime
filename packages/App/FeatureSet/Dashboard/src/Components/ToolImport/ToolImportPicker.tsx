import ToolImportLogo from "./ToolImportLogo";
import { TOOL_IMPORT_TOOL_COPY } from "./ToolImportText";
import IconProp from "Common/Types/Icon/IconProp";
import {
  getToolImportSourceDefinition,
  ToolImportSourceDefinition,
} from "Common/Types/ToolImport/ToolImportCatalog";
import ToolImportSource, {
  AllToolImportSources,
} from "Common/Types/ToolImport/ToolImportSource";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Step one: which tool the team is moving from. One tile per tool, its
 * name (a brand, never translated) and what an import brings over from it.
 * Picking one opens the step that connects it.
 */

export interface ComponentProps {
  onPick: (source: ToolImportSource) => void;
}

const ToolImportPicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div data-testid="tool-import-picker">
      <p className="text-sm font-medium text-gray-900">
        {translator.translateText("Which tool are you moving from?")}
      </p>
      <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {AllToolImportSources.map((source: ToolImportSource): ReactElement => {
          const definition: ToolImportSourceDefinition =
            getToolImportSourceDefinition(source);

          return (
            <li key={source}>
              <button
                type="button"
                data-testid={`tool-import-pick-${source}`}
                onClick={() => {
                  props.onPick(source);
                }}
                className="group flex h-full w-full items-start gap-3 rounded-xl border border-gray-200 bg-white p-4 text-left transition-colors hover:border-indigo-400 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                <ToolImportLogo source={source} size="lg" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-gray-900">
                    {definition.title}
                  </span>
                  <span className="mt-1 block text-sm text-gray-500">
                    {translator.translateText(
                      TOOL_IMPORT_TOOL_COPY[source].description,
                    )}
                  </span>
                </span>
                <span className="mt-0.5 flex-shrink-0 text-gray-400">
                  <Icon icon={IconProp.ChevronRight} className="h-4 w-4" />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default ToolImportPicker;
