import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { FIREFOX_NO_SYNC_LIBRARY_PATH } from "../../Utils/Monitors/SyntheticRuntime/SyntheticBrowser";

/*
 * SyntheticBrowser preloads a library into Firefox only when the image
 * provides it, and quietly launches Firefox as before when it does not. That
 * fallback is right for a development machine and wrong for the probe image:
 * if the Dockerfile step and the path SyntheticBrowser preloads ever drift
 * apart, every Firefox check goes back to waiting on the disk's syncs, and no
 * unit test can see it. These assertions tie the two together.
 */

const probeRoot: string = resolve(__dirname, "../..");
const dockerfile: string = readFileSync(
  resolve(probeRoot, "Dockerfile.tpl"),
  "utf8",
);
const shimSourcePath: string = resolve(
  probeRoot,
  "Utils/Monitors/SyntheticRuntime/Native/synthetic-no-sync.c",
);

// Top-level (non-static) C function definitions: "int name(".
const EXPORTED_C_FUNCTION: RegExp = /^int\s+(\w+)\s*\(/gm;

describe("Probe Firefox no-sync library image step", () => {
  test("compiles the shim source into exactly the path SyntheticBrowser preloads", () => {
    expect(existsSync(shimSourcePath)).toBe(true);
    expect(dockerfile).toContain(
      "COPY ./Probe/Utils/Monitors/SyntheticRuntime/Native/synthetic-no-sync.c /tmp/synthetic-no-sync.c",
    );
    expect(dockerfile).toContain(
      `-o ${FIREFOX_NO_SYNC_LIBRARY_PATH} /tmp/synthetic-no-sync.c`,
    );
    // A warning is a build failure, not a library that may misbehave.
    expect(dockerfile).toContain("gcc -shared -fPIC -O2 -Wall -Wextra -Werror");
  });

  test("builds it for the development and the production image alike", () => {
    const buildStepIndex: number = dockerfile.indexOf(
      `-o ${FIREFOX_NO_SYNC_LIBRARY_PATH}`,
    );
    const imageSplitIndex: number = dockerfile.indexOf(
      '{{ if eq .Env.ENVIRONMENT "development" }}',
    );

    expect(buildStepIndex).toBeGreaterThan(-1);
    expect(imageSplitIndex).toBeGreaterThan(-1);
    expect(buildStepIndex).toBeLessThan(imageSplitIndex);
  });

  test("leaves the preloaded library root-owned and unwritable by synthetic workers", () => {
    /*
     * Anyone who can replace a preloaded library runs code inside the browser.
     * The synthetic worker UIDs are not root, so root ownership and 0644 /
     * 0755 permissions are what keep them out.
     */
    const libraryDirectory: string = FIREFOX_NO_SYNC_LIBRARY_PATH.substring(
      0,
      FIREFOX_NO_SYNC_LIBRARY_PATH.lastIndexOf("/"),
    );

    expect(dockerfile).toContain(`chown -R root:root ${libraryDirectory}`);
    expect(dockerfile).toContain(`chmod 0755 ${libraryDirectory}`);
    expect(dockerfile).toContain(`chmod 0644 ${FIREFOX_NO_SYNC_LIBRARY_PATH}`);
  });

  test("overrides fsync and fdatasync and nothing else", () => {
    const source: string = readFileSync(shimSourcePath, "utf8");
    const exported: string[] = Array.from(
      source.matchAll(EXPORTED_C_FUNCTION),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });

    expect(exported.sort()).toEqual(["fdatasync", "fsync"]);
  });
});
