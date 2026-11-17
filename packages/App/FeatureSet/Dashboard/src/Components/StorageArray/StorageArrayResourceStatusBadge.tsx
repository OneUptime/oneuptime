import React, { FunctionComponent, ReactElement } from "react";
import StatusBadge, {
  StatusBadgeType,
} from "Common/UI/Components/StatusBadge/StatusBadge";
import {
  formatStatusLabel,
  getResourceStatusBadgeType,
} from "../../Pages/StorageArray/Utils/StorageArrayResourceUtils";
import { getKnownStorageArrayStatusKey } from "../../Pages/StorageArray/Utils/StorageArrayHealth";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";

export interface ComponentProps {
  // The status as ingest wrote it (lowercased): "ok", "critical", "healthy"...
  status: string | null | undefined;
  // Shown for an object whose status the array has not reported.
  emptyText?: string | undefined;
}

/*
 * A storage array object's status as a pill: red for the statuses that
 * mean a part has failed, amber for those that need attention, green for
 * healthy ones and grey for the expected states in between (not installed,
 * unused, disabled) — see StorageArrayResourceUtils for the lists.
 *
 * Its word is the reader's (StatusBadge looks it up): a status the rules
 * know is the key of their list (StorageArrayHealth's
 * getKnownStorageArrayStatusKey), the one the dashboard's hardware widget
 * draws too (#7521), so a drive reads "Beeinträchtigt" on its array's page
 * and on a board alike. Any other word - an alert's severity, a word a new
 * Purity release brings - is the array's, made readable.
 */
const StorageArrayResourceStatusBadge: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const label: string =
    getKnownStorageArrayStatusKey(props.status) ||
    formatStatusLabel(props.status);

  // No status: the object's own words for that, or the quiet dash.
  if (!label) {
    return props.emptyText ? (
      <span className="text-gray-500">{props.emptyText}</span>
    ) : (
      <TableEmptyValue />
    );
  }

  const type: StatusBadgeType = getResourceStatusBadgeType(props.status);

  return <StatusBadge text={label} type={type} />;
};

export default StorageArrayResourceStatusBadge;
