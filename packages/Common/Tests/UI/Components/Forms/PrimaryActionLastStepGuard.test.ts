import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { LocaleLookup, loadLocaleFor } from "../../../DialogActionRules";
import {
  listScanRoots,
  listSourceFiles,
} from "../../../ForeignHiddenRuleGuard";
import {
  BASIC_FORM_FILE,
  RETIRED_NAMES,
  STEPPED_FORM_FOOTER_FILE,
  SteppedFooterFacts,
  SteppedFooterProblem,
  SteppedFooterRule,
  formatSteppedFooterProblems,
  scanSteppedFooterSource,
} from "../../../Helpers/SteppedFooterScan";

/*
 * "In multi-step form. Please dont have the primary save button on any step
 * except the last. For example, do not show Declare Incident on the first
 * step, it should always be on the last step. Next button should never be
 * primary color as well. Can you please do this for all multistep forms in
 * the project?" - the maintainer, 2026-10-04.
 *
 * The shared form machinery holds the rule (Forms/Utils/SteppedFormFooter.ts,
 * pinned by its own tests and by the render tests of BasicForm,
 * ModelFormModal and BasicFormModal). This guard reads every front end
 * (Tests/Helpers/SteppedFooterScan) so that nothing outside it brings a
 * primary Next, or an early action, back:
 *   - a label that reads Next is never on a primary button, or a dialog's
 *     submit button;
 *   - submitAllSteps - the call that submits a stepped form from wherever
 *     it is - is only ever the last step's action, through
 *     getSteppedModalFooter;
 *   - a host that draws a stepped form's buttons itself builds them with
 *     getSteppedModalFooter;
 *   - the finish-early machinery it replaced (FinishFromAnyStep,
 *     customElementCanBeSkipped, saveFromAnyStep) stays gone.
 *
 * It replaces FinishFromAnyStepGuard, which kept that machinery honest. The
 * detector is pinned on inline snippets first, then run over the real tree.
 */

// packages/Common/Tests/UI/Components/Forms -> the repository root.
const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
);

function scan(
  text: string,
  options: { file?: string; locale?: Record<string, string> } = {},
): SteppedFooterFacts {
  const locale: Record<string, string> = options.locale || {};

  return scanSteppedFooterSource({
    file:
      options.file ||
      "packages/App/FeatureSet/Dashboard/src/Pages/Example/Page.tsx",
    text,
    locale: (key: string): string | null => {
      return locale[key] ?? null;
    },
  });
}

function rulesOf(text: string, options: { file?: string } = {}): Array<SteppedFooterRule> {
  return scan(text, options).problems.map(
    (problem: SteppedFooterProblem): SteppedFooterRule => {
      return problem.rule;
    },
  );
}

describe("the stepped footer detector", () => {
  describe("a label that reads Next", () => {
    test("on a plain Button passes, whatever plain style it wears", () => {
      expect(rulesOf(`const A = () => <Button title="Next" onClick={go} />;`)).toEqual([]);
      expect(
        rulesOf(
          `const A = () => <Button title={t("Next")} buttonStyle={ButtonStyleType.OUTLINE} />;`,
        ),
      ).toEqual([]);
      expect(
        rulesOf(
          `const A = () => <Button title={translateString(NEXT_BUTTON_TEXT) ?? NEXT_BUTTON_TEXT} buttonStyle={NEXT_BUTTON_STYLE} />;`,
        ),
      ).toEqual([]);
    });

    test("on a primary Button is a problem", () => {
      expect(
        rulesOf(
          `const A = () => <Button title="Next" buttonStyle={ButtonStyleType.PRIMARY} />;`,
        ),
      ).toEqual(["next-label"]);

      expect(
        rulesOf(
          `const A = () => <Button title={tx("Next")} buttonStyle={isLast ? ButtonStyleType.NORMAL : ButtonStyleType.PRIMARY} />;`,
        ),
      ).toEqual(["next-label"]);
    });

    test("as a dialog's submit button is a problem: that is its primary action", () => {
      expect(
        rulesOf(`const A = () => <Modal title="x" submitButtonText="Next" onSubmit={go} />;`),
      ).toEqual(["next-label"]);

      expect(
        rulesOf(
          `const A = () => <Modal title="x" submitButtonText={isLast ? "Create" : "Next"} onSubmit={go} />;`,
        ),
      ).toEqual(["next-label"]);
    });

    test("returned by a function the scan cannot follow to its button is a problem", () => {
      // The Create a workflow wizard's old submit text.
      expect(
        rulesOf(`
          const text = () => {
            if (step === Step.Name && hasMore) {
              return "Next";
            }
            return "Create Workflow";
          };
          const A = () => <Modal submitButtonText={text()} onSubmit={go} />;`),
      ).toEqual(["next-label"]);
    });

    test("as a dialog's secondaryButton, or getSteppedModalFooter's nextButtonText, passes", () => {
      expect(
        rulesOf(
          `const A = () => <Modal secondaryButton={{ title: "Next", onClick: go }} />;`,
        ),
      ).toEqual([]);
      expect(
        rulesOf(
          `const A = () => <Modal secondaryButton={more ? { title: NEXT_BUTTON_TEXT, onClick: go } : undefined} />;`,
        ),
      ).toEqual([]);
      expect(
        rulesOf(
          `const footer = getSteppedModalFooter({ hasSteps: true, isOnLastStep: false, onAction: a, onNext: b, nextButtonText: "Next" });`,
        ),
      ).toEqual([]);
    });

    test("as a native button's text passes when plain and is a problem in the primary colour", () => {
      expect(
        rulesOf(
          `const A = () => <button type="button" className="rounded-md border px-3">{t("Next")}</button>;`,
        ),
      ).toEqual([]);
      expect(
        rulesOf(
          `const A = () => <button type="button" className="rounded-md bg-indigo-600 text-white">Next</button>;`,
        ),
      ).toEqual(["next-label"]);
    });

    test("in a button object passes when plain and is a problem when primary", () => {
      expect(
        rulesOf(
          `const buttons = [{ title: "Next", buttonStyle: ButtonStyleType.NORMAL, onClick: go }];`,
        ),
      ).toEqual([]);
      expect(
        rulesOf(
          `const buttons = [{ title: "Next", buttonStyle: ButtonStyleType.PRIMARY, onClick: go }];`,
        ),
      ).toEqual(["next-label"]);
    });

    test("in a constant is judged by every place the constant is used", () => {
      const plain: string = `
        const label = translateString(NEXT_BUTTON_TEXT) ?? NEXT_BUTTON_TEXT;
        const A = () => <Button title={label} buttonStyle={NEXT_BUTTON_STYLE} />;`;

      expect(rulesOf(plain)).toEqual([]);

      const primary: string = `
        const label = translateString(NEXT_BUTTON_TEXT) ?? NEXT_BUTTON_TEXT;
        const A = () => <Button title={label} buttonStyle={ButtonStyleType.PRIMARY} />;`;

      // Both the literal's constant and the use are judged through the use.
      expect(rulesOf(primary).length).toBeGreaterThan(0);
      expect(new Set(rulesOf(primary))).toEqual(new Set(["next-label"]));
    });

    test("a translation key whose English is Next counts as Next", () => {
      const facts: SteppedFooterFacts = scan(
        `const A = () => <Button title={t("pages.wizard.next")} buttonStyle={ButtonStyleType.PRIMARY} />;`,
        {
          file: "packages/App/FeatureSet/AdminDashboard/src/Pages/Example.tsx",
          locale: { "pages.wizard.next": "Next" },
        },
      );

      expect(facts.nextLabels).toHaveLength(1);
      expect(facts.problems.map((problem: SteppedFooterProblem) => problem.rule)).toEqual([
        "next-label",
      ]);
    });

    test("other words are not labels: Next page, Next steps, a comment", () => {
      const facts: SteppedFooterFacts = scan(`
        // Next walks on.
        const A = () => <button aria-label={t("Next page")} className="bg-indigo-600">{t("Next steps")}</button>;`);

      expect(facts.nextLabels).toEqual([]);
      expect(facts.problems).toEqual([]);
    });

    test("NEXT_BUTTON_TEXT's own definition is not a label, its uses are", () => {
      const facts: SteppedFooterFacts = scan(
        `export const NEXT_BUTTON_TEXT: string = "Next";`,
        { file: STEPPED_FORM_FOOTER_FILE },
      );

      expect(facts.nextLabels).toEqual([]);
      expect(facts.problems).toEqual([]);
    });
  });

  describe("submitAllSteps", () => {
    test("as getSteppedModalFooter's onAction passes", () => {
      expect(
        rulesOf(`
          const footer = getSteppedModalFooter({
            hasSteps,
            isOnLastStep,
            onAction: () => { formRef.current?.submitAllSteps(); },
            onNext: () => { formRef.current?.goToNextStep(); },
          });`),
      ).toEqual([]);
    });

    test("called from a dialog's submit button on every step is a problem", () => {
      // The Kubernetes AI access dialog's old Save, on both of its steps.
      expect(
        rulesOf(`
          const A = () => (
            <Modal
              submitButtonText="Save"
              onSubmit={() => { (formRef.current as BasicFormHandle | null)?.submitAllSteps(); }}
            />
          );`),
      ).toEqual(["submit-all-steps"]);
    });

    test("as getSteppedModalFooter's onNext is a problem", () => {
      expect(
        rulesOf(`
          const footer = getSteppedModalFooter({
            hasSteps, isOnLastStep, onAction: save,
            onNext: () => { formRef.current?.submitAllSteps(); },
          });`),
      ).toEqual(["submit-all-steps"]);
    });

    test("BasicForm, which defines it, may call it", () => {
      expect(
        rulesOf(`const submit = () => { submitAllSteps(); };`, {
          file: BASIC_FORM_FILE,
        }),
      ).toEqual([]);
    });
  });

  describe("a host that draws a stepped form's buttons", () => {
    test("without getSteppedModalFooter is a problem", () => {
      expect(
        rulesOf(`
          const A = () => (
            <Modal submitButtonText="Save" onSubmit={() => formRef.current?.submitForm()}>
              <BasicForm ref={formRef} steps={steps} fields={fields} hideSubmitButton={true} />
            </Modal>
          );`),
      ).toEqual(["hosted-stepped-form"]);

      // Steps that may come in a spread count too.
      expect(
        rulesOf(`
          const A = () => (
            <Modal submitButtonText="Save" onSubmit={save}>
              <ModelForm {...props.formProps} hideSubmitButton />
            </Modal>
          );`),
      ).toEqual(["hosted-stepped-form"]);
    });

    test("with getSteppedModalFooter passes", () => {
      expect(
        rulesOf(`
          const footer = getSteppedModalFooter({ hasSteps: true, isOnLastStep, onAction: () => formRef.current?.submitAllSteps(), onNext: () => formRef.current?.goToNextStep() });
          const A = () => (
            <Modal submitButtonText="Save" onSubmit={footer.onSubmit} secondaryButton={footer.secondaryButton}>
              <BasicForm ref={formRef} steps={steps} fields={fields} hideSubmitButton={true} />
            </Modal>
          );`),
      ).toEqual([]);
    });

    test("a one-page form a host draws the buttons of, or a form drawing its own, passes", () => {
      expect(
        rulesOf(`
          const A = () => (
            <Modal submitButtonText="Add Monitors" onSubmit={() => formRef.current?.submitForm()}>
              <BasicForm ref={formRef} fields={fields} hideSubmitButton={true} />
            </Modal>
          );`),
      ).toEqual([]);

      expect(
        rulesOf(
          `const A = () => <ModelForm steps={steps} fields={fields} submitButtonText="Declare Incident" />;`,
        ),
      ).toEqual([]);

      // A pass-through wrapper (ModelForm itself) is not a host.
      expect(
        rulesOf(
          `const A = (props) => <BasicModelForm steps={props.steps} hideSubmitButton={props.hideSubmitButton} />;`,
        ),
      ).toEqual([]);
    });
  });

  describe("the finish-early machinery", () => {
    test.each(RETIRED_NAMES)("%s is retired", (name: string) => {
      expect(rulesOf(`const field = { ${name}: true };`)).toEqual(["retired"]);
      expect(rulesOf(`const A = () => <BasicFormModal ${name}={true} />;`)).toEqual([
        "retired",
      ]);
    });

    test("its module is retired", () => {
      expect(
        rulesOf(
          `import { getSteppedFormFooter } from "Common/UI/Components/Forms/Utils/FinishFromAnyStep";`,
        ),
      ).toEqual(["retired"]);
    });

    test("a comment that tells its history is not a use", () => {
      expect(
        rulesOf(`
          /*
           * Before 2026-10-04 a field could say customElementCanBeSkipped and a
           * dialog saveFromAnyStep (Forms/Utils/FinishFromAnyStep).
           */
          const x = 1;`),
      ).toEqual([]);
    });
  });
});

describe("the project's front ends", () => {
  const files: Array<string> = listScanRoots(REPOSITORY_ROOT).flatMap(
    (root: string): Array<string> => {
      return listSourceFiles(root);
    },
  );

  const localeCache: Map<string, LocaleLookup> = new Map<
    string,
    LocaleLookup
  >();

  const facts: Array<SteppedFooterFacts> = files.map(
    (file: string): SteppedFooterFacts => {
      const relative: string = path
        .relative(REPOSITORY_ROOT, file)
        .split(path.sep)
        .join("/");

      return scanSteppedFooterSource({
        file: relative,
        text: fs.readFileSync(file, "utf-8"),
        locale: loadLocaleFor(REPOSITORY_ROOT, relative, localeCache),
      });
    },
  );

  const factsOf: (file: string) => SteppedFooterFacts = (
    file: string,
  ): SteppedFooterFacts => {
    const found: SteppedFooterFacts | undefined = facts.find(
      (item: SteppedFooterFacts): boolean => {
        return item.file === file;
      },
    );

    expect(`${file}: ${Boolean(found)}`).toBe(`${file}: true`);

    return found!;
  };

  const problems: Array<SteppedFooterProblem> = facts.flatMap(
    (item: SteppedFooterFacts): Array<SteppedFooterProblem> => {
      return item.problems;
    },
  );

  // A broken walk must not pass by finding nothing.
  test("are really read", () => {
    expect(files.length).toBeGreaterThan(2000);

    const labels: number = facts.reduce(
      (total: number, item: SteppedFooterFacts): number => {
        return total + item.nextLabels.length;
      },
      0,
    );

    // BasicForm's Next, the shared footer's, and the pages' own.
    expect(labels).toBeGreaterThanOrEqual(4);

    expect(
      facts.filter((item: SteppedFooterFacts): boolean => {
        return item.callsSteppedModalFooter;
      }).length,
    ).toBeGreaterThanOrEqual(4);
  });

  test("never put Next on a primary button, offer the action early, or bring finishing early back", () => {
    expect(formatSteppedFooterProblems(problems)).toBe("");
  });

  /*
   * The footers drawn outside BasicForm, each built with
   * getSteppedModalFooter: Next until the last step, the action only there.
   */
  test("every dialog that draws a stepped form's footer builds it with getSteppedModalFooter", () => {
    for (const file of [
      "packages/Common/UI/Components/ModelFormModal/ModelFormModal.tsx",
      "packages/Common/UI/Components/FormModal/BasicFormModal.tsx",
      // Change what AI may do: two steps when a Runner can be picked.
      "packages/App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/AI/Agent.tsx",
      // Create a workflow: its own steps, Create Workflow only on the last.
      "packages/App/FeatureSet/Dashboard/src/Components/Workflow/CreateWorkflowModal.tsx",
    ]) {
      expect(`${file}: ${factsOf(file).callsSteppedModalFooter}`).toBe(
        `${file}: true`,
      );
    }
  });

  test("BasicForm draws its own Next, plain", () => {
    const basicForm: SteppedFooterFacts = factsOf(BASIC_FORM_FILE);

    expect(basicForm.nextLabels.length).toBeGreaterThan(0);
    expect(
      basicForm.nextLabels.every(
        (label: { isPlain: boolean }): boolean => {
          return label.isPlain;
        },
      ),
    ).toBe(true);
  });
});
