import StatusPageThemeUtil, {
  useStatusPageTheme,
} from "../../Utils/StatusPageTheme";
import { STATUS_PAGE_DARK_SCHEME } from "Common/Types/StatusPage/StatusPageTheme";
import React, { FunctionComponent, ReactElement, ReactNode } from "react";

/*
 * What a status page's logo sits on, and which logo it is.
 *
 * The logo is made for a light background: the light page has always shown
 * it, and the emails the page sends show it on white. So it is very often
 * dark lettering on nothing, which would all but vanish on the dark page.
 *
 *   - A page can have a second logo, made for a dark background (its Dark
 *     Theme Logo). While the page is dark, that one is shown instead, as it
 *     is, with nothing around it.
 *   - Without one, on a page a visitor can see dark - a Dark page, one that
 *     follows each visitor's device (StatusPageTheme.System), and any page
 *     in the Dashboard's preview, which can be switched - the logo sits on a
 *     small light backdrop while the page is dark (Theme.css,
 *     [data-ou-logo-plate]), so it reads the way it does on the light page.
 *
 * The light page draws the logo with nothing around it. The emails always
 * use the logo.
 */

export const LOGO_PLATE_ATTRIBUTE: string = "data-ou-logo-plate";

// Which of the page's logos is drawn: "light" (the logo) or "dark".
export const LOGO_VARIANT_ATTRIBUTE: string = "data-ou-logo-variant";

export interface ComponentProps {
  // The logo, made for the light page. Nothing when the page has none.
  children?: ReactNode | undefined;
  // The logo made for the dark theme, drawn instead while the page is dark.
  darkLogo?: ReactNode | undefined;
  className?: string | undefined;
  id?: string | undefined;
}

const LogoPlate: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { theme, colorScheme } = useStatusPageTheme();

  if (colorScheme === STATUS_PAGE_DARK_SCHEME && props.darkLogo) {
    return (
      <div
        id={props.id}
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

  const plateProps: Record<string, string> =
    StatusPageThemeUtil.canBeDarkForVisitor(theme)
      ? { [LOGO_PLATE_ATTRIBUTE]: "" }
      : {};

  return (
    <div
      id={props.id}
      className={props.className}
      {...{ [LOGO_VARIANT_ATTRIBUTE]: "light" }}
      {...plateProps}
    >
      {props.children}
    </div>
  );
};

export default LogoPlate;
