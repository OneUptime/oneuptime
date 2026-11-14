import { describe, expect, test } from "@jest/globals";
import {
  findServerTextKeys,
  ServerTextKey,
  TRANSLATED_LANGUAGES,
} from "../../../Scripts/I18n/ServerLocales";
import { SERVER_LOCALES } from "../../../Server/Utils/ServerTranslation";
import {
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * THE SERVER NAMES A MAINTENANCE EVENT AS THE DASHBOARD DOES, IN EVERY
 * LANGUAGE (#7907).
 *
 * A status page's subscribers hear of a new maintenance event in an email
 * (SubscriberScheduledMaintenanceEventCreated.hbs) whose first detail row
 * is titled with the server's "Maintenance Event", under a sentence that
 * names the record with each language's Dashboard word (#7900): "Für von
 * Ihnen abonnierte Dienste wurde ein Wartungsereignis angekündigt." Sixteen
 * languages worded the row's title as the plain word for maintenance -
 * German "Wartung" - so one email called the record two things, and the
 * row's was neither the Dashboard's word nor the status page's. The
 * server's "Maintenance Event" is the Dashboard's, in every language the
 * server writes in. App/Tests/Notification/EmailLanguage renders the email.
 */

const MAINTENANCE_EVENT: string = "Maintenance Event";

const NEW_EVENT_EMAIL: string =
  "packages/App/FeatureSet/Notification/Templates/SubscriberScheduledMaintenanceEventCreated.hbs";

describe("the server's word for a maintenance event", () => {
  test("is looked up by the new maintenance event email", () => {
    const files: Array<string> = findServerTextKeys()
      .filter((key: ServerTextKey): boolean => {
        return key.key === MAINTENANCE_EVENT;
      })
      .map((key: ServerTextKey): string => {
        return key.file;
      });

    expect(files).toContain(NEW_EVENT_EMAIL);
  });

  test("is its own English, as in the Dashboard's file", () => {
    expect(SERVER_LOCALES["en"]?.[MAINTENANCE_EVENT]).toBe(MAINTENANCE_EVENT);
    expect(readDashboardLocale("en")[MAINTENANCE_EVENT]).toBe(
      MAINTENANCE_EVENT,
    );
  });

  test.each([...TRANSLATED_LANGUAGES])(
    "%s words it as its Dashboard does",
    (language: string) => {
      // The Dashboard's own word, not the English it falls back to.
      expect({
        language,
        isWorded: isWordedInDashboardLocale(MAINTENANCE_EVENT, language),
      }).toEqual({ language, isWorded: true });

      expect({
        language,
        word: SERVER_LOCALES[language]?.[MAINTENANCE_EVENT],
      }).toEqual({
        language,
        word: readDashboardLocale(language)[MAINTENANCE_EVENT],
      });
    },
  );
});
