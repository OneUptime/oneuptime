import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The pieces the incident and episode Postmortem pages share
 * (Dashboard Components/Postmortem), and the dialog the incident, scheduled
 * maintenance and announcement lists show when there is no template to
 * create from (Components/Template/NoTemplatesYetModal).
 */

const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
    },
  };
});

let permissionsForTest: Array<string> = [];

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return permissionsForTest;
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

import {
  findPostmortemTemplate,
  getPostmortemTemplatePickerInitialValues,
  loadPostmortemTemplates,
  POSTMORTEM_TEMPLATE_PICKER_FIELD,
  PostmortemTemplateOption,
  toAITemplates,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Postmortem/PostmortemTemplates";
import { getPostmortemCardButtons } from "../../../../App/FeatureSet/Dashboard/src/Components/Postmortem/PostmortemCardButtons";
import {
  getPostmortemValuesWhenPublishingChanges,
  INCIDENT_POSTMORTEM_FORM_FIELDS,
  INCIDENT_POSTMORTEM_FORM_STEPS,
  POSTED_AT_BEFORE_PUBLISHING_KEY,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Postmortem/IncidentPostmortemForm";
import NoTemplatesYetModal from "../../../../App/FeatureSet/Dashboard/src/Components/Template/NoTemplatesYetModal";
import { CardButtonSchema } from "../../../UI/Components/Card/Card";
import Field from "../../../UI/Components/Forms/Types/Field";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import IncidentPostmortemTemplate from "../../../Models/DatabaseModels/IncidentPostmortemTemplate";
import Route from "../../../Types/API/Route";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import Permission from "../../../Types/Permission";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";

const OWNER: Array<string> = [
  Permission.Public,
  Permission.User,
  Permission.ProjectOwner,
];

const VIEWER: Array<string> = [
  Permission.Public,
  Permission.User,
  Permission.Viewer,
];

const TEMPLATE_A: PostmortemTemplateOption = {
  id: "t-a",
  name: "Customer-facing",
  note: "## For customers",
};

const TEMPLATE_B: PostmortemTemplateOption = {
  id: "t-b",
  name: "Internal review",
  note: "## For the team",
};

beforeEach(() => {
  permissionsForTest = OWNER;
  PermissionGate.clearPermissionPropsCache();
  getListMock.mockReset();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("loadPostmortemTemplates", () => {
  test("reads every template by name, with its body", async () => {
    getListMock.mockImplementation(async (): Promise<unknown> => {
      const template: IncidentPostmortemTemplate =
        new IncidentPostmortemTemplate();
      template._id = "t-a";
      template.templateName = "Customer-facing";
      template.postmortemNote = "## For customers";

      const unnamed: IncidentPostmortemTemplate =
        new IncidentPostmortemTemplate();
      unnamed._id = "t-c";

      return { data: [template, unnamed], count: 2, skip: 0, limit: 100 };
    });

    expect(await loadPostmortemTemplates()).toEqual([
      TEMPLATE_A,
      { id: "t-c", name: "", note: "" },
    ]);

    const request: {
      modelType: unknown;
      select: Record<string, unknown>;
      sort: Record<string, unknown>;
    } = getListMock.mock.calls[0]![0] as {
      modelType: unknown;
      select: Record<string, unknown>;
      sort: Record<string, unknown>;
    };

    expect(request.modelType).toBe(IncidentPostmortemTemplate);
    expect(request.select).toEqual({
      _id: true,
      templateName: true,
      postmortemNote: true,
    });
    expect(request.sort).toEqual({ templateName: SortOrder.Ascending });
  });

  test("leaves out a row without an id", async () => {
    getListMock.mockImplementation(async (): Promise<unknown> => {
      const template: IncidentPostmortemTemplate =
        new IncidentPostmortemTemplate();
      template.templateName = "No id";

      return { data: [template], count: 1, skip: 0, limit: 100 };
    });

    expect(await loadPostmortemTemplates()).toEqual([]);
  });
});

describe("the template picker", () => {
  test("starts on the only template when there is one", () => {
    expect(getPostmortemTemplatePickerInitialValues([TEMPLATE_A])).toEqual({
      [POSTMORTEM_TEMPLATE_PICKER_FIELD]: "t-a",
    });
  });

  test("asks for a pick when there are several, or none", () => {
    expect(
      getPostmortemTemplatePickerInitialValues([TEMPLATE_A, TEMPLATE_B]),
    ).toEqual({});
    expect(getPostmortemTemplatePickerInitialValues([])).toEqual({});
  });

  test("finds the picked template by its id, whatever form the id arrives in", () => {
    expect(findPostmortemTemplate([TEMPLATE_A, TEMPLATE_B], "t-b")).toBe(
      TEMPLATE_B,
    );
    expect(
      findPostmortemTemplate([TEMPLATE_A, TEMPLATE_B], {
        toString: (): string => {
          return "t-a";
        },
      }),
    ).toBe(TEMPLATE_A);
    expect(findPostmortemTemplate([TEMPLATE_A], "t-z")).toBeNull();
    expect(findPostmortemTemplate([TEMPLATE_A], undefined)).toBeNull();
    expect(findPostmortemTemplate([TEMPLATE_A], null)).toBeNull();
  });

  test("Generate with AI lists the templates with their bodies", () => {
    expect(
      toAITemplates([TEMPLATE_A, { id: "t-c", name: "", note: "" }]),
    ).toEqual([
      { id: "t-a", name: "Customer-facing", content: "## For customers" },
      { id: "t-c", name: "Unnamed Template" },
    ]);
  });
});

describe("the Postmortem card's buttons", () => {
  function titles(buttons: Array<CardButtonSchema>): Array<string> {
    return buttons.map((button: CardButtonSchema): string => {
      return button.title;
    });
  }

  test("offer Apply Template only when there is a template", () => {
    const withTemplates: Array<CardButtonSchema> = getPostmortemCardButtons({
      model: new Incident(),
      hasTemplates: true,
      onGenerateWithAI: () => {},
      onApplyTemplate: () => {},
    });
    const withoutTemplates: Array<CardButtonSchema> = getPostmortemCardButtons({
      model: new Incident(),
      hasTemplates: false,
      onGenerateWithAI: () => {},
      onApplyTemplate: () => {},
    });

    expect(titles(withTemplates)).toEqual([
      "Generate with AI",
      "Apply Template",
    ]);
    expect(titles(withoutTemplates)).toEqual(["Generate with AI"]);
  });

  test("open what they say", () => {
    const onGenerateWithAI: MockFunction = getJestMockFunction();
    const onApplyTemplate: MockFunction = getJestMockFunction();

    const buttons: Array<CardButtonSchema> = getPostmortemCardButtons({
      model: new IncidentEpisode(),
      hasTemplates: true,
      onGenerateWithAI: () => {
        onGenerateWithAI();
      },
      onApplyTemplate: () => {
        onApplyTemplate();
      },
    });

    buttons[0]!.onClick();
    expect(onGenerateWithAI).toHaveBeenCalledTimes(1);
    expect(onApplyTemplate).not.toHaveBeenCalled();

    buttons[1]!.onClick();
    expect(onApplyTemplate).toHaveBeenCalledTimes(1);
  });

  test("are locked, with the reason, for someone who may not edit", () => {
    permissionsForTest = VIEWER;

    const onApplyTemplate: MockFunction = getJestMockFunction();

    const buttons: Array<CardButtonSchema> = getPostmortemCardButtons({
      model: new Incident(),
      hasTemplates: true,
      onGenerateWithAI: () => {},
      onApplyTemplate: () => {
        onApplyTemplate();
      },
    });

    expect(titles(buttons)).toEqual(["Generate with AI", "Apply Template"]);

    for (const button of buttons) {
      expect(button.disabled).toBe(true);
      expect(button.tooltip).toBeTruthy();
    }

    buttons[1]!.onClick();
    expect(onApplyTemplate).not.toHaveBeenCalled();
  });

  test("are left out until the permissions are known", () => {
    permissionsForTest = [];

    expect(
      getPostmortemCardButtons({
        model: new Incident(),
        hasTemplates: true,
        onGenerateWithAI: () => {},
        onApplyTemplate: () => {},
      }),
    ).toEqual([]);
  });
});

describe("the incident postmortem form", () => {
  function fieldName(field: Field<Incident>): string {
    return Object.keys(field.field || {})[0] as string;
  }

  test("asks for the write-up, then the status page", () => {
    expect(
      INCIDENT_POSTMORTEM_FORM_STEPS.map((step: { id: string }): string => {
        return step.id;
      }),
    ).toEqual(["postmortem", "status-page"]);

    expect(
      INCIDENT_POSTMORTEM_FORM_FIELDS.map(
        (field: Field<Incident>): [string, string] => {
          return [fieldName(field), field.stepId as string];
        },
      ),
    ).toEqual([
      ["postmortemNote", "postmortem"],
      ["postmortemAttachments", "postmortem"],
      ["showPostmortemOnStatusPage", "status-page"],
      ["notifySubscribersOnPostmortemPublished", "status-page"],
      ["postmortemPostedAt", "status-page"],
    ]);
  });

  test("asks Notify Subscribers and Published At only while publishing", () => {
    const onlyWhilePublishing: Array<string> =
      INCIDENT_POSTMORTEM_FORM_FIELDS.filter(
        (field: Field<Incident>): boolean => {
          return Boolean(field.showIf);
        },
      ).map(fieldName);

    expect(onlyWhilePublishing).toEqual([
      "notifySubscribersOnPostmortemPublished",
      "postmortemPostedAt",
    ]);

    for (const field of INCIDENT_POSTMORTEM_FORM_FIELDS.filter(
      (candidate: Field<Incident>): boolean => {
        return Boolean(candidate.showIf);
      },
    )) {
      expect(field.showIf!({ showPostmortemOnStatusPage: true })).toBe(true);
      expect(field.showIf!({ showPostmortemOnStatusPage: false })).toBe(false);
      expect(field.showIf!({})).toBe(false);
    }
  });

  /*
   * The box stays ticked on every later edit of a published postmortem, and
   * every save used to tell subscribers again. They are told once, when it
   * is published (IncidentPostmortemPublication), and the box says so.
   */
  test("Notify Subscribers says subscribers are told once, when it is published", () => {
    const notify: Field<Incident> = INCIDENT_POSTMORTEM_FORM_FIELDS.find(
      (field: Field<Incident>): boolean => {
        return fieldName(field) === "notifySubscribersOnPostmortemPublished";
      },
    )!;

    expect(notify.title).toBe("Notify Subscribers");
    expect(notify.description).toBe(
      "Notify subscribers when this postmortem is published. Later edits do not notify them again.",
    );
    expect(notify.defaultValue).toBe(true);
  });

  test("Published At no longer starts at now on its own: publishing sets it", () => {
    const postedAt: Field<Incident> = INCIDENT_POSTMORTEM_FORM_FIELDS.find(
      (field: Field<Incident>): boolean => {
        return fieldName(field) === "postmortemPostedAt";
      },
    )!;

    expect(postedAt.getDefaultValue).toBeUndefined();
    expect(postedAt.defaultValue).toBeUndefined();
  });
});

describe("switching publishing on and off", () => {
  const NOW: Date = new Date("2026-10-04T09:30:00.000Z");
  const EARLIER: Date = new Date("2026-09-01T10:00:00.000Z");

  function postedAt(values: FormValues<Incident>): unknown {
    return (values as Record<string, unknown>)["postmortemPostedAt"];
  }

  test("on: a postmortem with no time is published now", () => {
    const values: FormValues<Incident> =
      getPostmortemValuesWhenPublishingChanges(
        { postmortemNote: "## Note", postmortemPostedAt: null as never },
        true,
        NOW,
      );

    expect(postedAt(values)).toBe(NOW);
    expect((values as Record<string, unknown>)["postmortemNote"]).toBe(
      "## Note",
    );
  });

  test("on: a postmortem published before keeps its time", () => {
    const values: FormValues<Incident> =
      getPostmortemValuesWhenPublishingChanges(
        { postmortemPostedAt: EARLIER },
        true,
        NOW,
      );

    expect(postedAt(values)).toBe(EARLIER);
  });

  test("off again: the time goes back to what it was, empty included", () => {
    const on: FormValues<Incident> = getPostmortemValuesWhenPublishingChanges(
      {},
      true,
      NOW,
    );
    const off: FormValues<Incident> = getPostmortemValuesWhenPublishingChanges(
      on,
      false,
      NOW,
    );

    expect(postedAt(on)).toBe(NOW);
    expect(postedAt(off)).toBeNull();
    expect(
      Object.prototype.hasOwnProperty.call(
        off,
        POSTED_AT_BEFORE_PUBLISHING_KEY,
      ),
    ).toBe(false);
  });

  test("off again after changing the time: back to the stored time", () => {
    const on: FormValues<Incident> = getPostmortemValuesWhenPublishingChanges(
      { postmortemPostedAt: EARLIER },
      true,
      NOW,
    );
    const changed: FormValues<Incident> = {
      ...on,
      postmortemPostedAt: new Date("2026-10-01T00:00:00.000Z"),
    };

    expect(
      postedAt(getPostmortemValuesWhenPublishingChanges(changed, false, NOW)),
    ).toBe(EARLIER);
  });

  test("off, on a postmortem that was already published: its time is kept", () => {
    const off: FormValues<Incident> = getPostmortemValuesWhenPublishingChanges(
      { postmortemPostedAt: EARLIER, showPostmortemOnStatusPage: true },
      false,
      NOW,
    );

    expect(postedAt(off)).toBe(EARLIER);
  });

  test("on, off, on: now again, and off: empty again", () => {
    let values: FormValues<Incident> = {};

    values = getPostmortemValuesWhenPublishingChanges(values, true, NOW);
    values = getPostmortemValuesWhenPublishingChanges(values, false, NOW);

    const later: Date = new Date("2026-10-04T10:00:00.000Z");

    values = getPostmortemValuesWhenPublishingChanges(values, true, later);
    expect(postedAt(values)).toBe(later);

    values = getPostmortemValuesWhenPublishingChanges(values, false, later);
    expect(postedAt(values)).toBeNull();
  });

  test("does not change the values it is given", () => {
    const values: FormValues<Incident> = {};

    getPostmortemValuesWhenPublishingChanges(values, true, NOW);

    expect(values).toEqual({});
  });
});

describe("NoTemplatesYetModal", () => {
  const TEMPLATES_ROUTE: Route = new Route(
    "/dashboard/project/incidents/settings/incident-templates",
  );

  function renderModal(onClose: () => void): void {
    render(
      <NoTemplatesYetModal
        title="No Incident Templates"
        description="This project has no incident templates yet. Create them in Incidents → Settings → Incident Templates."
        templatesRoute={TEMPLATES_ROUTE}
        onClose={onClose}
      />,
    );
  }

  test("says where templates are made, and Create Template goes there", () => {
    const navigate: MockFunction = getJestMockFunction();
    const onClose: MockFunction = getJestMockFunction();

    jest
      .spyOn(Navigation, "navigate")
      .mockImplementation((...args: Array<unknown>): void => {
        navigate(...args);
      });

    renderModal(() => {
      onClose();
    });

    expect(screen.getByText("No Incident Templates")).toBeInTheDocument();
    expect(
      screen.getByText(
        "This project has no incident templates yet. Create them in Incidents → Settings → Incident Templates.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Create Template" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate.mock.calls[0]![0]).toBe(TEMPLATES_ROUTE);
  });

  test("Close only closes", () => {
    const navigate: MockFunction = getJestMockFunction();
    const onClose: MockFunction = getJestMockFunction();

    jest
      .spyOn(Navigation, "navigate")
      .mockImplementation((...args: Array<unknown>): void => {
        navigate(...args);
      });

    renderModal(() => {
      onClose();
    });

    // The footer's Close (the header's X closes it the same way).
    fireEvent.click(screen.getByTestId("modal-footer-close-button"));

    expect(screen.getByTestId("modal-footer-close-button")).toHaveTextContent(
      "Close",
    );
    expect(onClose).toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});
