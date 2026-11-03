/*
 * Every Go file in StaticFiles/ ships with the provider.
 *
 * The generator copies them one by one (ResourceGenerator's copyStaticFile,
 * DataSourceGenerator for a hand-written data source). A file added to
 * StaticFiles/ and left off that list compiles and passes on a developer's
 * machine - where a test script copies the whole folder in - and is simply
 * missing from the provider CI builds: its tests never run, its code is
 * never there.
 */

import fs from "fs";
import path from "path";

const STATIC_FILES: string = path.join(__dirname, "..", "StaticFiles");
const CORE: string = path.join(__dirname, "..", "Core");

const generatorSource: string = fs
  .readdirSync(CORE)
  .filter((name: string): boolean => {
    return name.endsWith(".ts");
  })
  .map((name: string): string => {
    return fs.readFileSync(path.join(CORE, name), "utf-8");
  })
  .join("\n");

const goFiles: Array<string> = fs
  .readdirSync(STATIC_FILES)
  .filter((name: string): boolean => {
    return name.endsWith(".go");
  })
  .sort();

describe("the provider's static Go files", () => {
  test("there are some, tests among them", () => {
    expect(goFiles).toEqual(
      expect.arrayContaining([
        "people.go",
        "ids_test.go",
        "allowedvalues_test.go",
      ]),
    );
  });

  test.each(goFiles)("%s is copied into the provider", (file: string) => {
    expect(generatorSource).toContain(`"${file}"`);
  });
});
