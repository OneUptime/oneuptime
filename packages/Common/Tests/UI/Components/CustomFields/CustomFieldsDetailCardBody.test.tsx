import { afterEach, describe, expect, jest, test } from "@jest/globals";
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../../MockType";

/*
 * A record's Custom Fields card (CustomFieldsDetail), as a page draws it:
 *
 * - Its fields' box is a detail card's (CardModelDetail's): a rule across
 *   the card under its header, the fields padded as the card is, so their
 *   left edge is the title's at every width. It used to pull itself out
 *   24px on every side whatever the card's padding and pad its fields
 *   16px: on a phone the rule ran past the card's edges and the fields sat
 *   8px left of the title (a security case's Overview, #5577). The box's
 *   geometry at every width is CardModelDetailLayout's; this holds the card
 *   to the same box. In a section of a card, no rule and no box.
 *
 * - While the project has no fields of its kind, the card says what its
 *   page hands it, with Add Custom Fields leading to where they are added
 *   (a security case's: Security Events > Settings > Custom Fields). A page
 *   that hands nothing keeps the sentence every record's card says.
 */

const getListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();

jest.mock("../../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return ["ProjectOwner"];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<string> } => {
        return { globalPermissions: ["ProjectOwner"] };
      },
    },
  };
});

jest.mock("../../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      getItem: (...args: Array<any>) => {
        return getItemMock(...args);
      },
    },
  };
});

import CustomFieldsDetail, {
  ADD_CUSTOM_FIELDS_BUTTON_TITLE,
  NO_CUSTOM_FIELDS_MESSAGE,
  getCustomFieldsDetailBodyClassName,
} from "../../../../UI/Components/CustomFields/CustomFieldsDetail";
import CardSections from "../../../../UI/Components/Card/CardSections";
import { CARD_RULED_BODY_CLASS_NAME } from "../../../../UI/Components/Card/CardSurface";
import {
  CARD_MODEL_DETAIL_BODY_CLASS_NAME,
  CARD_MODEL_DETAIL_SECTION_BODY_CLASS_NAME,
} from "../../../../UI/Components/ModelDetail/CardModelDetail";
import Navigation from "../../../../UI/Utils/Navigation";
import SecurityCase from "../../../../Models/DatabaseModels/SecurityCase";
import SecurityCaseCustomField from "../../../../Models/DatabaseModels/SecurityCaseCustomField";
import Route from "../../../../Types/API/Route";
import CustomFieldType from "../../../../Types/CustomField/CustomFieldType";
import ObjectID from "../../../../Types/ObjectID";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CASE_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const SETTINGS_ROUTE: Route = new Route(
  `/dashboard/${PROJECT_ID.toString()}/security-events/settings/custom-fields`,
);
const EMPTY_MESSAGE: string =
  "This project has no custom fields for its cases yet.";

function listOf(fields: Array<SecurityCaseCustomField>): void {
  getListMock.mockResolvedValue({
    data: fields,
    count: fields.length,
    skip: 0,
    limit: fields.length,
  } as never);
}

function businessUnitField(): SecurityCaseCustomField {
  const field: SecurityCaseCustomField = new SecurityCaseCustomField();
  field.name = "Business Unit";
  field.customFieldType = CustomFieldType.Text;
  return field;
}

function caseWith(customFields: Record<string, string>): SecurityCase {
  const securityCase: SecurityCase = new SecurityCase();
  securityCase.id = CASE_ID;
  securityCase.customFields = customFields;
  return securityCase;
}

function card(props?: {
  emptyMessage?: string;
  addFieldsRoute?: Route;
}): React.ReactElement {
  return (
    <CustomFieldsDetail
      title="Case Custom Fields"
      description="The project's own fields, filled in for this case."
      modelType={SecurityCase}
      customFieldType={SecurityCaseCustomField}
      name="Security Case Custom Fields"
      projectId={PROJECT_ID}
      modelId={CASE_ID}
      emptyMessage={props?.emptyMessage}
      addFieldsRoute={props?.addFieldsRoute}
    />
  );
}

afterEach(() => {
  cleanup();
  getListMock.mockReset();
  getItemMock.mockReset();
  jest.restoreAllMocks();
});

describe("the fields' box", () => {
  test("is a detail card's ruled body, padded as the card is", async () => {
    listOf([businessUnitField()]);
    getItemMock.mockResolvedValue(caseWith({ "Business Unit": "IT" }) as never);

    render(card());

    expect(await screen.findByText("IT")).toBeInTheDocument();

    const body: HTMLElement = screen.getByTestId("custom-fields-detail-body");

    expect(body.className).toBe(CARD_MODEL_DETAIL_BODY_CLASS_NAME);
    expect(body.className.startsWith(CARD_RULED_BODY_CLASS_NAME)).toBe(true);
    expect(body).toHaveClass("border-t", "border-gray-200");
    // Never the old pull of 24px on every side, whatever the card's padding.
    expect(body.className.split(" ")).not.toContain("-m-6");
    expect(body.className.split(" ")).not.toContain("px-4");
  });

  test("in a section of a card it has no rule and no box of its own", async () => {
    listOf([businessUnitField()]);
    getItemMock.mockResolvedValue(caseWith({ "Business Unit": "IT" }) as never);

    render(<CardSections>{card()}</CardSections>);

    expect(await screen.findByText("IT")).toBeInTheDocument();

    const body: HTMLElement = screen.getByTestId("custom-fields-detail-body");

    expect(body.className).toBe(CARD_MODEL_DETAIL_SECTION_BODY_CLASS_NAME);
    expect(body.className).not.toContain("border-t");
  });

  test("picks the box by where the card is", () => {
    expect(getCustomFieldsDetailBodyClassName(false)).toBe(
      CARD_MODEL_DETAIL_BODY_CLASS_NAME,
    );
    expect(getCustomFieldsDetailBodyClassName(true)).toBe(
      CARD_MODEL_DETAIL_SECTION_BODY_CLASS_NAME,
    );
  });
});

describe("what someone wrote", () => {
  /*
   * A field's description is what someone wrote, read the way it is
   * written (IsolatedText): an English one on a Persian page put its full
   * stop at its start (".The part of the company the case is about").
   */
  test("a field's description reads the way it is written", async () => {
    const field: SecurityCaseCustomField = businessUnitField();
    field.description = "The part of the company the case is about.";
    listOf([field]);
    getItemMock.mockResolvedValue(caseWith({ "Business Unit": "IT" }) as never);

    render(card());

    const description: HTMLElement = await screen.findByText(
      "The part of the company the case is about.",
    );

    expect(description.tagName).toBe("BDI");
    expect(description).toHaveAttribute("dir", "ltr");
  });
});

describe("a read that fails", () => {
  /*
   * A failure that says nothing ("Server Error") reads as one the server did
   * not explain: what happened, and what to do next (#6836).
   */
  test("says why, and Try again reads the fields and the record again", async () => {
    getListMock
      .mockRejectedValueOnce(new Error("Server Error") as never)
      .mockResolvedValue({
        data: [businessUnitField()],
        count: 1,
        skip: 0,
        limit: 1,
      } as never);
    getItemMock.mockResolvedValue(caseWith({ "Business Unit": "IT" }) as never);

    render(card());

    expect(
      await screen.findByText(
        "The server ran into a problem it could not explain. Try again in a moment.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("error-what-failed")).toHaveTextContent(
      "This did not finish.",
    );
    expect(screen.queryByText("Server Error")).toBeNull();

    const retry: HTMLElement = screen.getByTestId("refresh-button");

    // As a list's failed read offers it: a button, not a link.
    expect(retry.tagName).toBe("BUTTON");
    expect(retry).toHaveTextContent("Try again");

    fireEvent.click(retry);

    expect(await screen.findByText("IT")).toBeInTheDocument();
    expect(screen.queryByTestId("error-explanation")).toBeNull();
    expect(getListMock).toHaveBeenCalledTimes(2);
  });
});

describe("a project with no fields of the card's kind", () => {
  test("says what the page hands it, and Add Custom Fields leads where they are added", async () => {
    listOf([]);
    getItemMock.mockResolvedValue(caseWith({}) as never);
    const navigate: ReturnType<typeof jest.spyOn> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation((): void => {
        // Recorded, not followed.
      });

    render(
      card({ emptyMessage: EMPTY_MESSAGE, addFieldsRoute: SETTINGS_ROUTE }),
    );

    expect(await screen.findByText(EMPTY_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByText(NO_CUSTOM_FIELDS_MESSAGE)).toBeNull();
    // Nothing to fill in yet: no Edit Fields.
    expect(screen.queryByText("Edit Fields")).toBeNull();

    const add: HTMLElement = screen.getByTestId("custom-fields-add-fields");

    expect(add).toHaveTextContent(ADD_CUSTOM_FIELDS_BUTTON_TITLE);
    expect(ADD_CUSTOM_FIELDS_BUTTON_TITLE).toBe("Add Custom Fields");

    fireEvent.click(add);

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledTimes(1);
    });
    expect(String(navigate.mock.calls[0]?.[0])).toBe(SETTINGS_ROUTE.toString());
  });

  test("a page that hands nothing keeps the card's own sentence, and no button", async () => {
    listOf([]);
    getItemMock.mockResolvedValue(caseWith({}) as never);

    render(card());

    expect(
      await screen.findByText(NO_CUSTOM_FIELDS_MESSAGE),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("custom-fields-add-fields")).toBeNull();
  });

  test("a project with fields shows them, not the empty state", async () => {
    listOf([businessUnitField()]);
    getItemMock.mockResolvedValue(caseWith({ "Business Unit": "IT" }) as never);

    render(
      card({ emptyMessage: EMPTY_MESSAGE, addFieldsRoute: SETTINGS_ROUTE }),
    );

    expect(await screen.findByText("IT")).toBeInTheDocument();
    expect(screen.queryByText(EMPTY_MESSAGE)).toBeNull();
    expect(screen.queryByTestId("custom-fields-add-fields")).toBeNull();
  });
});
