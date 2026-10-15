import * as fs from "fs";
import * as path from "path";

/*
 * Contract for the published Common dependency (#4872):
 * - package exports map Common/<path> → build/dist/<path>.js
 * - Common's tsc emit is CommonJS so require() from this CLI works
 */

describe("Common package resolve contract", () => {
  const commonRoot: string = path.join(__dirname, "..", "..", "Common");

  it("declares exports that map subpaths into build/dist", () => {
    const packageJson: {
      exports?: Record<string, string>;
    } = JSON.parse(
      fs.readFileSync(path.join(commonRoot, "package.json"), "utf8"),
    ) as {
      exports?: Record<string, string>;
    };

    expect(packageJson.exports?.["./*"]).toBe("./build/dist/*.js");
    expect(packageJson.exports?.["./package.json"]).toBe("./package.json");
  });

  it("emits CommonJS so the CLI can require() Common modules", () => {
    const tsconfig: string = fs.readFileSync(
      path.join(commonRoot, "tsconfig.json"),
      "utf8",
    );

    // Match the compilerOptions.module entry (not the ts-node override).
    const moduleMatch: RegExpMatchArray | null = tsconfig.match(
      /"compilerOptions"[\s\S]*?"module"\s*:\s*"([^"]+)"/u,
    );

    expect(moduleMatch?.[1]).toBe("commonjs");
  });
});
