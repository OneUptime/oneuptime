import { readFileSync } from "fs";
import { resolve } from "path";

interface ProbePackageJson {
  optionalDependencies: Record<string, string>;
  allowScripts: Record<string, boolean>;
}

interface ProbePackageLock {
  packages: Record<string, { version?: string }>;
}

const probeRoot: string = resolve(__dirname, "../..");
const packageJson: ProbePackageJson = JSON.parse(
  readFileSync(resolve(probeRoot, "package.json"), "utf8"),
) as ProbePackageJson;
const packageLock: ProbePackageLock = JSON.parse(
  readFileSync(resolve(probeRoot, "package-lock.json"), "utf8"),
) as ProbePackageLock;
const dockerfile: string = readFileSync(
  resolve(probeRoot, "Dockerfile.tpl"),
  "utf8",
);

describe("Probe SQL Server integrated-authentication image", () => {
  test("keeps the native driver optional for non-ODBC development environments", () => {
    expect(packageJson.optionalDependencies["msnodesqlv8"]).toBeDefined();
  });

  test("approves only the exact locked native-driver install script", () => {
    const lockedVersion: string | undefined =
      packageLock.packages["node_modules/msnodesqlv8"]?.version;

    expect(lockedVersion).toBeDefined();
    expect(packageJson.allowScripts).toEqual({
      [`msnodesqlv8@${lockedVersion}`]: true,
    });
  });

  test("installs and verifies the complete ODBC/Kerberos runtime", () => {
    for (const requiredPackage of [
      "unixodbc-dev",
      "krb5-user",
      "msodbcsql18",
    ]) {
      expect(dockerfile).toContain(requiredPackage);
    }

    expect(dockerfile).toContain("require('mssql/msnodesqlv8')");
    expect(dockerfile).toContain(
      'odbcinst -q -d -n "ODBC Driver 18 for SQL Server"',
    );
  });
});

/*
 * The build toolchain (python3, make, g++, the unixODBC headers) was ~80% of
 * the OS-package CVEs scanners reported for this image: g++ pulls in the kernel
 * headers (linux-libc-dev, ~1,900 CVEs on its own) and binutils. The production
 * image removes it once the native modules are built; the development image
 * keeps it because Start.dev.sh reinstalls and rebuilds them.
 */
const DEVELOPMENT_IF: string = '{{ if eq .Env.ENVIRONMENT "development" }}';
const developmentStart: number = dockerfile.indexOf(DEVELOPMENT_IF);
const elseIndex: number = dockerfile.indexOf("{{ else }}", developmentStart);
const endIndex: number = dockerfile.lastIndexOf("{{ end }}");
const sharedPart: string = dockerfile.slice(0, developmentStart);
const developmentPart: string = dockerfile.slice(developmentStart, elseIndex);
const productionPart: string = dockerfile.slice(elseIndex, endIndex);

const COMMENT_LINE: RegExp = /^\s*#/;
const NPM_CI: RegExp = /\bnpm ci\b/;
const BUILDS_NATIVE_CODE: RegExp =
  /\b(npm ci|npm install|npm rebuild|gcc |node-gyp)\b/;

// RUN instructions of one part, comments dropped and continuations joined.
function runInstructions(part: string): Array<string> {
  return part
    .split("\n")
    .filter((line: string) => {
      return !COMMENT_LINE.test(line);
    })
    .join("\n")
    .replace(/\\\n/g, " ")
    .split("\n")
    .map((line: string) => {
      return line.trim().replace(/\s+/g, " ");
    })
    .filter((line: string) => {
      return line.startsWith("RUN ");
    });
}

describe("Probe production image without the build toolchain", () => {
  const productionRuns: Array<string> = runInstructions(productionPart);
  const purge: string | undefined = productionRuns.find((line: string) => {
    return line.includes("apt-get purge");
  });

  test("the template has the development/production split this reads", () => {
    expect(developmentStart).toBeGreaterThan(0);
    expect(elseIndex).toBeGreaterThan(developmentStart);
    expect(endIndex).toBeGreaterThan(elseIndex);
  });

  test("purges the compilers and the unixODBC headers, with their dependencies", () => {
    expect(purge).toBeDefined();
    expect(purge).toContain(
      "apt-get purge -y --auto-remove python3 make g++ unixodbc-dev",
    );
  });

  test("purges after everything that compiles: the native modules, the no-sync library, the TypeScript build", () => {
    const compileIndex: number = productionRuns.findIndex((line: string) => {
      return line === "RUN npm run compile";
    });
    const purgeIndex: number = productionRuns.findIndex((line: string) => {
      return line.includes("apt-get purge");
    });
    expect(compileIndex).toBeGreaterThanOrEqual(0);
    expect(purgeIndex).toBeGreaterThan(compileIndex);

    // The native builds all happen before the development/production split.
    const sharedRuns: Array<string> = runInstructions(sharedPart);
    expect(
      sharedRuns.some((line: string) => {
        return line.includes("gcc -shared");
      }),
    ).toBe(true);
    expect(
      sharedRuns.filter((line: string) => {
        return NPM_CI.test(line);
      }),
    ).toHaveLength(2);
    expect(
      productionRuns.some((line: string) => {
        return BUILDS_NATIVE_CODE.test(line);
      }),
    ).toBe(false);
  });

  test("loads every native piece again after the purge, in the same step", () => {
    const afterPurge: string = purge!.slice(purge!.indexOf("apt-get purge"));
    expect(afterPurge).toContain("node -e \"require('mssql/msnodesqlv8')\"");
    expect(afterPurge).toContain(
      'odbcinst -q -d -n "ODBC Driver 18 for SQL Server"',
    );
    expect(afterPurge).toContain(
      "node -e \"require('/usr/src/Common/node_modules/isolated-vm')\"",
    );
    // The process-memory helper, run with no arguments, exits 2 with its usage.
    expect(afterPurge).toContain(
      "{ /usr/lib/oneuptime-probe/synthetic-process-memory 2>/dev/null; test $? -eq 2; }",
    );
  });

  test("keeps the runtime pieces: none of them is in the purge list", () => {
    const purged: Array<string> = purge!
      .slice(purge!.indexOf("--auto-remove") + "--auto-remove".length)
      .split("&&")[0]!
      .trim()
      .split(" ");
    expect(purged).toEqual(["python3", "make", "g++", "unixodbc-dev"]);
    for (const runtimePackage of [
      "msodbcsql18",
      "krb5-user",
      "tini",
      "curl",
      "dnsutils",
      "traceroute",
      "iputils-ping",
      "ca-certificates",
    ]) {
      expect(purged).not.toContain(runtimePackage);
    }
  });

  test("the development image keeps the toolchain Start.dev.sh rebuilds with", () => {
    expect(
      runInstructions(developmentPart).some((line: string) => {
        return line.includes("apt-get purge");
      }),
    ).toBe(false);
    expect(readFileSync(resolve(probeRoot, "Start.dev.sh"), "utf8")).toMatch(
      /npm (ci|install)/,
    );
  });
});
