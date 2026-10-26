import { STATUS_PAGE_API_URL } from "../../Utils/Config";
import StatusPageUtil from "../../Utils/StatusPage";
import LogoPlate from "./LogoPlate";
import URL from "Common/Types/API/URL";
import ObjectID from "Common/Types/ObjectID";
import React, { CSSProperties, FunctionComponent, ReactElement } from "react";

/*
 * The status page's logo above a page shown on its own, without the page's
 * header: sign-in, single sign-on, the password prompt, forgot and reset
 * password, and unsubscribe. Each of the six drew its own; they draw this.
 *
 * The logo comes from the page's /logo route, and - while the page is dark,
 * where the page has one - its logo for the dark theme from
 * /dark-theme-logo, shown instead (LogoPlate). Without a dark theme logo the
 * logo sits on its light backdrop there, as it always did. A page with
 * neither draws nothing.
 */

export type StatusPageLogoRoute = "logo" | "dark-theme-logo";

// Where the page's logo, or its dark theme one, is read from.
export const getStatusPageLogoUrl: (data: {
  route: StatusPageLogoRoute;
  statusPageId: string;
}) => string = (data: {
  route: StatusPageLogoRoute;
  statusPageId: string;
}): string => {
  return URL.fromString(STATUS_PAGE_API_URL.toString())
    .addRoute(`/${data.route}/${data.statusPageId}`)
    .toString();
};

export const PAGE_LOGO_STYLE: CSSProperties = {
  height: "70px",
  margin: "auto",
};

export interface ComponentProps {
  logoFileId?: ObjectID | null | undefined;
  darkThemeLogoFileId?: ObjectID | null | undefined;
  // What a screen reader hears for it: the page's name.
  altText?: string | undefined;
}

const hasFile: (id: ObjectID | null | undefined) => boolean = (
  id: ObjectID | null | undefined,
): boolean => {
  return Boolean(id && id.toString());
};

const PageLogo: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const statusPageId: string | undefined =
    StatusPageUtil.getStatusPageId()?.toString();

  const hasLogo: boolean = hasFile(props.logoFileId);
  const hasDarkThemeLogo: boolean = hasFile(props.darkThemeLogoFileId);

  if (!statusPageId || (!hasLogo && !hasDarkThemeLogo)) {
    return <></>;
  }

  return (
    <LogoPlate
      className="mx-auto w-fit"
      darkLogo={
        hasDarkThemeLogo ? (
          <img
            style={PAGE_LOGO_STYLE}
            src={getStatusPageLogoUrl({
              route: "dark-theme-logo",
              statusPageId: statusPageId,
            })}
            alt={props.altText || ""}
          />
        ) : undefined
      }
    >
      {hasLogo ? (
        <img
          style={PAGE_LOGO_STYLE}
          src={getStatusPageLogoUrl({
            route: "logo",
            statusPageId: statusPageId,
          })}
          alt={props.altText || ""}
        />
      ) : undefined}
    </LogoPlate>
  );
};

export default PageLogo;
