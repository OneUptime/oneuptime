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

  describe("isRecordingPermitted", (): void => {
    it("honours the signal by default, which is what doing nothing gets you", (): void => {
      const dnt: Navigator = navigatorWith({ doNotTrack: "1" });

      /*
       * Omitting data-oneuptime-respect-do-not-track leaves the page side
       * true, so the overwhelmingly common case still refuses to record.
       */
      expect(Consent.isRecordingPermitted(true, true, dnt)).toBe(false);
    });

    /*
     * The page decides; the server value is the default it starts from.
     *
     * "Either side insisting wins" sounds safer but made the documented
     * data-oneuptime-respect-do-not-track="false" attribute dead config: the
     * server always sends true, so the attribute could never take effect and
     * a customer whose lawful basis does not depend on DNT had no way to
     * record at all - silently, with nothing to debug from the page.
     */
    it("lets the page explicitly opt out on its own site", (): void => {
      expect(
        Consent.isRecordingPermitted(
          false,
          true,
          navigatorWith({ doNotTrack: "1" }),
        ),
      ).toBe(true);
    });

    it("records when the deployment itself does not honour the signal", (): void => {
      expect(
        Consent.isRecordingPermitted(
          true,
          false,
          navigatorWith({ doNotTrack: "1" }),
        ),
      ).toBe(true);
    });

    it("records when neither side asks to honour it", (): void => {
      expect(
        Consent.isRecordingPermitted(
          false,
          false,
          navigatorWith({ doNotTrack: "1" }),
        ),
      ).toBe(true);
    });

    it("records normally when there is no signal", (): void => {
      expect(Consent.isRecordingPermitted(true, true, navigatorWith({}))).toBe(
        true,
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
     * A revoke is final for the page. Re-granting would let a page that
     * mishandles its own banner state resume uploading data the user refused.
     */
    it("cannot be re-granted after a revoke", (): void => {
      const consent: Consent = new Consent(
        SessionReplayConsentMode.RequireExplicit,
      );

      consent.grant();
      consent.revoke();
      consent.grant();

      expect(consent.isUploadAllowed()).toBe(false);
      expect(consent.isRevoked()).toBe(true);
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

    it("still stops uploading after a revoke", (): void => {
      const consent: Consent = new Consent(
        SessionReplayConsentMode.NotRequired,
      );

      consent.revoke();

      expect(consent.isUploadAllowed()).toBe(false);
    });
  });
});
