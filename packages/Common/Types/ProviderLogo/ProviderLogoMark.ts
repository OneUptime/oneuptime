/*
 * A brand's mark, as OneUptime draws it: the shapes of the brand's official
 * mark, every one filled with the colour of the icons around it
 * (currentColor), so the mark is one colour wherever it sits - the grey of
 * an icon tile, the indigo of a picked menu entry, the light grey of the
 * dark theme. Never the brand's own colours, never an image.
 *
 * Each mark lives in Marks/<logo>.ts, the box its shapes are drawn in in
 * ProviderLogoMarks.ts.
 */

export interface ProviderLogoMarkShape {
  // The shape's path data, in the coordinates of the mark's box.
  d: string;
  /*
   * A shape the brand draws in a lighter tint of its colour (UptimeRobot's
   * halo around its dot): the same colour, this much of it. Left out, the
   * shape is solid.
   */
  opacity?: number | undefined;
}

export type ProviderLogoMarkShapes = ReadonlyArray<ProviderLogoMarkShape>;
