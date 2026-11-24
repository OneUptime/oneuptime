import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import {
  ModelFile,
  NAME_ADDRESS_MODEL,
} from "../../../../../Server/Utils/DataSecurity/Model/NameAddressModelFiles";

/*
 * THE REAL MODEL, FOR THE TESTS THAT NEED IT.
 *
 * The weights are never committed. A test that needs the real model fetches
 * its files once into a cache - ONEUPTIME_DATA_SECURITY_MODEL_CACHE, or
 * ~/.cache/oneuptime/data-security-model/<revision> - from the URLs
 * NameAddressModel.json pins, and checks each against its SHA-256 exactly as
 * the images' build does: a file that does not match is deleted, and the
 * test fails. Every other test uses a fake recogniser behind the same
 * interface.
 */

export function getModelCacheDirectory(): string {
  const configured: string | undefined =
    process.env["ONEUPTIME_DATA_SECURITY_MODEL_CACHE"]?.trim();

  return configured
    ? configured
    : path.join(
        os.homedir(),
        ".cache",
        "oneuptime",
        "data-security-model",
        NAME_ADDRESS_MODEL.revision,
      );
}

function sha256(filePath: string): string {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

async function download(file: ModelFile, target: string): Promise<void> {
  const response: Response = await fetch(file.url, { redirect: "follow" });

  if (!response.ok || !response.body) {
    throw new Error(
      `Could not fetch ${file.name} of the model: HTTP ${response.status}.`,
    );
  }

  const partial: string = `${target}.${process.pid}.${Date.now()}.part`;
  const bytes: Buffer = Buffer.from(await response.arrayBuffer());

  fs.writeFileSync(partial, bytes);

  const digest: string = sha256(partial);

  if (digest !== file.sha256) {
    fs.rmSync(partial, { force: true });
    throw new Error(
      `The fetched ${file.name} is not the pinned file: its SHA-256 is ${digest}, the manifest pins ${file.sha256}.`,
    );
  }

  fs.renameSync(partial, target);
}

/*
 * The cache directory with the given files of the model in it (all of them
 * when none are named), each checked against its SHA-256.
 */
export async function fetchModelIntoCache(
  names?: ReadonlyArray<string> | undefined,
): Promise<string> {
  const directory: string = getModelCacheDirectory();

  fs.mkdirSync(directory, { recursive: true });

  for (const file of NAME_ADDRESS_MODEL.files) {
    if (names && !names.includes(file.name)) {
      continue;
    }

    const target: string = path.join(directory, file.name);

    if (fs.existsSync(target) && sha256(target) === file.sha256) {
      continue;
    }

    fs.rmSync(target, { force: true });
    await download(file, target);
  }

  return directory;
}
