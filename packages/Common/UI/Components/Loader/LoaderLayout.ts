import { Gray500 } from "../../../Types/BrandColors";
import Color from "../../../Types/Color";

/*
 * One look for every loading bar (#9135). There were three: PageLoader drew
 * a gray-500 bar 208px down the page (mt-52), ComponentLoader a #c2c2c2 one
 * between 4rem margins, and CompactLoader the same pale bar between 1.25rem
 * ones, so the same wait looked different from card to card, and the pale
 * one (1.7:1 on white) read as a blank card rather than a loading one.
 */

// The bar's colour: visible without being loud, in both themes.
export const LOADER_COLOR: Color = Gray500;

/*
 * Where a page's or a card's bar sits: centred in a box as tall as an empty
 * card (EmptyState's card preset, about 13rem with its words), so a card that loads into
 * "No X yet" keeps its height, and nothing under it jumps.
 */
export const LOADER_BOX_CLASS_NAME: string =
  "flex min-h-52 w-full items-center justify-center";
