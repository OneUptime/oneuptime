import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  createContext,
  useContext,
} from "react";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Link, { LinkAriaCurrent } from "Common/UI/Components/Link/Link";

/*
 * One row of a list on a resource's or a part's page that opens a page - a
 * part that needs attention, a node at a glance, a busy guest, an open
 * incident. The whole row is the link, as on Home's Needs attention card:
 * a wide target, a tint under the pointer, a focus ring along the row for a
 * keyboard, and a chevron at its end (which turns round on a page read
 * right to left). A row with no page to open - the part whose page this
 * is - is the same row without them.
 *
 * A row that holds controls of its own - a health pill that opens why, an
 * (i) - is never one link around them: a control inside a link is lost to
 * a screen reader, which reads the link's content as its name and offers
 * nothing inside it (NestedControlsGuard). Such a row (hasControls) keeps
 * the same look, but its name is the link (ResourcePartRowName), stretched
 * over the whole row, so a press anywhere on it still opens the page; its
 * controls (ResourcePartRowControls) sit above that stretch, so a press on
 * one is the control's alone. A keyboard reaches the name, then each
 * control, and the name's focus ring still draws round the whole row
 * (#9728).
 *
 * `className` lays out what is in the row, inside its padding and beside
 * the chevron.
 */

export const RESOURCE_PART_ROW_CLASS_NAME: string =
  "flex items-center gap-3 px-5 py-3 md:px-6";

export const RESOURCE_PART_ROW_LINK_CLASS_NAME: string = `${RESOURCE_PART_ROW_CLASS_NAME} transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500`;

// A row that holds controls: the box its name's link is stretched over.
export const RESOURCE_PART_ROW_WITH_CONTROLS_CLASS_NAME: string = `relative ${RESOURCE_PART_ROW_CLASS_NAME} transition-colors hover:bg-gray-50`;

/*
 * The row's name as its link: its ::after covers the row, and draws the
 * row's focus ring.
 */
export const RESOURCE_PART_ROW_NAME_LINK_CLASS_NAME: string =
  "rounded-sm focus:outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-indigo-500";

/*
 * The row's own controls, above its stretched link: placed, and after the
 * name, so they are painted - and pressed - over the link's stretch. No
 * z-index: one would make them a stacking context of their own, and the
 * dialog a pill opens would then be painted under the rows after it.
 */
export const RESOURCE_PART_ROW_CONTROLS_CLASS_NAME: string = "relative";

// Where a row with controls of its own leads: its name's link reads it.
const RowRouteContext: React.Context<Route | null> =
  createContext<Route | null>(null);

export interface ComponentProps {
  to?: Route | undefined;
  className?: string | undefined;
  dataTestId?: string | undefined;
  /*
   * The row holds controls of its own: its name (ResourcePartRowName) is
   * its link, and they (ResourcePartRowControls) sit beside it.
   */
  hasControls?: boolean | undefined;
  children: ReactNode;
}

const ResourcePartRow: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const body: ReactElement = (
    <div className={`min-w-0 flex-1 ${props.className || ""}`}>
      {props.children}
    </div>
  );

  const chevron: ReactElement = (
    <Icon
      icon={IconProp.ChevronRight}
      className="h-4 w-4 flex-none text-gray-400"
    />
  );

  if (!props.to) {
    return (
      <div
        className={RESOURCE_PART_ROW_CLASS_NAME}
        data-testid={props.dataTestId}
      >
        {body}
      </div>
    );
  }

  if (props.hasControls) {
    return (
      <RowRouteContext.Provider value={props.to}>
        <div
          className={RESOURCE_PART_ROW_WITH_CONTROLS_CLASS_NAME}
          data-testid={props.dataTestId}
        >
          {body}
          {chevron}
        </div>
      </RowRouteContext.Provider>
    );
  }

  return (
    <Link
      to={props.to}
      className={RESOURCE_PART_ROW_LINK_CLASS_NAME}
      dataTestId={props.dataTestId}
    >
      {body}
      {chevron}
    </Link>
  );
};

export interface ResourcePartRowNameProps {
  children: ReactNode;
  className?: string | undefined;
  dataTestId?: string | undefined;
  // The id of what the row says besides its name, read after it.
  describedBy?: string | undefined;
  // The row is the one the page is on (a region the page reads).
  ariaCurrent?: LinkAriaCurrent | undefined;
}

/*
 * A row's name, in a row that holds controls of its own: the link to the
 * row's page, stretched over the row. Outside such a row, its words alone.
 */
export const ResourcePartRowName: FunctionComponent<
  ResourcePartRowNameProps
> = (props: ResourcePartRowNameProps): ReactElement => {
  const to: Route | null = useContext(RowRouteContext);

  if (!to) {
    return (
      <span className={props.className} data-testid={props.dataTestId}>
        {props.children}
      </span>
    );
  }

  return (
    <Link
      to={to}
      className={`${props.className || ""} ${RESOURCE_PART_ROW_NAME_LINK_CLASS_NAME}`}
      dataTestId={props.dataTestId}
      ariaDescribedBy={props.describedBy}
      ariaCurrent={props.ariaCurrent}
    >
      {props.children}
    </Link>
  );
};

export interface ResourcePartRowControlsProps {
  children: ReactNode;
  className?: string | undefined;
}

/*
 * A row's own controls, beside its name and above its stretched link. Draw
 * them after the name: a placed box is painted over the link's stretch
 * only when it comes after it.
 */
export const ResourcePartRowControls: FunctionComponent<
  ResourcePartRowControlsProps
> = (props: ResourcePartRowControlsProps): ReactElement => {
  return (
    <span
      className={`${RESOURCE_PART_ROW_CONTROLS_CLASS_NAME} ${props.className || ""}`}
    >
      {props.children}
    </span>
  );
};

export default ResourcePartRow;
