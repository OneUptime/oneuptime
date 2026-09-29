import OneUptimeDate from "Common/Types/Date";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A database list's "Last Seen" cell: relative ("5 minutes ago") with the
 * full local date and time on hover. The full date with its time zone was
 * the widest cell of the row, and the list is read for "how stale", not
 * for the exact minute.
 */
export interface ComponentProps {
  lastSeenAt?: Date | string | null | undefined;
}

export function getDatabaseLastSeenText(
  lastSeenAt: Date | string | null | undefined,
): { text: string; title: string } {
  if (!lastSeenAt) {
    return { text: "Never", title: "" };
  }
  const date: Date =
    lastSeenAt instanceof Date ? lastSeenAt : new Date(lastSeenAt);
  if (Number.isNaN(date.getTime())) {
    return { text: "—", title: "" };
  }
  return {
    text: OneUptimeDate.fromNow(date),
    title: OneUptimeDate.getDateAsLocalFormattedString(date),
  };
}

const DatabaseLastSeenCell: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const lastSeen: { text: string; title: string } = getDatabaseLastSeenText(
    props.lastSeenAt,
  );
  return (
    <span
      className="text-sm text-gray-700"
      title={lastSeen.title || undefined}
      data-testid="database-last-seen"
    >
      {lastSeen.text}
    </span>
  );
};

export default DatabaseLastSeenCell;
