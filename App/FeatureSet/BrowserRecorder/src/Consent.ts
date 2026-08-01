import { SessionReplayConsentState } from "Common/Types/Rum/SessionReplay";
import SessionReplayConsentMode from "Common/Types/Rum/SessionReplayConsentMode";

/*
 * Consent and the browser privacy signals.
 *
 * Two separate mechanisms that both gate UPLOAD rather than recording:
 *
 *  - DNT / GPC are checked before rrweb is even loaded. If the end user
 *    has asked not to be tracked, nothing is recorded at all, so there is
 *    no buffer to leak.
 *  - Consent gates upload only. In RequireExplicit the recorder still
 *    fills its rolling ring buffer while a cookie banner is on screen,
 *    because the seconds leading up to an error are exactly the seconds a
 *    banner is usually covering. revokeConsent() drops that buffer.
 */

export default class Consent {
  private mode: SessionReplayConsentMode;
  private granted: boolean = false;
  private revoked: boolean = false;

  public constructor(mode: SessionReplayConsentMode) {
    this.mode = mode;
  }

  /*
   * Has the end user asked not to be tracked?
   *
   * navigator.doNotTrack is the legacy signal (a string "1"), and
   * navigator.globalPrivacyControl is the current one (a boolean). Neither
   * is in lib.dom's Navigator for GPC, so both are read through an index
   * signature rather than by augmenting a global interface a third-party
   * bundle has no business augmenting.
   */
  public static hasPrivacySignal(navigatorRef: Navigator = navigator): boolean {
    const record: Record<string, unknown> = navigatorRef as unknown as Record<
      string,
      unknown
    >;

    if (record["globalPrivacyControl"] === true) {
      return true;
    }

    const doNotTrack: unknown = record["doNotTrack"];

    if (doNotTrack === "1" || doNotTrack === 1 || doNotTrack === true) {
      return true;
    }

    return false;
  }

  /*
   * Should the recorder run at all?
   *
   * respectDoNotTrack is the AND of the page-supplied option and the
   * server policy: either side may insist on honouring the signal, and
   * only both sides agreeing can turn it off.
   */
  public static isRecordingPermitted(
    pageRespectsDoNotTrack: boolean,
    policyRespectsDoNotTrack: boolean,
    navigatorRef: Navigator = navigator,
  ): boolean {
    /*
     * The PAGE decides, and the server's value is the default it starts from.
     *
     * This used to be "either side insisting wins", which sounds safer but
     * made data-oneuptime-respect-do-not-track="false" dead config: the server
     * always sends true, so the attribute could never take effect and a
     * customer with a lawful basis that does not depend on DNT had no way to
     * record at all. Silent, undocumented, and impossible to debug from the
     * page - which is exactly how it was found.
     *
     * The customer owns the lawful basis for their own site, so an explicit
     * opt-out on their own script tag is theirs to make. Omitting the
     * attribute leaves pageRespectsDoNotTrack true, so the default for
     * everyone who does nothing is still to honour the signal.
     */
    if (!pageRespectsDoNotTrack) {
      return true;
    }

    if (!policyRespectsDoNotTrack) {
      return true;
    }

    return !Consent.hasPrivacySignal(navigatorRef);
  }

  public getMode(): SessionReplayConsentMode {
    return this.mode;
  }

  public grant(): void {
    /*
     * A revoke is final for the life of the page. Re-granting after a
     * revoke would let a page that mishandles its own banner state resume
     * uploading data the user just refused.
     */
    if (this.revoked) {
      return;
    }

    this.granted = true;
  }

  public revoke(): void {
    this.revoked = true;
    this.granted = false;
  }

  public isRevoked(): boolean {
    return this.revoked;
  }

  /* May the recorder POST anything right now? */
  public isUploadAllowed(): boolean {
    if (this.revoked) {
      return false;
    }

    if (this.mode === SessionReplayConsentMode.NotRequired) {
      return true;
    }

    return this.granted;
  }

  /*
   * Value stamped on the envelope. Never "Granted" unless a grant actually
   * happened, so the ingest worker's own fail-closed check on Unknown has
   * something truthful to act on.
   */
  public getState(): SessionReplayConsentState {
    if (this.mode === SessionReplayConsentMode.NotRequired) {
      return "NotRequired";
    }

    return this.granted ? "Granted" : "Unknown";
  }
}
