import InsightTriageRunner from "../../../Server/Utils/AI/SRE/Insights/InsightTriageRunner";
import ExceptionAIClassification from "../../../Types/AI/ExceptionAIClassification";
import { describe, expect, test } from "@jest/globals";

/*
 * The triage verdict gates the automatic fix lane, so the parser must fail
 * CLOSED: anything unparseable reads as Unknown, and Unknown never routes
 * a fix pull request.
 */
describe("InsightTriageRunner.parseClassification", () => {
  test("parses the mandatory trailing verdict line", () => {
    expect(
      InsightTriageRunner.parseClassification(
        "Root cause: bad uuid in URL.\n\nClassification: user-error",
      ),
    ).toBe(ExceptionAIClassification.UserError);
  });

  test("tolerates markdown emphasis and mixed case", () => {
    expect(
      InsightTriageRunner.parseClassification(
        "analysis...\n**Classification:** code-fault",
      ),
    ).toBe(ExceptionAIClassification.CodeFault);

    expect(
      InsightTriageRunner.parseClassification(
        "analysis...\nCLASSIFICATION: expected-denial",
      ),
    ).toBe(ExceptionAIClassification.ExpectedDenial);
  });

  test("the LAST verdict line wins when the taxonomy is discussed earlier", () => {
    const analysis: string = [
      "The options were:",
      "Classification: code-fault",
      "...but the paywall check fired intentionally.",
      "Classification: expected-denial",
    ].join("\n");

    expect(InsightTriageRunner.parseClassification(analysis)).toBe(
      ExceptionAIClassification.ExpectedDenial,
    );
  });

  test("fails CLOSED: missing, malformed, or empty input reads as unknown", () => {
    expect(InsightTriageRunner.parseClassification("no verdict here")).toBe(
      ExceptionAIClassification.Unknown,
    );
    expect(
      InsightTriageRunner.parseClassification("Classification: maybe-a-bug"),
    ).toBe(ExceptionAIClassification.Unknown);
    expect(InsightTriageRunner.parseClassification("")).toBe(
      ExceptionAIClassification.Unknown,
    );
  });
});
