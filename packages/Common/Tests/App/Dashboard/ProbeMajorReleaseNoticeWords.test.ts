import { PROBE_MISSED_FEATURE_COPY } from "../../../../App/FeatureSet/Dashboard/src/Components/Probe/ProbeUpdateCopy";
import { UPDATE_A_PROBE_DOCS_PATH as DASHBOARD_UPDATE_A_PROBE_DOCS_PATH } from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/ProbesTooOld";
import { PROBE_MISSED_FEATURE_SENTENCES } from "../../../Server/Utils/Probe/ProbeMajorReleaseNotification";
import {
  ProbeFeature,
  UPDATE_A_PROBE_DOCS_PATH,
} from "../../../Types/Probe/ProbeReportedVersion";
import { describe, expect, test } from "@jest/globals";

/*
 * The email a probe's owners get when it falls a major release behind
 * (#9977) says what the probe misses in the words its page says it
 * (Components/Probe/ProbeUpdateCopy), and links the same docs section the
 * page does: a person who follows the email to the page reads the same
 * thing twice, never two versions of it.
 */
describe("the notice of a probe a major release behind, beside its page", () => {
  test("says what the probe misses in its page's own English words, for every feature", () => {
    for (const feature of Object.values(ProbeFeature)) {
      expect(PROBE_MISSED_FEATURE_SENTENCES[feature]).toBe(
        PROBE_MISSED_FEATURE_COPY[feature],
      );
    }
  });

  test("links the docs section the page links", () => {
    expect(DASHBOARD_UPDATE_A_PROBE_DOCS_PATH).toBe(UPDATE_A_PROBE_DOCS_PATH);
  });
});
