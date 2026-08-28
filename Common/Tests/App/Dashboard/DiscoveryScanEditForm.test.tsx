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
   */
  test("offers every setting the create wizard collects", async () => {
    await openEditDialog();

    const wizardKeys: Array<string> = (
      capturedTableProps?.formFields || []
    ).map(fieldKeyOf);

    expect(editFieldKeys()).toEqual(wizardKeys);

    for (const key of [
      "name",
      "cidr",
      "probe",
      "snmpVersion",
      "snmpCommunityString",
      "snmpPort",
      "snmpV3SecurityLevel",
      "snmpV3Username",
      "snmpV3AuthProtocol",
      "snmpV3AuthKey",
      "snmpV3PrivProtocol",
      "snmpV3PrivKey",
      "isRecurring",
      "rescanIntervalInMinutes",
    ]) {
      expect(editFieldKeys()).toContain(key);
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
   * second set of validators to keep in step, and the copy that drifted would
   * be this one — the one nobody exercises until they are already trying to
   * fix a scan that is not working.
   */
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
