import {
  analyzeDialogSource,
  ButtonGroupWithTwoFilled,
  DialogFinding,
  DialogRule,
  DialogSite,
  findButtonGroupsWithTwoFilled,
  findRepeatedFilledButtons,
  formatDialogFindings,
  listDialogSites,
  LocaleLookup,
  loadLocaleFor,
  RepeatedFilledButton,
} from "../DialogActionRules";
import {
  listScanRoots,
  listSourceFiles,
  toRelativePath,
} from "../ForeignHiddenRuleGuard";
import { beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Every dialog in the product has exactly one primary button, and it is the
 * thing the dialog exists to do.
 *
 * It started with the workflow builder's "Run this step now?" confirmation:
 * Cancel and "Run this step" were the same plain button and the focus ring sat
 * on Cancel, so the action the user had asked for looked like the lesser
 * choice ("Shouldn't run this step button be primary? ... if there are 'Let's
 * do it' actions, they should be primary, and only one button can be
 * primary."). The audit that followed found the fault, and its mirror images,
 * across the product, and this guard keeps them out:
 *
 *   - the affirmative action is PRIMARY, or DANGER when it destroys something
 *     ("Run this step", "Archive", "Reserve"; never NORMAL, never green);
 *   - a button that only closes the dialog is plain, and a dialog offers one
 *     of them ("Close" beside "Cancel" was two ways out, one of them indigo);
 *   - Delete / Remove actions are DANGER;
 *   - nothing else in the dialog is a filled button, including a button drawn
 *     once per row of a list inside it;
 *   - and, outside dialogs too, no filled button is repeated on every row of
 *     a list, and no group of buttons drawn side by side - a Card's buttons,
 *     sibling <Button>s - has more than one filled button.
 *
 * The detector (../DialogActionRules.ts) reads every use of Modal,
 * ConfirmModal, BasicFormModal, ModelFormModal and SideOver in the walk the
 * foreign-`hidden` guard makes (every feature set's browser source, Common's
 * UI and, when the checkout has it, ee/Dashboard and ee/AdminDashboard).
 *
 * An exception goes in ALLOWED below with the reason it is right for that
 * dialog. The guard fails when an entry stops matching anything, so the list
 * cannot quietly outlive the code it excuses.
 */

// packages/Common/Tests/UI -> the repository root.
const REPOSITORY_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");

interface AllowedDialogFinding {
  file: string;
  rule: DialogRule;
  // The dialog's title as the finding reports it.
  title: string;
  reason: string;
}

const ALLOWED_DIALOG_FINDINGS: Array<AllowedDialogFinding> = [
  {
    file: "packages/App/FeatureSet/Dashboard/src/Components/TwoFactorAuth/BackupCodes.tsx",
    rule: "dismissal-coloured",
    title: "Your backup codes",
    reason:
      "\"Done\" is not a way out here but the step that finishes setting up two-factor sign-in: it stays disabled until the user ticks that they have saved the codes, and the dialog deliberately has no Cancel, X or Escape. Finishing is the affirmative action.",
  },
];

interface AllowedRepeatedButton {
  file: string;
  label: string;
  reason: string;
}

const ALLOWED_REPEATED_FILLED_BUTTONS: Array<AllowedRepeatedButton> = [
  {
    file: "packages/App/FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplaySetupGuide.tsx",
    label: "Watch it",
    reason:
      "Written inside the live checks' map, but only the row for the 'playable' check, once it is done, gets the button: one per page.",
  },
  {
    file: "packages/App/FeatureSet/Dashboard/src/Pages/Runbook/View/ExecutionView.tsx",
    label: "Approve & continue / Mark complete",
    reason:
      "Written inside the steps' map, but only a step that is waiting gets it, and a runbook execution waits on one step at a time.",
  },
];

interface AllowedButtonGroup {
  file: string;
  // The group's labels, joined with " | ".
  labels: string;
  reason: string;
}

const ALLOWED_BUTTON_GROUPS: Array<AllowedButtonGroup> = [
  {
    file: "packages/Common/UI/Components/Date/StartAndEndDate.tsx",
    labels:
      "1 hour | 3 hours | 1 day | 1 week | 2 weeks | 3 weeks | 1 month | 3 months",
    reason:
      "A segmented choice of time range, not a row of actions: each chip is PRIMARY only while it is the selected range (`isX ? PRIMARY : NORMAL`), so exactly one is filled at a time.",
  },
];

/*
 * Dialogs the walk must reach, one per front end that has them. If a path
 * moves or a root drops out of listScanRoots, the guard says so instead of
 * passing over nothing.
 */
const EXPECTED_DIALOGS: Array<{ file: string; title: string }> = [
  {
    file: "packages/Common/UI/Components/Workflow/ComponentSettingsModal.tsx",
    title: "Run this step now?",
  },
  {
    file: "packages/Common/UI/Components/Workflow/RunModal.tsx",
    title: "Run Workflow Manually",
  },
  {
    file: "packages/App/FeatureSet/Dashboard/src/Components/TelemetryResource/ArchiveResourceCard.tsx",
    title: "title",
  },
  {
    file: "packages/App/FeatureSet/AdminDashboard/src/Pages/Users/View/Authentication.tsx",
    // Translated: the detector reads the English text of t("...") keys.
    title: "Reset Two Factor Authentication",
  },
];

const EXPECTED_ENTERPRISE_DIALOGS: Array<{ file: string; title: string }> = [
  {
    file: "ee/Dashboard/AuditLogs/AuditLogChangesModal.tsx",
    title: "… · … — … / … · …",
  },
  {
    file: "ee/AdminDashboard/Health/BackgroundQueues.tsx",
    title: "Failed jobs · … queue",
  },
];

interface Scan {
  files: Array<string>;
  sites: Array<DialogSite>;
  findings: Array<DialogFinding>;
  repeated: Array<RepeatedFilledButton>;
  groups: Array<ButtonGroupWithTwoFilled>;
}

const scan: Scan = {
  files: [],
  sites: [],
  findings: [],
  repeated: [],
  groups: [],
};

const isAllowedDialogFinding: (finding: DialogFinding) => boolean = (
  finding: DialogFinding,
): boolean => {
  return ALLOWED_DIALOG_FINDINGS.some((allowed: AllowedDialogFinding) => {
    return (
      allowed.file === finding.file &&
      allowed.rule === finding.rule &&
      allowed.title === finding.title
    );
  });
};

const isAllowedButtonGroup: (group: ButtonGroupWithTwoFilled) => boolean = (
  group: ButtonGroupWithTwoFilled,
): boolean => {
  return ALLOWED_BUTTON_GROUPS.some((allowed: AllowedButtonGroup) => {
    return (
      allowed.file === group.file && allowed.labels === group.labels.join(" | ")
    );
  });
};

const isAllowedRepeatedButton: (button: RepeatedFilledButton) => boolean = (
  button: RepeatedFilledButton,
): boolean => {
  return ALLOWED_REPEATED_FILLED_BUTTONS.some(
    (allowed: AllowedRepeatedButton) => {
      return allowed.file === button.file && allowed.label === button.label;
    },
  );
};

beforeAll(() => {
  const localeCache: Map<string, LocaleLookup> = new Map<
    string,
    LocaleLookup
  >();

  for (const root of listScanRoots(REPOSITORY_ROOT)) {
    for (const file of listSourceFiles(root)) {
      if (!file.endsWith(".tsx")) {
        continue;
      }

      const relativeFile: string = toRelativePath(REPOSITORY_ROOT, file);
      const source: string = fs.readFileSync(file, "utf8");
      const options: { locale: LocaleLookup } = {
        locale: loadLocaleFor(REPOSITORY_ROOT, relativeFile, localeCache),
      };

      scan.files.push(relativeFile);
      scan.sites.push(...listDialogSites(relativeFile, source, options));
      scan.findings.push(...analyzeDialogSource(relativeFile, source, options));
      scan.repeated.push(
        ...findRepeatedFilledButtons(relativeFile, source, options),
      );
      scan.groups.push(
        ...findButtonGroupsWithTwoFilled(relativeFile, source, options),
      );
    }
  }
});

describe("one primary 'do it' button per dialog", () => {
  test("the walk reaches the dialogs of every front end", () => {
    // Hundreds of dialogs: an empty or truncated walk must not pass.
    expect(scan.sites.length).toBeGreaterThan(300);

    const expected: Array<{ file: string; title: string }> = [
      ...EXPECTED_DIALOGS,
      ...(fs.existsSync(path.join(REPOSITORY_ROOT, "ee", "Dashboard"))
        ? EXPECTED_ENTERPRISE_DIALOGS
        : []),
    ];

    const missing: Array<string> = expected
      .filter((dialog: { file: string; title: string }) => {
        return !scan.sites.some((site: DialogSite) => {
          return site.file === dialog.file && site.title === dialog.title;
        });
      })
      .map((dialog: { file: string; title: string }): string => {
        return `${dialog.file} "${dialog.title}"`;
      });

    expect(missing).toEqual([]);

    for (const featureSet of ["Dashboard", "AdminDashboard"]) {
      expect(
        scan.sites.some((site: DialogSite) => {
          return site.file.startsWith(
            `packages/App/FeatureSet/${featureSet}/src/`,
          );
        }),
      ).toBe(true);
    }
  });

  test("every dialog's affirmative action is its one primary button, and it has one plain way out", () => {
    const violations: Array<DialogFinding> = scan.findings.filter(
      (finding: DialogFinding) => {
        return !isAllowedDialogFinding(finding);
      },
    );

    if (violations.length > 0) {
      throw new Error(
        `${violations.length} dialog(s) break the one-primary-action rule:\n\n${formatDialogFindings(
          violations,
        )}\n\nThe affirmative action is the dialog's one primary button: ButtonStyleType.PRIMARY, or DANGER when it destroys something. Cancel, Close and every other way out are NORMAL (or OUTLINE), and a dialog offers exactly one of them - a notice drops onSubmit and sets closeButtonText (Modal), or drops onClose (ConfirmModal, whose single button is then drawn plain by default). Nothing else in a dialog is a filled button. If a dialog really is the exception, add it to ALLOWED_DIALOG_FINDINGS in this file with the reason.`,
      );
    }
  });

  test("no list draws a filled button on every row", () => {
    const violations: Array<RepeatedFilledButton> = scan.repeated.filter(
      (button: RepeatedFilledButton) => {
        return !isAllowedRepeatedButton(button);
      },
    );

    if (violations.length > 0) {
      throw new Error(
        `${violations.length} filled button(s) are drawn once per row of a list:\n\n${violations
          .map((button: RepeatedFilledButton): string => {
            return `${button.file}:${button.line} "${button.label}" (${button.style})`;
          })
          .join(
            "\n",
          )}\n\nA filled button on every row is as many "main actions" as there are rows. Draw a per-row action as a NORMAL button; if only one row can ever carry it, add it to ALLOWED_REPEATED_FILLED_BUTTONS in this file with the reason.`,
      );
    }
  });

  test("no card or row of buttons draws more than one filled button", () => {
    const violations: Array<ButtonGroupWithTwoFilled> = scan.groups.filter(
      (group: ButtonGroupWithTwoFilled) => {
        return !isAllowedButtonGroup(group);
      },
    );

    if (violations.length > 0) {
      throw new Error(
        `${violations.length} group(s) of buttons draw more than one filled button side by side:\n\n${violations
          .map((group: ButtonGroupWithTwoFilled): string => {
            return `${group.file}:${group.line} (${group.kind}) ${group.labels.join(" | ")}`;
          })
          .join(
            "\n",
          )}\n\nButtons drawn together have one primary button, the thing to do next; the rest are NORMAL or OUTLINE (DANGER_OUTLINE for a destructive one). If the buttons can never be filled at the same time, add the group to ALLOWED_BUTTON_GROUPS in this file with the reason.`,
      );
    }
  });

  test("every allowlist entry still excuses something", () => {
    for (const allowed of ALLOWED_DIALOG_FINDINGS) {
      expect(
        scan.findings.some((finding: DialogFinding) => {
          return (
            finding.file === allowed.file &&
            finding.rule === allowed.rule &&
            finding.title === allowed.title
          );
        }),
      ).toBe(true);
      expect(allowed.reason.length).toBeGreaterThan(40);
    }

    for (const allowed of ALLOWED_BUTTON_GROUPS) {
      expect(
        scan.groups.some((group: ButtonGroupWithTwoFilled) => {
          return (
            group.file === allowed.file &&
            group.labels.join(" | ") === allowed.labels
          );
        }),
      ).toBe(true);
      expect(allowed.reason.length).toBeGreaterThan(40);
    }

    for (const allowed of ALLOWED_REPEATED_FILLED_BUTTONS) {
      expect(
        scan.repeated.some((button: RepeatedFilledButton) => {
          return (
            button.file === allowed.file && button.label === allowed.label
          );
        }),
      ).toBe(true);
      expect(allowed.reason.length).toBeGreaterThan(40);
    }
  });
});

/*
 * The guard would have caught the faults it was written for. Each test puts
 * the old code back into the real file's source, in memory, and checks the
 * detector reports it.
 */
describe("the guard catches the faults the audit fixed", () => {
  type ReadFunction = (relativeFile: string) => string;

  const read: ReadFunction = (relativeFile: string): string => {
    return fs.readFileSync(path.join(REPOSITORY_ROOT, relativeFile), "utf8");
  };

  type RevertFunction = (
    source: string,
    fixed: string,
    original: string,
  ) => string;

  const revert: RevertFunction = (
    source: string,
    fixed: string,
    original: string,
  ): string => {
    expect(source.split(fixed)).toHaveLength(2);

    return source.replace(fixed, original);
  };

  const SETTINGS_MODAL: string =
    "packages/Common/UI/Components/Workflow/ComponentSettingsModal.tsx";

  test("a plain 'Run this step' in the workflow builder", () => {
    const source: string = read(SETTINGS_MODAL);
    const runStepConfirmation: string = source.slice(
      source.indexOf("title={`Run this step now?`}"),
    );
    const fixedStyle: string = "submitButtonType={ButtonStyleType.PRIMARY}";

    expect(runStepConfirmation).toContain(fixedStyle);
    expect(analyzeDialogSource(SETTINGS_MODAL, source)).toEqual([]);

    const reverted: string =
      source.slice(0, source.indexOf("title={`Run this step now?`}")) +
      runStepConfirmation.replace(
        fixedStyle,
        "submitButtonType={ButtonStyleType.NORMAL}",
      );

    expect(
      analyzeDialogSource(SETTINGS_MODAL, reverted).map(
        (finding: DialogFinding): string => {
          return `${finding.title} ${finding.rule}`;
        },
      ),
    ).toEqual(["Run this step now? action-not-primary"]);
  });

  test("a green Run in the manual workflow run", () => {
    const file: string = "packages/Common/UI/Components/Workflow/RunModal.tsx";
    const reverted: string = revert(
      read(file),
      `props.onRun(component);
              props.onClose();
            }}
            submitButtonType={ButtonStyleType.PRIMARY}`,
      `props.onRun(component);
              props.onClose();
            }}
            submitButtonType={ButtonStyleType.SUCCESS}`,
    );

    expect(
      analyzeDialogSource(file, reverted).map(
        (finding: DialogFinding): string => {
          return `${finding.title} ${finding.rule}`;
        },
      ),
    ).toEqual(["Run Workflow Manually action-not-primary"]);
  });

  test("a primary Close beside a Cancel in a notice", () => {
    const file: string =
      "packages/App/FeatureSet/Dashboard/src/Pages/OnCallDuty/Readiness.tsx";
    const reverted: string = revert(
      read(file),
      `closeButtonText="Close"
          onClose={() => {
            setCoverageRow(null);
          }}`,
      `submitButtonText="Close"
          onSubmit={() => {
            setCoverageRow(null);
          }}
          onClose={() => {
            setCoverageRow(null);
          }}`,
    );

    expect(
      analyzeDialogSource(file, reverted)
        .map((finding: DialogFinding): string => {
          return finding.rule;
        })
        .sort(),
    ).toEqual(["dismissal-coloured", "two-dismissals"]);
  });

  test("a primary Run on every row of the runbook picker", () => {
    const file: string =
      "packages/App/FeatureSet/Dashboard/src/Components/Runbook/RunbookPicker.tsx";
    const reverted: string = revert(
      read(file),
      `title={isStarting ? "Starting..." : "Run"}
                        buttonStyle={ButtonStyleType.NORMAL}`,
      `title={isStarting ? "Starting..." : "Run"}
                        buttonStyle={ButtonStyleType.PRIMARY}`,
    );

    expect(
      analyzeDialogSource(file, reverted).map(
        (finding: DialogFinding): string => {
          return `${finding.title} ${finding.rule}`;
        },
      ),
    ).toEqual(["Run a Runbook two-primaries"]);
  });

  test("a filled red Uninstall beside the primary Connect on the Slack card", () => {
    const file: string =
      "packages/App/FeatureSet/Dashboard/src/Components/Slack/SlackIntegration.tsx";
    const source: string = read(file);

    expect(findButtonGroupsWithTwoFilled(file, source)).toEqual([]);

    const reverted: string = source.replace(
      "buttonStyle: ButtonStyleType.DANGER_OUTLINE,",
      "buttonStyle: ButtonStyleType.DANGER,",
    );

    expect(reverted).not.toBe(source);
    expect(
      findButtonGroupsWithTwoFilled(file, reverted).map(
        (group: ButtonGroupWithTwoFilled): string => {
          return group.labels.join(" | ");
        },
      ),
    ).toEqual(["title || `Connect with Slack` | Uninstall OneUptime from Slack"]);
  });

  test("a primary bulk Remove Labels", () => {
    const file: string =
      "packages/Common/UI/Components/BulkUpdate/BulkLabelActions.tsx";
    const reverted: string = revert(
      read(file),
      `submitButtonText="Remove Labels"
            submitButtonStyleType={ButtonStyleType.DANGER}`,
      `submitButtonText="Remove Labels"`,
    );

    expect(
      analyzeDialogSource(file, reverted).map(
        (finding: DialogFinding): string => {
          return `${finding.title} ${finding.rule}`;
        },
      ),
    ).toEqual(["Remove Labels destructive-not-danger"]);
  });
});
