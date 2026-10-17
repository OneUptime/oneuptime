import { useStatusPageTheme } from "../../Utils/StatusPageTheme";
import { doesStatusPageThemeFollowDevice } from "Common/Types/StatusPage/StatusPageTheme";
import React, { FunctionComponent, ReactElement, ReactNode } from "react";

/*
 * What a status page's logo sits on.
 *
 * A page has one logo, and on a page that follows each visitor's device
 * (StatusPageTheme.System) that logo is also what visitors with a light
 * device see on the light page - so it is a logo made for a light
 * background, very often dark lettering on nothing, which would all but
 * vanish on the dark page. On such a page the logo sits on a small light
 * backdrop while the page is dark (Theme.css, [data-ou-logo-plate]), so it
 * reads the way it does on the light page. The light page draws nothing
 * around it.
 *
 * A page whose owner chose Dark shows its logo as it is: they chose it for
 * a dark page, and a light logo made for one would vanish on a backdrop.
 */

export const LOGO_PLATE_ATTRIBUTE: string = "data-ou-logo-plate";

export interface ComponentProps {
  children: ReactNode;
  className?: string | undefined;
  id?: string | undefined;
}

const LogoPlate: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { theme } = useStatusPageTheme();

  const plateProps: Record<string, string> = doesStatusPageThemeFollowDevice(
    theme,
  )
    ? { [LOGO_PLATE_ATTRIBUTE]: "" }
    : {};

  return (
    <div id={props.id} className={props.className} {...plateProps}>
      {props.children}
    </div>
  );
};

export default LogoPlate;
