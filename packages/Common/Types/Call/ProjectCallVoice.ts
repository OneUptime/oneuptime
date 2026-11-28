import {
  CALL_VOICES,
  CallVoice,
  getCallVoice,
  getCallVoiceCentsOfAPage,
  toCallVoiceValue,
} from "./CallVoice";

/*
 * A PROJECT'S OWN CALL VOICE, THROUGH THE SERVER'S TWILIO ACCOUNT (#11065).
 *
 * A project with a Twilio config of its own chooses the voice its calls
 * speak with on that config (ProjectCallSMSConfig.twilioCallVoice, #10948),
 * and pays Twilio for it. A project that calls through the server's own
 * account speaks with the server's voice - the one GLOBAL_TWILIO_CALL_VOICE
 * sets, or the one chosen in Admin Dashboard > Settings > Call and SMS -
 * unless the server lets projects choose (GlobalConfig.
 * letProjectsChooseCallVoice): the project's voice (Project.callVoice) is
 * then the one its calls speak with, and its calls to people who read
 * another language speak it in that language's voice of the same kind.
 *
 * Twilio charges the account that places a call for these voices, so a
 * project's voice is paid for by whoever owns the server's account. That is
 * why the server's master admin decides, with a switch that starts off: no
 * project raises the owner's bill until the owner lets it, and turning the
 * switch off again puts every project back on the server's voice at once,
 * whatever voices they had chosen. The voices all cost the same
 * (CallVoice.getCallVoiceCentsOfAPage), so the switch is the one consent
 * there is to give.
 *
 * On OneUptime Cloud the server's account is OneUptime's, which projects pay
 * for at one price per minute, so projects never choose a voice through it:
 * the switch is refused and a stored voice is never read. A project there
 * chooses its voice with a Twilio config of its own.
 */

// Said when a project's voice is written while the server does not let projects choose one.
export const PROJECT_CALL_VOICE_NOT_OFFERED_MESSAGE: string =
  "This server does not let projects choose the voice of their calls through its Twilio account, so they speak with the server's voice. A master admin can let projects choose in Admin Dashboard > Settings > Call and SMS. A Twilio config of the project's own has a voice of its own.";

// Said on OneUptime Cloud, where projects never choose a voice through OneUptime's account.
export const PROJECT_CALL_VOICE_NOT_ON_CLOUD_MESSAGE: string =
  "On OneUptime Cloud, calls through OneUptime's Twilio account speak with OneUptime's voice. To choose the voice of your project's calls, add a Twilio config of your own in Project Settings > Notifications > Notification Channels, and choose its call voice.";

// Said when the switch is turned on on OneUptime Cloud.
export const PROJECT_CALL_VOICES_NOT_ON_CLOUD_MESSAGE: string =
  "Projects cannot choose the voice of their calls through OneUptime Cloud's Twilio account: OneUptime pays for it. A project chooses its voice with a Twilio config of its own.";

export default class ProjectCallVoice {
  /*
   * Whether projects choose the voice of their calls through the server's
   * own account: only when its master admin let them, and never on
   * OneUptime Cloud. Anything but true is no.
   */
  public static areOffered(data: {
    isBillingEnabled: boolean;
    letProjectsChooseCallVoice: unknown;
  }): boolean {
    return !data.isBillingEnabled && data.letProjectsChooseCallVoice === true;
  }

  /*
   * The voice a project's call speaks with through the server's own
   * account: the project's, while projects are offered a voice and it
   * chose one of OneUptime's; else the server's; else none - the account's
   * default voice. A value the list does not hold is no voice, as a call
   * takes it.
   */
  public static getVoiceOnServerAccount(data: {
    serverVoice: unknown;
    projectVoice: unknown;
    areOffered: boolean;
  }): string | undefined {
    if (data.areOffered) {
      const projectVoice: string | undefined = toCallVoiceValue(
        data.projectVoice,
      );

      if (projectVoice) {
        return projectVoice;
      }
    }

    return toCallVoiceValue(data.serverVoice);
  }

  /*
   * Why a project's voice cannot be written, or null when it can: no voice
   * - left out, null or empty, the server's voice - always can; a voice
   * only while projects are offered one.
   */
  public static getWriteError(data: {
    value: unknown;
    isBillingEnabled: boolean;
    letProjectsChooseCallVoice: unknown;
  }): string | null {
    if (!getCallVoice(data.value)) {
      return null;
    }

    if (data.isBillingEnabled) {
      return PROJECT_CALL_VOICE_NOT_ON_CLOUD_MESSAGE;
    }

    if (data.letProjectsChooseCallVoice !== true) {
      return PROJECT_CALL_VOICE_NOT_OFFERED_MESSAGE;
    }

    return null;
  }

  /*
   * The most a page's call costs the server's account in the voice a
   * project may choose, in whole US cents, as the Admin Dashboard's switch
   * says it: the dearest of the voices, in any language.
   */
  public static getMostCentsOfAPage(): number {
    return Math.max(
      0,
      ...CALL_VOICES.map((voice: CallVoice): number => {
        return getCallVoiceCentsOfAPage(voice);
      }),
    );
  }
}
