import { CLI_PACKAGE_NAME, readCliVersion } from "../Commands/UtilityCommands";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/*
 * `oneuptime --version` and `oneuptime version` read the CLI's own
 * package.json. The CLI runs from its TypeScript sources here, and from the
 * bundle at build/dist/Index.js once npm installs it (esbuild.config.js) -
 * two depths below package.json. The lookup used to try two fixed depths,
 * neither of which is the bundle's, so a bundled CLI printed the 1.0.0
 * fallback. It now walks up to the first package.json that is the CLI's.
 */

const CLI_ROOT: string = path.resolve(__dirname, "..");

function writeManifest(
  directory: string,
  manifest: Record<string, unknown> | string,
): void {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, "package.json"),
    typeof manifest === "string" ? manifest : JSON.stringify(manifest),
  );
}

describe("readCliVersion", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "oneuptime-cli-version-"));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("names the package the CLI is published as", () => {
    const manifest: { name: string } = JSON.parse(
      fs.readFileSync(path.join(CLI_ROOT, "package.json"), "utf-8"),
    ) as { name: string };

    expect(CLI_PACKAGE_NAME).toBe(manifest.name);
  });

  it("reads the version of packages/CLI/package.json from the sources", () => {
    const manifest: { version: string } = JSON.parse(
      fs.readFileSync(path.join(CLI_ROOT, "package.json"), "utf-8"),
    ) as { version: string };

    expect(readCliVersion()).toBe(manifest.version);
    expect(readCliVersion(path.join(CLI_ROOT, "Commands"))).toBe(
      manifest.version,
    );
  });

  it("reads it from the bundle's directory, two levels below package.json", () => {
    const cli: string = path.join(
      root,
      "prefix",
      "lib",
      "node_modules",
      "@oneuptime",
      "cli",
    );
    writeManifest(cli, { name: CLI_PACKAGE_NAME, version: "14.0.64" });
    fs.mkdirSync(path.join(cli, "build", "dist"), { recursive: true });

    expect(readCliVersion(path.join(cli, "build", "dist"))).toBe("14.0.64");
  });

  it("reads it from where tsc used to put this file, three levels below", () => {
    const cli: string = path.join(root, "cli");
    writeManifest(cli, { name: CLI_PACKAGE_NAME, version: "14.0.65" });
    fs.mkdirSync(path.join(cli, "build", "dist", "Commands"), {
      recursive: true,
    });

    expect(readCliVersion(path.join(cli, "build", "dist", "Commands"))).toBe(
      "14.0.65",
    );
  });

  it("passes over a package.json of another name on the way up", () => {
    const cli: string = path.join(root, "cli");
    writeManifest(cli, { name: CLI_PACKAGE_NAME, version: "14.0.66" });
    // A stray manifest between the bundle and the CLI's own.
    writeManifest(path.join(cli, "build"), {
      name: "something-else",
      version: "0.0.1",
    });
    fs.mkdirSync(path.join(cli, "build", "dist"), { recursive: true });

    expect(readCliVersion(path.join(cli, "build", "dist"))).toBe("14.0.66");
  });

  it("never reads the project the CLI is installed into", () => {
    const project: string = path.join(root, "my-project");
    writeManifest(project, { name: "my-project", version: "3.2.1" });
    const cli: string = path.join(project, "node_modules", "@oneuptime", "cli");
    writeManifest(cli, { name: CLI_PACKAGE_NAME, version: "14.0.67" });
    fs.mkdirSync(path.join(cli, "build", "dist"), { recursive: true });

    expect(readCliVersion(path.join(cli, "build", "dist"))).toBe("14.0.67");
  });

  it("walks past a package.json it cannot read, and one of the CLI's name without a version", () => {
    const cli: string = path.join(root, "cli");
    writeManifest(cli, { name: CLI_PACKAGE_NAME, version: "14.0.68" });
    writeManifest(path.join(cli, "build"), "{ this is not JSON");
    writeManifest(path.join(cli, "build", "dist"), {
      name: CLI_PACKAGE_NAME,
      version: "",
    });

    expect(readCliVersion(path.join(cli, "build", "dist"))).toBe("14.0.68");
  });

  it("falls back to 1.0.0 when no package.json up to the root is the CLI's", () => {
    writeManifest(root, { name: "not-the-cli", version: "9.9.9" });
    fs.mkdirSync(path.join(root, "a", "b"), { recursive: true });

    expect(readCliVersion(path.join(root, "a", "b"))).toBe("1.0.0");
  });
});
