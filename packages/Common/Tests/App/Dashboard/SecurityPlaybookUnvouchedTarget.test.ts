import { describe, expect, test } from "@jest/globals";
import {
  UNVOUCHED_PROXY_TARGET,
  UNVOUCHED_PROXY_TARGET_UNKNOWN,
  describeRunTarget,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityPlaybook/SecurityPlaybookRunSteps";
import { describeTarget } from "../../../Server/Utils/SecurityPlaybook/SecurityPlaybookContainment";
import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import {
  SecurityPlaybookTarget,
  SecurityPlaybookTargetReason,
  SecurityPlaybookTargetState,
} from "../../../Types/SecurityPlaybook/SecurityPlaybookStepResult";
import {
  Translator,
  getGlobalTranslator,
} from "../../../UI/Utils/TranslateTemplate";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  placeholdersOf,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * #11389: A BLOCK THAT WAITS FOR A PERSON SAYS WHY, beside each address it
 * would act on: the case's requests named it as a client that came through
 * a private address nothing vouches for - a TCP proxy there would have
 * passed on what the client wrote - or through proxies OneUptime cannot
 * name. On the run card, in the reader's language, and on the case's
 * timeline, in English.
 */

const english: Translator = getGlobalTranslator();

function target(data: Partial<SecurityPlaybookTarget>): SecurityPlaybookTarget {
  return {
    type: SecurityEntityType.IpAddress,
    value: "203.0.113.70",
    reason: SecurityPlaybookTargetReason.GroupedOn,
    state: SecurityPlaybookTargetState.Proposed,
    ...data,
  };
}

describe("an address whose block waits for a person, on the run card", () => {
  test("names the proxy it came through, and that the client may have written it", () => {
    expect(
      describeRunTarget(target({ unvouchedProxy: "10.0.1.57" }), english),
    ).toBe(
      "Came through 10.0.1.57, a private address you haven't listed as a proxy: the client may have written this address",
    );
  });

  test("says so of proxies OneUptime can't name", () => {
    expect(describeRunTarget(target({ unvouchedProxy: "" }), english)).toBe(
      UNVOUCHED_PROXY_TARGET_UNKNOWN,
    );
  });

  test("an address with no such mark is said as before", () => {
    expect(describeRunTarget(target({}), english)).not.toContain(
      "listed as a proxy",
    );
  });

  test("only a proposed one: a protected or left-out address says what it is", () => {
    for (const state of [
      SecurityPlaybookTargetState.Protected,
      SecurityPlaybookTargetState.LeftOut,
    ]) {
      expect(
        describeRunTarget(
          target({ state, unvouchedProxy: "10.0.1.57" }),
          english,
        ),
      ).not.toContain("10.0.1.57");
    }
  });

  test("in every language the Dashboard ships, keeping the proxy's place", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      const words: Record<string, string> = readDashboardLocale(language);

      for (const key of [
        UNVOUCHED_PROXY_TARGET,
        UNVOUCHED_PROXY_TARGET_UNKNOWN,
      ]) {
        expect({ language, key, has: Boolean(words[key]) }).toEqual({
          language,
          key,
          has: true,
        });
        expect(placeholdersOf(words[key] || "")).toEqual(placeholdersOf(key));
      }

      expect(
        describeRunTarget(
          target({ unvouchedProxy: "10.0.1.57" }),
          dashboardTranslator(language),
        ),
      ).toContain("10.0.1.57");
    }
  });
});

describe("an address whose block waits for a person, on the case's timeline", () => {
  test("names the proxy, or says OneUptime can't name them", () => {
    expect(describeTarget(target({ unvouchedProxy: "10.0.1.57" }))).toBe(
      "came through 10.0.1.57, a private address you haven't listed as a proxy: the client may have written it",
    );
    expect(describeTarget(target({ unvouchedProxy: "" }))).toBe(
      "came through proxies OneUptime can't name: the client may have written it",
    );
    expect(describeTarget(target({}))).toBe("what the case is grouped on");
  });
});
