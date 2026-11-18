/*
 * CAN A PAGE REACH THIS PROJECT'S PEOPLE BY EMAIL, SMS AND CALL? (#7151, #6880)
 *
 * A self-hosted server sends no email until its admin sets it up, and no SMS
 * or call without a Twilio account or a gateway - the project's own, or the
 * server's. Only a master admin could read that (GET /global-config/
 * sending-status), so a project member saw the phone field in the guided
 * on-call setup, typed a number and was refused only then; an owner turned
 * SMS on and read "Saved"; and every email method in Notification Methods
 * read as if a page would reach it.
 *
 * GET /api/project-can-send answers any signed-in member of the project with
 * three yes-or-noes, and nothing else - never what is missing, what a
 * provider said, nor any setting, which stay the server's admins':
 *
 *   - email  the server can send email: not "not set up", not failing;
 *   - sms    the project's own Twilio config sends SMS, or the server can;
 *   - call   the project's own Twilio config makes calls, or the server can.
 *
 * Always yes on OneUptime Cloud, whose sending is its operator's to watch.
 * Read in a browser, anything that is not a plain `false` - an older
 * server's 404, a failed read - is yes: a page then says what it always
 * said, and the server still refuses what it must.
 *
 * Pure, with no Node or browser APIs.
 */

export const PROJECT_CAN_SEND_API_PATH: string = "/project-can-send";

export interface ProjectCanSendAnswer {
  email: boolean;
  sms: boolean;
  call: boolean;
}

export const PROJECT_CAN_SEND_EVERYTHING: Readonly<ProjectCanSendAnswer> = {
  email: true,
  sms: true,
  call: true,
};

export default class ProjectCanSend {
  // The answer read in a browser: only a plain false is no.
  public static parse(value: unknown): ProjectCanSendAnswer {
    const row: Record<string, unknown> =
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};

    return {
      email: row["email"] !== false,
      sms: row["sms"] !== false,
      call: row["call"] !== false,
    };
  }
}
