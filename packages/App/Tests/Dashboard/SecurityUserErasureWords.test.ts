import { describe, expect, test } from "@jest/globals";
import SecurityUserErasureRequest from "Common/Models/DatabaseModels/SecurityUserErasureRequest";
import { SecurityUserErasureRequestStatus } from "Common/Types/SecurityEvent/SecurityUserErasure";
import { PluralTemplate, Translator } from "Common/Types/Translator";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  placeholdersOf,
  readDashboardLocale,
} from "Common/Tests/Helpers/DashboardLocales";
import * as Copy from "../../FeatureSet/Dashboard/src/Components/SecurityEvents/ErasureRequests/ErasureRequestCopy";
import * as UserCopy from "../../FeatureSet/Dashboard/src/Components/SecurityEvents/HiddenUserCopy";

/*
 * ERASE A PERSON FROM SECURITY EVENTS (#10908), AND HOW YOUR LOGS KNOW A
 * HIDDEN USER (#10909), IN EVERY LANGUAGE THE DASHBOARD SHIPS - read from
 * its locale files as they ship.
 *
 * A privacy officer in Germany or Japan files an erasure from the same page
 * and reads what it did in their own words: the dialog, its fields and
 * errors, each request's state and what it changed, and the help's account
 * of what an erasure does and leaves. The event panel's line under a user
 * hidden behind a token, and under one erased on request, reads the same.
 */

const SENTENCES: ReadonlyArray<string> = [
  Copy.ERASURE_REQUESTS_TITLE,
  Copy.ERASURE_REQUESTS_DESCRIPTION,
  Copy.NO_ERASURE_REQUESTS,
  Copy.ERASE_VERB,
  Copy.ERASE_NOUN,
  Copy.ERASE_PERSON,
  Copy.ERASE_A_PERSON,
  Copy.ERASE_DIALOG_DESCRIPTION,
  Copy.USER_FIELD_TITLE,
  Copy.USER_FIELD_DESCRIPTION,
  Copy.REFERENCE_FIELD_TITLE,
  Copy.REFERENCE_FIELD_DESCRIPTION,
  Copy.USER_REQUIRED,
  Copy.USER_TOO_LONG,
  Copy.ERASURE_REQUESTED,
  Copy.REQUEST_COLUMN,
  Copy.STATUS_COLUMN,
  Copy.CHANGES_COLUMN,
  Copy.TOKENS_COLUMN,
  Copy.UNNAMED_REQUEST,
  Copy.REQUESTED_AT_BY,
  Copy.REQUESTED_AT,
  ...Object.values(Copy.ERASURE_STATUS_LABELS),
  Copy.QUEUED_LINE,
  Copy.ERASING_LINE,
  Copy.ERASED_AT,
  Copy.FAILED_LINE,
  Copy.NOTHING_NAMED_THEM,
  Copy.NOT_STARTED,
  Copy.ERASURE_HELP_DESCRIPTION,
  Copy.ERASURE_HELP_MARKDOWN,
  UserCopy.HASHED_IN_YOUR_LOGS,
  UserCopy.HASHED_IN_YOUR_TRACES,
  UserCopy.SEARCH_YOUR_LOGS_FOR,
  UserCopy.SEARCH_YOUR_TRACES_FOR,
  UserCopy.ERASED_ON_REQUEST,
  UserCopy.ERASED_ON_REQUEST_DETAIL,
];

const PLURALS: ReadonlyArray<PluralTemplate> = [
  Copy.VAULT_ENTRIES_DELETED,
  Copy.EVENTS_UNNAMED,
  Copy.CASES_UNNAMED,
  Copy.PROPOSALS_WITHDRAWN,
];

const KEYS: ReadonlyArray<string> = [
  ...SENTENCES,
  ...PLURALS.flatMap((plural: PluralTemplate): Array<string> => {
    return [plural.other, `${plural.other}_one`];
  }),
];

function request(
  fields: Partial<SecurityUserErasureRequest>,
): SecurityUserErasureRequest {
  return Object.assign(new SecurityUserErasureRequest(), fields);
}

describe("the words of erasing a person", () => {
  test("are each a key the Dashboard's English holds", () => {
    const english: Record<string, string> = readDashboardLocale("en");

    for (const sentence of SENTENCES) {
      expect({ sentence, english: english[sentence] }).toEqual({
        sentence,
        english: sentence,
      });
    }

    for (const plural of PLURALS) {
      expect({
        other: english[plural.other],
        one: english[`${plural.other}_one`],
      }).toEqual({ other: plural.other, one: plural.one });
    }
  });

  test("are worded in every language, each keeping its placeholders", () => {
    const unworded: Array<string> = [];

    for (const language of DASHBOARD_LANGUAGES) {
      const words: Record<string, string> = readDashboardLocale(language);

      for (const key of KEYS) {
        if (!isWordedInDashboardLocale(key, language)) {
          unworded.push(`${language}: ${key}`);
          continue;
        }

        const english: string = key.endsWith("_one")
          ? key.slice(0, -"_one".length)
          : key;

        expect({
          language,
          key,
          placeholders: placeholdersOf(words[key] || ""),
        }).toEqual({
          language,
          key,
          placeholders: placeholdersOf(english),
        });
      }
    }

    expect(unworded).toEqual([]);
  });

  test("the help keeps its three headings and its lists in every language", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      const help: string =
        readDashboardLocale(language)[Copy.ERASURE_HELP_MARKDOWN] || "";

      expect({ language, headings: help.match(/^## /gm)?.length }).toEqual({
        language,
        headings: 3,
      });
      // Three things it does, four it leaves, two the request keeps.
      expect({ language, bullets: help.match(/^- /gm)?.length }).toEqual({
        language,
        bullets: 9,
      });
    }
  });

  test("what a request changed counts right at one and at many, in every language", () => {
    const english: Translator = dashboardTranslator("en");

    expect(english.translatePlural(Copy.EVENTS_UNNAMED, 1)).toBe(
      "1 event unnamed",
    );
    expect(english.translatePlural(Copy.VAULT_ENTRIES_DELETED, 3)).toBe(
      "3 vault entries deleted",
    );

    for (const language of DASHBOARD_LANGUAGES) {
      const translator: Translator = dashboardTranslator(language);

      for (const count of [1, 2, 21]) {
        for (const plural of PLURALS) {
          const drawn: string = translator.translatePlural(plural, count);

          expect({
            language,
            count,
            plural: plural.other,
            counted: drawn.includes(translator.formatNumber(count)),
            leftover: drawn.includes("{{"),
          }).toEqual({
            language,
            count,
            plural: plural.other,
            counted: true,
            leftover: false,
          });
        }
      }
    }
  });
});

describe("what one request shows", () => {
  test("lists only what it changed, in order", () => {
    expect(
      Copy.getErasureChanges(
        request({
          vaultEntriesDeleted: 2,
          eventsUnnamed: 0,
          casesUnnamed: 1,
          proposalsWithdrawn: 3,
        }),
      ),
    ).toEqual([
      { template: Copy.VAULT_ENTRIES_DELETED, count: 2 },
      { template: Copy.CASES_UNNAMED, count: 1 },
      { template: Copy.PROPOSALS_WITHDRAWN, count: 3 },
    ]);
    expect(Copy.getErasureChanges(request({}))).toEqual([]);
  });

  test("reads its state defensively: anything unknown is queued", () => {
    for (const status of Object.values(SecurityUserErasureRequestStatus)) {
      expect(Copy.getErasureStatus(request({ status }))).toBe(status);
    }

    expect(
      Copy.getErasureStatus(
        request({ status: "Paused" as SecurityUserErasureRequestStatus }),
      ),
    ).toBe(SecurityUserErasureRequestStatus.Pending);
    expect(Copy.getErasureStatus(request({}))).toBe(
      SecurityUserErasureRequestStatus.Pending,
    );
  });

  test("every state has a label and a tone; only a finished one is green, a failed one red", () => {
    expect(Copy.ERASURE_STATUS_TONES).toEqual({
      [SecurityUserErasureRequestStatus.Pending]: PillTone.Info,
      [SecurityUserErasureRequestStatus.InProgress]: PillTone.Info,
      [SecurityUserErasureRequestStatus.Completed]: PillTone.Success,
      [SecurityUserErasureRequestStatus.Failed]: PillTone.Danger,
    });
    expect(Object.keys(Copy.ERASURE_STATUS_LABELS).sort()).toEqual(
      Object.values(SecurityUserErasureRequestStatus).sort(),
    );
  });

  test("the dialog never asks for the person's name, and says it can't be undone", () => {
    expect(Copy.REFERENCE_FIELD_DESCRIPTION).toContain("Never the person's name");
    expect(Copy.ERASE_DIALOG_DESCRIPTION).toContain("can't be undone");
  });
});
