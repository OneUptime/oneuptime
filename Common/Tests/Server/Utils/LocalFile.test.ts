import LocalFile from "../../../Server/Utils/LocalFile";
import fs from "fs";
import os from "os";
import path from "path";

/*
 * These run against a real temp directory rather than a mocked `fs`: the
 * behaviour worth pinning down here is what the wrappers do with the
 * filesystem's own answers — ENOENT resolving to false instead of throwing,
 * delete being a no-op on a missing path, directory-vs-file discrimination —
 * and a mock would just re-state the implementation.
 */
describe("LocalFile", () => {
  let workDir: string = "";

  beforeEach(async () => {
    workDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "oneuptime-localfile-test-"),
    );
  });

  afterEach(async () => {
    await fs.promises.rm(workDir, { recursive: true, force: true });
  });

  describe("sanitizeFilePath", () => {
    test("should collapse double slashes", () => {
      expect(LocalFile.sanitizeFilePath("/a//b//c.txt")).toEqual("/a/b/c.txt");
    });

    test("should leave a clean path untouched", () => {
      expect(LocalFile.sanitizeFilePath("/a/b/c.txt")).toEqual("/a/b/c.txt");
    });

    test("should not touch the scheme separator of a url-like path", () => {
      // Only "//" is collapsed, so "://" becomes ":/" — pinning current behaviour.
      expect(LocalFile.sanitizeFilePath("https://example.com/a")).toEqual(
        "https:/example.com/a",
      );
    });
  });

  describe("getFileExtension", () => {
    test("should return the lowercased extension", () => {
      expect(LocalFile.getFileExtension("/tmp/report.PDF")).toEqual("pdf");
      expect(LocalFile.getFileExtension("archive.tar.gz")).toEqual("gz");
    });

    test("should return the whole name when there is no dot", () => {
      // No dot means split() yields one segment, which is the name itself.
      expect(LocalFile.getFileExtension("Makefile")).toEqual("makefile");
    });

    test("should return an empty string for a trailing dot", () => {
      expect(LocalFile.getFileExtension("weird.")).toEqual("");
    });
  });

  describe("write / read", () => {
    test("should round trip file contents", async () => {
      const filePath: string = path.join(workDir, "note.txt");

      await LocalFile.write(filePath, "hello world");

      expect(await LocalFile.read(filePath)).toEqual("hello world");
    });

    test("should overwrite existing contents", async () => {
      const filePath: string = path.join(workDir, "note.txt");

      await LocalFile.write(filePath, "first");
      await LocalFile.write(filePath, "second");

      expect(await LocalFile.read(filePath)).toEqual("second");
    });

    test("should read the same bytes back as a buffer", async () => {
      const filePath: string = path.join(workDir, "note.txt");

      await LocalFile.write(filePath, "buffer me");

      const buffer: Buffer = await LocalFile.readAsBuffer(filePath);

      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.toString("utf-8")).toEqual("buffer me");
    });

    test("should reject when reading a file that does not exist", async () => {
      await expect(
        LocalFile.read(path.join(workDir, "missing.txt")),
      ).rejects.toThrow();
    });
  });

  describe("doesFileExist / doesDirectoryExist", () => {
    test("should report an existing file as a file and not a directory", async () => {
      const filePath: string = path.join(workDir, "note.txt");
      await LocalFile.write(filePath, "x");

      expect(await LocalFile.doesFileExist(filePath)).toBe(true);
      expect(await LocalFile.doesDirectoryExist(filePath)).toBe(false);
    });

    test("should report an existing directory as a directory and not a file", async () => {
      expect(await LocalFile.doesDirectoryExist(workDir)).toBe(true);
      expect(await LocalFile.doesFileExist(workDir)).toBe(false);
    });

    test("should resolve false rather than throwing for a missing path", async () => {
      const missing: string = path.join(workDir, "nope");

      expect(await LocalFile.doesFileExist(missing)).toBe(false);
      expect(await LocalFile.doesDirectoryExist(missing)).toBe(false);
    });
  });

  describe("makeDirectory", () => {
    test("should create nested directories", async () => {
      const nested: string = path.join(workDir, "a", "b", "c");

      await LocalFile.makeDirectory(nested);

      expect(await LocalFile.doesDirectoryExist(nested)).toBe(true);
    });

    test("should be idempotent", async () => {
      const dir: string = path.join(workDir, "a");

      await LocalFile.makeDirectory(dir);
      await LocalFile.makeDirectory(dir);

      expect(await LocalFile.doesDirectoryExist(dir)).toBe(true);
    });
  });

  describe("deleteFile", () => {
    test("should delete an existing file", async () => {
      const filePath: string = path.join(workDir, "note.txt");
      await LocalFile.write(filePath, "x");

      await LocalFile.deleteFile(filePath);

      expect(await LocalFile.doesFileExist(filePath)).toBe(false);
    });

    test("should be a no-op for a missing file", async () => {
      await expect(
        LocalFile.deleteFile(path.join(workDir, "missing.txt")),
      ).resolves.toBeUndefined();
    });
  });

  describe("deleteDirectory", () => {
    test("should remove a directory and its contents", async () => {
      const dir: string = path.join(workDir, "a");
      await LocalFile.makeDirectory(dir);
      await LocalFile.write(path.join(dir, "note.txt"), "x");

      await LocalFile.deleteDirectory(dir);

      expect(await LocalFile.doesDirectoryExist(dir)).toBe(false);
    });

    test("should be a no-op for a missing directory", async () => {
      await expect(
        LocalFile.deleteDirectory(path.join(workDir, "missing")),
      ).resolves.toBeUndefined();
    });
  });

  describe("deleteAllDataInDirectory", () => {
    test("should empty the directory but keep it in place", async () => {
      const dir: string = path.join(workDir, "a");
      await LocalFile.makeDirectory(path.join(dir, "nested"));
      await LocalFile.write(path.join(dir, "note.txt"), "x");

      await LocalFile.deleteAllDataInDirectory(dir);

      expect(await LocalFile.doesDirectoryExist(dir)).toBe(true);
      expect(await LocalFile.readDirectory(dir)).toEqual([]);
    });

    test("should be a no-op for a missing directory", async () => {
      await expect(
        LocalFile.deleteAllDataInDirectory(path.join(workDir, "missing")),
      ).resolves.toBeUndefined();
    });
  });

  describe("getListOfDirectories", () => {
    test("should return only directories, not files", async () => {
      await LocalFile.makeDirectory(path.join(workDir, "alpha"));
      await LocalFile.makeDirectory(path.join(workDir, "beta"));
      await LocalFile.write(path.join(workDir, "note.txt"), "x");

      const directories: Array<string> = (
        await LocalFile.getListOfDirectories(workDir)
      ).sort();

      expect(directories).toEqual(["alpha", "beta"]);
    });

    test("should return an empty array for a directory with no subdirectories", async () => {
      await LocalFile.write(path.join(workDir, "note.txt"), "x");

      expect(await LocalFile.getListOfDirectories(workDir)).toEqual([]);
    });

    test("should reject for a missing directory", async () => {
      await expect(
        LocalFile.getListOfDirectories(path.join(workDir, "missing")),
      ).rejects.toThrow();
    });
  });

  describe("copyFile", () => {
    test("should copy contents to the destination", async () => {
      const source: string = path.join(workDir, "source.txt");
      const destination: string = path.join(workDir, "destination.txt");
      await LocalFile.write(source, "copy me");

      await LocalFile.copyFile({ source, destination });

      expect(await LocalFile.read(destination)).toEqual("copy me");
      // The source must survive a copy.
      expect(await LocalFile.doesFileExist(source)).toBe(true);
    });

    test("should reject when the source does not exist", async () => {
      await expect(
        LocalFile.copyFile({
          source: path.join(workDir, "missing.txt"),
          destination: path.join(workDir, "destination.txt"),
        }),
      ).rejects.toThrow();
    });
  });

  describe("copyDirectory", () => {
    test("should copy a directory tree recursively", async () => {
      const source: string = path.join(workDir, "source");
      const destination: string = path.join(workDir, "destination");

      await LocalFile.makeDirectory(path.join(source, "nested"));
      await LocalFile.write(path.join(source, "top.txt"), "top");
      await LocalFile.write(path.join(source, "nested", "deep.txt"), "deep");

      await LocalFile.copyDirectory({ source, destination });

      expect(await LocalFile.read(path.join(destination, "top.txt"))).toEqual(
        "top",
      );
      expect(
        await LocalFile.read(path.join(destination, "nested", "deep.txt")),
      ).toEqual("deep");
    });
  });
});
