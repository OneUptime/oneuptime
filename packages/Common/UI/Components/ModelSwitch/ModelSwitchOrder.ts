/*
 * The order a list of switches is drawn in when some of them have switches
 * of their own (ModelSwitchesCard's children): each switch, then the ones
 * under it. Free of imports, so React-free code - a page's copy module and
 * the App tests that read it - gets the same order the card draws.
 */
export interface SwitchWithChildren<TSwitch> {
  children?: ReadonlyArray<TSwitch> | undefined;
}

export const getSwitchesInDrawnOrder: <
  TSwitch extends SwitchWithChildren<TSwitch>,
>(
  switches: ReadonlyArray<TSwitch>,
) => Array<TSwitch> = <TSwitch extends SwitchWithChildren<TSwitch>>(
  switches: ReadonlyArray<TSwitch>,
): Array<TSwitch> => {
  return switches.flatMap((definition: TSwitch): Array<TSwitch> => {
    return [definition, ...(definition.children || [])];
  });
};
