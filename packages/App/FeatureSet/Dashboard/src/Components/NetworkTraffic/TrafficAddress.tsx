import {
  TrafficAddressLabel,
  getTrafficAddressText,
} from "./NetworkTrafficAddressNames";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
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

/*
 * A name or an address too long for its line is cut from its own end, the
 * way it reads: on a Persian page an English DNS name loses its last
 * letters ("blob.ams23prdstr05a.store.core.win…"), not its first, while it
 * still starts where the page's lines start. Inline-block so it sits in the
 * line where the page puts it; the top keeps it level with the text beside
 * it (a box that clips sits on its bottom edge otherwise).
 */
export const CUT_FROM_ITS_OWN_END_CLASS_NAME: string =
  "inline-block max-w-full truncate align-top";

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
        className={CUT_FROM_ITS_OWN_END_CLASS_NAME}
      />
    );
  }

  return (
    <TrafficAddressText
      address={props.label.address}
      className={CUT_FROM_ITS_OWN_END_CLASS_NAME}
    />
  );
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
    parts.push(<TrafficAddressText key="address" address={label.address} />);
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

export interface InlineProps extends ComponentProps {
  // How the address after a name is drawn: a chip's own colour, faded, by default.
  addressClassName?: string | undefined;
}

/*
 * One line: "mumbai-fs01 10.18.167.35" - the name, then the address in
 * small mono - or the address alone. A flex item: where the line is short,
 * the name gives way (cut from its own end) and the address stays whole,
 * so a long name never hides the address, or the words around it.
 */
export const TrafficAddressInline: FunctionComponent<InlineProps> = (
  props: InlineProps,
): ReactElement => {
  if (!props.label.name) {
    return (
      <TrafficAddressText
        address={props.label.address}
        className="min-w-0 truncate"
      />
    );
  }

  return (
    <span className="flex min-w-0 items-baseline gap-1.5">
      <IsolatedText text={props.label.name} className="min-w-0 truncate" />
      <TrafficAddressText
        address={props.label.address}
        className={`flex-shrink-0 ${
          props.addressClassName || "text-xs font-normal opacity-75"
        }`}
      />
    </span>
  );
};

export interface ConversationProps {
  source: TrafficAddressLabel;
  destination: TrafficAddressLabel;
  // What the line ends with, its bytes: last on a wide screen, beside the sender on a phone.
  trailing: ReactNode;
}

// The address after a name, in a list: small and grey, as under a top list's names.
const LIST_ADDRESS_CLASS_NAME: string = "text-xs text-gray-500";

/*
 * A conversation in the list: who sent and who received, each once - its
 * name with its address beside it, or its address alone - and its bytes.
 * Where there is room, one line in three columns, so every row's senders,
 * receivers and bytes line up under the row before's; in a narrow list (a
 * phone, or a laptop's beside the side menu) two lines, the sender beside
 * the bytes and the receiver under it, across the whole row. The room is
 * the list's own (CONVERSATION_LIST_CLASS_NAME), not the window's. The
 * arrow is the flow and points the way the page reads: on a Persian page
 * the sender is on the right and the arrow points left (Icon turns it).
 */
export const CONVERSATION_LIST_CLASS_NAME: string =
  "[container-type:inline-size]";

export const TrafficConversationLine: FunctionComponent<ConversationProps> = (
  props: ConversationProps,
): ReactElement => {
  return (
    <span className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-0.5 [@container(min-width:40rem)]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_4.5rem] [@container(min-width:40rem)]:gap-x-4">
      <span
        className="order-1 flex min-w-0 items-baseline"
        data-testid="traffic-conversation-from"
      >
        <TrafficAddressInline
          label={props.source}
          addressClassName={LIST_ADDRESS_CLASS_NAME}
        />
      </span>
      <span
        className="order-3 col-span-2 flex min-w-0 items-baseline gap-1.5 [@container(min-width:40rem)]:order-2 [@container(min-width:40rem)]:col-span-1"
        data-testid="traffic-conversation-to"
      >
        {/* Level with the words beside it, which keep the line's baseline. */}
        <Icon
          icon={IconProp.ArrowRight}
          className="h-3.5 w-3.5 flex-shrink-0 translate-y-px self-center text-gray-400"
        />
        <TrafficAddressInline
          label={props.destination}
          addressClassName={LIST_ADDRESS_CLASS_NAME}
        />
      </span>
      <span
        className="order-2 text-right tabular-nums [@container(min-width:40rem)]:order-3"
        data-testid="traffic-conversation-bytes"
      >
        {props.trailing}
      </span>
    </span>
  );
};
