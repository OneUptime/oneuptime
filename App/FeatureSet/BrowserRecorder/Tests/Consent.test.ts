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
    it("refuses to record when either side honours the signal", (): void => {
      const dnt: Navigator = navigatorWith({ doNotTrack: "1" });

      expect(Consent.isRecordingPermitted(true, true, dnt)).toBe(false);
      expect(Consent.isRecordingPermitted(true, false, dnt)).toBe(false);
      expect(Consent.isRecordingPermitted(false, true, dnt)).toBe(false);
    });

    /*
     * Only BOTH sides agreeing can turn honouring off. A page-level override
     * alone must not be able to defeat a server policy that insists.
     */
    it("records only when both sides opt out of honouring the signal", (): void => {
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
