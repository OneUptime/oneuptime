import { UrlTransform, defaultUrlTransform } from "react-markdown";
import { parseInlineImageDataUri } from "../../../Utils/Markdown/InlineImageDataUri";

/*
 * Which URLs the Markdown viewer keeps.
 *
 * react-markdown's default keeps http, https, irc, ircs, mailto and xmpp,
 * plus relative URLs, and blanks every other one. That includes every data:
 * URL, so a synthetic monitor's screenshot in an incident or alert
 * description - ![Login page](data:image/png;base64,...), the only way a
 * screenshot reaches one - was shown as an empty image, while the same
 * description's email showed it.
 *
 * An image's src may also be an inline raster image (a PNG, JPEG, GIF or
 * WebP that carries itself; see Utils/Markdown/InlineImageDataUri): it is
 * fetched from nowhere and runs nothing, so it is safer than the https
 * images the viewer already shows. Every other URL - a link's href, any
 * other data: URL, an SVG - is left to the default, as before.
 *
 * In safe mode the viewer draws no image at all, whatever its URL.
 *
 * No address holds the marks that set a value apart from the words round
 * it (LRI, RLI, FSI, PDI: U+2066-U+2069, as written or percent-encoded).
 * A text drawn on an Arabic or Persian page sets a value in Latin letters
 * apart in an isolate (Translator's setsValuesApart, an incident's root
 * cause: "- مقصد: FSI https://shop.example.com/health PDI"), and a bare
 * address takes every character up to a space into its link: the PDI
 * after it made the link go to ".../health%E2%81%A9". The marks are never
 * part of where a link goes; the address without them is.
 */
const ISOLATE_MARKS_IN_ADDRESS: RegExp = /[⁦-⁩]|%E2%81%A[6-9]/gi;

export const markdownUrlTransform: UrlTransform = (
  url: string,
  key: string,
  node: Parameters<UrlTransform>[2],
): string | null | undefined => {
  const address: string = url.replace(ISOLATE_MARKS_IN_ADDRESS, "");

  if (key === "src" && node.tagName === "img") {
    const inlineImageDataUri: string | undefined =
      parseInlineImageDataUri(address)?.dataUri;

    if (inlineImageDataUri) {
      return inlineImageDataUri;
    }
  }

  return defaultUrlTransform(address);
};
