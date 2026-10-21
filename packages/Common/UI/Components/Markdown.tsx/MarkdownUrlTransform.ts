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
 */
export const markdownUrlTransform: UrlTransform = (
  url: string,
  key: string,
  node: Parameters<UrlTransform>[2],
): string | null | undefined => {
  if (key === "src" && node.tagName === "img") {
    const inlineImageDataUri: string | undefined =
      parseInlineImageDataUri(url)?.dataUri;

    if (inlineImageDataUri) {
      return inlineImageDataUri;
    }
  }

  return defaultUrlTransform(url);
};
