import React, { FunctionComponent, ReactElement, ReactNode } from "react";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";

/*
 * One row of a list on a resource's or a part's page that opens a page - a
 * part that needs attention, a node at a glance, a busy guest, an open
 * incident. The whole row is the link, as on Home's Needs attention card:
 * a wide target, a tint under the pointer, a focus ring along the row for a
 * keyboard, and a chevron at its end (which turns round on a page read
 * right to left). A row with no page to open - the part whose page this
 * is - is the same row without them.
 *
 * `className` lays out what is in the row, inside its padding and beside
 * the chevron.
 */

export const RESOURCE_PART_ROW_CLASS_NAME: string =
  "flex items-center gap-3 px-5 py-3 md:px-6";

export const RESOURCE_PART_ROW_LINK_CLASS_NAME: string = `${RESOURCE_PART_ROW_CLASS_NAME} transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500`;

export interface ComponentProps {
  to?: Route | undefined;
  className?: string | undefined;
  dataTestId?: string | undefined;
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

  return (
    <Link
      to={props.to}
      className={RESOURCE_PART_ROW_LINK_CLASS_NAME}
      dataTestId={props.dataTestId}
    >
      {body}
      <Icon
        icon={IconProp.ChevronRight}
        className="h-4 w-4 flex-none text-gray-400"
      />
    </Link>
  );
};

export default ResourcePartRow;
