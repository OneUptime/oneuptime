import DetailSkeleton from "../Detail/DetailSkeleton";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * What a card shows while a list of names and values it draws by hand
 * loads: the detail card's own skeleton (DetailSkeleton), one name and
 * value per field, in the grid the fields will fill (#9220).
 */

export const DEFAULT_DETAIL_LIST_SKELETON_FIELDS: number = 4;

export interface ComponentProps {
  fields?: number | undefined;
  columns?: number | undefined;
  // The overview pages' denser rows, with hairlines between them.
  isCompact?: boolean | undefined;
}

const DetailListSkeleton: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const fieldCount: number = Math.max(
    1,
    props.fields ?? DEFAULT_DETAIL_LIST_SKELETON_FIELDS,
  );

  return (
    <DetailSkeleton
      spans={Array.from(Array(fieldCount)).map((): undefined => {
        return undefined;
      })}
      columns={props.columns}
      isCompact={props.isCompact}
    />
  );
};

export default DetailListSkeleton;
