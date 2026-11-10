/*
 * The qrcode library, and the image a QR code is drawn as: for the import()
 * in QR.tsx and nothing else, so the library stays out of every page that
 * draws no code (issue #5619).
 *
 * Why a module of our own, and not import("qrcode") (issue #6638): qrcode is
 * a CommonJS module. The frontends' build (Common/UI/esbuild-config.js: ES
 * modules, split into files) puts a module that is only ever import()ed in a
 * file of its own, and the file of a CommonJS module can export nothing but
 * `default` - its module.exports. So import("qrcode") handed QR.tsx an object
 * with `default` alone, no toDataURL, and every QR code in the product - the
 * sign-in page's two-factor setup, the Dashboard's authenticator apps,
 * Telegram's verification - said "L.toDataURL is not a function" where the
 * code should have been. Someone whose administrator requires two-factor
 * authentication could not set it up, and so could not sign in. Jest reads
 * modules as CommonJS, where import() hands over every export, so the
 * component's own tests passed.
 *
 * This file is an ES module, so its file exports what it declares, and inside
 * it qrcode is imported statically, which the build reads correctly for a
 * CommonJS module - as CodeEditorGrammars does highlight.js.
 * LazyLoadedLibrariesGuard holds every library a frontend import()s by name to
 * being an ES module; QRCodeInBrowserBuild builds this file as the frontends
 * do and draws a code with what the build wrote.
 */
import QRCode from "qrcode";

/*
 * An SVG rather than a PNG drawn on a canvas: it is sharp at any size, on any
 * screen, and it needs no document to be drawn, so the build's own output can
 * be run and checked. Dark squares on white, which every camera reads - in the
 * dark theme too, since the code carries its own white ground and the quiet
 * zone around it.
 */
export default async function makeQRCodeImage(text: string): Promise<string> {
  const svg: string = await QRCode.toString(text, { type: "svg" });

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
