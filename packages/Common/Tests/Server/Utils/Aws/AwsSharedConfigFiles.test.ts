import {
  AwsIniProfiles,
  AwsProfileSetting,
  AwsSharedConfigPaths,
  DEFAULT_AWS_PROFILE,
  getAwsSharedConfigPaths,
  isAwsProfileName,
  mergeAwsProfile,
  parseAwsSharedFile,
} from "../../../../Server/Utils/Aws/AwsSharedConfigFiles";
import { describe, expect, test } from "@jest/globals";

/*
 * THE AWS SHARED CONFIG AND CREDENTIALS FILES (#7381), read as the AWS
 * SDKs read them: a config file's profiles are [default] and
 * [profile <name>], a credentials file's [<name>]; comments start a line
 * or follow a space; a setting with no value starts nested settings, which
 * are skipped; and a profile's settings are both files', the credentials
 * file's winning, each with the file it came from - a credential_process
 * runs only from a file the server cannot change.
 */

const HOME: string = "/home/oneuptime";

describe("a config file's profiles", () => {
  test("are [default] and [profile <name>]; another section is no profile", () => {
    const profiles: AwsIniProfiles = parseAwsSharedFile(
      [
        "[default]",
        "region = us-east-1",
        "",
        "[profile oneuptime]",
        "credential_process = /usr/local/bin/aws_signing_helper credential-process",
        "",
        "[sso-session corp]",
        "sso_region = us-east-1",
        "",
        "[services local]",
        "endpoint_url = http://localhost:4566",
        "",
        "[plain]",
        "aws_access_key_id = AKIANOTAPROFILE00001",
      ].join("\n"),
      "config",
    );

    expect(profiles).toEqual({
      default: { region: "us-east-1" },
      oneuptime: {
        credential_process:
          "/usr/local/bin/aws_signing_helper credential-process",
      },
    });
  });

  test("a quoted name, and several spaces after profile, are the same profile", () => {
    expect(
      parseAwsSharedFile(
        '[profile   "oneuptime"]\nregion = eu-west-1\n[profile  oneuptime ]\noutput = json',
        "config",
      ),
    ).toEqual({ oneuptime: { region: "eu-west-1", output: "json" } });
  });

  test("a name the SDKs would not take is no profile", () => {
    expect(
      parseAwsSharedFile(
        "[profile has spaces in it]\nregion = us-east-1\n[profile ]\nregion = us-east-2",
        "config",
      ),
    ).toEqual({});
  });
});

describe("a credentials file's profiles", () => {
  test("are their sections' names, profile prefix or not", () => {
    expect(
      parseAwsSharedFile(
        [
          "[default]",
          "aws_access_key_id = AKIADEFAULTEXAMPLE01",
          "aws_secret_access_key = defaultSecret",
          "[oneuptime]",
          "aws_access_key_id = AKIAONEUPTIMEEXAMPL1",
        ].join("\n"),
        "credentials",
      ),
    ).toEqual({
      default: {
        aws_access_key_id: "AKIADEFAULTEXAMPLE01",
        aws_secret_access_key: "defaultSecret",
      },
      oneuptime: { aws_access_key_id: "AKIAONEUPTIMEEXAMPL1" },
    });
  });
});

describe("reading the lines", () => {
  test("comments start a line, or follow a space or a tab; a # inside a value stays", () => {
    expect(
      parseAwsSharedFile(
        [
          "# a comment",
          "; another",
          "[default] ; the default profile",
          "  # an indented comment",
          "aws_secret_access_key = abc#def;ghi",
          "region = us-east-1 ; where it sends",
          "output = json\t# the format",
        ].join("\n"),
        "credentials",
      ),
    ).toEqual({
      default: {
        aws_secret_access_key: "abc#def;ghi",
        region: "us-east-1",
        output: "json",
      },
    });
  });

  test("a setting with no value starts nested settings, which are skipped", () => {
    expect(
      parseAwsSharedFile(
        [
          "[profile oneuptime]",
          "s3 =",
          "  max_concurrent_requests = 20",
          "  aws_access_key_id = AKIANESTEDNOTREAD001",
          "region = us-east-1",
        ].join("\n"),
        "config",
      ),
    ).toEqual({ oneuptime: { region: "us-east-1" } });
  });

  test("names are read in lower case, values as written; the last of a name wins", () => {
    expect(
      parseAwsSharedFile(
        "[default]\nAWS_Access_Key_ID = AKIAFIRSTEXAMPLE0001\naws_access_key_id = AKIASECONDEXAMPLE001\nRegion=EU-West-1",
        "credentials",
      ),
    ).toEqual({
      default: {
        aws_access_key_id: "AKIASECONDEXAMPLE001",
        region: "EU-West-1",
      },
    });
  });

  test("Windows line ends, a value with = in it, and lines that are no setting", () => {
    expect(
      parseAwsSharedFile(
        "[default]\r\naws_session_token = IQoJ==abc=\r\nnot a setting\r\n= no name\r\n",
        "credentials",
      ),
    ).toEqual({ default: { aws_session_token: "IQoJ==abc=" } });
  });

  test("settings before any section, and a section read twice, are kept apart and merged", () => {
    expect(
      parseAwsSharedFile(
        "region = us-east-1\n[default]\noutput = json\n[default]\nregion = us-west-2",
        "config",
      ),
    ).toEqual({ default: { output: "json", region: "us-west-2" } });
  });
});

describe("where the files are, and which profile is read", () => {
  test.each([
    [{}, "default", `${HOME}/.aws/config`, `${HOME}/.aws/credentials`],
    [
      {
        AWS_PROFILE: " oneuptime ",
        AWS_CONFIG_FILE: "/etc/oneuptime/aws/config",
        AWS_SHARED_CREDENTIALS_FILE: "~/creds",
      },
      "oneuptime",
      "/etc/oneuptime/aws/config",
      `${HOME}/creds`,
    ],
    [{ AWS_CONFIG_FILE: "~" }, "default", HOME, `${HOME}/.aws/credentials`],
  ] as Array<[Record<string, string>, string, string, string]>)(
    "%j",
    (
      env: Record<string, string>,
      profile: string,
      configFile: string,
      credentialsFile: string,
    ) => {
      const paths: AwsSharedConfigPaths = getAwsSharedConfigPaths({
        env: env,
        homeDirectory: HOME,
      });

      expect(paths.profile).toBe(profile);
      expect(paths.configFile).toBe(configFile);
      expect(paths.credentialsFile).toBe(credentialsFile);
      expect(paths.isConfigFileNamed).toBe(Boolean(env["AWS_CONFIG_FILE"]));
      expect(paths.isCredentialsFileNamed).toBe(
        Boolean(env["AWS_SHARED_CREDENTIALS_FILE"]),
      );
    },
  );

  test("the default profile is named default", () => {
    expect(DEFAULT_AWS_PROFILE).toBe("default");
  });

  test.each([
    ["oneuptime", true],
    ["prod-us_east.1@corp", true],
    ["a/b:c%d", true],
    ["", false],
    ["has space", false],
    ["new\nline", false],
    ["x".repeat(129), false],
  ])("%j is a profile's name: %s", (name: string, isName: boolean) => {
    expect(isAwsProfileName(name)).toBe(isName);
  });
});

describe("one profile, from both files", () => {
  test("the credentials file wins, and each setting remembers its file", () => {
    const merged: Record<string, AwsProfileSetting> | null = mergeAwsProfile({
      profile: "oneuptime",
      config: {
        file: "/etc/aws/config",
        profiles: {
          oneuptime: {
            region: "us-east-1",
            credential_process: "/bin/helper",
            aws_access_key_id: "AKIAFROMCONFIG000001",
          },
        },
      },
      credentials: {
        file: "/etc/aws/credentials",
        profiles: {
          oneuptime: { aws_access_key_id: "AKIAFROMCREDENTIALS1" },
          other: { aws_access_key_id: "AKIAOTHERPROFILE0001" },
        },
      },
    });

    expect(merged).toEqual({
      region: { value: "us-east-1", file: "/etc/aws/config" },
      credential_process: { value: "/bin/helper", file: "/etc/aws/config" },
      aws_access_key_id: {
        value: "AKIAFROMCREDENTIALS1",
        file: "/etc/aws/credentials",
      },
    });
  });

  test("a profile in neither file is none", () => {
    expect(
      mergeAwsProfile({
        profile: "missing",
        config: { file: "/a", profiles: { default: { region: "x" } } },
        credentials: { file: "/b", profiles: {} },
      }),
    ).toBeNull();
  });
});
