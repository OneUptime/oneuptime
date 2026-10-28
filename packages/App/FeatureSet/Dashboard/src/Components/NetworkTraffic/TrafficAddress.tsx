import {
  TrafficAddressLabel,
  getTrafficAddressText,
} from "./NetworkTrafficAddressNames";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  ReactNode,
} from "react";

/*
 * An address on a Traffic page, drawn (issue #5340): its name first, the
 * address beside or under it, and the subnet it is in when someone named
 * one (NetworkTrafficAddressNames says what is written; these say how).
 *
 * The address always reads left to right, in the mono face, on a Persian
 * page as on an English one - an address is not a sentence - and a name
 * reads the way most of its letters do (IsolatedText): a DNS name left to
 * right, an Address Name someone wrote in Persian right to left.
 */

export interface AddressTextProps {
  address: string;
  className?: string | undefined;
}

// The address itself.
export const TrafficAddressText: FunctionComponent<AddressTextProps> = (
  props: AddressTextProps,
): ReactElement => {
  return (
    <bdi
      dir="ltr"
      className={`font-mono${props.className ? ` ${props.className}` : ""}`}
      data-testid="traffic-address-text"
    >
      {props.address}
    </bdi>
  );
};

export interface ComponentProps {
  label: TrafficAddressLabel;
}

// A row's first line: the name, or the address when there is none.
export const TrafficAddressPrimary: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (props.label.name) {
    return (
      <IsolatedText
        text={props.label.name}
        title={getTrafficAddressText(props.label)}
      />
    );
  }

  return <TrafficAddressText address={props.label.address} />;
};

/*
 * A row's second line: the address when the first line is a name, and the
 * subnet's name - "10.18.167.35 · Mumbai office". Null when there is
 * nothing to add (an address the project knows nothing about).
 */
export function getTrafficAddressSecondary(
  label: TrafficAddressLabel,
): ReactElement | null {
  const parts: Array<ReactElement> = [];

  if (label.name) {
    parts.push(
      <TrafficAddressText key="address" address={label.address} />,
    );
  }

  if (label.subnetName) {
    parts.push(
      <IsolatedText
        key="subnet"
        text={label.subnetName}
        title={label.subnet || undefined}
      />,
    );
  }

  if (parts.length === 0) {
    return null;
  }

  return (
    <Fragment>
      {parts.map((part: ReactElement, index: number): ReactElement => {
        return (
          <Fragment key={index}>
            {index > 0 ? <span aria-hidden="true"> · </span> : <></>}
            {part}
          </Fragment>
        );
      })}
    </Fragment>
  );
}

export interface PairProps {
  source: ReactNode;
  destination: ReactNode;
}

/*
 * "from → to", left to right whatever the page's language (the arrow is the
 * flow). Where the line is too narrow for both ends, the receiver goes to a
 * line of its own rather than out of sight; an end longer than a whole
 * line is cut short on its own.
 */
export const TrafficAddressPair: FunctionComponent<PairProps> = (
  props: PairProps,
): ReactElement => {
  return (
    <span dir="ltr" className="flex min-w-0 flex-wrap items-baseline gap-x-1">
      <span className="flex min-w-0 max-w-full items-baseline gap-x-1">
        <span className="min-w-0 truncate">{props.source}</span>
        <span aria-hidden="true" className="flex-shrink-0">
          →
        </span>
      </span>
      <span className="min-w-0 max-w-full truncate">{props.destination}</span>
    </span>
  );
};

/*
 * One line: "mumbai-fs01 10.18.167.35" - the name, then the address in
 * small grey mono - or the address alone. For a filter chip and a sentence.
 */
export const TrafficAddressInline: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (!props.label.name) {
    return <TrafficAddressText address={props.label.address} />;
  }

  return (
    <span className="inline-flex min-w-0 items-baseline gap-1.5">
      <IsolatedText text={props.label.name} className="truncate" />
      <TrafficAddressText
        address={props.label.address}
        className="text-xs font-normal opacity-75"
      />
    </span>
  );
};
