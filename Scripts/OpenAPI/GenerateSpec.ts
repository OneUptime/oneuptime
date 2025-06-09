import OpenAPI from "Common/Server/Utils/OpenAPI";
import fs from "fs";
import { validate, ValidationResult } from "@readme/openapi-parser";
import JSONFunctions from "Common/Types/JSONFunctions";
import BadDataException from "Common/Types/Exception/BadDataException";

const spec = OpenAPI.generateOpenAPISpec();

const validationResult: ValidationResult = await validate(
  JSONFunctions.toString(spec)
);

if (validationResult.valid) {
  console.log("OpenAPI spec is valid.");
} else {
  throw new BadDataException("OpenAPI spec validation failed.");
}

// Write the OpenAPI spec to a file

const outputPath = "./openapi.json";
fs.writeFileSync(outputPath, JSON.stringify(spec, null, 2), "utf8");

console.log(`OpenAPI spec generated and saved to ${outputPath}`);
