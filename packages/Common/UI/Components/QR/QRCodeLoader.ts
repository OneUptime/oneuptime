/*
 * The image of a QR code, made once the library has loaded: the one place
 * QRCodeImage - and with it the qrcode library - is loaded, by the first code
 * drawn (issue #5619). A module of its own, without React, so that
 * QRCodeInBrowserBuild can build it as the frontends are built and run what
 * the build wrote: the step that broke every QR code (issue #6638) happened in
 * the build, where no test that only imports the source can see it.
 *
 * The import() names our own module, never the library: see QRCodeImage.ts.
 */
export function loadQRCodeImage(text: string): Promise<string> {
  return import("./QRCodeImage").then(
    (library: typeof import("./QRCodeImage")): Promise<string> => {
      return library.default(text);
    },
  );
}
