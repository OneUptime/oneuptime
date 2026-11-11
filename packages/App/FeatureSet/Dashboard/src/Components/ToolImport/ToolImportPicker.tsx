import ToolImportLogo from "./ToolImportLogo";
import { TOOL_IMPORT_TOOL_COPY } from "./ToolImportText";
import IconProp from "Common/Types/Icon/IconProp";
import {
  getToolImportSourceDefinition,
  getToolImportSourcesThatFill,
  ToolImportCategory,
  ToolImportSourceDefinition,
} from "Common/Types/ToolImport/ToolImportCatalog";
import ToolImportResourceKind from "Common/Types/ToolImport/ToolImportResourceKind";
import ToolImportSource, {
  AllToolImportSources,
} from "Common/Types/ToolImport/ToolImportSource";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
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
 *
 * Opened from an empty list (ToolImportOffer: ?kind=), it offers only the
 * tools that fill that list - the on-call tools from On-Call Schedules,
 * the uptime tools from Monitors - with every tool one click away.
 */

// The groups, in the order the page shows them, with their headings.
export const TOOL_IMPORT_CATEGORY_TITLES: Record<ToolImportCategory, string> = {
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

/*
 * The tools the picker offers, by group: every tool, or only those that
 * fill a list of `fills`. A group with none to offer is left out. A kind
 * no tool fills offers every tool rather than none.
 */
export function getToolImportPickerGroups(
  fills?: ToolImportResourceKind | undefined,
): Array<{ category: ToolImportCategory; sources: Array<ToolImportSource> }> {
  const fitting: Array<ToolImportSource> | null = fills
    ? getToolImportSourcesThatFill(fills)
    : null;
  const offered: Array<ToolImportSource> | null =
    fitting && fitting.length > 0 ? fitting : null;

  return CATEGORY_ORDER.map(
    (
      category: ToolImportCategory,
    ): { category: ToolImportCategory; sources: Array<ToolImportSource> } => {
      return {
        category,
        sources: getToolImportSourcesOf(category).filter(
          (source: ToolImportSource): boolean => {
            return !offered || offered.includes(source);
          },
        ),
      };
    },
  ).filter(
    (group: {
      category: ToolImportCategory;
      sources: Array<ToolImportSource>;
    }): boolean => {
      return group.sources.length > 0;
    },
  );
}

export interface ComponentProps {
  onPick: (source: ToolImportSource) => void;
  /*
   * Offer only the tools that fill a list of this kind (the list the person
   * came from), with a way to every tool (onShowEveryTool).
   */
  fills?: ToolImportResourceKind | undefined;
  onShowEveryTool?: (() => void) | undefined;
}

export const TOOL_IMPORT_SHOW_EVERY_TOOL_TEST_ID: string =
  "tool-import-picker-show-every-tool";

const ToolImportPickerGroup: FunctionComponent<{
  category: ToolImportCategory;
  sources: Array<ToolImportSource>;
  onPick: (source: ToolImportSource) => void;
}> = (props: {
  category: ToolImportCategory;
  sources: Array<ToolImportSource>;
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
        {props.sources.map((source: ToolImportSource): ReactElement => {
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
    </section>
  );
};

const ToolImportPicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const groups: Array<{
    category: ToolImportCategory;
    sources: Array<ToolImportSource>;
  }> = getToolImportPickerGroups(props.fills);
  const offeredCount: number = groups.reduce(
    (
      count: number,
      group: { category: ToolImportCategory; sources: Array<ToolImportSource> },
    ): number => {
      return count + group.sources.length;
    },
    0,
  );
  const isNarrowed: boolean = offeredCount < AllToolImportSources.length;

  return (
    <div
      data-testid="tool-import-picker"
      data-fills={isNarrowed ? props.fills : undefined}
    >
      <p className="text-sm font-medium text-gray-900">
        {translator.translateText("Which tool are you moving from?")}
      </p>
      <div className="mt-4 space-y-6">
        {groups.map(
          (group: {
            category: ToolImportCategory;
            sources: Array<ToolImportSource>;
          }): ReactElement => {
            return (
              <ToolImportPickerGroup
                key={group.category}
                category={group.category}
                sources={group.sources}
                onPick={props.onPick}
              />
            );
          },
        )}
      </div>
      {isNarrowed && props.onShowEveryTool && (
        <div className="mt-4">
          <Button
            title="Show every tool"
            buttonStyle={ButtonStyleType.LINK}
            icon={IconProp.ChevronDown}
            onClick={props.onShowEveryTool}
            dataTestId={TOOL_IMPORT_SHOW_EVERY_TOOL_TEST_ID}
          />
        </div>
      )}
    </div>
  );
};

export default ToolImportPicker;
