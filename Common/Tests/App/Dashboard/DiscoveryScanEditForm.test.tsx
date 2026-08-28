import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * The wiring half of OneUptime issue #3444.
 *
 * A discovery scan's settings used to be fixed at creation. A typo'd subnet, a
 * probe on the wrong side of a firewall, a community string the devices
 * reject, a one-time scan that should have repeated — each of them could only
 * be fixed by deleting the scan, losing its results, and building it again.
 * The row actions were Rename, Review Results and Delete, and none of them
 * touched the sweep.
 *
 * The dialog that fixes this is configuration, not markup: an action button
 * whose onClick opens a ModelFormModal whose formProps carry the field set.
 * Every way of getting it wrong is silent — a field dropped from the array
 * simply cannot be edited, a validator dropped from a field simply stops
 * being enforced, `formType` left at Create posts a new scan instead of
 * saving this one — so the modal is mocked to capture those props and they
 * are asserted directly. Same approach as
 * DiscoveryScanWizardValidation.test.tsx, which does this for the create
 * wizard on the same page.
 */

type CapturedFormField = {
  field: Record<string, boolean>;
  title?: string | undefined;
  stepId?: string | undefined;
  sectionTitle?: string | undefined;
  required?: boolean | undefined;
  customValidation?:
    | ((values: Record<string, unknown>) => string | null)
    | undefined;
  showIf?: ((values: Record<string, unknown>) => boolean) | undefined;
  dropdownOptions?: Array<{ label: string; value: string }> | undefined;
  /*
   * The scan-method toggle's handler. Captured because hiding the credential
   * fields is only half of turning SNMP off — the other half is clearing the
   * values already typed into them, and that happens here.
   */
  onChange?:
    | ((
        value: boolean,
        currentFormValues: Record<string, unknown>,
        setNewFormValues: (values: Record<string, unknown>) => void,
      ) => void)
    | undefined;
};

type CapturedActionButton = {
  title?: string | undefined;
  icon?: unknown;
  isVisible?: ((item: NetworkDeviceDiscoveryScan) => boolean) | undefined;
  onClick?:
    | ((
        item: NetworkDeviceDiscoveryScan,
        onCompleteAction: VoidFunction,
      ) => Promise<void>)
    | undefined;
};

type CapturedTableProps = {
  formFields?: Array<CapturedFormField>;
  formSteps?: Array<{ id: string; title: string }>;
  actionButtons?: Array<CapturedActionButton>;
  isEditable?: boolean | undefined;
};

type CapturedModalProps = {
  title?: string | undefined;
  description?: string | undefined;
  footer?: React.ReactElement | undefined;
  submitButtonText?: string | undefined;
  modelIdToEdit?: { toString: () => string } | undefined;
  formProps?:
    | {
        formType?: unknown;
        fields?: Array<CapturedFormField>;
        steps?: Array<{ id: string; title: string }> | undefined;
        id?: string | undefined;
      }
    | undefined;
};

let capturedTableProps: CapturedTableProps | null = null;
let capturedModalProps: CapturedModalProps | null = null;

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: CapturedTableProps) => {
      capturedTableProps = props;
      return null;
    },
  };
});

jest.mock("../../../UI/Components/ModelFormModal/ModelFormModal", () => {
  return {
    __esModule: true,
    default: (props: CapturedModalProps) => {
      capturedModalProps = props;
      return null;
    },
  };
});

import DiscoveryPage from "../../../../App/FeatureSet/Dashboard/src/Pages/NetworkDevice/Discovery";
import ProbeUtil from "../../../../App/FeatureSet/Dashboard/src/Utils/Probe";
import { FormType } from "../../../UI/Components/Forms/ModelForm";
import Project from "../../../Models/DatabaseModels/Project";
import Probe from "../../../Models/DatabaseModels/Probe";
import ProjectUtil from "../../../UI/Utils/Project";
import PermissionUtil from "../../../UI/Utils/Permission";
import Permission from "../../../Types/Permission";
import ScanTargetUtil from "../../../Utils/NetworkDiscovery/ScanTargetUtil";
import SnmpScanConfigUtil from "../../../Utils/NetworkDiscovery/SnmpScanConfigUtil";
import NetworkDeviceDiscoveryScan from "../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import ObjectID from "../../../Types/ObjectID";
import Route from "../../../Types/API/Route";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const PROBE_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const SCAN_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

function editFields(): Array<CapturedFormField> {
  return capturedModalProps?.formProps?.fields || [];
}

function fieldKeyOf(field: CapturedFormField): string {
  return Object.keys(field.field || {})[0] as string;
}

function editFieldKeys(): Array<string> {
  return editFields().map(fieldKeyOf);
}

function editFieldNamed(key: string): CapturedFormField {
  const field: CapturedFormField | undefined = editFields().find(
    (candidate: CapturedFormField): boolean => {
      return fieldKeyOf(candidate) === key;
    },
  );

  if (!field) {
    throw new Error(`Edit dialog field "${key}" not found`);
  }

  return field;
}

function editAction(): CapturedActionButton {
  const action: CapturedActionButton | undefined = (
    capturedTableProps?.actionButtons || []
  ).find((button: CapturedActionButton): boolean => {
    return button.title === "Edit";
  });

  if (!action) {
    throw new Error("The scans table has no Edit action");
  }

  return action;
}

function storedScan(): NetworkDeviceDiscoveryScan {
  const scan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan();

  scan.id = SCAN_ID;
  scan.cidr = "192.168.1.0/24";
  scan.status = "Completed";

  return scan;
}

async function renderPage(): Promise<void> {
  const project: Project = new Project();
  project.id = PROJECT_ID;

  render(
    <MemoryRouter>
      <DiscoveryPage
        pageRoute={new Route("/dashboard/network-devices/discovery")}
        currentProject={project}
        hasPaymentMethod={true}
      />
    </MemoryRouter>,
  );

  // The page renders a loader until its probe fetch settles.
  await waitFor(() => {
    expect(capturedTableProps).not.toBeNull();
  });
}

// Open the dialog the way the operator does: press the row's Edit button.
async function openEditDialog(): Promise<void> {
  await renderPage();

  const onClick: CapturedActionButton["onClick"] = editAction().onClick;

  if (!onClick) {
    throw new Error("The Edit action does nothing when clicked");
  }

  await act(async () => {
    await onClick(storedScan(), () => {});
  });

  await waitFor(() => {
    expect(capturedModalProps).not.toBeNull();
  });
}

describe("Editing a discovery scan after it was created", () => {
  beforeEach(() => {
    capturedTableProps = null;
    capturedModalProps = null;

    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);

    const probe: Probe = new Probe();
    probe._id = PROBE_ID.toString();
    probe.name = "Region 1100 probe";

    jest.spyOn(ProbeUtil, "getAllProbes").mockResolvedValue([probe] as never);

    jest
      .spyOn(PermissionUtil, "getAllPermissions")
      .mockReturnValue([Permission.ProjectAdmin]);
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
    capturedTableProps = null;
    capturedModalProps = null;
  });

  test("nothing opens until the operator asks for it", async () => {
    await renderPage();

    expect(capturedModalProps).toBeNull();
  });

  test("the dialog edits the scan that was clicked, rather than creating one", async () => {
    await openEditDialog();

    expect(capturedModalProps?.formProps?.formType).toBe(FormType.Update);
    expect(capturedModalProps?.modelIdToEdit?.toString()).toBe(
      SCAN_ID.toString(),
    );
    expect(capturedModalProps?.submitButtonText).toBe("Save Changes");
  });

  /*
   * The issue's actual complaint, field by field: the target, the probe, the
   * credentials and the schedule. Asserted as a set rather than a count, so a
   * new field on the create wizard that is not offered for editing is a
   * failure here rather than a discovery months later.
   *
   * The credentials are ONE key now, not nine. The SNMP step used to spread
   * getSnmpConfigFormFields — snmpVersion, snmpCommunityString, snmpPort and
   * the six v3 fields, flat — which allowed exactly one credential set per
   * scan. A scan now carries an ORDERED LIST of them and tries each in turn
   * (OneUptime issue #3458), and a repeated block cannot be expressed as
   * Fields, so the nine are replaced by a single CustomComponent field bound
   * to the `snmpConfigs` column. The list still has to be editable after
   * creation — a rejected community string is exactly the kind of thing this
   * dialog exists to correct — so it is named here like every other setting.
   *
   * `isSnmpEnabled` is named here for the same reason and a sharper one
   * (OneUptime issue #3445): it is the scan's METHOD, and a scan created as
   * ICMP-only with no way to turn SNMP back on is the delete-and-recreate loop
   * this dialog was built to end, one field further along. Asserted as an
   * exact list rather than a set of `toContain` calls, so a tenth flat field
   * creeping back onto the wizard fails here too.
   */
  test("offers every setting the create wizard collects", async () => {
    await openEditDialog();

    const wizardKeys: Array<string> = (
      capturedTableProps?.formFields || []
    ).map(fieldKeyOf);

    expect(editFieldKeys()).toEqual(wizardKeys);

    expect(editFieldKeys()).toEqual([
      "name",
      "cidr",
      "probe",
      "isSnmpEnabled",
      "snmpConfigs",
      "isRecurring",
      "rescanIntervalInMinutes",
    ]);
  });

  /*
   * Where the two changes meet, and the case neither of them can state alone.
   *
   * An ICMP-only scan (issue #3445) stores no credentials, and the credential
   * list (issue #3458) is `required: true` with a validator of its own. Those
   * two facts collide in exactly one place: a scan whose method is off must
   * not be judged by the credential rules, or the Edit dialog refuses to save
   * a ping sweep because it is missing credentials it will never send.
   *
   * Validation.validate skips a field whose `showIf` says it is hidden, so
   * that gate is the whole mechanism — and it is asserted here against the
   * EDIT dialog specifically. The wizard has a second line of defence in the
   * step-level showIf on the SNMP step, which filters the step out entirely;
   * the edit dialog has no steps at all, so the field-level `showIf` is the
   * only thing standing between an ICMP-only scan and an unsavable form.
   */
  test("stops asking for credentials once the scan is ICMP-only", async () => {
    await openEditDialog();

    const snmpConfigs: CapturedFormField = editFieldNamed("snmpConfigs");

    expect(snmpConfigs.required).toBe(true);
    expect(snmpConfigs.showIf).toBeDefined();

    // The method is on: the list is shown, and its rules apply.
    expect(snmpConfigs.showIf?.({ isSnmpEnabled: true })).toBe(true);

    // Turned off: hidden, so neither `required` nor the validator can speak.
    expect(snmpConfigs.showIf?.({ isSnmpEnabled: false })).toBe(false);

    /*
     * And ABSENT means shown. A scan row written before the column existed,
     * or one whose `select` did not ask for it, arrives here as undefined —
     * and every one of those scans is an SNMP scan, so hiding the editor for
     * them would blank a credential list the scan is really carrying. This is
     * ScanModeUtil's `!== false` read, reaching the form through
     * isIcmpOnlyScan.
     */
    expect(snmpConfigs.showIf?.({})).toBe(true);
  });

  /*
   * The same interaction from the other end: turning the method off has to
   * take the credentials with it.
   *
   * Hiding the editor is not enough on its own. ModelForm builds the request
   * body from every DECLARED field without asking whether it was visible, so a
   * list of v3 passphrases typed before the operator changed their mind would
   * be posted — and stored — on a scan that will never send one. The toggle's
   * own onChange is what clears it, and this is the edit dialog's copy of that
   * toggle, so the guarantee is pinned on the form the operator uses to make
   * exactly this change to an EXISTING scan.
   */
  test("clears the credential list when the method is turned off", async () => {
    await openEditDialog();

    const isSnmpEnabled: CapturedFormField = editFieldNamed("isSnmpEnabled");

    expect(isSnmpEnabled.onChange).toBeDefined();

    const before: Record<string, unknown> = {
      cidr: "192.168.1.0/24",
      isSnmpEnabled: true,
      snmpConfigs: [
        { id: "config-1", snmpVersion: "V2c", snmpCommunityString: "public" },
      ],
      snmpCommunityString: "public",
      snmpV3AuthKey: "auth-key",
      snmpV3PrivKey: "priv-key",
    };

    let after: Record<string, unknown> | null = null;

    isSnmpEnabled.onChange?.(
      false,
      before,
      (values: Record<string, unknown>) => {
        after = values;
      },
    );

    const cleared: Record<string, unknown> = after as unknown as Record<
      string,
      unknown
    >;

    expect(cleared).not.toBeNull();
    expect(cleared["isSnmpEnabled"]).toBe(false);
    expect(cleared["snmpConfigs"]).toBeUndefined();
    /*
     * The flattened columns go too. This form no longer collects them — the
     * server mirrors them from the list's first entry — but a value that
     * reached the form some other way must not ride along on a scan that will
     * never send SNMP.
     */
    expect(cleared["snmpCommunityString"]).toBeUndefined();
    expect(cleared["snmpV3AuthKey"]).toBeUndefined();
    expect(cleared["snmpV3PrivKey"]).toBeUndefined();
    /*
     * With ONE exception: the version is RESET to its default rather than
     * cleared. Clearing it leaves a required Dropdown holding nothing, which
     * then fails with "SNMP Version is required" against a control that
     * visibly reads V2c the moment the operator turns SNMP back on — issue
     * #3445's own symptom, reintroduced on the way out of it.
     */
    expect(cleared["snmpVersion"]).toBeDefined();
    // ...and the rest of the scan is untouched.
    expect(cleared["cidr"]).toBe("192.168.1.0/24");

    /*
     * Turning it back ON changes nothing by itself: the editor seeds its own
     * first card, and a handler that rewrote values here would fight it.
     */
    let touchedOnEnable: boolean = false;

    isSnmpEnabled.onChange?.(true, before, () => {
      touchedOnEnable = true;
    });

    expect(touchedOnEnable).toBe(false);
  });

  /*
   * The other half of that change, stated as its own guarantee: the flattened
   * columns are no longer collected ANYWHERE on this dialog.
   *
   * They still exist on the model — the server mirrors the first config onto
   * them so that a probe a version behind keeps working — but they are derived
   * now, not typed. Offering one of them here would give the operator a box
   * whose value the next save silently overwrites from the list, which is
   * worse than not offering it at all.
   */
  test("no longer offers the flattened SNMP columns the list replaced", async () => {
    await openEditDialog();

    for (const key of [
      "snmpVersion",
      "snmpCommunityString",
      "snmpPort",
      "snmpV3SecurityLevel",
      "snmpV3Username",
      "snmpV3AuthProtocol",
      "snmpV3AuthKey",
      "snmpV3PrivProtocol",
      "snmpV3PrivKey",
    ]) {
      expect(editFieldKeys()).not.toContain(key);
    }
  });

  /*
   * "Repeat this scan" is the setting named in the issue title, and the one
   * whose absence sent people to delete-and-recreate.
   */
  test("offers recurrence, which is what the report was about", async () => {
    await openEditDialog();

    const isRecurring: CapturedFormField = editFieldNamed("isRecurring");
    const interval: CapturedFormField = editFieldNamed(
      "rescanIntervalInMinutes",
    );

    expect(isRecurring.title).toBe("Repeat this scan");
    // The interval reveals itself off the toggle, exactly as in the wizard.
    expect(interval.showIf?.({ isRecurring: true })).toBe(true);
    expect(interval.showIf?.({ isRecurring: false })).toBe(false);
  });

  /*
   * One definition, two layouts. A second copy of the field array would be a
   * second set of descriptions, validators and reveal rules to keep in step,
   * and the copy that drifted would be this one — the one nobody exercises
   * until they are already trying to fix a scan that is not working.
   *
   * Compared field by field rather than by object identity: the factory builds
   * fresh objects for each form, deliberately, because ModelForm mutates the
   * field objects it is handed (it writes an inferred maxLength onto them) and
   * two forms must not share one mutable object.
   */
  test("describes every field exactly as the create wizard does", async () => {
    await openEditDialog();

    const wizardFields: Array<CapturedFormField> =
      capturedTableProps?.formFields || [];
    const formSteps: Array<{ id: string; title: string }> =
      capturedTableProps?.formSteps || [];

    expect(editFields()).toHaveLength(wizardFields.length);

    let headed: number = 0;
    const titledStepIds: Set<string> = new Set<string>();

    editFields().forEach((field: CapturedFormField, index: number) => {
      const wizardField: CapturedFormField = wizardFields[
        index
      ] as CapturedFormField;

      expect({
        key: fieldKeyOf(field),
        title: field.title,
        stepId: field.stepId,
        required: field.required,
        // Module-level functions, so identity is the right comparison here.
        customValidation: field.customValidation,
        hasShowIf: Boolean(field.showIf),
      }).toEqual({
        key: fieldKeyOf(wizardField),
        title: wizardField.title,
        stepId: wizardField.stepId,
        required: wizardField.required,
        customValidation: wizardField.customValidation,
        hasShowIf: Boolean(wizardField.showIf),
      });

      let expectedSectionTitle: string | undefined = wizardField.sectionTitle;

      /*
       * The edit layout adds each wizard step's title to the first field in
       * that step. Field-level subsection titles are part of the shared field
       * definition, though, and must survive unchanged in both layouts. The
       * scan-method toggle's "What to check" heading is one such subsection.
       */
      if (wizardField.stepId && !titledStepIds.has(wizardField.stepId)) {
        expectedSectionTitle = formSteps.find(
          (step: { id: string; title: string }): boolean => {
            return step.id === wizardField.stepId;
          },
        )?.title;

        expect(expectedSectionTitle).toBeDefined();
        titledStepIds.add(wizardField.stepId);
        headed++;
      }

      expect(field.sectionTitle).toBe(expectedSectionTitle);
    });

    expect(headed).toBe(formSteps.length);
    expect(
      wizardFields.find((field: CapturedFormField): boolean => {
        return fieldKeyOf(field) === "isSnmpEnabled";
      })?.sectionTitle,
    ).toBe("What to check");

    // And the validators are really wired, not merely identical undefineds.
    expect(
      editFieldNamed("cidr").customValidation?.({ cidr: "10.0.0.0/33" }),
    ).toBe(ScanTargetUtil.getValidationError("10.0.0.0/33"));
    expect(
      editFieldNamed("rescanIntervalInMinutes").customValidation,
    ).toBeDefined();
    expect(editFieldNamed("name").customValidation).toBeDefined();

    /*
     * The credential list included. Its validator is `validateSnmpConfigs`, a
     * MODULE-LEVEL const in DiscoveryScanFormValidation rather than an arrow
     * written inline in the field factory — which is what makes the identity
     * comparison above meaningful for it. An inline closure would be a fresh
     * function object on each of the two calls the page makes to the factory,
     * so this test would fail even though both forms enforced the same rule;
     * the const is the fix, and this assertion is what would notice it being
     * inlined again.
     */
    expect(
      editFieldNamed("snmpConfigs").customValidation?.({ snmpConfigs: [] }),
    ).toBe(SnmpScanConfigUtil.getValidationError([]));
  });

  test("offers the probes that were fetched for the create wizard", async () => {
    await openEditDialog();

    expect(editFieldNamed("probe").dropdownOptions).toEqual([
      { label: "Region 1100 probe", value: PROBE_ID.toString() },
    ]);
  });

  /*
   * Not a wizard. A stepped form has no Back button — the only way backwards
   * is the step rail, which BasicForm hides below the `lg` breakpoint — and
   * three "Next" clicks to reach the toggle you came to flip is the wrong
   * shape for a repair. The wizard's step titles survive as section headings
   * so the grouping is not lost with the steps.
   */
  test("lays the settings out on one page, under the wizard's own headings", async () => {
    await openEditDialog();

    expect(capturedModalProps?.formProps?.steps).toBeUndefined();

    const headings: Array<string> = editFields()
      .map((field: CapturedFormField): string | undefined => {
        return field.sectionTitle;
      })
      .filter((title: string | undefined): boolean => {
        return Boolean(title);
      }) as Array<string>;

    /*
     * NOT simply the step titles in order any more, which is what this
     * assertion used to be. The scan-method toggle carries a subsection
     * heading of its own ("What to check") in the middle of the Scan Target
     * group, so the edit dialog's headings are the step titles INTERLEAVED
     * with the field-level ones — and an assertion that only knew about steps
     * would have to be relaxed to accommodate that, which would stop it
     * noticing a step heading going missing.
     *
     * Rebuilt from the wizard's own fields instead: first field of a step
     * contributes that step's title (the edit layout overwrites its
     * sectionTitle with it), every other field contributes whatever
     * sectionTitle it declares. That keeps the assertion exact while staying
     * true for both kinds of heading.
     */
    const wizardFields: Array<CapturedFormField> =
      capturedTableProps?.formFields || [];
    const formSteps: Array<{ id: string; title: string }> =
      capturedTableProps?.formSteps || [];
    const titledStepIds: Set<string> = new Set<string>();
    const expectedHeadings: Array<string> = [];

    wizardFields.forEach((field: CapturedFormField): void => {
      if (field.stepId && !titledStepIds.has(field.stepId)) {
        const stepTitle: string | undefined = formSteps.find(
          (step: { id: string; title: string }): boolean => {
            return step.id === field.stepId;
          },
        )?.title;

        expect(stepTitle).toBeDefined();
        expectedHeadings.push(stepTitle as string);
        titledStepIds.add(field.stepId);
        return;
      }

      if (field.sectionTitle) {
        expectedHeadings.push(field.sectionTitle);
      }
    });

    expect(headings).toEqual(expectedHeadings);
    expect(headings).toContain("What to check");

    /*
     * A heading is carried by the FIRST field of its group, so which field
     * carries it is not decoration — it is where the group begins. The SNMP
     * group used to begin at `snmpVersion`, the first of nine flat fields;
     * it now begins at `snmpConfigs`, which is the only field on that step.
     * Pinned because the heading silently moves to whatever field happens to
     * come first, and a group that begins in the wrong place puts the
     * credentials under the schedule's heading with no other symptom.
     */
    expect(editFieldNamed("snmpConfigs").sectionTitle).toBe("SNMP Credentials");

    /*
     * And the toggle keeps its own heading rather than being promoted to a
     * group start. It sits in the MIDDLE of the Scan Target step, so if the
     * edit layout ever headed every field instead of the first of each step,
     * "What to check" would be replaced by a second "Scan Target" and the two
     * questions the step asks would read as one.
     */
    expect(editFieldNamed("isSnmpEnabled").sectionTitle).toBe("What to check");
  });

  /*
   * Changing the sweep clears the last run's hosts, and that is not something
   * to find out afterwards in an empty Review Results dialog.
   */
  test("says what changing the sweep will cost before it is saved", async () => {
    await openEditDialog();

    const footerElement: React.ReactElement | undefined =
      capturedModalProps?.footer;

    expect(footerElement).toBeDefined();

    /*
     * Rendered rather than inspected: what matters is the sentence the
     * operator reads, not which component carries it.
     */
    const { container } = render(<MemoryRouter>{footerElement}</MemoryRouter>);
    const warning: string = container.textContent || "";

    expect(warning).toContain("re-runs the scan");
    expect(warning).toContain("cleared");
    // ...and that a rename or a schedule change costs nothing.
    expect(warning).toContain("name or the schedule");
  });

  /*
   * The table itself must stay non-editable, or the operator gets two Edit
   * buttons: this one, and ModelTable's own — which has no room for the
   * warning above and no per-row visibility hook.
   */
  test("does not also turn on the table's built-in edit button", async () => {
    await renderPage();

    expect(capturedTableProps?.isEditable).toBe(false);
  });
});
