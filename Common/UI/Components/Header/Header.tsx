import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  leftComponents?: undefined | Array<ReactElement> | ReactElement;
  /*
   * The right-hand rail. Rendered at every viewport width — see the note on the
   * container below. An entry that only earns its space on a wide screen
   * carries its own breakpoint classes (`hidden lg:flex`) at the call site.
   */
  rightComponents?: undefined | Array<ReactElement> | ReactElement;
  centerComponents?: undefined | Array<ReactElement> | ReactElement;
  className?: string | undefined;
}

const Header: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <React.Fragment>
      <div
        className={
          props.className ||
          "relative flex h-16 justify-between bg-white shadow-sm px-4"
        }
      >
        {/*
         * min-w-0 so this side is what gives way when the header runs out of
         * room. Without it the project picker's intrinsic width wins the flex
         * negotiation and the whole row overflows the viewport on a phone.
         */}
        <div className="relative z-20 flex min-w-0 items-center">
          {props.leftComponents}
        </div>

        {props.centerComponents && (
          <div className="relative z-0 flex flex-1 items-center justify-center px-2 sm:absolute sm:inset-0">
            {props.centerComponents}
          </div>
        )}

        {/*
         * One right rail, on screen at every width.
         *
         * This used to be `hidden lg:flex`, so below 1024px the header dropped
         * every action it holds — including the profile button, and with it the
         * only way to reach the profile menu, admin settings, the theme switch
         * and log out. Nothing about a narrow viewport makes those optional, so
         * the container no longer decides: it always renders, and each entry
         * hides itself at the widths where it does not fit.
         *
         * flex-shrink-0 keeps the buttons at full size and pushes the squeeze
         * onto the left side, which can truncate.
         */}
        <div className="relative z-20 ml-2 flex flex-shrink-0 items-center gap-2 lg:z-10 lg:ml-4">
          {props.rightComponents}
        </div>
      </div>
    </React.Fragment>
  );
};

export default Header;
