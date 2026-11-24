import crypto from "crypto";
import fs from "fs";
import http from "http";
import https from "https";
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

// GET a URL into a file, following redirects (the model's host answers with its CDN's).
function getInto(
  url: string,
  target: string,
  redirectsLeft: number,
): Promise<void> {
  return new Promise<void>(
    (resolve: () => void, reject: (error: Error) => void): void => {
      https
        .get(url, (response: http.IncomingMessage): void => {
          const status: number = response.statusCode || 0;
          const location: string | undefined = response.headers.location;

          if (status >= 300 && status < 400 && location) {
            response.resume();

            if (redirectsLeft <= 0) {
              reject(new Error(`Too many redirects fetching ${url}.`));
              return;
            }

            getInto(
              new URL(location, url).toString(),
              target,
              redirectsLeft - 1,
            )
              .then(resolve)
              .catch(reject);
            return;
          }

          if (status !== 200) {
            response.resume();
            reject(new Error(`HTTP ${status} fetching ${url}.`));
            return;
          }

          const out: fs.WriteStream = fs.createWriteStream(target);

          response.pipe(out);
          out.on("finish", (): void => {
            resolve();
          });
          out.on("error", reject);
          response.on("error", reject);
        })
        .on("error", reject);
    },
  );
}

async function download(file: ModelFile, target: string): Promise<void> {
  const partial: string = `${target}.${process.pid}.${Date.now()}.part`;

  try {
    await getInto(file.url, partial, 5);
  } catch (error) {
    fs.rmSync(partial, { force: true });
    throw new Error(
      `Could not fetch ${file.name} of the model: ${(error as Error).message}`,
    );
  }

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
