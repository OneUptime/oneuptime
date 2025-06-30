import OpenAPI from "Common/Server/Utils/OpenAPI";
import fs from "fs";
import path from "path";
import { validate, ValidationResult } from "@readme/openapi-parser";
import { JSONObject } from "Common/Types/JSON";
import Logger from "Common/Server/Utils/Logger";

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

  if (validationResult.valid) {
    Logger.info("OpenAPI spec is valid.");
  } else {
    throw validationResult.errors;
  }

  Logger.info(`OpenAPI spec generated and saved to ${finalOutputPath}`);
}

generateOpenAPISpec(process.argv[2]).catch((error: Error) => {
  Logger.error("Error generating OpenAPI spec:");
  Logger.error(error);
  process.exit(1);
});
