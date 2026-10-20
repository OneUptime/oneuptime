import React, { FunctionComponent, ReactElement, ReactNode } from "react";

/*
 * What a public dashboard's logo sits on.
 *
 * A dashboard has one logo, uploaded on its Branding page, and it is made
 * for a light background: every public dashboard was light before it had a
 * theme. So it is very often dark lettering on nothing, which would all but
 * vanish on the dark page - and any visitor can turn any public dashboard
 * dark from its toolbar. While the page is dark, the logo sits on a small
 * light backdrop (Common/UI/Styles/Theme.css, [data-ou-logo-plate], the
 * rule a status page's logo uses), so it reads the way it does on the light
 * page. The owner has nothing to change; the light page draws nothing
 * around it.
 */

export const LOGO_PLATE_ATTRIBUTE: string = "data-ou-logo-plate";

export interface ComponentProps {
  children: ReactNode;
  className?: string | undefined;
}

const LogoPlate: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div className={props.className} {...{ [LOGO_PLATE_ATTRIBUTE]: "" }}>
      {props.children}
    </div>
  );
};

export default LogoPlate;
