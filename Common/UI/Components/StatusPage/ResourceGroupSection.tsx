import Icon, { ThickProp } from "../Icon/Icon";
import MarkdownViewer from "../Markdown.tsx/LazyMarkdownViewer";
import IconProp from "../../../Types/Icon/IconProp";
import StatusPageGroupNestingLayoutUtil from "../../../Utils/StatusPage/GroupNestingLayout";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

export interface ComponentProps {
  /*
   * 0 for a top level group, 1 for its children, and so on. Everything about
   * how this section is drawn comes from it - see GroupNestingLayout.
   */
  depth: number;
  name: string;
  /*
   * Markdown. Rendered below the header rather than inside it - a description
   * may contain links, and a link inside a button is not something a browser or
   * a screen reader can make sense of.
   */
  description?: string | undefined;
  /*
   * Rendered next to the name when the group has sub groups. Pre-translated by
   * the caller: this component has no i18n of its own.
   */
  subGroupCountLabel?: string | undefined;
  /*
   * The group's rolled up status or uptime, already formatted and translated by
   * the caller ("99.9% uptime", "Operational"). Drawn with a status dot so it
   * reads as a rollup of everything below rather than as one more resource
   * reading, and it stays visible while the section is open - the point of the
   * hierarchy is that every level always shows what it rolls up, and a number
   * that disappears on expand is a number you cannot compare against the level
   * below it.
   */
  rollupLabel?: string | undefined;
  /* Hex or css colour for the rollup, from the rolled up status. */
  rollupColor?: string | undefined;
  isInitiallyExpanded?: boolean | undefined;
  /* The group's own resources. */
  resourcesElement?: ReactElement | undefined;
  /* Nested sections, normally one per sub group. */
  subGroupsElement?: ReactElement | undefined;
  hasOwnResources?: boolean | undefined;
  subGroupCount?: number | undefined;
  testId?: string | undefined;
}

/*
 * One level of the status page resource group hierarchy.
 *
 * A top level group is a card. Everything under it is a row on a tree rail -
 * no card, no second border, no background tint stacked on the last one - so
 * the hierarchy stays readable however deep it goes and the uptime bars keep
 * the width they need.
 */
const ResourceGroupSection: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isOpen, setIsOpen] = useState<boolean>(
    Boolean(props.isInitiallyExpanded),
  );

  /*
   * Groups arrive with the page payload, so isInitiallyExpanded can flip after
   * the first render. Keyed on the *boolean*, not on the prop: the column is an
   * optional boolean, so it routinely arrives as undefined and settles to false,
   * and keying on the prop would fire on that and slam shut a section the
   * visitor had just opened.
   */
  const initiallyExpanded: boolean = Boolean(props.isInitiallyExpanded);

  useEffect(() => {
    setIsOpen(initiallyExpanded);
  }, [initiallyExpanded]);

  const generatedId: string = React.useId();
  const bodyId: string = `status-page-group-body-${generatedId}`;
  const descriptionId: string = `status-page-group-description-${generatedId}`;

  const isRootLevel: boolean = StatusPageGroupNestingLayoutUtil.isRootLevel({
    depth: props.depth,
  });

  const subGroupCount: number = props.subGroupCount || 0;

  const showSubGroupDivider: boolean =
    StatusPageGroupNestingLayoutUtil.shouldShowSubGroupDivider({
      hasOwnResources: Boolean(props.hasOwnResources),
      subGroupCount: subGroupCount,
    });

  return (
    <div
      className={StatusPageGroupNestingLayoutUtil.getContainerClassName({
        depth: props.depth,
      })}
      data-testid={
        props.testId ||
        (isRootLevel ? "status-page-group" : "status-page-nested-group")
      }
      data-depth={props.depth}
    >
      <button
        type="button"
        className={StatusPageGroupNestingLayoutUtil.getHeaderClassName({
          depth: props.depth,
        })}
        aria-expanded={isOpen}
        aria-controls={isOpen ? bodyId : undefined}
        aria-describedby={props.description ? descriptionId : undefined}
        data-testid="status-page-group-header"
        onClick={() => {
          setIsOpen(!isOpen);
        }}
      >
        <span
          className={StatusPageGroupNestingLayoutUtil.getHeaderRowClassName()}
        >
          <span
            className={`${StatusPageGroupNestingLayoutUtil.getChevronBoxClassName()} ${
              isOpen ? "bg-gray-900/5 text-gray-700" : "text-gray-400"
            }`}
            data-testid="status-page-group-chevron"
            aria-hidden="true"
          >
            <Icon
              className={`h-3.5 w-3.5 transition-transform duration-200 ease-out ${
                isOpen ? "rotate-90" : ""
              }`}
              icon={IconProp.ChevronRight}
              thick={ThickProp.Thick}
            />
          </span>
          <span
            className={StatusPageGroupNestingLayoutUtil.getTitleClassName({
              depth: props.depth,
            })}
            title={props.name}
          >
            {props.name}
          </span>
          {props.subGroupCountLabel ? (
            <span
              className={StatusPageGroupNestingLayoutUtil.getSubGroupCountBadgeClassName()}
              data-testid="status-page-group-sub-group-count"
            >
              {props.subGroupCountLabel}
            </span>
          ) : (
            <></>
          )}
        </span>
        {props.rollupLabel ? (
          <span
            className={StatusPageGroupNestingLayoutUtil.getRollupClassName()}
            data-testid="status-page-group-rollup"
          >
            <span className="inline-flex items-center gap-1.5">
              <span
                className={StatusPageGroupNestingLayoutUtil.getRollupDotClassName()}
                style={
                  props.rollupColor
                    ? { backgroundColor: props.rollupColor }
                    : undefined
                }
                data-testid="status-page-group-rollup-dot"
                aria-hidden="true"
              />
              <span
                className={StatusPageGroupNestingLayoutUtil.getRollupLabelClassName()}
                style={
                  props.rollupColor ? { color: props.rollupColor } : undefined
                }
              >
                {props.rollupLabel}
              </span>
            </span>
          </span>
        ) : (
          <></>
        )}
      </button>
      {props.description ? (
        <div
          id={descriptionId}
          className={StatusPageGroupNestingLayoutUtil.getDescriptionClassName()}
          data-testid="status-page-group-description"
        >
          <MarkdownViewer text={props.description} />
        </div>
      ) : (
        <></>
      )}
      {isOpen ? (
        <div
          id={bodyId}
          className={StatusPageGroupNestingLayoutUtil.getBodyClassName({
            depth: props.depth,
          })}
          data-testid="status-page-group-body"
        >
          {props.resourcesElement || <></>}
          {props.subGroupsElement ? (
            <div
              className={`${
                showSubGroupDivider
                  ? StatusPageGroupNestingLayoutUtil.getSubGroupDividerClassName()
                  : ""
              } ${StatusPageGroupNestingLayoutUtil.getSubGroupListClassName({
                depth: props.depth,
              })}`.trim()}
              data-testid="status-page-sub-group-list"
            >
              {props.subGroupsElement}
            </div>
          ) : (
            <></>
          )}
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default ResourceGroupSection;
