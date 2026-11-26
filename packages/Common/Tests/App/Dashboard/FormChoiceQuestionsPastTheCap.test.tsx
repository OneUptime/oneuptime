import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import CappedListServer, { namesSortingFirst } from "./CappedListServer";
import QuestionCard from "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/Builder/QuestionCard";
import FormsCopy from "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/FormsCopy";
import {
  FormQuestionData,
  getFormRecordOptionsWanted,
  loadFormQuestionData,
} from "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/Templates/FormQuestionData";
import {
  fitFormTemplateToQuestions,
  getFormTemplateEditorQuestions,
} from "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/Templates/FormTemplatesState";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Includes from "../../../Types/BaseDatabase/Includes";
import Search from "../../../Types/BaseDatabase/Search";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import { FormField, FormFieldSource } from "../../../Types/Form/FormField";
import {
  buildPublicForm,
  PublicFormField,
  PublicFormFieldOption,
} from "../../../Types/Form/FormPublic";
import { FormTargetOptionsSource } from "../../../Types/Form/FormTargetCatalog";
import { FormTemplate } from "../../../Types/Form/FormTemplate";
import FormTargetType from "../../../Types/Form/FormTargetType";
import ObjectID from "../../../Types/ObjectID";
import ProjectUtil from "../../../UI/Utils/Project";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * A FORM'S CHOICE QUESTIONS OFFER, AND KEEP, EVERY RECORD THEY NAME, HOWEVER
 * MANY THE PROJECT HAS (#10646).
 *
 * A question offering monitors names the ones it offers (allowedOptionIds).
 * The builder, the Templates page and Duplicate Form read the project's
 * monitors whole - the first 10,000 by name - and looked for those among
 * them. A monitor whose name sorts past the 10,000th ("WB1500KSK02") could
 * not be picked in the builder, read as nothing the question offers, and
 * was lost from the question the next time its "Choices offered" changed;
 * a template could not set it, and a copy's template lost its answer.
 *
 * Now the records a question offers are read by their ids, as the server
 * reads them for the public page, and "Choices offered" searches the
 * server. ModelAPI answers from a project faked whole (CappedListServer).
 */

const PROJECT_ID: string = "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const LATE_MONITOR_ID: string = "b0000000-0000-4000-8000-0000000000aa";
const OTHER_LATE_MONITOR_ID: string = "b0000000-0000-4000-8000-0000000000ab";
const DELETED_MONITOR_ID: string = "b0000000-0000-4000-8000-0000000000dd";
const LIVE_LABEL_ID: string = "c0000000-0000-4000-8000-000000000001";
const ARCHIVED_LABEL_ID: string = "c0000000-0000-4000-8000-0000000000ee";
const SEVERITY_ID: string = "a0000000-0000-4000-8000-000000000001";

const MONITORS_BEFORE_WB: number = LIMIT_PER_PROJECT + 50;

let server: CappedListServer;

beforeEach(() => {
  server = new CappedListServer();

  server.add(
    Monitor,
    namesSortingFirst(MONITORS_BEFORE_WB).map(
      (name: string): Record<string, unknown> => {
        return { _id: ObjectID.generate().toString(), name: name };
      },
    ),
  );
  server.add(Monitor, [
    { _id: LATE_MONITOR_ID, name: "WB1500KSK02" },
    { _id: OTHER_LATE_MONITOR_ID, name: "WB1500KSK03" },
  ]);
  server.add(Label, [
    { _id: LIVE_LABEL_ID, name: "customer-report", isArchived: false },
    { _id: ARCHIVED_LABEL_ID, name: "customer-old", isArchived: true },
  ]);
  server.add(IncidentSeverity, [
    { _id: SEVERITY_ID, name: "Major", order: 1, isArchived: false },
  ]);
  server.install();

  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
    new ObjectID(PROJECT_ID),
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

const monitorsQuestion: (allowed: Array<string>) => FormField = (
  allowed: Array<string>,
): FormField => {
  return {
    id: "monitors",
    source: FormFieldSource.TargetField,
    targetField: "monitors",
    label: "Affected Monitors",
    isRequired: false,
    allowedOptionIds: allowed,
  };
};

const labelsQuestion: (allowed: Array<string>) => FormField = (
  allowed: Array<string>,
): FormField => {
  return {
    id: "labels",
    source: FormFieldSource.TargetField,
    targetField: "labels",
    label: "Labels",
    isRequired: false,
    allowedOptionIds: allowed,
  };
};

const severityQuestion: FormField = {
  id: "severity",
  source: FormFieldSource.TargetField,
  targetField: "incidentSeverityId",
  label: "How bad?",
  isRequired: false,
};

// The options a question offers on the public page, as the page builds them.
const offeredBy: (data: {
  question: FormField;
  questionData: FormQuestionData;
}) => Array<string> = (data: {
  question: FormField;
  questionData: FormQuestionData;
}): Array<string> => {
  const field: PublicFormField | undefined = buildPublicForm({
    form: {
      name: "Report",
      fields: [data.question] as never,
      targetType: FormTargetType.Incident,
    },
    customFields: data.questionData.customFields,
    recordOptions: data.questionData.recordOptions,
    isCaptchaRequired: false,
  }).allFields.find((candidate: PublicFormField): boolean => {
    return candidate.id === data.question.id;
  });

  return (field?.options || []).map((option: PublicFormFieldOption): string => {
    return option.label;
  });
};

describe("what a question offers is read by its ids", () => {
  test("the records each kind's questions name, a kind whole only where a question offers it whole", () => {
    expect(
      Array.from(
        getFormRecordOptionsWanted({
          targetType: FormTargetType.Incident,
          fields: [
            monitorsQuestion([LATE_MONITOR_ID.toUpperCase(), LATE_MONITOR_ID]),
            { ...monitorsQuestion([OTHER_LATE_MONITOR_ID]), id: "more" },
            labelsQuestion([]),
            severityQuestion,
          ],
        }).entries(),
      ),
    ).toEqual([
      [
        FormTargetOptionsSource.Monitor,
        {
          isEveryRecord: false,
          ids: [LATE_MONITOR_ID, OTHER_LATE_MONITOR_ID],
        },
      ],
      // A question that must name its labels and names none offers none.
      [FormTargetOptionsSource.Label, { isEveryRecord: false, ids: [] }],
      // A severity question naming none offers every severity.
      [
        FormTargetOptionsSource.IncidentSeverity,
        { isEveryRecord: true, ids: [] },
      ],
    ]);
  });

  test("a question offering a monitor past the 10,000th offers it", async () => {
    const question: FormField = monitorsQuestion([
      LATE_MONITOR_ID,
      DELETED_MONITOR_ID,
    ]);
    const questionData: FormQuestionData = await loadFormQuestionData({
      targetType: FormTargetType.Incident,
      fields: [question],
    });

    // The one deleted since is simply not there to offer.
    expect(offeredBy({ question, questionData })).toEqual(["WB1500KSK02"]);

    // Read by its ids: never the project's monitors whole.
    for (const call of server.callsFor(Monitor)) {
      expect(call.query["_id"]).toBeInstanceOf(Includes);
    }
  });

  test("an archived label is never offered, as the public page offers none", async () => {
    const question: FormField = labelsQuestion([
      LIVE_LABEL_ID,
      ARCHIVED_LABEL_ID,
    ]);

    expect(
      offeredBy({
        question,
        questionData: await loadFormQuestionData({
          targetType: FormTargetType.Incident,
          fields: [question],
        }),
      }),
    ).toEqual(["customer-report"]);
  });

  test("a severity question naming none offers every severity, read whole", async () => {
    expect(
      offeredBy({
        question: severityQuestion,
        questionData: await loadFormQuestionData({
          targetType: FormTargetType.Incident,
          fields: [severityQuestion],
        }),
      }),
    ).toEqual(["Major"]);
  });

  /*
   * The Templates page and Duplicate Form fit a template to what its
   * questions offer (fitFormTemplateToQuestions): an answer naming a
   * monitor past the 10,000th was left behind, as one the question did not
   * offer. It is kept now.
   */
  test("a template's answer naming a monitor past the 10,000th is kept", async () => {
    const question: FormField = monitorsQuestion([LATE_MONITOR_ID]);
    const questionData: FormQuestionData = await loadFormQuestionData({
      targetType: FormTargetType.Incident,
      fields: [question],
    });

    const template: FormTemplate = {
      id: "kiosk",
      name: "Kiosk down",
      answers: { monitors: [LATE_MONITOR_ID] },
    } as FormTemplate;

    expect(
      fitFormTemplateToQuestions({
        template,
        questions: getFormTemplateEditorQuestions(
          buildPublicForm({
            form: {
              name: "Report",
              fields: [question] as never,
              targetType: FormTargetType.Incident,
            },
            customFields: questionData.customFields,
            recordOptions: questionData.recordOptions,
            isCaptchaRequired: false,
          }),
        ),
      }).answers,
    ).toEqual({ monitors: [LATE_MONITOR_ID] });
  });
});

describe("the builder's Choices Offered searches the server", () => {
  let onChange: MockFunction;

  const renderCard: (field: FormField) => Promise<void> = async (
    field: FormField,
  ): Promise<void> => {
    onChange = getJestMockFunction();

    await act(async () => {
      render(
        <QuestionCard
          field={field}
          index={0}
          count={1}
          targetType={FormTargetType.Incident}
          customFields={[]}
          recordOptions={{}}
          isSelected={true}
          isReadOnly={false}
          onSelect={() => {}}
          onDeselect={() => {}}
          onChange={(changes: Partial<FormField>) => {
            onChange(changes);
          }}
          onMove={() => {}}
          onDuplicate={() => {}}
          onDelete={() => {}}
        />,
      );
    });
  };

  const picker: (questionId: string) => HTMLElement = (
    questionId: string,
  ): HTMLElement => {
    return screen.getByTestId(`form-question-choices-${questionId}`);
  };

  const chips: () => Array<string> = (): Array<string> => {
    return screen
      .queryAllByTestId("entity-dropdown-chip-label")
      .map((chip: HTMLElement): string => {
        return chip.textContent || "";
      });
  };

  const lastChange: () => Array<string> | undefined = ():
    | Array<string>
    | undefined => {
    return (
      onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as
        | Partial<FormField>
        | undefined
    )?.allowedOptionIds;
  };

  test("names the monitors the question offers past the 10,000th, and finds another by its name", async () => {
    await renderCard(monitorsQuestion([LATE_MONITOR_ID]));

    await waitFor(() => {
      expect(chips()).toEqual(["WB1500KSK02"]);
    });

    await act(async () => {
      fireEvent.focus(picker("monitors"));
      fireEvent.change(picker("monitors"), {
        target: { value: "WB1500KSK0" },
      });
    });

    const option: HTMLElement = await screen.findByRole("option", {
      name: /WB1500KSK03/,
    });

    expect(
      server
        .callsFor(Monitor)
        .some((call: { query: Record<string, unknown> }): boolean => {
          return (
            call.query["name"] instanceof Search &&
            (call.query["name"] as Search<string>).toString() === "WB1500KSK0"
          );
        }),
    ).toBe(true);

    await act(async () => {
      fireEvent.click(option);
    });

    // The one held is kept beside the one picked.
    expect(lastChange()).toEqual([LATE_MONITOR_ID, OTHER_LATE_MONITOR_ID]);
  });

  test("a monitor deleted since reads Deleted, kept until it is taken out", async () => {
    await renderCard(monitorsQuestion([DELETED_MONITOR_ID, LATE_MONITOR_ID]));

    await waitFor(() => {
      expect(chips()).toEqual([FormsCopy.deletedRecord, "WB1500KSK02"]);
    });

    // Nothing is changed by drawing it.
    expect(onChange).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", {
          name: `Remove ${FormsCopy.deletedRecord}`,
        }),
      );
    });

    expect(lastChange()).toEqual([LATE_MONITOR_ID]);
  });

  test("an archived label is never offered; one the question holds stays, marked Archived", async () => {
    await renderCard(labelsQuestion([ARCHIVED_LABEL_ID]));

    await waitFor(() => {
      expect(chips()).toEqual(["customer-old"]);
    });
    expect(
      screen.getByTestId("entity-dropdown-archived-tag"),
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.focus(picker("labels"));
      fireEvent.change(picker("labels"), { target: { value: "customer" } });
    });

    const menu: HTMLElement = await screen.findByTestId("entity-dropdown-menu");

    await within(menu).findByRole("option", { name: /customer-report/ });
    expect(
      within(menu).queryByRole("option", { name: /customer-old/ }),
    ).not.toBeInTheDocument();
  });
});
