import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  children: ReactElement | Array<ReactElement>;
  /*
   * A group after another in the same menu: a hairline above it sets it
   * apart (Help's ways to learn, then its ways to ask for help).
   */
  isSeparated?: boolean | undefined;
  dataTestId?: string | undefined;
}

export const ICON_DROPDOWN_ROW_SEPARATED_CLASS_NAME: string =
  "mt-2 border-t border-gray-100 pt-2";

const IconDropdownRow: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    /*
     * Where the rows sit, no part of the menu itself (role="none"): its menu
     * items are the menu's own, which the arrow keys walk across groups.
     */
    <div
      role="none"
      data-testid={props.dataTestId}
      className={
        props.isSeparated ? ICON_DROPDOWN_ROW_SEPARATED_CLASS_NAME : undefined
      }
    >
      {props.children}
    </div>
  );
};

export default IconDropdownRow;
