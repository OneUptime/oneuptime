import crypto from "crypto";
import fs from "fs";
import path from "path";
import ModelManifest from "./NameAddressModel.json";

/*
 * WHERE THE NAMES-AND-ADDRESSES MODEL'S FILES ARE, AND WHETHER THEY ARE THE
 * ONES OneUptime PINNED.
 *
 * NameAddressModel.json names the model, its licence, the revision its files
 * come from, and each file's URL, size and SHA-256. The images fetch them at
 * build time into its `directory` (Scripts/Docker/FetchDataSecurityModel.js),
 * Iron Bank's manifests list the same files, and nothing fetches them at run
 * time: a server or probe whose image has no model scans without it, and says
 * so in its scans' warnings. DATA_SECURITY_MODEL_DIRECTORY points elsewhere
 * (a development checkout, the tests' cache).
 *
 * Before the model is loaded each file is checked again, its size then its
 * SHA-256, so a file changed on disk after the build is never run.
 */

export interface ModelFile {
  name: string;
  url: string;
  sha256: string;
  bytes: number;
}

export interface NameAddressModelManifest {
  name: string;
  revision: string;
  licence: string;
  homepage: string;
  directory: string;
  files: Array<ModelFile>;
}

export const NAME_ADDRESS_MODEL: NameAddressModelManifest =
  ModelManifest as NameAddressModelManifest;

export const MODEL_FILE_NAME: string = "model_quantized.onnx";
export const VOCABULARY_FILE_NAME: string = "vocab.txt";
export const CONFIG_FILE_NAME: string = "config.json";

export const MODEL_DIRECTORY_VARIABLE: string = "DATA_SECURITY_MODEL_DIRECTORY";

export function getModelDirectory(
  environment: Record<string, string | undefined> = process.env,
): string {
  const configured: string | undefined =
    environment[MODEL_DIRECTORY_VARIABLE]?.trim();

  return configured ? configured : NAME_ADDRESS_MODEL.directory;
}

export function getModelFile(name: string): ModelFile {
  const file: ModelFile | undefined = NAME_ADDRESS_MODEL.files.find(
    (candidate: ModelFile): boolean => {
      return candidate.name === name;
    },
  );

  if (!file) {
    throw new Error(`The names-and-addresses model has no file ${name}.`);
  }

  return file;
}

export async function sha256OfFile(filePath: string): Promise<string> {
  return await new Promise<string>(
    (resolve: (digest: string) => void, reject: (error: Error) => void) => {
      const hash: crypto.Hash = crypto.createHash("sha256");
      const stream: fs.ReadStream = fs.createReadStream(filePath);

      stream.on("data", (chunk: string | Buffer): void => {
        hash.update(chunk);
      });
      stream.on("error", reject);
      stream.on("end", (): void => {
        resolve(hash.digest("hex"));
      });
    },
  );
}

export type ModelFilesCheck =
  | { isReady: true; directory: string }
  | {
      isReady: false;
      // Why, in a sentence a scan's warning and a log can carry.
      reason: string;
    };

/*
 * Whether every file of the model is in the directory, of the size and with
 * the SHA-256 the manifest pins. Says which file is missing or different,
 * never more.
 */
export async function checkModelFiles(
  directory: string = getModelDirectory(),
): Promise<ModelFilesCheck> {
  for (const file of NAME_ADDRESS_MODEL.files) {
    const filePath: string = path.join(directory, file.name);
    let size: number;

    try {
      size = (await fs.promises.stat(filePath)).size;
    } catch {
      return {
        isReady: false,
        reason: `the model's ${file.name} is not installed`,
      };
    }

    if (size !== file.bytes) {
      return {
        isReady: false,
        reason: `the model's ${file.name} is not the pinned file`,
      };
    }

    if ((await sha256OfFile(filePath)) !== file.sha256) {
      return {
        isReady: false,
        reason: `the model's ${file.name} is not the pinned file`,
      };
    }
  }

  return { isReady: true, directory };
}
