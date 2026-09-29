import MeasurementDefinitionValidator from "../../../../Server/Utils/Measurement/MeasurementDefinitionValidator";
import MeasurementOccurrence from "../../../../Types/Measurement/MeasurementOccurrence";
import BadDataException from "../../../../Types/Exception/BadDataException";

const STATE_ENTERED: string = "State Entered";
const STATE_ROLE_ENTERED: string = "State Role Entered";
const DECLARED_AT: string = "Declared At";
const IMPACT_STARTED_AT: string = "Impact Started At";

function anchorPair(
  overrides: Partial<
    Parameters<typeof MeasurementDefinitionValidator.validateAnchorPair>[0]
  > = {},
): Parameters<typeof MeasurementDefinitionValidator.validateAnchorPair>[0] {
  return {
    startAnchorType: IMPACT_STARTED_AT,
    endAnchorType: DECLARED_AT,
    stateEnteredAnchor: STATE_ENTERED,
    stateRoleEnteredAnchor: STATE_ROLE_ENTERED,
    ...overrides,
  };
}

describe("MeasurementDefinitionValidator", () => {
  describe("validateKey", () => {
    test.each(["time-to-detect", "t", "9lives", "a-b-c-d-e-f", "a".repeat(50)])(
      "accepts %s",
      (key: string) => {
        expect(() => {
          return MeasurementDefinitionValidator.validateKey(key);
        }).not.toThrow();
      },
    );

    test.each([
      ["", "empty"],
      ["Time-To-Detect", "uppercase"],
      ["time to detect", "spaces"],
      ["time_to_detect", "underscores"],
      ["-leading-hyphen", "leading hyphen"],
      ["time.to.detect", "dots"],
      ["a".repeat(51), "too long"],
      ["времени", "non-ascii"],
    ])("rejects %s (%s)", (key: string) => {
      expect(() => {
        return MeasurementDefinitionValidator.validateKey(key);
      }).toThrow(BadDataException);
    });

    test("rejects an absent key", () => {
      expect(() => {
        return MeasurementDefinitionValidator.validateKey(undefined);
      }).toThrow(BadDataException);
    });

    test("the rejection message shows a usable example", () => {
      expect(() => {
        return MeasurementDefinitionValidator.validateKey("Time To Detect");
      }).toThrow(/time-to-detect/);
    });
  });

  describe("validateAnchorPair — required companions", () => {
    test("a state-entered anchor needs a state", () => {
      expect(() => {
        return MeasurementDefinitionValidator.validateAnchorPair(
          anchorPair({ startAnchorType: STATE_ENTERED }),
        );
      }).toThrow(BadDataException);
    });

    test("a state-entered end anchor needs a state", () => {
      expect(() => {
        return MeasurementDefinitionValidator.validateAnchorPair(
          anchorPair({ endAnchorType: STATE_ENTERED }),
        );
      }).toThrow(BadDataException);
    });

    test("a state-role anchor needs a role", () => {
      expect(() => {
        return MeasurementDefinitionValidator.validateAnchorPair(
          anchorPair({ endAnchorType: STATE_ROLE_ENTERED }),
        );
      }).toThrow(BadDataException);
    });

    test("accepts a state-entered anchor once the state is supplied", () => {
      expect(() => {
        return MeasurementDefinitionValidator.validateAnchorPair(
          anchorPair({
            startAnchorType: STATE_ENTERED,
            startStateId: "state-1",
          }),
        );
      }).not.toThrow();
    });

    test("both ends are required", () => {
      expect(() => {
        return MeasurementDefinitionValidator.validateAnchorPair(
          anchorPair({ startAnchorType: undefined }),
        );
      }).toThrow(BadDataException);

      expect(() => {
        return MeasurementDefinitionValidator.validateAnchorPair(
          anchorPair({ endAnchorType: undefined }),
        );
      }).toThrow(BadDataException);
    });
  });

  describe("validateAnchorPair — definitions that would always be zero", () => {
    /*
     * These rejections are the point of the validator. A definition whose
     * two ends are the same point charts a flat zero on every entity, which
     * reads as "we do this instantly" rather than "this is not configured".
     */
    test("rejects two identical timestamp anchors", () => {
      expect(() => {
        return MeasurementDefinitionValidator.validateAnchorPair(
          anchorPair({
            startAnchorType: DECLARED_AT,
            endAnchorType: DECLARED_AT,
          }),
        );
      }).toThrow(/always be zero/);
    });

    test("rejects the same state at both ends with the same occurrence", () => {
      expect(() => {
        return MeasurementDefinitionValidator.validateAnchorPair(
          anchorPair({
            startAnchorType: STATE_ENTERED,
            endAnchorType: STATE_ENTERED,
            startStateId: "state-1",
            endStateId: "state-1",
          }),
        );
      }).toThrow(/always be zero/);
    });

    test("allows the same state at both ends when the occurrences differ", () => {
      /*
       * First-entered to last-entered of the same state is a real
       * measurement: how long a reopened incident spent away from it.
       */
      expect(() => {
        return MeasurementDefinitionValidator.validateAnchorPair(
          anchorPair({
            startAnchorType: STATE_ENTERED,
            endAnchorType: STATE_ENTERED,
            startStateId: "state-1",
            endStateId: "state-1",
            startOccurrence: MeasurementOccurrence.First,
            endOccurrence: MeasurementOccurrence.Last,
          }),
        );
      }).not.toThrow();
    });

    test("rejects the same role at both ends with the same occurrence", () => {
      expect(() => {
        return MeasurementDefinitionValidator.validateAnchorPair(
          anchorPair({
            startAnchorType: STATE_ROLE_ENTERED,
            endAnchorType: STATE_ROLE_ENTERED,
            startStateRole: "Resolved",
            endStateRole: "Resolved",
          }),
        );
      }).toThrow(/always be zero/);
    });

    test("allows two different states", () => {
      expect(() => {
        return MeasurementDefinitionValidator.validateAnchorPair(
          anchorPair({
            startAnchorType: STATE_ENTERED,
            endAnchorType: STATE_ENTERED,
            startStateId: "state-1",
            endStateId: "state-2",
          }),
        );
      }).not.toThrow();
    });

    test("allows two different timestamp anchors", () => {
      expect(() => {
        return MeasurementDefinitionValidator.validateAnchorPair(anchorPair());
      }).not.toThrow();
    });
  });

  describe("aliased timestamp anchors", () => {
    /*
     * Several anchor types read the same column -- an alert's "Timeline
     * Start" and "Created At" are both createdAt. Comparing enum values
     * alone waved these through, and the resulting measurement charted a
     * flat zero on every entity: the exact failure the zero-check exists to
     * prevent, wearing two different names.
     */
    const SOURCES: Record<string, string> = {
      "Timeline Start": "createdAt",
      "Created At": "createdAt",
      "Impact Started At": "impactStartedAt",
      "Declared At": "declaredAt",
    };

    test("rejects two anchor types that read the same column", () => {
      expect(() => {
        return MeasurementDefinitionValidator.validateAnchorPair(
          anchorPair({
            startAnchorType: "Created At",
            endAnchorType: "Timeline Start",
            timestampAnchorSources: SOURCES,
          }),
        );
      }).toThrow(/always be zero/);
    });

    test("rejects them in the other direction too", () => {
      expect(() => {
        return MeasurementDefinitionValidator.validateAnchorPair(
          anchorPair({
            startAnchorType: "Timeline Start",
            endAnchorType: "Created At",
            timestampAnchorSources: SOURCES,
          }),
        );
      }).toThrow(/always be zero/);
    });

    test("still allows two anchors that read different columns", () => {
      expect(() => {
        return MeasurementDefinitionValidator.validateAnchorPair(
          anchorPair({
            startAnchorType: "Impact Started At",
            endAnchorType: "Declared At",
            timestampAnchorSources: SOURCES,
          }),
        );
      }).not.toThrow();
    });

    test("without a source map, falls back to comparing the anchor types", () => {
      // Domains that declare no aliases keep the original behaviour.
      expect(() => {
        return MeasurementDefinitionValidator.validateAnchorPair(
          anchorPair({
            startAnchorType: "Created At",
            endAnchorType: "Timeline Start",
          }),
        );
      }).not.toThrow();
    });
  });

  describe("validateStateOrder", () => {
    test("accepts an end state ordered after the start state", () => {
      expect(() => {
        return MeasurementDefinitionValidator.validateStateOrder({
          startStateName: "Identified",
          startStateOrder: 1,
          endStateName: "Resolved",
          endStateOrder: 3,
        });
      }).not.toThrow();
    });

    test("rejects an end state ordered before the start state", () => {
      /*
       * States are entered in strictly increasing order, so this describes a
       * duration that can never complete. Without this check the definition
       * looks fine and every entity silently reports Not Applicable forever.
       */
      expect(() => {
        return MeasurementDefinitionValidator.validateStateOrder({
          startStateName: "Resolved",
          startStateOrder: 3,
          endStateName: "Identified",
          endStateOrder: 1,
        });
      }).toThrow(/could never complete/);
    });

    test("rejects two states at the same order", () => {
      expect(() => {
        return MeasurementDefinitionValidator.validateStateOrder({
          startStateName: "A",
          startStateOrder: 2,
          endStateName: "B",
          endStateOrder: 2,
        });
      }).toThrow(BadDataException);
    });

    test("names both states in the message so the fix is obvious", () => {
      expect(() => {
        return MeasurementDefinitionValidator.validateStateOrder({
          startStateName: "Resolved",
          startStateOrder: 3,
          endStateName: "Acknowledged",
          endStateOrder: 2,
        });
      }).toThrow(/"Acknowledged" comes before "Resolved"/);
    });

    test("says nothing when an order is unknown", () => {
      // A deleted state leaves no order to compare; the evaluator reports it.
      expect(() => {
        return MeasurementDefinitionValidator.validateStateOrder({
          startStateName: "Identified",
          startStateOrder: undefined,
          endStateName: "Resolved",
          endStateOrder: 3,
        });
      }).not.toThrow();
    });
  });
});
