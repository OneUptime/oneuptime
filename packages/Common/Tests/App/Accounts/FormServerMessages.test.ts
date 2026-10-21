import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  FORM_RATE_LIMIT_UNAVAILABLE_MESSAGE,
  FORM_READ_RATE_LIMIT_MESSAGE,
  FORM_SUBMIT_RATE_LIMIT_MESSAGE,
  FORM_TOTAL_RATE_LIMIT_MESSAGE,
} from "../../../Server/Middleware/FormRateLimit";
import {
  FORM_NETWORK_NOT_ALLOWED_MESSAGE,
  FORM_NOT_AVAILABLE_MESSAGE,
  FORM_SUBMIT_FAILED_MESSAGE,
} from "../../../Server/Services/FormService";
import { FORM_NO_SEVERITY_MESSAGE } from "../../../Server/Utils/Form/IncidentFormTarget";
import FormMessage from "../../../../App/FeatureSet/Accounts/src/Utils/FormMessage";

/*
 * THE PAGE AND THE SERVER USE THE SAME WORDS.
 *
 * The public form page translates a refusal by looking the server's
 * sentence up, whole, in its locale files (FormMessage). The page
 * cannot import the server's constants - they live beside Redis clients and
 * database services - so it keeps its own copy of each sentence, and this
 * file is what keeps the copies honest.
 *
 * A sentence reworded on the server and not here fails silently in a
 * browser: the page stops recognising it, and every submitter reads the
 * English sentence whatever their language (or, for a limit or an outage,
 * the page's own generic sentence instead of the server's precise one).
 */

describe("each sentence the page knows is the server's, byte for byte", () => {
  test.each([
    [
      "a form that is not available (404)",
      FormMessage.NotAvailable,
      FORM_NOT_AVAILABLE_MESSAGE,
    ],
    [
      "a network that is not allowed (403)",
      FormMessage.NetworkNotAllowed,
      FORM_NETWORK_NOT_ALLOWED_MESSAGE,
    ],
    [
      "a form with no severity (400)",
      FormMessage.NoSeverity,
      FORM_NO_SEVERITY_MESSAGE,
    ],
    [
      "a record that could not be created (500)",
      FormMessage.SubmitFailed,
      FORM_SUBMIT_FAILED_MESSAGE,
    ],
    [
      "too many reads (429)",
      FormMessage.TooManyRequests,
      FORM_READ_RATE_LIMIT_MESSAGE,
    ],
    [
      "too many submissions from one network (429)",
      FormMessage.TooManySubmissions,
      FORM_SUBMIT_RATE_LIMIT_MESSAGE,
    ],
    [
      "too many submissions to one form (429)",
      FormMessage.FormBusy,
      FORM_TOTAL_RATE_LIMIT_MESSAGE,
    ],
    [
      "submits paused while the limiter is down (503)",
      FormMessage.SubmissionsUnavailable,
      FORM_RATE_LIMIT_UNAVAILABLE_MESSAGE,
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

    expect(captchaSource).toContain(JSON.stringify(FormMessage.CaptchaMissing));
    expect(captchaSource).toContain(JSON.stringify(FormMessage.CaptchaFailed));
  });

  test("every sentence is accounted for: the server's, or the page's own", () => {
    /*
     * One sentence is the page's own - a form it could not read at all is not
     * something the server ever says. Anything else added to
     * FormMessage needs a row above.
     */
    expect(Object.values(FormMessage).sort()).toEqual(
      [
        FORM_NOT_AVAILABLE_MESSAGE,
        FORM_NETWORK_NOT_ALLOWED_MESSAGE,
        FORM_NO_SEVERITY_MESSAGE,
        FORM_SUBMIT_FAILED_MESSAGE,
        FORM_READ_RATE_LIMIT_MESSAGE,
        FORM_SUBMIT_RATE_LIMIT_MESSAGE,
        FORM_TOTAL_RATE_LIMIT_MESSAGE,
        FORM_RATE_LIMIT_UNAVAILABLE_MESSAGE,
        FormMessage.CaptchaMissing,
        FormMessage.CaptchaFailed,
        FormMessage.LoadFailed,
      ].sort(),
    );
  });
});
