import SessionReplayConsentMode from "Common/Types/Rum/SessionReplayConsentMode";
import Consent from "../src/Consent";

describe("Consent", (): void => {
  const navigatorWith: (props: Record<string, unknown>) => Navigator = (
    props: Record<string, unknown>,
  ): Navigator => {
    return props as unknown as Navigator;
  };

  describe("hasPrivacySignal", (): void => {
    it("honours Global Privacy Control", (): void => {
      expect(
        Consent.hasPrivacySignal(navigatorWith({ globalPrivacyControl: true })),
      ).toBe(true);
    });

    it('honours the legacy doNotTrack "1"', (): void => {
      expect(Consent.hasPrivacySignal(navigatorWith({ doNotTrack: "1" }))).toBe(
        true,
      );
    });

    it('ignores doNotTrack "0" and "unspecified"', (): void => {
      expect(Consent.hasPrivacySignal(navigatorWith({ doNotTrack: "0" }))).toBe(
        false,
      );
      expect(
        Consent.hasPrivacySignal(navigatorWith({ doNotTrack: "unspecified" })),
      ).toBe(false);
    });

    it("treats an absent signal as no signal", (): void => {
      expect(Consent.hasPrivacySignal(navigatorWith({}))).toBe(false);
    });
  });

  /*
   * One rule: an explicit page value wins, otherwise the server policy
   * decides, and nobody asking to honour the signal means recording proceeds.
   *
   * The old shape ("page false wins, then policy false wins, then the
   * signal") let a dashboard policy of false record users the page had
   * PROMISED not to record with data-oneuptime-respect-do-not-track="true",
   * and could not tell that promise from a page that said nothing, because
   * Config collapsed both into the same boolean.
   */
  describe("isRecordingPermitted", (): void => {
    const dnt: Navigator = navigatorWith({ doNotTrack: "1" });
    const quiet: Navigator = navigatorWith({});

    it("honours the signal when the page says nothing and the policy says honour it", (): void => {
      expect(Consent.isRecordingPermitted(undefined, true, dnt)).toBe(false);
    });

    it("lets the policy decide when the page says nothing", (): void => {
      expect(Consent.isRecordingPermitted(undefined, false, dnt)).toBe(true);
    });

    /*
     * The page PROMISED. An admin flipping the project policy must not
     * break a promise the customer made in their own markup.
     */
    it("keeps an explicit page promise even when the policy would not honour the signal", (): void => {
      expect(Consent.isRecordingPermitted(true, false, dnt)).toBe(false);
      expect(Consent.isRecordingPermitted(true, true, dnt)).toBe(false);
    });

    /*
     * The customer owns the lawful basis for their own site, so an explicit
     * opt-out on their script tag is theirs to make. Without this the
     * documented attribute was dead config: the server always sends true.
     */
    it("lets the page explicitly opt out on its own site", (): void => {
      expect(Consent.isRecordingPermitted(false, true, dnt)).toBe(true);
      expect(Consent.isRecordingPermitted(false, false, dnt)).toBe(true);
    });

    it("records normally when there is no signal, whatever anyone asked", (): void => {
      expect(Consent.isRecordingPermitted(undefined, true, quiet)).toBe(true);
      expect(Consent.isRecordingPermitted(true, true, quiet)).toBe(true);
      expect(Consent.isRecordingPermitted(false, false, quiet)).toBe(true);
    });

    /*
     * Pinned because Config still collapses "omitted" into true for the
     * callers that have not moved to the tri-state yet: a page that passes
     * true when it meant "nothing said" errs toward honouring the signal,
     * never toward recording.
     */
    it("treats a boolean true exactly like the explicit page promise", (): void => {
      expect(Consent.isRecordingPermitted(true, false, dnt)).toBe(
        Consent.isRecordingPermitted(true, true, dnt),
      );
    });
  });

  describe("RequireExplicit", (): void => {
    it("blocks upload until consent is granted", (): void => {
      const consent: Consent = new Consent(
        SessionReplayConsentMode.RequireExplicit,
      );

      expect(consent.isUploadAllowed()).toBe(false);
      expect(consent.getState()).toBe("Unknown");

      consent.grant();

      expect(consent.isUploadAllowed()).toBe(true);
      expect(consent.getState()).toBe("Granted");
    });

    /*
     * A revoke is not the end of the page. Consent-management platforms fire
     * reject-then-accept inside one page life routinely (a preference
     * centre), and treating the first revoke as final left those users
     * unrecorded until a reload with nothing on the page to say why. The
     * revoke's real guarantee - everything held under the old consent is
     * gone - is the recorder's to keep, and it keeps it by dropping the
     * buffer, the queue and the session identity at revoke time.
     */
    it("can be re-granted after a revoke, as a new consent epoch", (): void => {
      const consent: Consent = new Consent(
        SessionReplayConsentMode.RequireExplicit,
      );

      consent.grant();
      consent.revoke();

      expect(consent.isUploadAllowed()).toBe(false);
      expect(consent.isRevoked()).toBe(true);
      expect(consent.getState()).toBe("Unknown");
      expect(consent.getRevocationCount()).toBe(1);

      consent.grant();

      expect(consent.isUploadAllowed()).toBe(true);
      expect(consent.isRevoked()).toBe(false);
      expect(consent.getState()).toBe("Granted");
    });

    it("counts each withdrawal once, however many times revoke is called", (): void => {
      const consent: Consent = new Consent(
        SessionReplayConsentMode.RequireExplicit,
      );

      consent.revoke();
      consent.revoke();

      expect(consent.getRevocationCount()).toBe(1);

      consent.grant();
      consent.revoke();

      expect(consent.getRevocationCount()).toBe(2);
    });
  });

  describe("NotRequired", (): void => {
    it("allows upload immediately and reports NotRequired", (): void => {
      const consent: Consent = new Consent(
        SessionReplayConsentMode.NotRequired,
      );

      expect(consent.isUploadAllowed()).toBe(true);
      expect(consent.getState()).toBe("NotRequired");
    });

    it("still stops uploading after a revoke, and says so on the envelope", (): void => {
      const consent: Consent = new Consent(
        SessionReplayConsentMode.NotRequired,
      );

      consent.revoke();

      expect(consent.isUploadAllowed()).toBe(false);
      /* Never NotRequired while revoked: the worker fails closed on Unknown. */
      expect(consent.getState()).toBe("Unknown");

      consent.grant();

      expect(consent.isUploadAllowed()).toBe(true);
      expect(consent.getState()).toBe("NotRequired");
    });
  });
});
