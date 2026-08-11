import fs from "fs";
import os from "os";
import path from "path";
import { FileGenerator } from "../Core/FileGenerator";

let outputDir: string;
let sourceDir: string;

beforeEach(() => {
  outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tfgen-out-"));
  sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "tfgen-src-"));
});

afterEach(() => {
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.rmSync(sourceDir, { recursive: true, force: true });
});

function write(root: string, relativePath: string, content: string): void {
  const full: string = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf-8");
}

function read(root: string, relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf-8");
}

describe("FileGenerator.copyDirectory", () => {
  test("copies files verbatim", () => {
    write(sourceDir, "main.tf", 'resource "x" "y" {}\n');
    new FileGenerator(outputDir).copyDirectory(sourceDir, "modules");

    expect(read(outputDir, "modules/main.tf")).toBe('resource "x" "y" {}\n');
  });

  test("copies nested directories", () => {
    write(sourceDir, "a/b/c/deep.tf", "deep\n");
    new FileGenerator(outputDir).copyDirectory(sourceDir, "modules");

    expect(read(outputDir, "modules/a/b/c/deep.tf")).toBe("deep\n");
  });

  test("creates the destination when it does not exist", () => {
    write(sourceDir, "main.tf", "x\n");
    new FileGenerator(outputDir).copyDirectory(sourceDir, "nested/deeply/mods");

    expect(
      fs.existsSync(path.join(outputDir, "nested/deeply/mods/main.tf")),
    ).toBe(true);
  });

  /*
   * The published provider repository is rebuilt from the generator's output on
   * every release. Without clearing the destination first, a file deleted from
   * the source would survive in the published repo forever — the tree is copied
   * over the previous one, not replaced.
   */
  test("clears files that no longer exist in the source", () => {
    write(outputDir, "modules/stale.tf", "left over from a previous release\n");
    write(outputDir, "modules/nested/also-stale.tf", "stale\n");
    write(sourceDir, "main.tf", "current\n");

    new FileGenerator(outputDir).copyDirectory(sourceDir, "modules");

    expect(fs.existsSync(path.join(outputDir, "modules/stale.tf"))).toBe(false);
    expect(fs.existsSync(path.join(outputDir, "modules/nested"))).toBe(false);
    expect(read(outputDir, "modules/main.tf")).toBe("current\n");
  });

  test("leaves sibling directories alone", () => {
    write(outputDir, "docs/index.md", "generated docs\n");
    write(sourceDir, "main.tf", "x\n");

    new FileGenerator(outputDir).copyDirectory(sourceDir, "modules");

    expect(read(outputDir, "docs/index.md")).toBe("generated docs\n");
  });

  test("is idempotent across repeated generation runs", () => {
    write(sourceDir, "main.tf", "x\n");
    const generator: FileGenerator = new FileGenerator(outputDir);

    generator.copyDirectory(sourceDir, "modules");
    generator.copyDirectory(sourceDir, "modules");

    expect(fs.readdirSync(path.join(outputDir, "modules"))).toEqual([
      "main.tf",
    ]);
  });
});
