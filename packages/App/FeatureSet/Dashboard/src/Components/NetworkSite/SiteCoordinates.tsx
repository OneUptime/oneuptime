import React, { FunctionComponent, ReactElement } from "react";

/*
 * A SITE'S POINT ON THE MAP, READ LEFT TO RIGHT IN EVERY LANGUAGE.
 *
 * "42.3601, -71.0589" is a latitude and a longitude, written the way the
 * site's Latitude and Longitude fields take them, the way a CSV of sites
 * holds them and the way a map app reads them when it is pasted in. On an
 * Arabic or Persian page, laid out from the right, the bidi rules read the
 * pair as two numbers in a right-to-left line: the minus sign moved to the
 * other side of its number ("71.0589-") and the two numbers could swap
 * places, so the reader saw another point.
 *
 * So the pair is one left-to-right isolate (bdi dir="ltr"): latitude first,
 * the minus sign in front of its number, in every language. The isolate
 * still starts where its line does - under its column's name in the Sites
 * list, beside its label on a site's page - and on a page read from the
 * left it reads exactly as the plain pair did. The digits stay as they are
 * written (Latin, as the fields and the import file have them), so the
 * point can be checked against them and copied.
 *
 * The Sites list's Location column, a site's Coordinates and the CSV
 * import's preview all draw a point with it.
 */

export interface ComponentProps {
  latitude: number;
  longitude: number;
  className?: string | undefined;
  dataTestId?: string | undefined;
}

// "42.3601, -71.0589": the pair as the fields and the import file write it.
export const formatSiteCoordinates: (
  latitude: number,
  longitude: number,
) => string = (latitude: number, longitude: number): string => {
  return `${latitude}, ${longitude}`;
};

const SiteCoordinates: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <bdi
      dir="ltr"
      className={props.className}
      data-testid={props.dataTestId || "site-coordinates"}
    >
      {formatSiteCoordinates(props.latitude, props.longitude)}
    </bdi>
  );
};

export default SiteCoordinates;
