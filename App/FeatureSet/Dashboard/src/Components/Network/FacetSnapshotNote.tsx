import IconProp from "Common/Types/Icon/IconProp";
import Icon, { SizeProp } from "Common/UI/Components/Icon/Icon";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  /*
   * What the reader needs to know about a filter whose meaning depends on when it
   * was applied, e.g. "Up / down is measured against a 15-minute window taken at
   * 14:32."
   */
  detail: string;
  // Suffix for the note's `data-testid`, so several tables stay distinguishable.
  testIdSuffix: string;
}

/*
 * A caption under the facet bar for a chip that filters against a moment rather
 * than a value.
 *
 * The device list's Status chip is the case this exists for. Its cutoff is a
 * snapshot taken when the value was picked, while the Status column recomputes the
 * same window live on every render — so leave the page open long enough and a row
 * inside the "Up" list paints a Down pill. Without this line there is nothing on
 * screen that could explain the disagreement.
 */
const FacetSnapshotNote: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div
      data-testid={`facet-snapshot-note-${props.testIdSuffix}`}
      className="-mt-2 mb-4 flex items-center gap-1.5 text-xs text-gray-500"
    >
      <Icon icon={IconProp.Info} size={SizeProp.ExtraSmall} />
      <span>{props.detail}</span>
    </div>
  );
};

export default FacetSnapshotNote;
