import OpenAPI from "Common/Server/Utils/OpenAPI";
import fs from "fs";
import { validate, ValidationResult } from "@readme/openapi-parser";

async function generateOpenAPISpec(): Promise<void> {
  const spec = OpenAPI.generateOpenAPISpec();

  const outputPath = "./openapi.json";
  fs.writeFileSync(outputPath, JSON.stringify(spec, null, 2), "utf8");

  const validationResult: ValidationResult = await validate(outputPath);

  if (validationResult.valid) {
    console.log("OpenAPI spec is valid.");
  } else {
    throw validationResult.errors;
  }

  // Write the OpenAPI spec to a file

  console.log(`OpenAPI spec generated and saved to ${outputPath}`);
}

generateOpenAPISpec().catch((error) => {
  console.error("Error generating OpenAPI spec:");
  console.error(error);
  process.exit(1);
});
