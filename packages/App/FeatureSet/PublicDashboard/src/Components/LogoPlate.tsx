import { useDashboardTheme } from "../Utils/UseDashboardTheme";
import { DASHBOARD_DARK_SCHEME } from "Common/Types/Dashboard/DashboardTheme";
import React, { FunctionComponent, ReactElement, ReactNode } from "react";

/*
 * What a public dashboard's logo sits on, and which logo it is.
 *
 * A dashboard's logo, uploaded on its Branding page, is made for a light
 * background: every public dashboard was light before it had a theme. So it
 * is very often dark lettering on nothing, which would all but vanish on
 * the dark page - and any visitor can turn any public dashboard dark from
 * its toolbar.
 *
 *   - A dashboard can have a second logo, made for a dark background (its
 *     Dark Theme Logo). While the page is dark, that one is shown instead,
 *     as it is, with nothing around it.
 *   - Without one, while the page is dark the logo sits on a small light
 *     backdrop (Common/UI/Styles/Theme.css, [data-ou-logo-plate], the rule
 *     a status page's logo uses), so it reads the way it does on the light
 *     page.
 *
 * The light page draws the logo with nothing around it. The status page's
 * own LogoPlate does the same for a status page.
 */

export const LOGO_PLATE_ATTRIBUTE: string = "data-ou-logo-plate";

// Which of the dashboard's logos is drawn: "light" (the logo) or "dark".
export const LOGO_VARIANT_ATTRIBUTE: string = "data-ou-logo-variant";

export interface ComponentProps {
  // The logo, made for the light page. Nothing when the dashboard has none.
  children?: ReactNode | undefined;
  // The logo made for the dark theme, drawn instead while the page is dark.
  darkLogo?: ReactNode | undefined;
  className?: string | undefined;
}

const LogoPlate: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { colorScheme } = useDashboardTheme();

  if (colorScheme === DASHBOARD_DARK_SCHEME && props.darkLogo) {
    return (
      <div
        className={props.className}
        {...{ [LOGO_VARIANT_ATTRIBUTE]: "dark" }}
      >
        {props.darkLogo}
      </div>
    );
  }

  if (!props.children) {
    return <></>;
  }

  return (
    <div
      className={props.className}
      {...{ [LOGO_VARIANT_ATTRIBUTE]: "light" }}
      {...{ [LOGO_PLATE_ATTRIBUTE]: "" }}
    >
      {props.children}
    </div>
  );
};

export default LogoPlate;
