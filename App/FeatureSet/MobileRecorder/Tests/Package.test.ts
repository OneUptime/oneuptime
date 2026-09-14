import { spawnSync, SpawnSyncReturns } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

describe("published React Native package", () => {
  jest.setTimeout(120_000);

  test("prepack builds every JS, declaration, and native consumer artifact", () => {
    const packageRoot: string = path.resolve(__dirname, "..");
    const packageJson: { scripts: Record<string, string> } = JSON.parse(
      fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    expect(packageJson.scripts["prepack"]).toBe("npm run build");
    expect(packageJson.scripts["prepublishOnly"]).toBe("npm run build");

    const npmExecPath: string | undefined = process.env["npm_execpath"];
    expect(npmExecPath).toBeTruthy();
    const packed: SpawnSyncReturns<string> = spawnSync(
      process.execPath,
      [npmExecPath as string, "pack", "--dry-run", "--json", "--silent"],
      {
        cwd: packageRoot,
        encoding: "utf8",
        env: { ...process.env, NODE_ENV: "production" },
      },
    );
    expect(packed.status).toBe(0);
    const result: Array<{ files: Array<{ path: string }> }> = JSON.parse(
      packed.stdout,
    ) as Array<{
      files: Array<{ path: string }>;
    }>;
    const files: Array<string> =
      result[0]?.files.map((file: { path: string }) => {
        return file.path;
      }) ?? [];
    expect(files).toEqual(
      expect.arrayContaining([
        "dist/index.js",
        "dist/index.cjs",
        "dist/types/index.d.ts",
        "android/src/main/java/com/oneuptime/replay/OneUptimeReplayViewTreeModule.java",
        "ios/OneUptimeReplayViewTreeModule.swift",
        "ios/OneUptimeReplayViewTreeModule.m",
        "OneUptimeReactNativeReplay.podspec",
        "react-native.config.js",
        "README.md",
        "package.json",
      ]),
    );

    const bundle: string = fs.readFileSync(
      path.join(packageRoot, "dist/index.js"),
      "utf8",
    );
    expect(bundle).not.toContain("Common/Types");
    expect(bundle).not.toContain("Common/Utils");
  });
});
