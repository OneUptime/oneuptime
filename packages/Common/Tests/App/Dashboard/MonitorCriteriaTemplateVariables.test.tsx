import "@testing-library/jest-dom";
import type { Mock } from "jest-mock";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import MonitorCriteriaAlertForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorCriteriaAlertForm";
import MonitorCriteriaIncidentForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorCriteriaIncidentForm";
import MonitorCriteriaTemplateCopy from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorCriteriaTemplateCopy";
import { CriteriaAlert } from "../../../Types/Monitor/CriteriaAlert";
import { CriteriaIncident } from "../../../Types/Monitor/CriteriaIncident";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";

/*
 * A monitor rule's incident and alert carry templates - the title, the
 * description and the remediation notes are filled in from the monitor
 * ({{monitorName}}, what the check saw) when the rule fires. The description
 * and remediation notes are Markdown editors, and they now offer those
 * variables themselves: collapsed under each editor, behind its Insert
 * variable button, and under the cursor when "{{" is typed - the variables
 * of this monitor's type. Their help used to end in a link to a dialog to
 * copy a variable from; the title, a plain text box, keeps that link.
 */

afterEach(() => {
  cleanup();
});

const DROPDOWNS: {
  onCallPolicyDropdownOptions: [];
  labelDropdownOptions: [];
  teamDropdownOptions: [];
  userDropdownOptions: [];
} = {
  onCallPolicyDropdownOptions: [],
  labelDropdownOptions: [],
  teamDropdownOptions: [],
  userDropdownOptions: [],
};

function incident(overrides: Partial<CriteriaIncident>): CriteriaIncident {
  return {
    id: ObjectID.generate().toString(),
    title: "{{monitorName}} is offline",
    description: "",
    incidentSeverityId: undefined,
    ...overrides,
  };
}

function alert(overrides: Partial<CriteriaAlert>): CriteriaAlert {
  return {
    id: ObjectID.generate().toString(),
    title: "{{monitorName}} is degraded",
    description: "",
    alertSeverityId: undefined,
    ...overrides,
  };
}

function editorLists(): Array<HTMLElement> {
  return screen.getAllByTestId("markdown-editor-template-variables");
}

describe.each([
  [
    "incident",
    (
      monitorType: MonitorType,
      onChange?: (value: CriteriaIncident) => void,
    ) => {
      render(
        <MonitorCriteriaIncidentForm
          initialValue={incident({
            description: "Down",
            remediationNotes: "Check it",
          })}
          incidentSeverityDropdownOptions={[]}
          monitorType={monitorType}
          onChange={onChange}
          {...DROPDOWNS}
        />,
      );
    },
    MonitorCriteriaTemplateCopy.incidentDescriptionHelp,
    MonitorCriteriaTemplateCopy.incidentRemediationHelp,
    MonitorCriteriaTemplateCopy.incidentVariablesDescription,
  ],
  [
    "alert",
    (monitorType: MonitorType, onChange?: (value: CriteriaAlert) => void) => {
      render(
        <MonitorCriteriaAlertForm
          initialValue={alert({
            description: "Down",
            remediationNotes: "Check it",
          })}
          alertSeverityDropdownOptions={[]}
          monitorType={monitorType}
          onChange={onChange}
          {...DROPDOWNS}
        />,
      );
    },
    MonitorCriteriaTemplateCopy.alertDescriptionHelp,
    MonitorCriteriaTemplateCopy.alertRemediationHelp,
    MonitorCriteriaTemplateCopy.alertVariablesDescription,
  ],
])(
  "a monitor rule's %s",
  (
    _kind: string,
    renderForm: (
      monitorType: MonitorType,
      onChange?: (value: any) => void,
    ) => void,
    descriptionHelp: string,
    remediationHelp: string,
    variablesDescription: string,
  ) => {
    test("its description and remediation notes editors both offer the monitor's variables", () => {
      renderForm(MonitorType.API);

      const lists: Array<HTMLElement> = editorLists();

      expect(lists).toHaveLength(2);

      for (const list of lists) {
        expect(list).not.toHaveAttribute("open");
        expect(within(list).getByText("{{monitorName}}")).toBeInTheDocument();
        expect(list).toHaveTextContent(variablesDescription);
      }

      expect(
        screen.getAllByTestId("markdown-editor-insert-variable"),
      ).toHaveLength(2);
    });

    test("the variables are this monitor type's", () => {
      renderForm(MonitorType.SSLCertificate);

      const list: HTMLElement = editorLists()[0]!;

      // An SSL monitor's own variables are there; an API monitor's are not.
      expect(within(list).getByText("{{commonName}}")).toBeInTheDocument();
      expect(within(list).queryByText("{{responseStatusCode}}")).toBeNull();
    });

    test("their help says what the field is for, without a link to copy variables from", () => {
      renderForm(MonitorType.API);

      expect(screen.getByText(descriptionHelp)).toBeInTheDocument();
      expect(screen.getByText(remediationHelp)).toBeInTheDocument();
      // Only the title, a plain text box, keeps the link.
      expect(
        screen.getAllByRole("button", {
          name: "Learn about dynamic templates",
        }),
      ).toHaveLength(1);
    });

    test("a variable picked in the description goes into the rule", () => {
      const onChange: Mock<(value: any) => void> =
        jest.fn<(value: any) => void>();

      renderForm(MonitorType.API, onChange);

      const card: HTMLElement = within(editorLists()[0]!)
        .getAllByTestId("template-variable-insert")
        .find((element: HTMLElement): boolean => {
          return element.dataset["variableName"] === "monitorName";
        })!;

      act(() => {
        fireEvent.click(card);
      });

      const calls: Array<Array<any>> = onChange.mock.calls;
      const last: any = calls[calls.length - 1]?.[0];

      expect(last.description).toContain("{{monitorName}}");
    });
  },
);
