import { describe, expect, test } from "@jest/globals";
import path from "path";
import fs from "fs";
import { transformSync, type BabelFileResult } from "@babel/core";

/*
 * Regression guard for "styles do not load on some pages".
 *
 * The app used to compile every JSX element through NativeWind's JSX runtime
 * even though no component used a className. On iOS and Android that runtime
 * wraps View, Text, Pressable and friends and folds their inline `style` into
 * a plain object with an object spread. A Pressable style written as a
 * function - `style={({ pressed }) => ({ ... })}` - spreads to `{}`, so every
 * card, row, filter chip and response button styled that way rendered with no
 * background, padding, radius or layout at all.
 *
 * None of the existing suites could see it: react-native-web never takes that
 * code path, and the runtime skips its component registration when NODE_ENV is
 * "test". So these tests pin the build configuration itself - the only place
 * the fault could come back from.
 */

const appRoot: string = path.resolve(__dirname, "../..");

function compile(platform: "ios" | "android"): string {
  const source: string = [
    'import { Pressable, Text } from "react-native";',
    "export default function Row() {",
    "  return (",
    "    <Pressable style={({ pressed }) => ({ padding: pressed ? 12 : 16 })}>",
    "      <Text>Row</Text>",
    "    </Pressable>",
    "  );",
    "}",
  ].join("\n");

  const result: BabelFileResult | null = transformSync(source, {
    filename: path.join(appRoot, "src/components/StyleProbe.tsx"),
    cwd: appRoot,
    root: appRoot,
    babelrc: false,
    configFile: path.join(appRoot, "babel.config.js"),
    caller: {
      name: "metro",
      bundler: "metro",
      platform,
    } as unknown as { name: string },
  });

  if (!result?.code) {
    throw new Error("Babel produced no output for the style probe");
  }

  return result.code;
}

describe("native style pipeline", () => {
  test.each(["ios", "android"] as const)(
    "JSX compiles to React's own runtime on %s, so Pressable style callbacks reach React Native untouched",
    (platform: "ios" | "android") => {
      const code: string = compile(platform);

      expect(code).toMatch(/react\/jsx-(dev-)?runtime/);
      expect(code).not.toMatch(/nativewind/);
      expect(code).not.toMatch(/react-native-css-interop/);
      // The callback itself survives compilation as a function.
      expect(code).toMatch(/style:\s*(\w+|\(\{[^)]*\}\))\s*=>/);
    },
  );

  test("the Babel config does not route JSX through a CSS interop runtime", () => {
    const babelConfigSource: string = fs.readFileSync(
      path.join(appRoot, "babel.config.js"),
      "utf8",
    );

    expect(babelConfigSource).not.toMatch(/jsxImportSource/);
    expect(babelConfigSource).not.toMatch(/nativewind/);
  });

  test("Metro does not wrap the bundle with NativeWind", () => {
    const metroConfigSource: string = fs.readFileSync(
      path.join(appRoot, "metro.config.js"),
      "utf8",
    );

    expect(metroConfigSource).not.toMatch(/nativewind/i);
  });

  test("NativeWind and its CSS toolchain are not installed as app dependencies", () => {
    const manifest: {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    } = JSON.parse(fs.readFileSync(path.join(appRoot, "package.json"), "utf8"));
    const installed: string[] = [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.devDependencies ?? {}),
    ];

    expect(installed).not.toContain("nativewind");
    expect(installed).not.toContain("react-native-css-interop");
    expect(installed).not.toContain("tailwindcss");
  });

  test("no source file relies on className styling", () => {
    const offenders: string[] = [];

    function walk(directory: string): void {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const fullPath: string = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (
          (/\.tsx?$/).test(entry.name) &&
          !(/\.test\.tsx?$/).test(entry.name) &&
          (/\bclassName=/).test(fs.readFileSync(fullPath, "utf8"))
        ) {
          offenders.push(path.relative(appRoot, fullPath));
        }
      }
    }

    walk(path.join(appRoot, "src"));

    expect(offenders).toEqual([]);
  });
});
