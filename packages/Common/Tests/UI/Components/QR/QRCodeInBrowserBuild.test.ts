import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import childProcess from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import QRCode from "qrcode";

/*
 * A QR code drawn by what the frontends' build writes, not by the source
 * (issue #6638).
 *
 * The QR code element loaded the qrcode library with import("qrcode"). The
 * build (Common/UI/esbuild-config.js: ES modules, split into files) put the
 * library in a file of its own, and the file of a CommonJS module exports
 * nothing but `default`, so the element was handed an object without
 * toDataURL and every QR code in the product said "L.toDataURL is not a
 * function": the sign-in page's two-factor setup, the Dashboard's
 * authenticator apps, Telegram's verification. Jest reads the source as
 * CommonJS, where import() hands over every export, and the element's own
 * tests passed throughout.
 *
 * So the loader the element draws with (QRCodeLoader) is built here as the
 * frontends build it - the shared config, for production, minified and split
 * - and the files the build wrote are run in Node, which reads them as the
 * browser does: as ES modules. A code drawn that way went through the very
 * step that broke. The one setting changed is publicPath: the build would
 * have the files import each other from /accounts/dist/, which is a path on
 * the server, not on disk. Where a file is fetched from has no bearing on
 * what it exports.
 *
 * A subprocess supplies the native Node environment esbuild requires, as in
 * SignInFirstLoadBuild.test.ts.
 */

const COMMON_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");

const LOADER: string = path.join(
  COMMON_ROOT,
  "UI",
  "Components",
  "QR",
  "QRCodeLoader.ts",
);

const IMAGE_PREFIX: string = "data:image/svg+xml;charset=utf-8,";

// What the server issues for a new authenticator app (TotpAuth.generateUri).
const OTP_URL: string =
  "otpauth://totp/OneUptime:ada%40example.com?issuer=OneUptime&secret=MTEA5EMEV46EOK5MXD7E3ES7YSRRR6LQ&algorithm=SHA1&digits=6&period=30";

// What Telegram's verification draws.
const TELEGRAM_LINK: string = "https://t.me/OneUptimeBot?start=4f1c2a7e9b";

// Text past ASCII is written as UTF-8 bytes.
const NON_ASCII_TEXT: string = "二要素認証 — Zwei-Faktor-Authentifizierung";

// More than the largest QR code holds (2,953 bytes).
const TOO_LONG_TEXT: string = "x".repeat(4000);

const TEXTS: ReadonlyArray<string> = [
  OTP_URL,
  TELEGRAM_LINK,
  NON_ASCII_TEXT,
  TOO_LONG_TEXT,
];

interface BuiltOutput {
  // Relative to the build's output folder.
  file: string;
  entryPoint: string;
  exports: Array<string>;
  inputs: Array<string>;
}

interface Drawn {
  text: string;
  image?: string;
  error?: string;
}

interface Built {
  outputs: Array<BuiltOutput>;
  // Each input's module format, as esbuild read it: "esm" or "cjs".
  inputFormats: Record<string, string>;
  drawn: Array<Drawn>;
}

let outputDirectory: string = "";
let built: Built | null = null;

const buildAndDraw: () => Built = (): Built => {
  outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "qr-code-build-"));

  const script: string = `
    const fs = require("fs");
    const path = require("path");
    const { pathToFileURL } = require("url");
    const commonRoot = ${JSON.stringify(COMMON_ROOT)};
    const outdir = ${JSON.stringify(outputDirectory)};
    const esbuild = require(require.resolve("esbuild", { paths: [commonRoot] }));
    const { createConfig } = require(path.join(commonRoot, "UI/esbuild-config.js"));
    const config = createConfig({
      serviceName: "Accounts",
      publicPath: "/accounts/dist/",
      entryPoint: ${JSON.stringify(LOADER)},
    });

    (async () => {
      const result = await esbuild.build({
        ...config,
        outdir: outdir,
        publicPath: "./",
        write: true,
        sourcemap: false,
        metafile: true,
        logLevel: "silent",
      });

      // Read as the browser reads them: as ES modules.
      fs.writeFileSync(path.join(outdir, "package.json"), '{"type":"module"}');

      const outputs = Object.entries(result.metafile.outputs)
        .filter(([file]) => file.endsWith(".js"))
        .map(([file, output]) => {
          return {
            file: path.relative(outdir, path.resolve(file)),
            entryPoint: output.entryPoint || "",
            exports: output.exports,
            inputs: Object.keys(output.inputs),
          };
        });
      const inputFormats = {};

      for (const [input, details] of Object.entries(result.metafile.inputs)) {
        inputFormats[input] = details.format || "";
      }

      const loaderOutput = outputs.find((output) => {
        return output.entryPoint.endsWith("QRCodeLoader.ts");
      });
      const loader = await import(
        pathToFileURL(path.join(outdir, loaderOutput.file)).href
      );
      const drawn = [];

      for (const text of ${JSON.stringify(TEXTS)}) {
        try {
          drawn.push({ text: text, image: await loader.loadQRCodeImage(text) });
        } catch (error) {
          drawn.push({ text: text, error: String((error && error.message) || error) });
        }
      }

      console.log(JSON.stringify({ outputs, inputFormats, drawn }));
    })().catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
  `;

  return JSON.parse(
    childProcess.execFileSync(process.execPath, ["-e", script], {
      cwd: COMMON_ROOT,
      env: { ...process.env, NODE_ENV: "production" },
      encoding: "utf8",
      timeout: 240000,
      maxBuffer: 64 * 1024 * 1024,
    }),
  );
};

const drawnFor: (text: string) => Drawn = (text: string): Drawn => {
  const drawn: Drawn | undefined = built!.drawn.find(
    (entry: Drawn): boolean => {
      return entry.text === text;
    },
  );

  if (!drawn) {
    throw new Error(`No code was drawn for "${text.slice(0, 40)}"`);
  }

  return drawn;
};

const svgOf: (drawn: Drawn) => string = (drawn: Drawn): string => {
  expect(drawn.error).toBeUndefined();
  expect(drawn.image?.startsWith(IMAGE_PREFIX)).toBe(true);

  return decodeURIComponent(drawn.image!.slice(IMAGE_PREFIX.length));
};

const outputFor: (entryPointEnd: string) => BuiltOutput = (
  entryPointEnd: string,
): BuiltOutput => {
  const output: BuiltOutput | undefined = built!.outputs.find(
    (candidate: BuiltOutput): boolean => {
      return candidate.entryPoint.endsWith(entryPointEnd);
    },
  );

  if (!output) {
    throw new Error(`The build wrote no file for ${entryPointEnd}`);
  }

  return output;
};

const isQRCodeLibrary: (input: string) => boolean = (
  input: string,
): boolean => {
  return input.includes("node_modules/qrcode/");
};

beforeAll(() => {
  built = buildAndDraw();
}, 300000);

afterAll(() => {
  if (outputDirectory) {
    fs.rmSync(outputDirectory, { recursive: true, force: true });
  }
});

describe("a QR code drawn by the frontends' build", () => {
  test.each([
    ["an authenticator app's enrolment", OTP_URL],
    ["Telegram's verification link", TELEGRAM_LINK],
    ["text past ASCII", NON_ASCII_TEXT],
  ])("is drawn for %s, as an SVG image", (_name: string, text: string) => {
    const svg: string = svgOf(drawnFor(text));

    expect(svg.startsWith("<svg xmlns=")).toBe(true);
    expect(svg.endsWith("</svg>\n")).toBe(true);
    expect(svg).toContain("<path");
  });

  test.each([
    ["an authenticator app's enrolment", OTP_URL],
    ["Telegram's verification link", TELEGRAM_LINK],
    ["text past ASCII", NON_ASCII_TEXT],
  ])(
    "is the code the library draws for %s, square for square",
    async (_name: string, text: string) => {
      const expected: string = await QRCode.toString(text, { type: "svg" });

      expect(svgOf(drawnFor(text))).toBe(expected);
    },
  );

  test("draws a code for each text, not one for all of them", () => {
    expect(svgOf(drawnFor(OTP_URL))).not.toBe(svgOf(drawnFor(TELEGRAM_LINK)));
  });

  test("refuses text too long for any code, which the element says it cannot show", () => {
    const drawn: Drawn = drawnFor(TOO_LONG_TEXT);

    expect(drawn.image).toBeUndefined();
    expect(drawn.error).toMatch(/too big/i);
  });
});

describe("what the build makes of the loader", () => {
  test("loads the library in a file of its own, once a code is drawn", () => {
    const loader: BuiltOutput = outputFor("UI/Components/QR/QRCodeLoader.ts");

    expect(loader.inputs.filter(isQRCodeLibrary)).toEqual([]);
    expect(
      built!.outputs.some((output: BuiltOutput): boolean => {
        return output.inputs.some(isQRCodeLibrary);
      }),
    ).toBe(true);
  });

  test("loads our own module, an ES module, not the CommonJS library itself", () => {
    const image: BuiltOutput = outputFor("UI/Components/QR/QRCodeImage.ts");

    expect(built!.inputFormats[image.entryPoint]).toBe("esm");
    expect(image.exports).toEqual(["default"]);
    expect(image.inputs.some(isQRCodeLibrary)).toBe(true);

    // No file is the library's alone: that file could export only default.
    expect(
      built!.outputs.filter((output: BuiltOutput): boolean => {
        return isQRCodeLibrary(output.entryPoint);
      }),
    ).toEqual([]);
  });

  test("reads the library as the CommonJS module it is, so the guard above is not vacuous", () => {
    const libraryFormats: Array<string> = Object.entries(built!.inputFormats)
      .filter(([input]: [string, string]): boolean => {
        return isQRCodeLibrary(input);
      })
      .map(([, format]: [string, string]): string => {
        return format;
      });

    expect(libraryFormats.length).toBeGreaterThan(0);
    expect(libraryFormats).toContain("cjs");
  });
});
