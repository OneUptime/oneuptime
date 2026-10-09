import ToolImportLogo from "./ToolImportLogo";
import { TOOL_IMPORT_TOOL_COPY } from "./ToolImportText";
import IconProp from "Common/Types/Icon/IconProp";
import {
  getToolImportSourceDefinition,
  ToolImportCategory,
  ToolImportSourceDefinition,
} from "Common/Types/ToolImport/ToolImportCatalog";
import ToolImportSource, {
  AllToolImportSources,
} from "Common/Types/ToolImport/ToolImportSource";
import Icon from "Common/UI/Components/Icon/Icon";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useId } from "react";

/*
 * Step one: which tool the team is moving from. The tools come in two
 * groups - the on-call and incident tools a team is paged from, and the
 * uptime monitoring and status page tools - each a tile with the tool's
 * name (a brand, never translated) and what an import brings over from it.
 * Picking one opens the step that connects it.
 */

// The groups, in the order the page shows them, with their headings.
export const TOOL_IMPORT_CATEGORY_TITLES: Record<ToolImportCategory, string> =
  {
    [ToolImportCategory.OnCall]: translationKey("On-call and incident tools"),
    [ToolImportCategory.Monitoring]: translationKey(
      "Uptime monitoring and status pages",
    ),
  };

const CATEGORY_ORDER: ReadonlyArray<ToolImportCategory> = [
  ToolImportCategory.OnCall,
  ToolImportCategory.Monitoring,
];

// The tools of a group, in the order AllToolImportSources lists them.
export function getToolImportSourcesOf(
  category: ToolImportCategory,
): Array<ToolImportSource> {
  return AllToolImportSources.filter((source: ToolImportSource): boolean => {
    return getToolImportSourceDefinition(source).category === category;
  });
}

export interface ComponentProps {
  onPick: (source: ToolImportSource) => void;
}

const ToolImportPickerGroup: FunctionComponent<{
  category: ToolImportCategory;
  onPick: (source: ToolImportSource) => void;
}> = (props: {
  category: ToolImportCategory;
  onPick: (source: ToolImportSource) => void;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const headingId: string = useId();

  return (
    <section
      aria-labelledby={headingId}
      data-testid={`tool-import-picker-group-${props.category}`}
    >
      <h3
        id={headingId}
        className="text-xs font-semibold uppercase tracking-wide text-gray-500"
      >
        {translator.translateText(TOOL_IMPORT_CATEGORY_TITLES[props.category])}
      </h3>
      <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {getToolImportSourcesOf(props.category).map(
          (source: ToolImportSource): ReactElement => {
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
          },
        )}
      </ul>
    </section>
  );
};

const ToolImportPicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div data-testid="tool-import-picker">
      <p className="text-sm font-medium text-gray-900">
        {translator.translateText("Which tool are you moving from?")}
      </p>
      <div className="mt-4 space-y-6">
        {CATEGORY_ORDER.map((category: ToolImportCategory): ReactElement => {
          return (
            <ToolImportPickerGroup
              key={category}
              category={category}
              onPick={props.onPick}
            />
          );
        })}
      </div>
    </div>
  );
};

export default ToolImportPicker;
