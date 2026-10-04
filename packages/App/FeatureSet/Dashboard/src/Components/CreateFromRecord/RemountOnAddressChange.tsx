import React, { Fragment, FunctionComponent, ReactElement } from "react";
import { Location, useLocation } from "react-router-dom";

/*
 * A create page reads its address once - the record it was opened from, the
 * template picked, the alerts it is declared from - and its form latches
 * the values it starts with. Opened again on the same route at another
 * address (the command palette's Declare Incident while Declare Incident is
 * open from a monitor, Back and Forward between two such addresses), React
 * Router keeps the page mounted, and it would go on showing the first
 * address's picks and trail. Keyed by the address, it starts over instead.
 */
export interface ComponentProps {
  children: ReactElement;
}

const RemountOnAddressChange: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const location: Location = useLocation();

  return <Fragment key={location.search}>{props.children}</Fragment>;
};

export default RemountOnAddressChange;
