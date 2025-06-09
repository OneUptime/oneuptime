import OpenAPI from "Common/Server/Utils/OpenAPI";
import fs from "fs";
import { validate, ValidationResult } from "@readme/openapi-parser";
import { JSONObject } from "Common/Types/JSON";
import Logger from "Common/Server/Utils/Logger";

export async function generateOpenAPISpec(): Promise<void> {
  const spec: JSONObject = OpenAPI.generateOpenAPISpec();

  const outputPath: string = "./openapi.json";
  fs.writeFileSync(outputPath, JSON.stringify(spec, null, 2), "utf8");

  const validationResult: ValidationResult = await validate(outputPath);

  if (validationResult.valid) {
    Logger.info("OpenAPI spec is valid.");
  } else {
    throw validationResult.errors;
  }

  // Write the OpenAPI spec to a file

  Logger.info(`OpenAPI spec generated and saved to ${outputPath}`);
}

generateOpenAPISpec().catch((error: Error) => {
  Logger.error("Error generating OpenAPI spec:");
  Logger.error(error);
  process.exit(1);
});
