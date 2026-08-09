import IconProp from "Common/Types/Icon/IconProp";
import StatusPageGroupViewMode from "Common/Types/StatusPage/StatusPageGroupViewMode";
import Icon, { ThickProp } from "Common/UI/Components/Icon/Icon";
import StatusPageResourceEditorTreeUtil from "Common/Utils/StatusPage/ResourceEditorTree";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  /* 0 for a top level group. Drives the indent and nothing else. */
  depth: number;
  name: string;
  /*
   * "Corporate › Region 1000" - the group's ancestors, shown above the name
   * when the row is not sitting under them in the tree (search results), so
   * two groups with the same leaf name stay distinguishable.
   */
  path?: string | undefined;
  viewMode?: StatusPageGroupViewMode | undefined;
  /* Already formatted and pluralised by the caller; null hides the badge. */
  resourceCountLabel?: string | null | undefined;
  subGroupCountLabel?: string | null | undefined;
  isExpanded: boolean;
  onToggle: () => void;
  /*
   * Row actions ("Add Monitor", the overflow menu). Rendered beside the
   * disclosure control rather than inside it: a button inside a button is not
   * something a browser or a screen reader can make sense of, and clicking
   * "Add Monitor" must not also toggle the row.
   */
  actionsElement?: ReactElement | undefined;
  /*
   * The group's resources. Only ever passed through when the row is open -
   * this component never renders it while collapsed, which is the whole point:
   * a table that is not mounted does not fetch.
   */
  children?: ReactElement | undefined;
  testId?: string | undefined;
}

/*
 * One group row in the Resources tab's tree.
 *
 * Expansion is controlled by the page rather than held here, because the page
 * owns "collapse all", owns which groups a search opened, and has to be able to
 * count how many groups are open before it offers to open more.
 */
const ResourceGroupRow: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const generatedId: string = React.useId();
  const bodyId: string = `status-page-resource-group-body-${generatedId}`;

  const isGrid: boolean = props.viewMode === StatusPageGroupViewMode.Grid;

  /*
   * The row itself is not indented. It is already drawn inside the body of
   * every group above it, and each of those bodies steps its contents in - so
   * a row that also set its own depth-proportional padding would be indenting
   * on top of an indent, and ten legal levels of nesting would push the
   * deepest rows off the side of the card.
   */
  const indentStepPixels: number =
    StatusPageResourceEditorTreeUtil.getIndentStepPixels({
      depth: props.depth,
    });

  return (
    <div
      className={props.isExpanded ? "bg-gray-50" : ""}
      data-testid={props.testId || "status-page-resource-group-row"}
      data-depth={props.depth}
      data-expanded={props.isExpanded ? "true" : "false"}
    >
      <div className="group flex items-center gap-2 pl-2 pr-2 transition-colors hover:bg-gray-100/70">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg py-2.5 pl-2 pr-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
          aria-expanded={props.isExpanded}
          aria-controls={props.isExpanded ? bodyId : undefined}
          data-testid="status-page-resource-group-header"
          onClick={props.onToggle}
        >
          <span
            className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md transition-colors ${
              props.isExpanded
                ? "bg-indigo-100 text-indigo-700"
                : /*
                   * bg-gray-200 rather than bg-gray-200/70: the dark theme
                   * remaps the un-suffixed token and not the transparent one,
                   * and the icon inside is remapped either way - so the
                   * opacity modifier leaves a light chip under a light icon.
                   */
                  "text-gray-400 group-hover:bg-gray-200 group-hover:text-gray-600"
            }`}
            data-testid="status-page-resource-group-chevron"
            aria-hidden="true"
          >
            <Icon
              className={`h-3.5 w-3.5 transition-transform duration-200 ease-out ${
                props.isExpanded ? "rotate-90" : ""
              }`}
              icon={IconProp.ChevronRight}
              thick={ThickProp.Thick}
            />
          </span>

          <span className="min-w-0 flex-1">
            {props.path ? (
              <span
                className="block truncate text-[11px] leading-4 text-gray-400"
                data-testid="status-page-resource-group-path"
                title={props.path}
              >
                {props.path}
              </span>
            ) : (
              <></>
            )}
            <span
              className="block truncate text-sm font-semibold text-gray-900"
              title={props.name}
            >
              {props.name}
            </span>
          </span>

          <span className="flex flex-shrink-0 items-center gap-1.5">
            {props.resourceCountLabel ? (
              <span
                className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600 tabular-nums"
                data-testid="status-page-resource-group-resource-count"
              >
                {props.resourceCountLabel}
              </span>
            ) : (
              <></>
            )}
            {props.subGroupCountLabel ? (
              <span
                className="hidden items-center rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500 tabular-nums sm:inline-flex"
                data-testid="status-page-resource-group-sub-group-count"
              >
                {props.subGroupCountLabel}
              </span>
            ) : (
              <></>
            )}
            {isGrid ? (
              <span
                className="hidden items-center gap-1 rounded-full bg-purple-50 px-2 py-0.5 text-[11px] font-medium text-purple-700 sm:inline-flex"
                data-testid="status-page-resource-group-view-mode"
              >
                <Icon icon={IconProp.Grid} className="h-3 w-3" />
                Grid
              </span>
            ) : (
              <></>
            )}
          </span>
        </button>

        {props.actionsElement ? (
          <div
            className="flex flex-shrink-0 items-center gap-1"
            data-testid="status-page-resource-group-actions"
          >
            {props.actionsElement}
          </div>
        ) : (
          <></>
        )}
      </div>

      {props.isExpanded ? (
        <div
          id={bodyId}
          className="pb-4 pr-2 pt-1"
          style={{ paddingLeft: `${indentStepPixels}px` }}
          data-testid="status-page-resource-group-body"
        >
          {props.children || <></>}
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default ResourceGroupRow;
