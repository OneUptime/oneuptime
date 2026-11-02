import { GuideMark, monogramOf } from "./Integrations/OpenTelemetry/GuidePage";
import { Product } from "./ProductCompare";
import { getProviderLogoMarkup } from "./ProviderLogoMarkup";

/*
 * The mark beside a tool OneUptime is compared with, on the comparisons'
 * index and at the top of the tool's own page: its official mark, drawn
 * inline in the page's grey as the integrations' marks are, or, for a tool
 * the logo registry has no mark for, its initials on the same tile. Never an
 * image of the tool's logo, never its colours: the tool's name is written
 * right beside it, and the page reads as the site's own.
 */
export function getCompareMark(product: Product): GuideMark {
  return {
    logo: product.logo ? getProviderLogoMarkup(product.logo) : undefined,
    monogram: monogramOf(product.productName),
  };
}
