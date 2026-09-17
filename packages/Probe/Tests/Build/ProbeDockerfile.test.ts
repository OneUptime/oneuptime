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
