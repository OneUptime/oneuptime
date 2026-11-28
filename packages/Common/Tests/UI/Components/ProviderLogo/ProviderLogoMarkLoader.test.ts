import { describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ProviderLogo, {
  ALL_PROVIDER_LOGOS,
} from "../../../../Types/ProviderLogo/ProviderLogo";
import ALL_PROVIDER_LOGO_MARKS from "../../../../Types/ProviderLogo/AllProviderLogoMarks";
import { ProviderLogoMarkShapes } from "../../../../Types/ProviderLogo/ProviderLogoMark";
import { PROVIDER_LOGO_MARK_BOXES } from "../../../../Types/ProviderLogo/ProviderLogoMarks";
import ICON_BRAND_MARKS from "../../../../UI/Components/Icon/IconBrandMarks";
import * as LoaderModule from "../../../../UI/Components/ProviderLogo/ProviderLogoMarkLoader";

/*
 * The marks a page draws are loaded one by one, the first time each is
 * drawn (ProviderLogoMarkLoader): the bundler makes a small file of every
 * mark a loader names, so a page carries only the marks it shows. The
 * icon set's marks (Icon/IconBrandMarks), which every page holds already,
 * are drawn at once and have no loader: a loader made each one more file of
 * every page's first load. These hold the loader table and the icon set's
 * marks to the Marks folder and the registry, and the loading itself: once,
 * cached, retried after a failure, never throwing.
 */

type Loader = () => Promise<{ default: unknown }>;
type Loaders = Partial<Record<ProviderLogo, Loader>>;

const LOADER_FILE: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "UI",
  "Components",
  "ProviderLogo",
  "ProviderLogoMarkLoader.ts",
);

const MARKS_FOLDER: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "Types",
  "ProviderLogo",
  "Marks",
);

// One loader as the file writes it: [ProviderLogo.Member]: () => { return import(".../Marks/<file>"); }
const LOADER_ENTRY: RegExp =
  /\[ProviderLogo\.(\w+)\]: \(\) => \{\s*return import\("\.\.\/\.\.\/\.\.\/Types\/ProviderLogo\/Marks\/([a-z0-9-]+)"\);\s*\}/g;

const memberValue: (member: string) => string | undefined = (
  member: string,
): string | undefined => {
  return (ProviderLogo as unknown as Record<string, string>)[member];
};

// A fresh copy of the loader module, with an empty cache.
function freshLoader(): typeof LoaderModule {
  let module: typeof LoaderModule | undefined;

  jest.isolateModules(() => {
    module = jest.requireActual(
      "../../../../UI/Components/ProviderLogo/ProviderLogoMarkLoader",
    ) as typeof LoaderModule;
  });

  return module!;
}

const SHAPES: ProviderLogoMarkShapes = [{ d: "M0 0h24v24H0z" }];

describe("the mark loader table", () => {
  const source: string = fs.readFileSync(LOADER_FILE, "utf8");
  const entries: Array<{ member: string; file: string }> = Array.from(
    source.matchAll(LOADER_ENTRY),
  ).map((match: RegExpMatchArray) => {
    return { member: match[1] || "", file: match[2] || "" };
  });
  const files: Array<string> = fs
    .readdirSync(MARKS_FOLDER)
    .filter((name: string): boolean => {
      return name.endsWith(".ts");
    })
    .map((name: string): string => {
      return name.slice(0, -".ts".length);
    })
    .sort();

  test("the walk reads the table, so the rules below are not vacuous", () => {
    expect(entries.length).toBeGreaterThan(80);
    expect(entries.length).toBe(
      Object.keys(LoaderModule.PROVIDER_LOGO_MARK_LOADERS).length,
    );
  });

  test("every loader names its own mark's module, by its full name", () => {
    for (const entry of entries) {
      expect({ member: entry.member, file: memberValue(entry.member) }).toEqual(
        { member: entry.member, file: entry.file },
      );
    }
  });

  test("the loaders with the icon set's marks, the boxes, the shapes and the folder name the same marks", () => {
    const loaders: Array<string> = Object.keys(
      LoaderModule.PROVIDER_LOGO_MARK_LOADERS,
    );

    expect([...loaders, ...Object.keys(ICON_BRAND_MARKS)].sort()).toEqual(
      files,
    );
    expect(Object.keys(PROVIDER_LOGO_MARK_BOXES).sort()).toEqual(files);
    expect(Object.keys(ALL_PROVIDER_LOGO_MARKS).sort()).toEqual(files);
  });

  test("no mark the icon set draws has a loader: a file of its own would only be one more of every first load", () => {
    for (const mark of Object.keys(ICON_BRAND_MARKS)) {
      expect({
        mark,
        hasLoader: mark in LoaderModule.PROVIDER_LOGO_MARK_LOADERS,
      }).toEqual({ mark, hasLoader: false });
    }
  });

  test("every mark is a logo of the registry", () => {
    for (const file of files) {
      expect(ALL_PROVIDER_LOGOS as ReadonlyArray<string>).toContain(file);
    }
  });

  test.each(Object.keys(LoaderModule.PROVIDER_LOGO_MARK_LOADERS))(
    "%s loads the shapes its module holds",
    async (mark: string) => {
      const loader: Loader | undefined = (
        LoaderModule.PROVIDER_LOGO_MARK_LOADERS as Loaders
      )[mark as ProviderLogo];

      const module: { default: unknown } = await loader!();

      expect(module.default).toEqual(
        ALL_PROVIDER_LOGO_MARKS[mark as ProviderLogo],
      );
    },
  );
});

describe("loading a mark", () => {
  test("loads a mark once, caches it, and draws it at once after that", async () => {
    const loader: typeof LoaderModule = freshLoader();
    const loaders: Loaders = loader.PROVIDER_LOGO_MARK_LOADERS as Loaders;
    const original: Loader | undefined = loaders[ProviderLogo.Cloudflare];
    let calls: number = 0;

    loaders[ProviderLogo.Cloudflare] = async (): Promise<{
      default: unknown;
    }> => {
      calls++;
      return { default: SHAPES };
    };

    expect(
      loader.getLoadedProviderLogoMark(ProviderLogo.Cloudflare),
    ).toBeUndefined();
    await expect(
      loader.loadProviderLogoMark(ProviderLogo.Cloudflare),
    ).resolves.toBe(SHAPES);
    expect(loader.getLoadedProviderLogoMark(ProviderLogo.Cloudflare)).toBe(
      SHAPES,
    );
    await loader.loadProviderLogoMark(ProviderLogo.Cloudflare);
    expect(calls).toBe(1);

    if (original) {
      loaders[ProviderLogo.Cloudflare] = original;
    }
  });

  test.each(Object.keys(ICON_BRAND_MARKS))(
    "%s, a mark the icon set draws, is drawn at once from the icon set's own shapes, before any load",
    async (mark: string) => {
      const loader: typeof LoaderModule = freshLoader();
      const shapes: ProviderLogoMarkShapes | undefined =
        ALL_PROVIDER_LOGO_MARKS[mark as ProviderLogo];

      expect(shapes).toBeDefined();
      expect(loader.getLoadedProviderLogoMark(mark as ProviderLogo)).toEqual(
        shapes,
      );
      await expect(
        loader.loadProviderLogoMark(mark as ProviderLogo),
      ).resolves.toEqual(shapes);
    },
  );

  test("marks asked for at the same time share one load", async () => {
    const loader: typeof LoaderModule = freshLoader();
    const loaders: Loaders = loader.PROVIDER_LOGO_MARK_LOADERS as Loaders;
    let calls: number = 0;

    loaders[ProviderLogo.Python] = async (): Promise<{ default: unknown }> => {
      calls++;
      return { default: SHAPES };
    };

    const all: Array<ProviderLogoMarkShapes | undefined> = await Promise.all([
      loader.loadProviderLogoMark(ProviderLogo.Python),
      loader.loadProviderLogoMark(ProviderLogo.Python),
      loader.loadProviderLogoMark(ProviderLogo.Python),
    ]);

    expect(calls).toBe(1);
    expect(all).toEqual([SHAPES, SHAPES, SHAPES]);
  });

  test("a mark that failed to load is not cached, and is asked for again next time", async () => {
    const loader: typeof LoaderModule = freshLoader();
    const loaders: Loaders = loader.PROVIDER_LOGO_MARK_LOADERS as Loaders;
    let calls: number = 0;

    loaders[ProviderLogo.Ruby] = async (): Promise<{ default: unknown }> => {
      calls++;

      if (calls === 1) {
        throw new Error("The connection dropped");
      }

      return { default: SHAPES };
    };

    await expect(
      loader.loadProviderLogoMark(ProviderLogo.Ruby),
    ).resolves.toBeUndefined();
    expect(loader.getLoadedProviderLogoMark(ProviderLogo.Ruby)).toBeUndefined();

    await expect(loader.loadProviderLogoMark(ProviderLogo.Ruby)).resolves.toBe(
      SHAPES,
    );
    expect(calls).toBe(2);
  });

  test("a module that holds no shapes is no mark", async () => {
    const loader: typeof LoaderModule = freshLoader();
    const loaders: Loaders = loader.PROVIDER_LOGO_MARK_LOADERS as Loaders;

    for (const value of [undefined, "", [], [{}], [{ d: 3 }], "M0 0z"]) {
      loaders[ProviderLogo.Go] = async (): Promise<{ default: unknown }> => {
        return { default: value };
      };

      await expect(
        loader.loadProviderLogoMark(ProviderLogo.Go),
      ).resolves.toBeUndefined();
      expect(loader.getLoadedProviderLogoMark(ProviderLogo.Go)).toBeUndefined();
    }
  });

  test("a logo with no mark of its own loads nothing, and never throws", async () => {
    const loader: typeof LoaderModule = freshLoader();

    await expect(
      loader.loadProviderLogoMark(ProviderLogo.Aws),
    ).resolves.toBeUndefined();
    await expect(
      loader.loadProviderLogoMark("no-such-mark" as ProviderLogo),
    ).resolves.toBeUndefined();
  });
});
