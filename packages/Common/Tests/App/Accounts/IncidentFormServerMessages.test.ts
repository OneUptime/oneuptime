import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  INCIDENT_FORM_RATE_LIMIT_UNAVAILABLE_MESSAGE,
  INCIDENT_FORM_READ_RATE_LIMIT_MESSAGE,
  INCIDENT_FORM_SUBMIT_RATE_LIMIT_MESSAGE,
  INCIDENT_FORM_TOTAL_RATE_LIMIT_MESSAGE,
} from "../../../Server/Middleware/IncidentFormRateLimit";
import {
  INCIDENT_FORM_NETWORK_NOT_ALLOWED_MESSAGE,
  INCIDENT_FORM_NO_SEVERITY_MESSAGE,
  INCIDENT_FORM_NOT_AVAILABLE_MESSAGE,
  INCIDENT_FORM_SUBMIT_FAILED_MESSAGE,
} from "../../../Server/Services/IncidentFormService";
import IncidentFormMessage from "../../../../App/FeatureSet/Accounts/src/Utils/IncidentFormMessage";

/*
 * THE PAGE AND THE SERVER USE THE SAME WORDS.
 *
 * The public incident form page translates a refusal by looking the server's
 * sentence up, whole, in its locale files (IncidentFormMessage). The page
 * cannot import the server's constants - they live beside Redis clients and
 * database services - so it keeps its own copy of each sentence, and this
 * file is what keeps the copies honest.
 *
 * A sentence reworded on the server and not here fails silently in a
 * browser: the page stops recognising it, and every reporter reads the
 * English sentence whatever their language (or, for a limit or an outage,
 * the page's own generic sentence instead of the server's precise one).
 */

describe("each sentence the page knows is the server's, byte for byte", () => {
  test.each([
    [
      "a form that is not available (404)",
      IncidentFormMessage.NotAvailable,
      INCIDENT_FORM_NOT_AVAILABLE_MESSAGE,
    ],
    [
      "a network that is not allowed (403)",
      IncidentFormMessage.NetworkNotAllowed,
      INCIDENT_FORM_NETWORK_NOT_ALLOWED_MESSAGE,
    ],
    [
      "a form with no severity (400)",
      IncidentFormMessage.NoSeverity,
      INCIDENT_FORM_NO_SEVERITY_MESSAGE,
    ],
    [
      "an incident that could not be declared (500)",
      IncidentFormMessage.SubmitFailed,
      INCIDENT_FORM_SUBMIT_FAILED_MESSAGE,
    ],
    [
      "too many reads (429)",
      IncidentFormMessage.TooManyRequests,
      INCIDENT_FORM_READ_RATE_LIMIT_MESSAGE,
    ],
    [
      "too many submissions from one network (429)",
      IncidentFormMessage.TooManySubmissions,
      INCIDENT_FORM_SUBMIT_RATE_LIMIT_MESSAGE,
    ],
    [
      "too many reports to one form (429)",
      IncidentFormMessage.FormBusy,
      INCIDENT_FORM_TOTAL_RATE_LIMIT_MESSAGE,
    ],
    [
      "submits paused while the limiter is down (503)",
      IncidentFormMessage.ReportsUnavailable,
      INCIDENT_FORM_RATE_LIMIT_UNAVAILABLE_MESSAGE,
    ],
  ])("%s", (_case: string, pageSentence: string, serverSentence: string) => {
    expect(pageSentence).toBe(serverSentence);
  });

  test("the two captcha refusals", () => {
    /*
     * CaptchaUtil keeps these as literals rather than exported constants, so
     * they are read off its source - the words it throws with.
     */
    const captchaSource: string = fs.readFileSync(
      path.join(__dirname, "..", "..", "..", "Server", "Utils", "Captcha.ts"),
      "utf8",
    );

    expect(captchaSource).toContain(
      JSON.stringify(IncidentFormMessage.CaptchaMissing),
    );
    expect(captchaSource).toContain(
      JSON.stringify(IncidentFormMessage.CaptchaFailed),
    );
  });

  test("every sentence is accounted for: the server's, or the page's own", () => {
    /*
     * One sentence is the page's own - a form it could not read at all is not
     * something the server ever says. Anything else added to
     * IncidentFormMessage needs a row above.
     */
    expect(Object.values(IncidentFormMessage).sort()).toEqual(
      [
        INCIDENT_FORM_NOT_AVAILABLE_MESSAGE,
        INCIDENT_FORM_NETWORK_NOT_ALLOWED_MESSAGE,
        INCIDENT_FORM_NO_SEVERITY_MESSAGE,
        INCIDENT_FORM_SUBMIT_FAILED_MESSAGE,
        INCIDENT_FORM_READ_RATE_LIMIT_MESSAGE,
        INCIDENT_FORM_SUBMIT_RATE_LIMIT_MESSAGE,
        INCIDENT_FORM_TOTAL_RATE_LIMIT_MESSAGE,
        INCIDENT_FORM_RATE_LIMIT_UNAVAILABLE_MESSAGE,
        IncidentFormMessage.CaptchaMissing,
        IncidentFormMessage.CaptchaFailed,
        IncidentFormMessage.LoadFailed,
      ].sort(),
    );
  });
});
