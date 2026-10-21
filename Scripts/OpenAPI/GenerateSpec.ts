import OpenAPI from "Common/Server/Utils/OpenAPI";
import fs from "fs";
import path from "path";
import {
  compileErrors,
  validate,
  ValidationResult,
} from "@readme/openapi-parser";
import { JSONObject } from "Common/Types/JSON";
import Logger from "Common/Server/Utils/Logger";

/*
 * A validation result is a union on `valid`. Only an invalid one has
 * `errors` (and `additionalErrors`, the count it stopped listing); both have
 * `warnings`.
 */
export type ValidOpenAPISpecResult = Extract<ValidationResult, { valid: true }>;

/*
 * Throws when the spec validate() read from `specPath` is not valid, with an
 * Error a caller can print: every problem the parser found, written out by
 * its own compileErrors (each message with where in the file it is, then any
 * warnings, then how many more errors there were), and the path of the file
 * to look at.
 *
 * This used to throw the bare `errors` array. The Terraform provider
 * generator prints `error.message` for an Error and "Unknown error" for
 * anything else, so a spec that failed validation stopped generation without
 * saying why.
 */
export function assertValidOpenAPISpec(
  result: ValidationResult,
  specPath: string,
): asserts result is ValidOpenAPISpecResult {
  if (!result.valid) {
    throw new Error(`${compileErrors(result)}\n\nThe spec is at ${specPath}.`);
  }
}

export async function generateOpenAPISpec(outputPath?: string): Promise<void> {
  const spec: JSONObject = OpenAPI.generateOpenAPISpec();

  // Default to root directory if outputPath is not provided
  const finalOutputPath: string = outputPath || "./openapi.json";

  // Ensure the directory exists
  const directory: string = path.dirname(finalOutputPath);
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }

  fs.writeFileSync(finalOutputPath, JSON.stringify(spec, null, 2), "utf8");

  const validationResult: ValidationResult = await validate(finalOutputPath);

  assertValidOpenAPISpec(validationResult, finalOutputPath);

  /*
   * compileErrors() says "succeeded, but with warnings" even when there are
   * none, so it is only asked when there are some.
   */
  if (validationResult.warnings.length > 0) {
    Logger.warn(compileErrors(validationResult));
  }

  Logger.info("OpenAPI spec is valid.");
  Logger.info(`OpenAPI spec generated and saved to ${finalOutputPath}`);
}

/*
 * Only when run as a script. The Terraform provider generator imports this
 * module for generateOpenAPISpec; running here on import too built the spec
 * a second time, at whatever path its own command line happened to name.
 */
if (require.main === module) {
  generateOpenAPISpec(process.argv[2]).catch((error: Error) => {
    Logger.error("Error generating OpenAPI spec:");
    Logger.error(error);
    process.exit(1);
  });
}
