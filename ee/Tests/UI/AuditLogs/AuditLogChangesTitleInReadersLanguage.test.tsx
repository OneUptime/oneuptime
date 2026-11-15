import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import * as React from "react";
import { I18nextProvider } from "react-i18next";
import AuditLogChangesModal, {
  getAuditLogChangesTitle,
} from "../../../Dashboard/AuditLogs/AuditLogChangesModal";
import { AUDIT_LOG_SESSION_RESOURCE_TYPE } from "Common/Types/AuditLog/AuditLogSessionEvent";
import { Translator } from "Common/Types/Translator";
import {
  dashboardTranslator,
  readDashboardLocale,
} from "Common/Tests/Helpers/DashboardLocales";

/*
 * ---------------------------------------------------------------------------
 * The audit log dialog's title in the reader's language (issue #8076).
 * ---------------------------------------------------------------------------
 *
 * The dialog's title was joined from English pieces - the action's words,
 * " · ", then the resource's name, its type, or the fallbacks "User
 * Session" and "Resource" - and Modal can only look a whole title up, so a
 * Spanish reader saw "Sign In · User Session" and "Update · Resource". The
 * title is one line now: the action and the type in the reader's words, a
 * name as written, the separator as the language writes it (" • " in
 * Persian, whose zero is a dot).
 */

afterEach(() => {
  cleanup();
});

describe("the changes dialog's title", () => {
  test("English reads as it always did", () => {
    const english: Translator = dashboardTranslator("en");

    expect(
      getAuditLogChangesTitle({
        action: "SignOut",
        resourceType: AUDIT_LOG_SESSION_RESOURCE_TYPE,
        translator: english,
      }),
    ).toBe(`Sign Out · ${AUDIT_LOG_SESSION_RESOURCE_TYPE}`);
    expect(
      getAuditLogChangesTitle({
        action: "SignOut",
        translator: english,
      }),
    ).toBe("Sign Out · User Session");
    expect(
      getAuditLogChangesTitle({
        action: "Update",
        resourceType: "Monitor",
        resourceName: "Checkout API",
        translator: english,
      }),
    ).toBe("Update · Monitor — Checkout API");
    expect(
      getAuditLogChangesTitle({ action: "Delete", translator: english }),
    ).toBe("Delete · Resource");
  });

  test("Spanish says the action, the type and the fallbacks in Spanish, the name as written", () => {
    const spanish: Translator = dashboardTranslator("es");
    const words: Record<string, string> = readDashboardLocale("es");

    // The words the title is made of are Spanish words, not English left in.
    for (const word of ["Sign In", "Update", "User Session", "Resource"]) {
      expect({ word, isWorded: words[word] !== word }).toEqual({
        word,
        isWorded: true,
      });
    }

    expect(
      getAuditLogChangesTitle({ action: "SignIn", translator: spanish }),
    ).toBe(`${words["Sign In"]} · ${words["User Session"]}`);
    expect(
      getAuditLogChangesTitle({ action: "Delete", translator: spanish }),
    ).toBe(`${words["Delete"]} · ${words["Resource"]}`);
    expect(
      getAuditLogChangesTitle({
        action: "Update",
        resourceType: "Monitor",
        resourceName: "Checkout API",
        translator: spanish,
      }),
    ).toBe(`${words["Update"]} · ${words["Monitor"]} — Checkout API`);
  });

  test("Persian sets the action apart with its own bullet", () => {
    const persian: Translator = dashboardTranslator("fa");
    const words: Record<string, string> = readDashboardLocale("fa");
    const title: string = getAuditLogChangesTitle({
      action: "SignIn",
      resourceName: "Chrome 130 on macOS",
      translator: persian,
    });

    expect(title).toBe(`${words["Sign In"]} • Chrome 130 on macOS`);
    expect(title).not.toContain("·");
  });

  test("a session's name comes before its type, and its type before the fallback", () => {
    const english: Translator = dashboardTranslator("en");

    expect(
      getAuditLogChangesTitle({
        action: "SessionTimeout",
        resourceType: AUDIT_LOG_SESSION_RESOURCE_TYPE,
        resourceName: "Chrome 130 on macOS",
        translator: english,
      }),
    ).toBe("Session Timeout · Chrome 130 on macOS");
  });

  test("the dialog draws its title in the reader's language", () => {
    const instance: i18n = createInstance();

    instance.init({
      lng: "es",
      fallbackLng: "en",
      resources: {
        en: { translation: readDashboardLocale("en") },
        es: { translation: readDashboardLocale("es") },
      },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
      initImmediate: false,
    });

    const words: Record<string, string> = readDashboardLocale("es");

    render(
      <I18nextProvider i18n={instance}>
        <AuditLogChangesModal
          isOpen={true}
          onClose={jest.fn()}
          action="Delete"
          resourceType="Monitor"
          changes={[]}
        />
      </I18nextProvider>,
    );

    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      `${words["Delete"]} · ${words["Monitor"]}`,
    );
  });
});
