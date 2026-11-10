import { describe, expect, test } from "@jest/globals";
import QRCode from "qrcode";
import makeQRCodeImage from "../../../../UI/Components/QR/QRCodeImage";
import { loadQRCodeImage } from "../../../../UI/Components/QR/QRCodeLoader";

/*
 * The image a QR code is drawn as, made by the real qrcode library: an SVG,
 * sharp at any size and needing no canvas, carried in a data: URL an <img>
 * shows. Read here from the source; QRCodeInBrowserBuild.test.ts makes the
 * same images with what the frontends' build writes (issue #6638).
 */

const IMAGE_PREFIX: string = "data:image/svg+xml;charset=utf-8,";

const OTP_URL: string =
  "otpauth://totp/OneUptime:ada%40example.com?issuer=OneUptime&secret=MTEA5EMEV46EOK5MXD7E3ES7YSRRR6LQ&algorithm=SHA1&digits=6&period=30";

const svgIn: (image: string) => string = (image: string): string => {
  expect(image.startsWith(IMAGE_PREFIX)).toBe(true);

  return decodeURIComponent(image.slice(IMAGE_PREFIX.length));
};

describe("makeQRCodeImage", () => {
  test("is an SVG in a data: URL, every character of it escaped for the URL", async () => {
    const image: string = await makeQRCodeImage(OTP_URL);

    expect(image.startsWith(IMAGE_PREFIX)).toBe(true);
    // Nothing that would end the address or the attribute it is written in.
    expect(image.slice(IMAGE_PREFIX.length)).not.toMatch(/[\s"'<>#]/);
  });

  test("draws the code the library draws for the text", async () => {
    expect(svgIn(await makeQRCodeImage(OTP_URL))).toBe(
      await QRCode.toString(OTP_URL, { type: "svg" }),
    );
  });

  test("dark squares on a white ground, which every camera reads, whatever the page's theme", async () => {
    const svg: string = svgIn(await makeQRCodeImage(OTP_URL));

    expect(svg).toContain('fill="#ffffff"');
    expect(svg).toContain('stroke="#000000"');
  });

  test("scales to the box it is drawn in, crisply", async () => {
    const svg: string = svgIn(await makeQRCodeImage(OTP_URL));

    expect(svg).toMatch(/^<svg [^>]*viewBox="0 0 \d+ \d+"/);
    expect(svg).toContain('shape-rendering="crispEdges"');
    // No fixed size of its own: the element's classes size it.
    expect(svg).not.toMatch(/^<svg [^>]*\swidth=/);
  });

  test("draws a different code for different text", async () => {
    expect(await makeQRCodeImage(OTP_URL)).not.toBe(
      await makeQRCodeImage("https://t.me/OneUptimeBot?start=4f1c2a7e9b"),
    );
  });

  test("refuses text too long for any code", async () => {
    await expect(makeQRCodeImage("x".repeat(4000))).rejects.toThrow(/too big/i);
  });
});

describe("loadQRCodeImage", () => {
  test("loads the module and makes the image with it", async () => {
    expect(await loadQRCodeImage(OTP_URL)).toBe(
      await makeQRCodeImage(OTP_URL),
    );
  });

  test("passes a refusal on, for the element to say it cannot show the code", async () => {
    await expect(loadQRCodeImage("x".repeat(4000))).rejects.toThrow(/too big/i);
  });
});
