import React, { FunctionComponent, ReactElement } from "react";
import StatusBadge, {
  StatusBadgeType,
} from "Common/UI/Components/StatusBadge/StatusBadge";
import {
  formatStatusLabel,
  getResourceStatusBadgeType,
} from "../../Pages/StorageArray/Utils/StorageArrayResourceUtils";

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
 */
const StorageArrayResourceStatusBadge: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const label: string = formatStatusLabel(props.status);

  if (!label) {
    return <span className="text-gray-400">{props.emptyText || "—"}</span>;
  }

  const type: StatusBadgeType = getResourceStatusBadgeType(props.status);

  return <StatusBadge text={label} type={type} />;
};

export default StorageArrayResourceStatusBadge;
