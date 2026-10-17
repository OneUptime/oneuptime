import { useStatusPageTheme } from "../../Utils/StatusPageTheme";
import { canStatusPageThemeBeDark } from "Common/Types/StatusPage/StatusPageTheme";
import React, { FunctionComponent, ReactElement, ReactNode } from "react";

/*
 * What a status page's logo sits on.
 *
 * A page has one logo, and it is made for a light background: the light
 * page has always shown it, and the emails the page sends show it on white.
 * So it is very often dark lettering on nothing, which would all but vanish
 * on the dark page. On a page a visitor can see dark - a Dark page, and one
 * that follows each visitor's device (StatusPageTheme.System) - the logo
 * sits on a small light backdrop while the page is dark (Theme.css,
 * [data-ou-logo-plate]), so it reads the way it does on the light page.
 * The owner has nothing to change, and nothing to break in their emails.
 * The light page draws nothing around it.
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

  const plateProps: Record<string, string> = canStatusPageThemeBeDark(theme)
    ? { [LOGO_PLATE_ATTRIBUTE]: "" }
    : {};

  return (
    <div id={props.id} className={props.className} {...plateProps}>
      {props.children}
    </div>
  );
};

export default LogoPlate;
