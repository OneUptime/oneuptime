import { describe, expect, test } from "@jest/globals";
import AuditLogAction from "../../../Types/AuditLog/AuditLogAction";
import { AUDIT_LOG_ACTION_LABELS } from "../../../Types/AuditLog/AuditLogActionLabel";
import {
  DASHBOARD_LANGUAGES,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * A SESSION THAT TIMED OUT READS AS WHAT HAPPENED, AS A REVOKED ONE DOES (#8078).
 *
 * The audit log's Action column and its Action filter name each session
 * event: Sign In, Sign Out, Session Timeout and Session Revoked. "Session
 * Timeout" was worded as the setting in many languages - Spanish "Tiempo de
 * espera de la sesión" (the session's time limit), German
 * "Sitzungs-Timeout", Portuguese "Tempo limite da sessão" - beside "Sesión
 * revocada", "Sitzung widerrufen": an event. It reads as the event now,
 * the way Session Revoked beside it does: "Sesión expirada", "Sitzung
 * abgelaufen", "Sessão expirada".
 */

const TIMED_OUT: string =
  AUDIT_LOG_ACTION_LABELS[AuditLogAction.SessionTimeout];
const REVOKED: string = AUDIT_LOG_ACTION_LABELS[AuditLogAction.SessionRevoked];

// Each language's event, beside its Session Revoked.
const EXPECTED: Record<string, { timedOut: string; revoked: string }> = {
  es: { timedOut: "Sesión expirada", revoked: "Sesión revocada" },
  de: { timedOut: "Sitzung abgelaufen", revoked: "Sitzung widerrufen" },
  fr: { timedOut: "Session expirée", revoked: "Session révoquée" },
  it: { timedOut: "Sessione scaduta", revoked: "Sessione revocata" },
  pt: { timedOut: "Sessão expirada", revoked: "Sessão revogada" },
  nl: { timedOut: "Sessie verlopen", revoked: "Sessie ingetrokken" },
  da: { timedOut: "Session udløbet", revoked: "Session tilbagekaldt" },
  no: { timedOut: "Økt utløpt", revoked: "Økt tilbakekalt" },
  ru: { timedOut: "Сеанс истёк", revoked: "Сеанс отозван" },
};

// The words the setting reads in, which an event never does.
const SETTING_WORDS: Record<string, RegExp> = {
  es: /tiempo de espera/i,
  pt: /tempo limite/i,
  it: /timeout/i,
  de: /timeout/i,
  da: /timeout/i,
  sv: /timeout/i,
  nl: /time-?out/i,
  no: /tidsavbrudd/i,
  ru: /тайм-аут/i,
  hi: /टाइमआउट/,
};

describe("the audit log's session events", () => {
  test("are keyed by their English words", () => {
    expect(TIMED_OUT).toBe("Session Timeout");
    expect(REVOKED).toBe("Session Revoked");
  });

  test.each(Object.keys(EXPECTED))(
    "in %s: a timed-out session reads as an event, as the revoked one beside it does",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);
      const expected: { timedOut: string; revoked: string } = EXPECTED[
        language
      ] as { timedOut: string; revoked: string };

      expect(words[TIMED_OUT]).toBe(expected.timedOut);
      expect(words[REVOKED]).toBe(expected.revoked);
      // Both name the session first, then what happened to it.
      expect(words[TIMED_OUT]?.split(" ")[0]).toBe(
        words[REVOKED]?.split(" ")[0],
      );
    },
  );

  test("never read as the timeout setting, in any language", () => {
    for (const language of Object.keys(SETTING_WORDS)) {
      const words: Record<string, string> = readDashboardLocale(language);

      expect({
        language,
        timedOut: words[TIMED_OUT],
        readsAsTheSetting: (SETTING_WORDS[language] as RegExp).test(
          words[TIMED_OUT] || "",
        ),
      }).toEqual({
        language,
        timedOut: words[TIMED_OUT],
        readsAsTheSetting: false,
      });
    }
  });

  test("are worded in every Dashboard language", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      const words: Record<string, string> = readDashboardLocale(language);

      for (const action of [
        AuditLogAction.SignIn,
        AuditLogAction.SignOut,
        AuditLogAction.SessionTimeout,
        AuditLogAction.SessionRevoked,
      ]) {
        const key: string = AUDIT_LOG_ACTION_LABELS[action];

        expect({
          language,
          key,
          worded: Boolean(words[key]) && words[key] !== key,
        }).toEqual({ language, key, worded: true });
      }
    }
  });
});
