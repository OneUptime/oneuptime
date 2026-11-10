import {
  getProviderConfigOfCallback,
  PROVIDER_CONFIG_QUERY_PARAMETER,
  withProviderConfig,
} from "../../FeatureSet/Notification/Utils/StatusCallbackProviderConfig";
import { NotificationProviderConfig } from "Common/Server/Utils/Telemetry/NotificationDeliveryMetrics";
import { describe, expect, test } from "@jest/globals";

/*
 * WHOSE TWILIO ACCOUNT AN SMS OR A CALL WENT OUT ON, AS ITS STATUS CALLBACK
 * TELLS IT (issue #6648).
 *
 * Neither the SMS log nor the call log keeps whose Twilio account a message
 * went out on, so the address Twilio calls back on says it: a project's own
 * account adds ?providerConfig=project, the installation's adds nothing -
 * its address is as it always was, and one sent before this read back as
 * the installation's. Anything else in the query is the installation's: the
 * attribute only ever takes one of its two values.
 */

const CALLBACK_URL: string =
  "https://oneuptime.example.com/notification/sms/status-callback/5e5e0000-0000-4000-8000-0000000000a1/5e5e0000-0000-4000-8000-0000000000f1";

describe("withProviderConfig", () => {
  test("a project's own account says so in the query", () => {
    expect(
      withProviderConfig(CALLBACK_URL, NotificationProviderConfig.Project),
    ).toBe(`${CALLBACK_URL}?providerConfig=project`);
  });

  test("the installation's account leaves the address as it was", () => {
    expect(
      withProviderConfig(CALLBACK_URL, NotificationProviderConfig.Global),
    ).toBe(CALLBACK_URL);
  });

  test("the query's name is providerConfig", () => {
    expect(PROVIDER_CONFIG_QUERY_PARAMETER).toBe("providerConfig");
  });
});

describe("getProviderConfigOfCallback", () => {
  test("project: the project's account", () => {
    expect(getProviderConfigOfCallback({ providerConfig: "project" })).toBe(
      NotificationProviderConfig.Project,
    );
  });

  test.each([
    ["no query", undefined],
    ["null", null],
    ["an empty query", {}],
    ["global", { providerConfig: "global" }],
    ["another case", { providerConfig: "Project" }],
    ["padded", { providerConfig: " project" }],
    ["anything else", { providerConfig: "anything" }],
    ["a list of values", { providerConfig: ["project", "project"] }],
    ["an object", { providerConfig: { value: "project" } }],
    ["a number", { providerConfig: 1 }],
    ["a string query", "providerConfig=project"],
  ])("%s: the installation's account", (_name: string, query: unknown) => {
    expect(getProviderConfigOfCallback(query)).toBe(
      NotificationProviderConfig.Global,
    );
  });

  test("reads back what withProviderConfig wrote, for either account", () => {
    for (const config of [
      NotificationProviderConfig.Global,
      NotificationProviderConfig.Project,
    ]) {
      const query: Record<string, string> = Object.fromEntries(
        new URL(withProviderConfig(CALLBACK_URL, config)).searchParams,
      );

      expect(getProviderConfigOfCallback(query)).toBe(config);
    }
  });
});
