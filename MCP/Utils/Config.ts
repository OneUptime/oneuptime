import URL from "@oneuptime/common/Types/API/URL";
import BadDataException from "@oneuptime/common/Types/Exception/BadDataException";
import Version from "@oneuptime/common/Types/Version";
import { readFileSync } from "fs";
import { join } from "path";

export const ServerName: string = "oneuptime";

export const OneUptimeUrl: URL = process.env["ONEUPTIME_URL"]
  ? URL.fromString(process.env["ONEUPTIME_URL"].toString())
  : URL.fromString("https://oneuptime.com");

if (!process.env["ONEUPTIME_PROJECT_ID"]) {
  throw new BadDataException("PROJECT_ID is not set in environment variables.");
}

export const ProjectID: string = process.env["ONEUPTIME_PROJECT_ID"]
  .toString()
  .trim();

if (!process.env["ONEUPTIME_API_KEY"]) {
  throw new BadDataException(
    "ONEUPTIME_API_KEY is not set in environment variables.",
  );
}

export const ApiKey: string = process.env["ONEUPTIME_API_KEY"]
  .toString()
  .trim();

// read version from package.json

const packageJsonPath: string = join(__dirname, "..", "package.json");
const packageJson: { version: string } = JSON.parse(
  readFileSync(packageJsonPath, "utf-8"),
);

export const AppVersion: Version = new Version(packageJson.version);
