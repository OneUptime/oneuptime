import path from "path";

/*
 * THE AWS SHARED CONFIG AND CREDENTIALS FILES, READ AS THE AWS SDKS READ
 * THEM (#7381): ~/.aws/config and ~/.aws/credentials, or the files
 * AWS_CONFIG_FILE and AWS_SHARED_CREDENTIALS_FILE name, and the profile
 * AWS_PROFILE names ("default" when it names none).
 *
 * Both are INI files:
 *
 *   [default]                        the default profile, in either file
 *   [profile oneuptime]              a profile, in the config file
 *   [oneuptime]                      a profile, in the credentials file
 *   aws_access_key_id = AKIA...      a setting: its name, "=", its value
 *   # a comment                      a line starting with # or ; is none,
 *   region = us-east-1 ; a note      nor is the rest of a line after one
 *                                    that follows a space
 *   s3 =                             a setting with no value starts nested
 *     max_concurrent_requests = 20   settings (indented), which are skipped
 *
 * A config file's section that is not a profile ([sso-session x],
 * [services x], or one without "profile ") belongs to no profile. A
 * setting's name is read in lower case. A profile's settings are those of
 * both files, the credentials file's winning, each remembered with the file
 * it came from: a credential_process runs only from a file the server
 * cannot write (AwsDefaultCredentialChain).
 *
 * https://docs.aws.amazon.com/sdkref/latest/guide/file-format.html
 */

export type AwsSharedFileKind = "config" | "credentials";

// One profile's settings in one file: name (lower case) -> value.
export type AwsIniProfiles = Record<string, Record<string, string>>;

export interface AwsProfileSetting {
  value: string;
  // The file the value was read from.
  file: string;
}

export interface AwsSharedConfigPaths {
  profile: string;
  configFile: string;
  credentialsFile: string;
  // Whether the environment named each file (a named file must be there).
  isConfigFileNamed: boolean;
  isCredentialsFileNamed: boolean;
}

export const AWS_PROFILE_ENV: string = "AWS_PROFILE";
export const AWS_CONFIG_FILE_ENV: string = "AWS_CONFIG_FILE";
export const AWS_SHARED_CREDENTIALS_FILE_ENV: string =
  "AWS_SHARED_CREDENTIALS_FILE";

export const DEFAULT_AWS_PROFILE: string = "default";

// The longest file read: a profile is a few lines.
export const MAX_AWS_SHARED_FILE_LENGTH: number = 1024 * 1024;

// A profile's name, as the SDKs take one.
const PROFILE_NAME_PATTERN: RegExp = /^[\w+=,.@:/%-]{1,128}$/;

// "profile", then the name, in a config file's section header.
const CONFIG_PROFILE_SECTION_PATTERN: RegExp = /^profile\s+(.+)$/;

// A comment: # or ; at the start of a line, or after a space or a tab.
const COMMENT_PATTERN: RegExp = /(^|\s)[#;]/;

// A line that starts with a space or a tab: a nested setting's.
const INDENTED_PATTERN: RegExp = /^\s/;

export const isAwsProfileName: (name: string) => boolean = (
  name: string,
): boolean => {
  return PROFILE_NAME_PATTERN.test(name);
};

/*
 * The profiles of one file, by name. A section a config file does not
 * write as a profile is left out; so is a nested setting.
 */
export const parseAwsSharedFile: (
  text: string,
  kind: AwsSharedFileKind,
) => AwsIniProfiles = (
  text: string,
  kind: AwsSharedFileKind,
): AwsIniProfiles => {
  const profiles: AwsIniProfiles = {};
  let current: Record<string, string> | null = null;
  let isNested: boolean = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line: string = (rawLine.split(COMMENT_PATTERN)[0] || "").trim();

    if (!line) {
      continue;
    }

    if (line.startsWith("[") && line.endsWith("]")) {
      const name: string | null = readProfileName(
        line.slice(1, -1).trim(),
        kind,
      );

      isNested = false;
      current = null;

      if (name) {
        profiles[name] = profiles[name] || {};
        current = profiles[name]!;
      }

      continue;
    }

    const isIndented: boolean = INDENTED_PATTERN.test(rawLine);

    // An indented line under a setting with no value is one of its own.
    if (isNested && isIndented) {
      continue;
    }

    isNested = false;

    const equals: number = line.indexOf("=");

    if (!current || equals <= 0) {
      continue;
    }

    const key: string = line.slice(0, equals).trim().toLowerCase();
    const value: string = line.slice(equals + 1).trim();

    if (!key) {
      continue;
    }

    if (!value) {
      isNested = true;
      continue;
    }

    current[key] = value;
  }

  return profiles;
};

/*
 * The name of the profile a section header holds, or null when it holds
 * none: in a config file "default" or "profile <name>"; in a credentials
 * file the name itself.
 */
const readProfileName: (
  header: string,
  kind: AwsSharedFileKind,
) => string | null = (
  header: string,
  kind: AwsSharedFileKind,
): string | null => {
  let name: string = header;

  if (kind === "config" && header !== DEFAULT_AWS_PROFILE) {
    const match: RegExpExecArray | null =
      CONFIG_PROFILE_SECTION_PATTERN.exec(header);

    if (!match) {
      return null;
    }

    name = (match[1] || "").trim();
  }

  // A name may be quoted: [profile "oneuptime"].
  if (
    name.length >= 2 &&
    (name.startsWith('"') || name.startsWith("'")) &&
    name.endsWith(name.charAt(0))
  ) {
    name = name.slice(1, -1);
  }

  return isAwsProfileName(name) ? name : null;
};

/*
 * Where the files are and which profile is read, from the environment: a
 * leading "~/" is the home directory, as the SDKs read it.
 */
export const getAwsSharedConfigPaths: (data: {
  env: Record<string, string | undefined>;
  homeDirectory: string;
}) => AwsSharedConfigPaths = (data: {
  env: Record<string, string | undefined>;
  homeDirectory: string;
}): AwsSharedConfigPaths => {
  const read: (name: string) => string = (name: string): string => {
    const value: unknown = data.env[name];
    return typeof value === "string" ? value.trim() : "";
  };

  const expand: (file: string) => string = (file: string): string => {
    if (file === "~") {
      return data.homeDirectory;
    }

    return file.startsWith("~/")
      ? path.join(data.homeDirectory, file.slice(2))
      : file;
  };

  const configFile: string = read(AWS_CONFIG_FILE_ENV);
  const credentialsFile: string = read(AWS_SHARED_CREDENTIALS_FILE_ENV);

  return {
    profile: read(AWS_PROFILE_ENV) || DEFAULT_AWS_PROFILE,
    configFile: configFile
      ? expand(configFile)
      : path.join(data.homeDirectory, ".aws", "config"),
    credentialsFile: credentialsFile
      ? expand(credentialsFile)
      : path.join(data.homeDirectory, ".aws", "credentials"),
    isConfigFileNamed: Boolean(configFile),
    isCredentialsFileNamed: Boolean(credentialsFile),
  };
};

/*
 * One profile's settings from both files, the credentials file's winning,
 * each with the file it came from; null when neither file has the profile.
 */
export const mergeAwsProfile: (data: {
  profile: string;
  config: { file: string; profiles: AwsIniProfiles };
  credentials: { file: string; profiles: AwsIniProfiles };
}) => Record<string, AwsProfileSetting> | null = (data: {
  profile: string;
  config: { file: string; profiles: AwsIniProfiles };
  credentials: { file: string; profiles: AwsIniProfiles };
}): Record<string, AwsProfileSetting> | null => {
  const fromConfig: Record<string, string> | undefined =
    data.config.profiles[data.profile];
  const fromCredentials: Record<string, string> | undefined =
    data.credentials.profiles[data.profile];

  if (!fromConfig && !fromCredentials) {
    return null;
  }

  const merged: Record<string, AwsProfileSetting> = {};

  for (const [settings, file] of [
    [fromConfig, data.config.file],
    [fromCredentials, data.credentials.file],
  ] as Array<[Record<string, string> | undefined, string]>) {
    for (const key of Object.keys(settings || {})) {
      merged[key] = { value: settings![key]!, file: file };
    }
  }

  return merged;
};
