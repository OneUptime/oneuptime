import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import fs from "fs";
import path from "path";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * An App Platforms environment's Logs tab. Logs reach it when they carry the
 * environment's cloud.platform, cloud.account.id and cloud.region - an app's
 * own, and, on App Runner, Elastic Beanstalk and ECS, the platform's own
 * CloudWatch Logs once the account's connection streams them (CloudLogGroups
 * stamps their platform). So the tab filters on those three alone, and an
 * empty tab on one of those three platforms says the second way too.
 */

const getItemMock: MockFunction = getJestMockFunction();
const logsViewerMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: (error: unknown) => {
        return (
          ((error as { message?: unknown } | null)?.message as string) ||
          "Could not load"
        );
      },
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getLastParamAsObjectID: () => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("0193c0de-4444-4aaa-8bbb-000000000004");
      },
      getRoutePath: () => {
        return "";
      },
    },
  };
});

jest.mock("../../../UI/Components/Loader/PageLoader", () => {
  return {
    __esModule: true,
    default: () => {
      return <div data-testid="page-loader" />;
    },
  };
});

jest.mock("../../../UI/Components/ErrorMessage/ErrorMessage", () => {
  return {
    __esModule: true,
    default: (props: { message: string }) => {
      return <div data-testid="error-message">{props.message}</div>;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudResourceConnectBanner",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div data-testid="connect-banner" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Logs/LogsViewer",
  () => {
    return {
      __esModule: true,
      default: (props: unknown) => {
        logsViewerMock(props);
        return <div data-testid="logs-viewer" />;
      },
    };
  },
);

import CloudEnvironmentLogs, {
  CLOUD_ENVIRONMENT_NO_LOGS,
  CLOUD_ENVIRONMENT_NO_LOGS_OR_STREAM,
  getCloudEnvironmentNoLogsMessage,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/AppPlatforms/View/Logs";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import { AWS_LOG_GROUP_PLATFORMS } from "../../../Types/Cloud/CloudLogGroups";
import {
  MANAGED_CLOUD_PLATFORMS,
  ManagedCloudPlatform,
  ManagedCloudPlatformDescriptor,
} from "../../../Types/Cloud/CloudPlatform";

type ViewerProps = Record<string, unknown>;

const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function environment(platform: string): Record<string, string> {
  return {
    resourceIdentifier: `${platform}|123456789012|us-east-1`,
    name: `${platform} · us-east-1 · 123456789012`,
    cloudPlatform: platform,
    cloudAccountId: "123456789012",
    cloudRegion: "us-east-1",
  };
}

function lastViewerProps(): ViewerProps {
  const calls: Array<Array<unknown>> = logsViewerMock.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1]![0] as ViewerProps;
}

async function openLogsTab(platform: string): Promise<ViewerProps> {
  getItemMock.mockResolvedValue(environment(platform));

  render(<CloudEnvironmentLogs {...PAGE_PROPS} />);
  await screen.findByTestId("logs-viewer");

  return lastViewerProps();
}

beforeEach(() => {
  getItemMock.mockReset();
  logsViewerMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("an App Platforms environment's Logs tab", () => {
  test.each([
    ManagedCloudPlatform.AwsAppRunner,
    ManagedCloudPlatform.AwsElasticBeanstalk,
    ManagedCloudPlatform.AwsEcs,
  ])(
    "%s: filters on the three attributes a stream's logs carry, and says streaming fills it too",
    async (platform: string) => {
      const props: ViewerProps = await openLogsTab(platform);

      expect(props["logQuery"]).toEqual({
        attributes: {
          "resource.cloud.platform": platform,
          "resource.cloud.account.id": "123456789012",
          "resource.cloud.region": "us-east-1",
        },
      });
      expect(props["attributeFilterDisplayKeys"]).toEqual({
        "resource.cloud.platform": "Platform",
        "resource.cloud.account.id": "Account",
        "resource.cloud.region": "Region",
      });
      expect(props["noLogsMessage"]).toBe(CLOUD_ENVIRONMENT_NO_LOGS_OR_STREAM);
    },
  );

  test.each(
    MANAGED_CLOUD_PLATFORMS.filter(
      (descriptor: ManagedCloudPlatformDescriptor): boolean => {
        return !(AWS_LOG_GROUP_PLATFORMS as ReadonlyArray<string>).includes(
          descriptor.platform,
        );
      },
    ).map((descriptor: ManagedCloudPlatformDescriptor): string => {
      return descriptor.platform;
    }),
  )(
    "%s: no stream reaches it, so the tab names its apps' attributes only",
    async (platform: string) => {
      const props: ViewerProps = await openLogsTab(platform);

      expect(props["noLogsMessage"]).toBe(CLOUD_ENVIRONMENT_NO_LOGS);
    },
  );

  test("an environment made by hand, with no platform yet, shows the connect banner and asks for no logs", async () => {
    getItemMock.mockResolvedValue({
      resourceIdentifier: "manual-environment",
      name: "Made by hand",
    });

    render(<CloudEnvironmentLogs {...PAGE_PROPS} />);

    expect(await screen.findByTestId("connect-banner")).toBeInTheDocument();
    expect(logsViewerMock).not.toHaveBeenCalled();
  });
});

describe("getCloudEnvironmentNoLogsMessage", () => {
  test("every platform a stream's logs reach says streaming; every other, and none, does not", () => {
    for (const descriptor of MANAGED_CLOUD_PLATFORMS) {
      const streams: boolean = (
        AWS_LOG_GROUP_PLATFORMS as ReadonlyArray<string>
      ).includes(descriptor.platform);

      expect({
        platform: descriptor.platform,
        message: getCloudEnvironmentNoLogsMessage(descriptor.platform),
      }).toEqual({
        platform: descriptor.platform,
        message: streams
          ? CLOUD_ENVIRONMENT_NO_LOGS_OR_STREAM
          : CLOUD_ENVIRONMENT_NO_LOGS,
      });
    }

    for (const platform of [undefined, null, "", "aws_lambda", "aws_ec2"]) {
      expect(getCloudEnvironmentNoLogsMessage(platform)).toBe(
        CLOUD_ENVIRONMENT_NO_LOGS,
      );
    }
  });

  test("the streaming one keeps the first's sentence, and names the dialog and the page as they are titled", () => {
    expect(
      CLOUD_ENVIRONMENT_NO_LOGS_OR_STREAM.startsWith(
        CLOUD_ENVIRONMENT_NO_LOGS.slice(0, -1),
      ),
    ).toBe(true);
    expect(CLOUD_ENVIRONMENT_NO_LOGS_OR_STREAM).toContain(
      "in Cloud > Connect, choose Stream metrics and logs in the account's row.",
    );
  });

  test("both are read in every language the Dashboard has, and none of them is left in English", () => {
    const files: Array<string> = fs
      .readdirSync(LOCALES_DIR)
      .filter((file: string): boolean => {
        return file.endsWith(".json");
      });

    expect(files).toHaveLength(18);

    for (const file of files) {
      const locale: Record<string, string> = JSON.parse(
        fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"),
      ) as Record<string, string>;

      for (const key of [
        CLOUD_ENVIRONMENT_NO_LOGS,
        CLOUD_ENVIRONMENT_NO_LOGS_OR_STREAM,
      ]) {
        const value: string | undefined = locale[key];

        expect({ file, key, has: typeof value === "string" }).toEqual({
          file,
          key,
          has: true,
        });

        if (file !== "en.json") {
          expect({ file, translated: value !== key }).toEqual({
            file,
            translated: true,
          });
          // The attribute names, the platform and the cloud stay as written.
          for (const word of [
            "cloud.platform",
            "cloud.account.id",
            "cloud.region",
          ]) {
            expect({ file, word, kept: value!.includes(word) }).toEqual({
              file,
              word,
              kept: true,
            });
          }
        }
      }

      if (file !== "en.json") {
        for (const word of ["AWS", "CloudWatch Logs"]) {
          expect({
            file,
            word,
            kept: locale[CLOUD_ENVIRONMENT_NO_LOGS_OR_STREAM]!.includes(word),
          }).toEqual({ file, word, kept: true });
        }
        /*
         * The place and the menu item as this language's Dashboard draws
         * them - its own words for Cloud > Connect, never the English menu
         * inside a translated sentence.
         */
        for (const drawn of [
          `${locale["Cloud"]} > ${locale["Connect"]}`,
          locale["Stream metrics and logs"]!,
        ]) {
          expect({
            file,
            drawn,
            named: locale[CLOUD_ENVIRONMENT_NO_LOGS_OR_STREAM]!.includes(drawn),
          }).toEqual({ file, drawn, named: true });
        }
      }
    }
  });
});
