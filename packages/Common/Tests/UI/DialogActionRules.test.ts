import {
  analyzeDialogSource,
  ButtonGroupWithTwoFilled,
  DialogFinding,
  findButtonGroupsWithTwoFilled,
  findRepeatedFilledButtons,
  formatDialogFindings,
  isDestructiveLabel,
  isDismissalLabel,
  listDialogSites,
  LocaleLookup,
  RepeatedFilledButton,
} from "../DialogActionRules";
import { describe, expect, test } from "@jest/globals";

/*
 * The detector behind DialogPrimaryActionGuard.test.ts, on hand-written
 * sources: what each rule flags, and the shapes it must leave alone. The
 * guard itself runs it over the real code.
 */

const FILE: string = "packages/App/FeatureSet/Dashboard/src/Pages/Fixture.tsx";

const IMPORTS: string = `
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import Modal from "Common/UI/Components/Modal/Modal";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import SideOver from "Common/UI/Components/SideOver/SideOver";
`;

type RulesOfFunction = (jsx: string, locale?: LocaleLookup) => Array<string>;

// "<rule>" for each finding in a component that renders `jsx`.
const rulesOf: RulesOfFunction = (
  jsx: string,
  locale?: LocaleLookup,
): Array<string> => {
  const source: string = `${IMPORTS}
const Fixture = () => {
  return (
    <>
      ${jsx}
    </>
  );
};
export default Fixture;
`;

  return analyzeDialogSource(FILE, source, { locale })
    .map((finding: DialogFinding): string => {
      return finding.rule;
    })
    .sort();
};

describe("labels", () => {
  test("a dismissal is a word that only closes", () => {
    for (const label of [
      "Close",
      "close",
      " Done ",
      "OK",
      "Okay",
      "Got it",
      "Got it!",
      "Great",
      "Cancel",
      "Back",
      "Done.",
    ]) {
      expect(isDismissalLabel(label)).toBe(true);
    }

    // Dismissing a recommendation is an action with a consequence.
    for (const label of [
      "Dismiss",
      "Run this step",
      "Close incident",
      "Done editing? Save",
      "Archive",
    ]) {
      expect(isDismissalLabel(label)).toBe(false);
    }
  });

  test("a destructive label starts with Delete or Remove", () => {
    expect(isDestructiveLabel("Delete")).toBe(true);
    expect(isDestructiveLabel("Delete Monitor")).toBe(true);
    expect(isDestructiveLabel("remove owner")).toBe(true);
    expect(isDestructiveLabel("Removed")).toBe(false);
    expect(isDestructiveLabel("Undelete")).toBe(false);
    expect(isDestructiveLabel("Archive")).toBe(false);
  });
});

describe("the affirmative action is PRIMARY or DANGER", () => {
  test("a confirmation whose action is plain or green is flagged", () => {
    expect(
      rulesOf(`<ConfirmModal
        title="Run this step now?"
        description="x"
        submitButtonText="Run this step"
        submitButtonType={ButtonStyleType.NORMAL}
        onSubmit={() => {}}
        onClose={() => {}}
      />`),
    ).toEqual(["action-not-primary"]);

    expect(
      rulesOf(`<ConfirmModal
        title="Run Workflow Manually"
        description="x"
        submitButtonText="Run"
        submitButtonType={ButtonStyleType.SUCCESS}
        onSubmit={() => {}}
        onClose={() => {}}
      />`),
    ).toEqual(["action-not-primary"]);
  });

  test("PRIMARY, DANGER and ConfirmModal's default with a Cancel all pass", () => {
    for (const style of [
      "submitButtonType={ButtonStyleType.PRIMARY}",
      "submitButtonType={ButtonStyleType.DANGER}",
      "",
    ]) {
      expect(
        rulesOf(`<ConfirmModal
          title="Archive this?"
          description="x"
          submitButtonText="Archive"
          ${style}
          onSubmit={() => {}}
          onClose={() => {}}
        />`),
      ).toEqual([]);
    }
  });

  test("a ConfirmModal with no Cancel draws its button plain, so an action there must say PRIMARY", () => {
    expect(
      rulesOf(`<ConfirmModal
        title="Something went wrong"
        description="x"
        submitButtonText="Reload Page"
        onSubmit={() => {}}
      />`),
    ).toEqual(["action-not-primary"]);

    expect(
      rulesOf(`<ConfirmModal
        title="Something went wrong"
        description="x"
        submitButtonText="Reload Page"
        submitButtonType={ButtonStyleType.PRIMARY}
        onSubmit={() => {}}
      />`),
    ).toEqual([]);
  });

  test("a Cancel that is taken away mid-run turns the default plain, and is flagged", () => {
    expect(
      rulesOf(`<ConfirmModal
        title="Run This Rule Now"
        description="x"
        submitButtonText="Run Rule"
        onSubmit={() => {}}
        onClose={isRunning ? undefined : close}
      />`),
    ).toEqual(["action-not-primary"]);
  });

  test("Modal and the form modals default to PRIMARY", () => {
    expect(
      rulesOf(`<Modal title="Edit" onSubmit={() => {}} onClose={() => {}}><div /></Modal>`),
    ).toEqual([]);
    expect(
      rulesOf(`<BasicFormModal title="Edit" onSubmit={() => {}} onClose={() => {}} formProps={{ fields: [] }} />`),
    ).toEqual([]);
    expect(
      rulesOf(`<ModelFormModal title="Create" modelType={Monitor} onClose={() => {}} formProps={{ fields: [] }} />`),
    ).toEqual([]);
  });

  test("a label held in a variable is not guessed at", () => {
    expect(
      rulesOf(`<ConfirmModal
        title="x"
        description="x"
        submitButtonText={props.submitButtonText}
        submitButtonType={ButtonStyleType.NORMAL}
        onSubmit={() => {}}
        onClose={() => {}}
      />`),
    ).toEqual([]);
  });
});

describe("a way out is plain, and there is one of it", () => {
  test("a Modal notice with a primary Close beside Cancel is flagged twice", () => {
    expect(
      rulesOf(`<Modal
        title="Metric Details"
        onClose={() => {}}
        onSubmit={() => {}}
        submitButtonText="Close"
      ><div /></Modal>`),
    ).toEqual(["dismissal-coloured", "two-dismissals"]);
  });

  test("a plain Close beside Cancel is still two ways out", () => {
    expect(
      rulesOf(`<ConfirmModal
        title="Nothing to Add"
        description="x"
        submitButtonText="Close"
        submitButtonType={ButtonStyleType.NORMAL}
        onSubmit={() => {}}
        onClose={() => {}}
      />`),
    ).toEqual(["two-dismissals"]);

    expect(
      rulesOf(`<Modal
        title="Run a Runbook"
        onClose={() => {}}
        onSubmit={() => {}}
        submitButtonText="Cancel"
        submitButtonStyleType={ButtonStyleType.OUTLINE}
      ><div /></Modal>`),
    ).toEqual(["two-dismissals"]);
  });

  test("the notice shapes that pass: a ConfirmModal with no Cancel, a Modal with only a close button", () => {
    expect(
      rulesOf(`<ConfirmModal
        title="Code sent"
        description="x"
        submitButtonText="Close"
        onSubmit={() => {}}
      />`),
    ).toEqual([]);

    expect(
      rulesOf(`<Modal title="Coverage" onClose={() => {}} closeButtonText="Close"><div /></Modal>`),
    ).toEqual([]);
  });

  test("a coloured dismissal is flagged, whatever the colour", () => {
    expect(
      rulesOf(`<ConfirmModal
        title="Device Registered"
        description="x"
        submitButtonText="Close"
        submitButtonType={ButtonStyleType.SUCCESS}
        onSubmit={() => {}}
      />`),
    ).toEqual(["dismissal-coloured"]);

    expect(
      rulesOf(`<ConfirmModal
        title="Synced"
        description="x"
        submitButtonText="OK"
        submitButtonType={ButtonStyleType.PRIMARY}
        onSubmit={() => {}}
      />`),
    ).toEqual(["dismissal-coloured"]);
  });

  test("a coloured Cancel or Close is flagged", () => {
    expect(
      rulesOf(`<Modal
        title="Monitors Added"
        closeButtonText="Done"
        closeButtonStyleType={ButtonStyleType.PRIMARY}
        onClose={() => {}}
      ><div /></Modal>`),
    ).toEqual(["cancel-coloured"]);

    expect(
      rulesOf(`<ConfirmModal
        title="x"
        description="x"
        submitButtonText="Archive"
        closeButtonType={ButtonStyleType.DANGER}
        onSubmit={() => {}}
        onClose={() => {}}
      />`),
    ).toEqual(["cancel-coloured", "two-primaries"]);
  });

  test("a SideOver always has Close, so a Done submit is a second way out", () => {
    expect(
      rulesOf(`<SideOver title="x" description="x" onClose={() => {}} onSubmit={() => {}} submitButtonText="Done"><div /></SideOver>`),
    ).toEqual(["dismissal-coloured", "two-dismissals"]);

    expect(
      rulesOf(`<SideOver title="x" description="x" onClose={() => {}} onSubmit={() => {}} submitButtonText="Create Monitors"><div /></SideOver>`),
    ).toEqual([]);
  });
});

describe("destructive actions are DANGER", () => {
  test("Delete and Remove that are not red are flagged, in templates too", () => {
    expect(
      rulesOf(`<BasicFormModal
        title="Remove Labels"
        submitButtonText="Remove Labels"
        onSubmit={() => {}}
        onClose={() => {}}
        formProps={{ fields: [] }}
      />`),
    ).toEqual(["destructive-not-danger"]);

    expect(
      rulesOf(`<ConfirmModal
        title="x"
        description="x"
        submitButtonText={\`Delete \${name}\`}
        submitButtonType={ButtonStyleType.PRIMARY}
        onSubmit={() => {}}
        onClose={() => {}}
      />`),
    ).toEqual(["destructive-not-danger"]);

    expect(
      rulesOf(`<ConfirmModal
        title="x"
        description="x"
        submitButtonText="Delete"
        submitButtonType={ButtonStyleType.DANGER}
        onSubmit={() => {}}
        onClose={() => {}}
      />`),
    ).toEqual([]);
  });
});

describe("one filled button per dialog", () => {
  test("a primary button beside the primary submit is flagged, wherever it is written", () => {
    expect(
      rulesOf(`<Modal
        title="Save"
        onSubmit={() => {}}
        onClose={() => {}}
        leftFooterElement={<Button title="Test" buttonStyle={ButtonStyleType.PRIMARY} />}
      ><div /></Modal>`),
    ).toEqual(["two-primaries"]);

    expect(
      rulesOf(`<Modal title="Save" onSubmit={() => {}} onClose={() => {}}>
        <div><Button title="Check now" buttonStyle={ButtonStyleType.PRIMARY} /></div>
      </Modal>`),
    ).toEqual(["two-primaries"]);

    // A filled red button competes just the same.
    expect(
      rulesOf(`<Modal title="Save" onSubmit={() => {}} onClose={() => {}}>
        <Button title="Try again" buttonStyle={ButtonStyleType.DANGER} />
      </Modal>`),
    ).toEqual(["two-primaries"]);
  });

  test("a button in a list counts once per row, even with no other primary", () => {
    expect(
      rulesOf(`<Modal title="Run a Runbook" onClose={() => {}}>
        <ul>{runbooks.map((runbook) => {
          return <Button title="Run" buttonStyle={ButtonStyleType.PRIMARY} />;
        })}</ul>
      </Modal>`),
    ).toEqual(["two-primaries"]);

    expect(
      rulesOf(`<Modal title="Run a Runbook" onClose={() => {}}>
        <ul>{runbooks.map((runbook) => {
          return <Button title="Run" buttonStyle={ButtonStyleType.NORMAL} />;
        })}</ul>
      </Modal>`),
    ).toEqual([]);
  });

  test("plain and outline extras, and one primary in a dialog with no submit, pass", () => {
    expect(
      rulesOf(`<Modal
        title="Save"
        onSubmit={() => {}}
        onClose={() => {}}
        leftFooterElement={<Button title="Delete" buttonStyle={ButtonStyleType.DANGER_OUTLINE} />}
      >
        <Button title="Preview" buttonStyle={ButtonStyleType.OUTLINE} />
      </Modal>`),
    ).toEqual([]);

    expect(
      rulesOf(`<Modal title="Verify" onClose={() => {}} closeButtonText="Close">
        <Button title="I've sent the message — check" buttonStyle={ButtonStyleType.PRIMARY} />
      </Modal>`),
    ).toEqual([]);
  });

  test("a nested dialog's buttons belong to the nested dialog", () => {
    expect(
      rulesOf(`<Modal title="Step settings" onSubmit={() => {}} onClose={() => {}}>
        <ConfirmModal
          title="Run this step now?"
          description="x"
          submitButtonText="Run this step"
          onSubmit={() => {}}
          onClose={() => {}}
        />
      </Modal>`),
    ).toEqual([]);
  });

  test("card-button schemas inside a dialog count too", () => {
    expect(
      rulesOf(`<Modal title="x" onSubmit={() => {}} onClose={() => {}}>
        <Card buttons={[{ title: "Add", buttonStyle: ButtonStyleType.PRIMARY }]} />
      </Modal>`),
    ).toEqual(["two-primaries"]);
  });
});

describe("ternaries", () => {
  test("props that branch on the same condition are read as consistent footers", () => {
    // A notice when it cannot be retried, a confirmation when it can.
    expect(
      rulesOf(`<ConfirmModal
        title="Notification"
        description="x"
        submitButtonText={isRetryable ? "Resend" : "Close"}
        submitButtonType={isRetryable ? ButtonStyleType.PRIMARY : ButtonStyleType.NORMAL}
        closeButtonText={isRetryable ? "Close" : undefined}
        onClose={isRetryable ? () => {} : undefined}
        onSubmit={() => {}}
      />`),
    ).toEqual([]);
  });

  test("a branch that breaks the rule is still found", () => {
    expect(
      rulesOf(`<ConfirmModal
        title="Notification"
        description="x"
        submitButtonText={isRetryable ? "Resend" : "Close"}
        submitButtonType={isRetryable ? ButtonStyleType.NORMAL : ButtonStyleType.NORMAL}
        onClose={() => {}}
        onSubmit={() => {}}
      />`),
    ).toEqual(["action-not-primary", "two-dismissals"]);
  });

  test("an onSubmit that goes away leaves a single way out", () => {
    expect(
      rulesOf(`<Modal
        title="Import Groups from CSV"
        closeButtonText={hasImported ? "Done" : "Cancel"}
        submitButtonText="Import"
        onSubmit={hasImported ? undefined : () => {}}
        onClose={() => {}}
      ><div /></Modal>`),
    ).toEqual([]);
  });
});

describe("what the detector reads, and what it does not", () => {
  test("translation keys are read in the feature set's English", () => {
    const locale: LocaleLookup = (key: string): string | null => {
      return key === "common.close" ? "Close" : null;
    };

    expect(
      rulesOf(
        `<ConfirmModal
          title="Version"
          description="x"
          submitButtonText={t("common.close")}
          submitButtonType={ButtonStyleType.PRIMARY}
          onSubmit={() => {}}
        />`,
        locale,
      ),
    ).toEqual(["dismissal-coloured"]);

    // tx() translates English text, which is its own key.
    expect(
      rulesOf(`<ConfirmModal
        title="x"
        description="x"
        submitButtonText={tx("Close")}
        submitButtonType={ButtonStyleType.PRIMARY}
        onSubmit={() => {}}
      />`),
    ).toEqual(["dismissal-coloured"]);
  });

  test("a dialog is recognised by the module it comes from, under any name", () => {
    const aliased: string = `
import Dialog from "../Modal/Modal";
import { ButtonStyleType } from "../Button/Button";
const X = () => <Dialog title="x" onSubmit={() => {}} onClose={() => {}} submitButtonText="Close"><div /></Dialog>;
`;

    expect(
      analyzeDialogSource("packages/Common/UI/Components/X/X.tsx", aliased).map(
        (finding: DialogFinding): string => {
          return finding.rule;
        },
      ),
    ).toEqual(["dismissal-coloured", "two-dismissals"]);

    const localModal: string = `
import Modal from "./MyOwnModal";
const X = () => <Modal title="x" onSubmit={() => {}} onClose={() => {}} submitButtonText="Close"><div /></Modal>;
`;

    expect(analyzeDialogSource(FILE, localModal)).toEqual([]);
    expect(listDialogSites(FILE, localModal)).toEqual([]);
  });

  test("a wrapper that spreads its props into the dialog is left to its callers", () => {
    expect(
      rulesOf(`<Modal {...props} submitButtonText="Close" onSubmit={() => {}} onClose={() => {}}><div /></Modal>`),
    ).toEqual([]);
  });

  test("lists every dialog it looked at, with its title", () => {
    const source: string = `${IMPORTS}
const X = () => (
  <>
    <ConfirmModal title="Run this step now?" description="x" onSubmit={() => {}} />
    <Modal title={\`Delete \${name}\`} onClose={() => {}}><div /></Modal>
  </>
);
`;

    expect(
      listDialogSites(FILE, source).map((site: { title: string }): string => {
        return site.title;
      }),
    ).toEqual(["Run this step now?", "Delete …"]);
  });

  test("the failure message names the file, line, dialog and rule", () => {
    const source: string = `${IMPORTS}
const X = () => (
  <ConfirmModal
    title="Run this step now?"
    description="x"
    submitButtonText="Run this step"
    submitButtonType={ButtonStyleType.NORMAL}
    onSubmit={() => {}}
    onClose={() => {}}
  />
);
`;
    const message: string = formatDialogFindings(
      analyzeDialogSource(FILE, source),
    );

    expect(message).toContain(`${FILE}:10`);
    expect(message).toContain('<ConfirmModal> "Run this step now?"');
    expect(message).toContain("[action-not-primary]");
    expect(message).toContain('"Run this step" is what the dialog is for');
  });
});

describe("buttons drawn side by side", () => {
  type GroupsOfFunction = (body: string) => Array<string>;

  const groupsOf: GroupsOfFunction = (body: string): Array<string> => {
    return findButtonGroupsWithTwoFilled(FILE, `${IMPORTS}\n${body}`).map(
      (group: ButtonGroupWithTwoFilled): string => {
        return `${group.kind}: ${group.labels.join(" | ")}`;
      },
    );
  };

  test("two filled schemas in a card's buttons are flagged", () => {
    expect(
      groupsOf(`const X = () => (
        <Card
          title="Slack"
          buttons={[
            { title: "Connect", buttonStyle: ButtonStyleType.PRIMARY },
            { title: "View Channels", buttonStyle: ButtonStyleType.NORMAL },
            { title: "Uninstall", buttonStyle: ButtonStyleType.DANGER },
          ]}
        />
      );`),
    ).toEqual(["button-schemas: Connect | Uninstall"]);
  });

  test("a schema returned by a local helper is read through the call", () => {
    expect(
      groupsOf(`const getConnectButton = (title: string) => {
        return { title: title || "Connect", buttonStyle: ButtonStyleType.PRIMARY };
      };
      const buttons = [
        getConnectButton("Connect my account"),
        { title: "Uninstall", buttonStyle: ButtonStyleType.DANGER },
      ];`),
    ).toEqual(['button-schemas: title || "Connect" | Uninstall']);
  });

  test("one filled button among plain and outlined ones passes", () => {
    expect(
      groupsOf(`const buttons = [
        { title: "Connect", buttonStyle: ButtonStyleType.PRIMARY },
        { title: "Uninstall", buttonStyle: ButtonStyleType.DANGER_OUTLINE },
        { title: "Docs", buttonStyle: ButtonStyleType.OUTLINE },
      ];`),
    ).toEqual([]);
  });

  test("sibling filled <Button>s are flagged; a ternary's two sides count once", () => {
    expect(
      groupsOf(`const X = () => (
        <div>
          <Button title="Save" buttonStyle={ButtonStyleType.PRIMARY} />
          {canTest && <Button title="Test" buttonStyle={ButtonStyleType.PRIMARY} />}
        </div>
      );`),
    ).toEqual(["sibling-buttons: Save | Test"]);

    expect(
      groupsOf(`const X = () => (
        <div>
          {isEditing ? (
            <Button title="Save" buttonStyle={ButtonStyleType.PRIMARY} />
          ) : (
            <Button title="Edit" buttonStyle={ButtonStyleType.PRIMARY} />
          )}
          <Button title="Cancel" buttonStyle={ButtonStyleType.NORMAL} />
        </div>
      );`),
    ).toEqual([]);
  });

  test("ButtonStyleType is read under the name the file imported it as", () => {
    const source: string = `
import { ButtonStyleType as SharedButtonStyle } from "Common/UI/Components/Button/Button";
const buttons = [
  { title: "Connect", buttonStyle: SharedButtonStyle.PRIMARY },
  { title: "Uninstall", buttonStyle: SharedButtonStyle.DANGER },
];
`;

    expect(
      findButtonGroupsWithTwoFilled(FILE, source).map(
        (group: ButtonGroupWithTwoFilled): Array<string> => {
          return group.labels;
        },
      ),
    ).toEqual([["Connect", "Uninstall"]]);
  });
});

describe("filled buttons repeated on every row, outside dialogs", () => {
  test("are found, with their label and style", () => {
    const source: string = `${IMPORTS}
const X = () => (
  <ul>
    {numbers.map((number) => {
      return <Button title="Reserve" buttonStyle={ButtonStyleType.SUCCESS} />;
    })}
    <Button title="Add" buttonStyle={ButtonStyleType.PRIMARY} />
  </ul>
);
`;

    expect(
      findRepeatedFilledButtons(FILE, source).map(
        (button: RepeatedFilledButton): string => {
          return `${button.label} ${button.style}`;
        },
      ),
    ).toEqual(["Reserve SUCCESS"]);
  });

  test("plain per-row buttons and buttons inside dialogs are not reported here", () => {
    const source: string = `${IMPORTS}
const X = () => (
  <>
    {rows.map((row) => {
      return <Button title="Select" buttonStyle={ButtonStyleType.NORMAL} />;
    })}
    <Modal title="x" onClose={() => {}}>
      {rows.map((row) => {
        return <Button title="Run" buttonStyle={ButtonStyleType.PRIMARY} />;
      })}
    </Modal>
  </>
);
`;

    expect(findRepeatedFilledButtons(FILE, source)).toEqual([]);
  });
});
