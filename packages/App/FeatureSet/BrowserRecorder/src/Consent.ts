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
 *
 * A revoke is NOT the end of the page. Consent-management platforms fire
 * reject-then-accept inside one page life all the time (a preference
 * centre, a banner re-opened from the footer), and a recorder that treated
 * the first revoke as final left every one of those users unrecorded until a
 * reload, with nothing on the page to say why. What a revoke guarantees is
 * narrower and stronger: everything held or queued under the withdrawn
 * consent is dropped, the session identity is forgotten, and nothing is
 * uploaded until a NEW grant arrives - at which point recording covers only
 * what happens after it, under a fresh session id.
 */

/*
 * What the page said on its script tag about honouring Do Not Track / GPC.
 *
 *   true       "honour the signal" - an explicit promise made in markup
 *   false      "do not honour it" - the customer owns the lawful basis for
 *              their own site and has said the signal is not it
 *   undefined  nothing said; the server policy decides
 *
 * Config collapses omitted and explicit true into the same boolean, which is
 * why the recorder could not tell a page that PROMISED from one that said
 * nothing, and let a dashboard policy of false record users the page had
 * promised not to. Callers pass the raw optional value.
 */
export type PageDoNotTrackPreference = boolean | undefined;

export default class Consent {
  private mode: SessionReplayConsentMode;
  private granted: boolean = false;
  private revoked: boolean = false;

  /*
   * How many times consent has been withdrawn on this page. A grant after a
   * revoke starts a new consent epoch; the recorder uses the change to know
   * that a fresh session identity is owed.
   */
  private revocationCount: number = 0;

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
   * ONE rule, stated once, that Loader.ts, Index.ts and the install docs all
   * defer to:
   *
   *   1. An explicit page value wins. `data-oneuptime-respect-do-not-track`
   *      set to "true" honours the signal whatever the dashboard policy says
   *      (a privacy promise made in the customer's own markup is theirs to
   *      keep, and an admin flipping a project setting must not break it);
   *      set to "false" it records regardless of the signal (the customer
   *      owns the lawful basis for their site, and without this the
   *      attribute was dead config because the server always sends true).
   *   2. With no page value, the server policy decides.
   *   3. Nobody asking to honour the signal means recording proceeds.
   *
   * The previous shape - page false wins, then policy false wins, then the
   * signal - let a false policy override a page that had explicitly said
   * true, and its comments described the precedence three different ways.
   */
  public static isRecordingPermitted(
    pageRespectsDoNotTrack: PageDoNotTrackPreference,
    policyRespectsDoNotTrack: boolean,
    navigatorRef: Navigator = navigator,
  ): boolean {
    const honourSignal: boolean =
      pageRespectsDoNotTrack !== undefined
        ? pageRespectsDoNotTrack
        : policyRespectsDoNotTrack;

    if (!honourSignal) {
      return true;
    }

    return !Consent.hasPrivacySignal(navigatorRef);
  }

  public getMode(): SessionReplayConsentMode {
    return this.mode;
  }

  /*
   * Consent given. Also the way back after a revoke: the revoke already
   * dropped everything held under the earlier consent, so a later grant
   * covers only what is recorded from here on, under a new session.
   */
  public grant(): void {
    this.revoked = false;
    this.granted = true;
  }

  public revoke(): void {
    if (!this.revoked) {
      this.revocationCount++;
    }

    this.revoked = true;
    this.granted = false;
  }

  public isRevoked(): boolean {
    return this.revoked;
  }

  public getRevocationCount(): number {
    return this.revocationCount;
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
   * something truthful to act on. A revoked NotRequired page reports Unknown
   * rather than NotRequired: nothing is uploaded while revoked, and the one
   * way a chunk could still carry this value is a bug, in which case the
   * worker's fail-closed branch is the right reader.
   */
  public getState(): SessionReplayConsentState {
    if (this.revoked) {
      return "Unknown";
    }

    if (this.mode === SessionReplayConsentMode.NotRequired) {
      return "NotRequired";
    }

    return this.granted ? "Granted" : "Unknown";
  }
}
