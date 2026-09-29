import BasicForm from "../../../../UI/Components/Forms/BasicForm";
import Fields from "../../../../UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import { FormStep } from "../../../../UI/Components/Forms/Types/FormStep";
import ScanTargetUtil from "../../../../Utils/NetworkDiscovery/ScanTargetUtil";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import "@testing-library/jest-dom";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";
import * as React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * "Next" has to be a gate, not a page-turn.
 *
 * Issue #3377, against the Create Network Device Discovery Scan wizard: every
 * step accepted whatever was typed into it. An invalid scan target cleared
 * step 1, cleared step 2, cleared step 3, and then failed the final submit
 * with one combined banner rendered above the SCHEDULE fields — describing a
 * value entered two steps earlier, with nothing marking the field at fault.
 *
 * The fix is a field-level validator, and the reason a field-level validator
 * is sufficient is the behaviour pinned here: BasicForm validates only the
 * current step, refuses to advance while that step has an error, and renders
 * the message inline under the offending input. Nothing in the repo tested
 * that — no test clicked a Next button — so the whole mechanism the fix leans
 * on was unpinned.
 *
 * The wizard below is shaped like the real one and uses the real scan-target
 * parser, so a regression in either the step machinery or the parser shows up
 * here as a step that turns when it should not.
 */

/*
 * Type without userEvent's default inter-keystroke await, and give the typing
 * tests explicit timeouts. Both are load-bearing and both are borrowed from
 * BasicForm.test.tsx: Input syncs a display value from props onto the DOM
 * node, so a keystroke arriving before React has committed the previous one is
 * destroyed rather than delayed; and re-validating once per keystroke has no
 * headroom against jest's 5s default on a loaded runner.
 */
function setupUser(): UserEvent {
  return userEvent.setup({ delay: null });
}

const TEST_TIMEOUT_MS: number = 30000;

const SUBMIT_BUTTON_TEXT: string = "Create Scan";

const STEPS: Array<FormStep<FormValues<any>>> = [
  { title: "Scan Target", id: "scan-target" },
  { title: "SNMP Credentials", id: "snmp" },
];

const FIELDS: Fields<FormValues<any>> = [
  {
    field: { cidr: true },
    title: "Scan Target",
    stepId: "scan-target",
    fieldType: FormFieldSchemaType.Text,
    required: true,
    dataTestId: "cidr",
    /*
     * The real validator's shape: delegate to the parser, and stay silent on
     * empty so `required` keeps its own shorter message.
     */
    customValidation: (values: FormValues<any>): string | null => {
      const raw: string =
        values["cidr"] === undefined || values["cidr"] === null
          ? ""
          : String(values["cidr"]);

      /*
       * Empty is `required`'s; blank is the parser's. validateRequired
       * measures the UNTRIMMED string, so a lone space satisfies it — see the
       * whitespace test below.
       */
      if (raw === "") {
        return null;
      }

      return ScanTargetUtil.getValidationError(raw.trim());
    },
  },
  {
    field: { snmpCommunityString: true },
    title: "SNMP Community String",
    stepId: "snmp",
    fieldType: FormFieldSchemaType.Text,
    required: true,
    dataTestId: "community",
  },
];

interface RenderWizardResult {
  handleSubmit: MockFunction;
  user: UserEvent;
}

function renderWizard(): RenderWizardResult {
  const handleSubmit: MockFunction = getJestMockFunction();

  render(
    <BasicForm
      id="discovery-wizard"
      fields={FIELDS}
      steps={STEPS}
      initialValues={{}}
      onSubmit={handleSubmit}
      submitButtonText={SUBMIT_BUTTON_TEXT}
    />,
  );

  return { handleSubmit, user: setupUser() };
}

/*
 * The button's LABEL is "Next" until the last step, but its test id is always
 * the submitButtonText it was given — see BasicForm's Button props. Reading it
 * by test id therefore works on every step.
 */
function stepButton(): HTMLElement {
  return screen.getByTestId(SUBMIT_BUTTON_TEXT);
}

function errorMessages(): Array<string> {
  return screen
    .queryAllByTestId("error-message")
    .map((element: HTMLElement): string => {
      return element.textContent || "";
    });
}

function onStepOne(): boolean {
  return screen.queryByTestId("cidr") !== null;
}

function onStepTwo(): boolean {
  return screen.queryByTestId("community") !== null;
}

describe("BasicForm wizard — an invalid field holds its own step", () => {
  afterEach(() => {
    cleanup();
  });

  test(
    "the reported case: a phone-number-shaped scan target does not advance",
    async () => {
      const { handleSubmit, user }: RenderWizardResult = renderWizard();

      await user.type(screen.getByTestId("cidr"), "9876543210");
      await user.click(stepButton());

      await waitFor(() => {
        expect(errorMessages().join(" ")).toContain(
          "is not a valid scan target",
        );
      });

      // Still on step one, and nothing was submitted.
      expect(onStepOne()).toBe(true);
      expect(onStepTwo()).toBe(false);
      expect(handleSubmit).not.toHaveBeenCalled();
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "the message is rendered inline, on the step that owns the field",
    async () => {
      const { user }: RenderWizardResult = renderWizard();

      await user.type(screen.getByTestId("cidr"), "10.0.0.256");
      await user.click(stepButton());

      await waitFor(() => {
        expect(errorMessages().join(" ")).toContain("between 0 and 255");
      });

      /*
       * Exactly one message, attached to the one field on this step — not a
       * combined banner, and not a message about a field the operator cannot
       * see.
       */
      expect(errorMessages()).toHaveLength(1);
      expect(screen.getByTestId("cidr")).toBeInTheDocument();
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "an over-sized but well-formed target is stopped at step one too",
    async () => {
      const { user }: RenderWizardResult = renderWizard();

      // Syntactically perfect; 16.7M addresses.
      await user.type(screen.getByTestId("cidr"), "10.0.0.0/8");
      await user.click(stepButton());

      await waitFor(() => {
        expect(errorMessages().join(" ")).toContain("scan limit");
      });

      expect(onStepTwo()).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "a blank field does not advance either, even though `required` passes it",
    async () => {
      const { handleSubmit, user }: RenderWizardResult = renderWizard();

      /*
       * The trap this whole distinction exists for: Validation.validateRequired
       * tests `!content || content.length === 0` on the RAW string, so a single
       * space has length 1 and satisfies it. No length rule fires either (the
       * inferred maxLength is an upper bound, and trims to 0 anyway). If the
       * field's own validator also read " " as empty, nothing on the form would
       * speak — and the step would turn on a target the server rejects.
       */
      await user.type(screen.getByTestId("cidr"), "   ");
      await user.click(stepButton());

      await waitFor(() => {
        expect(errorMessages().join(" ")).toContain(
          "A scan target is required",
        );
      });

      expect(onStepTwo()).toBe(false);
      expect(handleSubmit).not.toHaveBeenCalled();
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "an empty required field is reported as required, not as malformed",
    async () => {
      const { handleSubmit, user }: RenderWizardResult = renderWizard();

      await user.click(stepButton());

      await waitFor(() => {
        expect(errorMessages().join(" ")).toContain("Scan Target is required.");
      });

      /*
       * The customValidation returns null for empty precisely so this message
       * survives — it runs after validateRequired and would otherwise replace
       * it with the parser's longer sentence.
       */
      expect(errorMessages().join(" ")).not.toContain("is not a valid");
      expect(onStepTwo()).toBe(false);
      expect(handleSubmit).not.toHaveBeenCalled();
    },
    TEST_TIMEOUT_MS,
  );
});

describe("BasicForm wizard — a corrected field releases the step", () => {
  afterEach(() => {
    cleanup();
  });

  test(
    "correcting the value advances to the next step",
    async () => {
      const { user }: RenderWizardResult = renderWizard();

      await user.type(screen.getByTestId("cidr"), "9876543210");
      await user.click(stepButton());

      await waitFor(() => {
        expect(errorMessages().length).toBeGreaterThan(0);
      });

      await user.clear(screen.getByTestId("cidr"));
      await user.type(screen.getByTestId("cidr"), "192.168.1.0/24");
      await user.click(stepButton());

      await waitFor(() => {
        expect(onStepTwo()).toBe(true);
      });

      expect(onStepOne()).toBe(false);
      expect(errorMessages()).toHaveLength(0);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "a valid target advances first time, with no error shown on the way",
    async () => {
      const { user }: RenderWizardResult = renderWizard();

      await user.type(screen.getByTestId("cidr"), "10.16-22.0-255.51-66");
      await user.click(stepButton());

      await waitFor(() => {
        expect(onStepTwo()).toBe(true);
      });

      expect(errorMessages()).toHaveLength(0);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "the whole wizard submits once every step is satisfied",
    async () => {
      const { handleSubmit, user }: RenderWizardResult = renderWizard();

      await user.type(screen.getByTestId("cidr"), "192.168.1.0/24");
      await user.click(stepButton());

      await waitFor(() => {
        expect(onStepTwo()).toBe(true);
      });

      await user.type(screen.getByTestId("community"), "public");
      await user.click(stepButton());

      await waitFor(() => {
        expect(handleSubmit).toHaveBeenCalled();
      });

      expect(handleSubmit.mock.calls[0]?.[0]).toMatchObject({
        cidr: "192.168.1.0/24",
        snmpCommunityString: "public",
      });
    },
    TEST_TIMEOUT_MS,
  );
});

describe("BasicForm wizard — a later step's field never blocks an earlier one", () => {
  afterEach(() => {
    cleanup();
  });

  test(
    "step two's required field is not demanded while on step one",
    async () => {
      const { user }: RenderWizardResult = renderWizard();

      await user.type(screen.getByTestId("cidr"), "192.168.1.0/24");
      await user.click(stepButton());

      /*
       * The community string is required and empty. If the step filter ever
       * stopped applying, "Next" would become a dead button: the error would
       * block the advance while its field is on a step that has not been
       * rendered yet, so nothing on screen could explain the refusal.
       */
      await waitFor(() => {
        expect(onStepTwo()).toBe(true);
      });

      expect(errorMessages()).toHaveLength(0);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "step two blocks on its own field once the operator gets there",
    async () => {
      const { handleSubmit, user }: RenderWizardResult = renderWizard();

      await user.type(screen.getByTestId("cidr"), "192.168.1.0/24");
      await user.click(stepButton());

      await waitFor(() => {
        expect(onStepTwo()).toBe(true);
      });

      await user.click(stepButton());

      await waitFor(() => {
        expect(errorMessages().join(" ")).toContain(
          "SNMP Community String is required.",
        );
      });

      expect(handleSubmit).not.toHaveBeenCalled();
    },
    TEST_TIMEOUT_MS,
  );
});
