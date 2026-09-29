import Icon, { SizeProp } from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import {
  InventoryLiveness,
  InventoryLivenessResult,
  formatMinutesAgo,
  getInventoryLiveness,
} from "./InventoryLiveness";
import {
  InventorySourceDescriptor,
  getInventorySourceDescriptor,
  getInventorySourceLabel,
} from "./InventorySource";
import {
  getInventoryTypeIcon,
  getInventoryTypeLabel,
} from "./InventoryTypeCatalog";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The three pills the Inventory product renders a row's identity with. They
 * exist as one module because a table cell, a detail header and a
 * relationship row all have to describe the same thing the same way — three
 * near-copies of "what colour is `manual` again?" is exactly how a product
 * ends up looking as unfinished as this one did.
 *
 * All three take raw `string` values off the model rather than the enums,
 * because that is what a server-written row hands them and a newer server can
 * legitimately send a value this build has never seen. Every one degrades to
 * showing the raw value rather than rendering blank.
 */

const PILL_CLASS_NAME: string =
  "inline-flex items-center gap-x-1 rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset whitespace-nowrap";

export interface InventoryTypeBadgeProps {
  entityType: string | undefined;
}

/**
 * What kind of thing this is — "Kubernetes Pod", not `k8s.pod`. The icon
 * carries most of the scanning weight in a long list, so it is never omitted.
 */
export const InventoryTypeBadge: FunctionComponent<InventoryTypeBadgeProps> = (
  props: InventoryTypeBadgeProps,
): ReactElement => {
  if (!props.entityType) {
    return <span className="text-sm text-gray-400">-</span>;
  }

  return (
    <span
      className={`${PILL_CLASS_NAME} bg-gray-50 text-gray-700 ring-gray-500/20`}
    >
      <Icon
        icon={getInventoryTypeIcon(props.entityType)}
        size={SizeProp.Smaller}
        className="h-3 w-3"
      />
      {getInventoryTypeLabel(props.entityType)}
    </span>
  );
};

export interface InventorySourceBadgeProps {
  source: string | undefined;
}

/**
 * Where the row came from. This is the pill that tells a user whether
 * deleting the row will actually do anything, so its tooltip carries the
 * source's full explanation rather than repeating the label.
 */
export const InventorySourceBadge: FunctionComponent<
  InventorySourceBadgeProps
> = (props: InventorySourceBadgeProps): ReactElement => {
  if (!props.source) {
    return <span className="text-sm text-gray-400">-</span>;
  }

  const descriptor: InventorySourceDescriptor | null =
    getInventorySourceDescriptor(props.source);

  const pill: ReactElement = (
    <span
      className={`${PILL_CLASS_NAME} ${
        descriptor?.pillClassName || "bg-gray-50 text-gray-700 ring-gray-500/20"
      }`}
    >
      {getInventorySourceLabel(props.source)}
    </span>
  );

  if (!descriptor) {
    return pill;
  }

  return <Tooltip text={descriptor.description}>{pill}</Tooltip>;
};

export interface InventoryLivenessBadgeProps {
  source: string | undefined;
  lastSeenAt: Date | string | undefined | null;
  now?: Date | undefined;
  /** Append "· 4m ago" to the pill. Off in dense table cells. */
  showAge?: boolean | undefined;
}

/**
 * Whether the thing still appears to be there.
 *
 * Renders nothing at all for rows nothing bumps — mirrored and manual ones.
 * Their `lastSeenAt` is either absent or frozen at creation, so any badge
 * derived from it would be an accusation the data cannot support. An empty
 * cell reads correctly here: there is no heartbeat to report on.
 */
export const InventoryLivenessBadge: FunctionComponent<
  InventoryLivenessBadgeProps
> = (props: InventoryLivenessBadgeProps): ReactElement => {
  const result: InventoryLivenessResult = getInventoryLiveness({
    source: props.source,
    lastSeenAt: props.lastSeenAt,
    now: props.now || new Date(),
  });

  if (result.liveness === InventoryLiveness.NotTracked) {
    return <span className="text-sm text-gray-400">-</span>;
  }

  const age: string | null =
    props.showAge && result.minutesSinceLastSeen !== null
      ? formatMinutesAgo(result.minutesSinceLastSeen)
      : null;

  return (
    <Tooltip text={result.description}>
      <span className={`${PILL_CLASS_NAME} ${result.pillClassName}`}>
        {result.liveness === InventoryLiveness.Stale && (
          <Icon
            icon={IconProp.ExclaimationCircle}
            size={SizeProp.Smaller}
            className="h-3 w-3"
          />
        )}
        {result.label}
        {age ? <span className="font-normal opacity-75">· {age}</span> : null}
      </span>
    </Tooltip>
  );
};
