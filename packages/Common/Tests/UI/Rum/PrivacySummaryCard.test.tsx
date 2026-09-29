import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import * as React from "react";
import { describe, expect, it } from "@jest/globals";
import PrivacySummaryCard, {
  PrivacySummarySentence,
  buildPrivacySummary,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/PrivacySummaryCard";

/*
 * Five sentences that say what a recording contains for the person being
 * recorded, one per masking / identity / location / retention / consent
 * choice, each with a "Change" link; a field that was never set reads as
 * the default it actually is. A sixth ("backend-link") joins them while
 * same-origin trace propagation is on, which is the default.
 */

function sentence(
  sentences: Array<PrivacySummarySentence>,
  key: string,
): PrivacySummarySentence {
  const found: PrivacySummarySentence | undefined = sentences.find(
    (entry: PrivacySummarySentence): boolean => {
      return entry.key === key;
    },
  );

  expect(found).toBeDefined();

  return found as PrivacySummarySentence;
}

function keysOf(sentences: Array<PrivacySummarySentence>): Array<string> {
  return sentences.map((entry: PrivacySummarySentence): string => {
    return entry.key;
  });
}

describe("buildPrivacySummary", () => {
  it("produces six sentences in the reviewer's order while same-origin trace propagation is on (the default)", () => {
    expect(keysOf(buildPrivacySummary({}))).toEqual([
      "page-text",
      "identity",
      "backend-link",
      "location",
      "retention",
      "consent",
    ]);
    expect(
      keysOf(buildPrivacySummary({ sameOriginTracePropagation: true })),
    ).toEqual([
      "page-text",
      "identity",
      "backend-link",
      "location",
      "retention",
      "consent",
    ]);
  });

  it("produces exactly the five sentences when same-origin trace propagation is off", () => {
    expect(
      keysOf(buildPrivacySummary({ sameOriginTracePropagation: false })),
    ).toEqual(["page-text", "identity", "location", "retention", "consent"]);
  });

  it("an empty policy reads as the model defaults and marks every sentence default", () => {
    const sentences: Array<PrivacySummarySentence> = buildPrivacySummary({});

    for (const entry of sentences) {
      expect(entry.isDefault).toBe(true);
    }

    expect(sentence(sentences, "page-text").text).toContain(
      "Readable page text and most input values are recorded",
    );
    expect(sentence(sentences, "identity").text).toContain(
      "Recordings are identified",
    );
    expect(sentence(sentences, "location").text).toContain(
      "Only a country code is stored",
    );
    expect(sentence(sentences, "retention").text).toContain(
      "deleted after 7 days",
    );
    expect(sentence(sentences, "consent").text).toContain(
      "does not wait for consent",
    );
  });

  it("masking modes: wireframe, inputs-only, sensitive-only, with the selector and canvas extras", () => {
    expect(
      sentence(buildPrivacySummary({ maskingMode: "MaskAllText" }), "page-text")
        .text,
    ).toContain("the replay is a wireframe");
    expect(
      sentence(buildPrivacySummary({ maskingMode: "MaskAllText" }), "page-text")
        .isSensitive,
    ).toBe(false);

    const inputsOnly: PrivacySummarySentence = sentence(
      buildPrivacySummary({
        maskingMode: "MaskInputsOnly",
        maskSelectors: [".customer-name", " "],
        blockSelectors: ["iframe.payment", ".id-document"],
        recordCanvas: true,
      }),
      "page-text",
    );

    expect(inputsOnly.text).toContain("every input value is masked");
    expect(inputsOnly.text).toContain("1 extra selector masked");
    expect(inputsOnly.text).toContain("2 selectors blocked entirely");
    expect(inputsOnly.text).toContain("canvas contents recorded");
    expect(inputsOnly.isSensitive).toBe(true);
    expect(inputsOnly.isDefault).toBe(false);

    expect(
      sentence(
        buildPrivacySummary({ maskingMode: "MaskSensitiveInputsOnly" }),
        "page-text",
      ).text,
    ).toContain("least private mode");
  });

  /*
   * Same-origin trace propagation puts the session id on the page's own
   * requests. The sentence says where it goes (the backend and every
   * service it calls) and what that means (backend telemetry naming the
   * user leads to the recording), and is flagged for a second look.
   */
  it("backend link on reads as the session id reaching the backend and beyond, and is flagged", () => {
    const on: PrivacySummarySentence = sentence(
      buildPrivacySummary({ sameOriginTracePropagation: true }),
      "backend-link",
    );

    expect(on.text).toContain(
      "Same-origin requests carry this session's id to your backend",
    );
    expect(on.text).toContain("forwards it to the services it calls");
    expect(on.text).toContain("third parties included");
    expect(on.text).toContain(
      "Backend telemetry that names the user links to the recording",
    );
    expect(on.text).toContain("The visitor id is never sent");
    expect(on.isSensitive).toBe(true);
    expect(on.isDefault).toBe(false);
    expect(on.changeLabel).toBe("Change trace propagation");
  });

  it("a never-set switch reads as the on default and says so", () => {
    for (const value of [undefined, null]) {
      const backendLink: PrivacySummarySentence = sentence(
        buildPrivacySummary({ sameOriginTracePropagation: value }),
        "backend-link",
      );

      expect(backendLink.isDefault).toBe(true);
      expect(backendLink.isSensitive).toBe(true);
    }
  });

  /*
   * With identity capture off the recording stores no user reference, but
   * a linked backend span or log that names the user still leads to it, so
   * "cannot be found by who the person was" would overpromise.
   */
  it("identity off with the backend link on does not promise the session cannot be found by who the person was", () => {
    const identity: PrivacySummarySentence = sentence(
      buildPrivacySummary({
        captureUserIdentity: false,
        sameOriginTracePropagation: true,
      }),
      "identity",
    );

    expect(identity.text).toContain("pseudonymous");
    expect(identity.text).toContain(
      "Backend telemetry linked to it by same-origin trace propagation can still name the person",
    );
    expect(identity.text).not.toContain(
      "cannot be found by who the person was",
    );
    expect(identity.isSensitive).toBe(false);

    /* The never-set switch is the on default, so the caveat applies there too. */
    expect(
      sentence(buildPrivacySummary({ captureUserIdentity: false }), "identity")
        .text,
    ).toContain("can still name the person");
  });

  it("identity off with the backend link off keeps the full pseudonymity promise", () => {
    const identity: PrivacySummarySentence = sentence(
      buildPrivacySummary({
        captureUserIdentity: false,
        sameOriginTracePropagation: false,
      }),
      "identity",
    );

    expect(identity.text).toContain(
      "so a session cannot be found by who the person was",
    );
    expect(identity.text).not.toContain("Backend telemetry");
  });

  it("identity on is unchanged by the backend link", () => {
    for (const value of [true, false]) {
      expect(
        sentence(
          buildPrivacySummary({
            captureUserIdentity: true,
            sameOriginTracePropagation: value,
          }),
          "identity",
        ).text,
      ).toContain("Recordings are identified");
    }
  });

  it("identity off reads as pseudonymous and is not flagged", () => {
    const off: PrivacySummarySentence = sentence(
      buildPrivacySummary({ captureUserIdentity: false }),
      "identity",
    );

    expect(off.text).toContain("pseudonymous");
    expect(off.isSensitive).toBe(false);
    expect(off.isDefault).toBe(false);
  });

  it("location off still promises no IP is stored", () => {
    const off: PrivacySummarySentence = sentence(
      buildPrivacySummary({ captureGeo: false }),
      "location",
    );

    expect(off.text).toContain("No location is stored");
    expect(off.text).toContain("IP address is never stored");
  });

  it("retention quotes the days and flags long retention", () => {
    expect(
      sentence(buildPrivacySummary({ retentionInDays: 1 }), "retention").text,
    ).toContain("deleted after 1 day");
    expect(
      sentence(buildPrivacySummary({ retentionInDays: 90 }), "retention")
        .isSensitive,
    ).toBe(true);
    expect(
      sentence(buildPrivacySummary({ retentionInDays: 7 }), "retention")
        .isSensitive,
    ).toBe(false);
  });

  /*
   * ux-09. RumSession derives retentionDate from the clamped session START so
   * a session expires atomically - "keeps the header's retentionDate equal to
   * its chunks'". The sentence a data-protection reviewer reads therefore may
   * not promise that URLs, counts and the identity label outlive the footage;
   * they are on the row that goes with it.
   */
  it("retention says the session row expires WITH the footage, never that metadata is kept longer", () => {
    const retention: PrivacySummarySentence = sentence(
      buildPrivacySummary({ retentionInDays: 7 }),
      "retention",
    );

    expect(retention.text).toContain("expires with it");
    expect(retention.text).toContain(
      "only the session's logs, spans and exceptions follow the telemetry retention",
    );
    expect(retention.text).not.toContain("kept longer");
    expect(retention.text).not.toContain("stays accurate after playback");
  });

  it("consent modes: explicit is gated and calm, not-required is asserted and flagged", () => {
    const explicit: PrivacySummarySentence = sentence(
      buildPrivacySummary({ consentMode: "RequireExplicit" }),
      "consent",
    );

    expect(explicit.text).toContain("OneUptimeReplay.grantConsent()");
    expect(explicit.isSensitive).toBe(false);

    const notRequired: PrivacySummarySentence = sentence(
      buildPrivacySummary({ consentMode: "NotRequired" }),
      "consent",
    );

    expect(notRequired.text).toContain("lawful basis");
    expect(notRequired.isSensitive).toBe(true);
    expect(notRequired.isDefault).toBe(false);
  });

  it("an unrecognised value is named rather than mapped to a guess", () => {
    expect(
      sentence(buildPrivacySummary({ maskingMode: "Future" }), "page-text")
        .text,
    ).toContain('"Future" is not one this dashboard knows');
    expect(
      sentence(buildPrivacySummary({ consentMode: "Future" }), "consent").text,
    ).toContain('"Future" is not one this dashboard knows');
  });
});

describe("PrivacySummaryCard", () => {
  it("renders the backend-link row with its Change link while same-origin trace propagation is on", () => {
    render(
      <PrivacySummaryCard
        policy={{ sameOriginTracePropagation: true }}
        changeHref="#replay-policy"
      />,
    );

    expect(
      screen.getByTestId("privacy-summary-backend-link"),
    ).toHaveTextContent(
      "Same-origin requests carry this session's id to your backend",
    );
    expect(screen.getByTestId("privacy-summary-backend-link")).toHaveAttribute(
      "data-default",
      "false",
    );
    expect(
      screen.getByTestId("privacy-summary-change-backend-link"),
    ).toHaveAttribute("href", "#replay-policy");
    expect(
      screen.getByTestId("privacy-summary-change-backend-link"),
    ).toHaveTextContent("Change trace propagation");
  });

  it("renders no backend-link row when same-origin trace propagation is off", () => {
    render(
      <PrivacySummaryCard
        policy={{
          sameOriginTracePropagation: false,
          captureUserIdentity: false,
        }}
        changeHref="#replay-policy"
      />,
    );

    expect(screen.queryByTestId("privacy-summary-backend-link")).toBeNull();
    expect(screen.getByTestId("privacy-summary-identity")).toHaveTextContent(
      "cannot be found by who the person was",
    );
  });

  it("renders five rows, each with a Change link to the policy anchor, and marks defaults", () => {
    render(
      <PrivacySummaryCard
        policy={{
          maskingMode: "MaskAllText",
          consentMode: "RequireExplicit",
          captureUserIdentity: false,
          captureGeo: true,
          retentionInDays: 7,
        }}
        changeHref="#replay-policy"
      />,
    );

    for (const key of [
      "page-text",
      "identity",
      "location",
      "retention",
      "consent",
    ]) {
      expect(screen.getByTestId(`privacy-summary-${key}`)).toBeInTheDocument();
      expect(
        screen.getByTestId(`privacy-summary-change-${key}`),
      ).toHaveAttribute("href", "#replay-policy");
    }

    expect(screen.getByTestId("privacy-summary-page-text")).toHaveTextContent(
      "wireframe",
    );
    expect(screen.getByTestId("privacy-summary-page-text")).toHaveAttribute(
      "data-default",
      "false",
    );
    expect(screen.getByTestId("privacy-summary-identity")).toHaveTextContent(
      "pseudonymous",
    );
    expect(
      screen.getByTestId("privacy-summary-change-consent"),
    ).toHaveTextContent("Change consent");
  });

  it("with no policy yet it says it is reading, not that the defaults apply", () => {
    render(<PrivacySummaryCard policy={null} changeHref="#replay-policy" />);

    expect(screen.getByTestId("privacy-summary-loading")).toHaveTextContent(
      "Reading the policy",
    );
    expect(screen.queryByTestId("privacy-summary-page-text")).toBeNull();
  });

  it("a never-set field carries the default marker", () => {
    render(
      <PrivacySummaryCard policy={{ maskingMode: null }} changeHref="#x" />,
    );

    expect(screen.getByTestId("privacy-summary-page-text")).toHaveAttribute(
      "data-default",
      "true",
    );
    expect(screen.getByTestId("privacy-summary-page-text")).toHaveTextContent(
      "default; never set for this application",
    );
  });
});
