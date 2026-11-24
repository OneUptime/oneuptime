import { describe, expect, test } from "@jest/globals";
import { GROUP_FIX_SERVER_SENTENCES } from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/IssueGroupsCopy";
import {
  CLOUD_FIX_REFUSED_MESSAGE,
  GROUP_FIX_CHANGED_MESSAGE,
  GROUP_FIX_HELD_READER_MESSAGE,
  GROUP_FIX_NOTHING_TO_DO_MESSAGE,
  GROUP_NOT_FOUND_MESSAGE,
  GROUP_PULL_REQUEST_REFUSED_MESSAGE,
} from "../../../Server/Utils/DataSecurity/DataSecurityIssueGroupFix";

/*
 * WHAT THE SERVER SAYS OF A GROUP'S FIX, THE DASHBOARD SAYS IN THE READER'S
 * LANGUAGE (#10370, #10739): Fix the cause shows the server's refusal as
 * it came, through the translator - so each sentence the server answers is
 * one the Dashboard's locales hold, word for word. A reader held to labels
 * reads a group and asks for no fix: the sentence that tells them so is
 * one of them.
 */

describe("the server's sentences of a group's fix", () => {
  test.each([
    [
      "a pull request the reader may not ask for",
      GROUP_PULL_REQUEST_REFUSED_MESSAGE,
    ],
    ["a cloud change the reader may not make", CLOUD_FIX_REFUSED_MESSAGE],
    ["a plan that changed since it was shown", GROUP_FIX_CHANGED_MESSAGE],
    ["a group whose every store is left out", GROUP_FIX_NOTHING_TO_DO_MESSAGE],
    ["a group that is gone", GROUP_NOT_FOUND_MESSAGE],
    ["a reader held to labels (#10739)", GROUP_FIX_HELD_READER_MESSAGE],
  ])(
    "%s is one the Dashboard translates",
    (_name: string, sentence: string) => {
      expect(GROUP_FIX_SERVER_SENTENCES).toContain(sentence);
    },
  );
});
