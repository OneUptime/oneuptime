import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render } from "@testing-library/react";
import React, { ReactElement } from "react";

/*
 * A code repository's Settings (Code > a repository > Settings), its Pull
 * Requests card under More settings:
 *
 *   - how many AI fix pull requests it takes is one choice - No limit, A
 *     limit (then the number), None - where a number's help explained
 *     "Leave empty for no cap, or 0 to block them". The choice writes the
 *     same column (null, the number, 0), read as OpenPullRequestCap reads
 *     it, and the page says the stored limit in words;
 *   - the GitHub trigger label has a card of its own beside it, asked
 *     whatever GitHub Commands says (CodeRepositorySettingsPage.test.tsx).
 */

const mockDetails: Array<Record<string, unknown>> = [];

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): null => {
      mockDetails.push(props);
      return null;
    },
  };
});

// The GitHub Commands switch card reads the repository itself: not here.
jest.mock("../../../UI/Components/ModelSwitch/ModelSwitchCard", () => {
  return {
    __esModule: true,
    default: (): null => {
      return null;
    },
  };
});

import CodeRepositorySettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Code/Repository/Settings";
import {
  FixPullRequestLimit,
  getFixPullRequestLimit,
  getPickedFixPullRequestLimit,
  getValuesForFixPullRequestLimit,
} from "../../../../App/FeatureSet/Dashboard/src/Components/CodeRepository/FixPullRequestLimit";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import OpenPullRequestCap from "../../../Server/Utils/AI/CodeFix/OpenPullRequestCap";
import CodeRepository from "../../../Models/DatabaseModels/CodeRepository";
import ObjectID from "../../../Types/ObjectID";
import { ModelField } from "../../../UI/Components/Forms/ModelForm";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import Navigation from "../../../UI/Utils/Navigation";

type FormField = ModelField<CodeRepository>;

interface DetailField {
  field?: Record<string, boolean>;
  title?: string;
  showIf?: ((item: CodeRepository) => boolean) | undefined;
  getElement?: ((item: CodeRepository) => ReactElement) | undefined;
}

// The Pull Requests card, as the settings page drew it.
function page(): Record<string, unknown> {
  render(<CodeRepositorySettings {...({} as unknown as PageComponentProps)} />);

  return mockDetails.filter((props: Record<string, unknown>): boolean => {
    return props["name"] === "Repository > Pull Requests";
  })[0]!;
}

function formFields(): Array<FormField> {
  return page()["formFields"] as Array<FormField>;
}

function detailFields(): Array<DetailField> {
  return (page()["modelDetailProps"] as { fields: Array<DetailField> }).fields;
}

function values(data: Record<string, unknown>): FormValues<CodeRepository> {
  return data as FormValues<CodeRepository>;
}

beforeEach(() => {
  mockDetails.length = 0;
  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockReturnValue(new ObjectID("11111111-1111-4111-8111-111111111111"));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the limit on AI fix pull requests", () => {
  test.each([
    [null, FixPullRequestLimit.NoLimit],
    [undefined, FixPullRequestLimit.NoLimit],
    [0, FixPullRequestLimit.Blocked],
    [-1, FixPullRequestLimit.Blocked],
    [3, FixPullRequestLimit.Limit],
  ])(
    "a stored %p reads as %s, as the server's cap does",
    (stored: number | null | undefined, limit: FixPullRequestLimit) => {
      expect(getFixPullRequestLimit({ maxOpenFixPullRequests: stored })).toBe(
        limit,
      );

      const decision: ReturnType<typeof OpenPullRequestCap.evaluate> =
        OpenPullRequestCap.evaluate({
          configuredLimit: stored,
          openCount: 0,
        });

      expect({
        stored,
        noCap: decision.limit === null,
        blocked: decision.paused,
      }).toEqual({
        stored,
        noCap: limit === FixPullRequestLimit.NoLimit,
        blocked: limit === FixPullRequestLimit.Blocked,
      });
    },
  );

  test("each answer writes the column the server reads", () => {
    expect(
      getValuesForFixPullRequestLimit({
        values: { maxOpenFixPullRequests: 3 },
        limit: FixPullRequestLimit.NoLimit,
      }),
    ).toMatchObject({ maxOpenFixPullRequests: null });
    expect(
      getValuesForFixPullRequestLimit({
        values: { maxOpenFixPullRequests: 3 },
        limit: FixPullRequestLimit.Blocked,
      }),
    ).toMatchObject({ maxOpenFixPullRequests: 0 });
    // A limit keeps a number set, and asks for one where there was none.
    expect(
      getValuesForFixPullRequestLimit({
        values: { maxOpenFixPullRequests: 3 },
        limit: FixPullRequestLimit.Limit,
      }),
    ).toMatchObject({ maxOpenFixPullRequests: 3 });
    expect(
      getValuesForFixPullRequestLimit({
        values: { maxOpenFixPullRequests: 0 },
        limit: FixPullRequestLimit.Limit,
      }),
    ).toMatchObject({ maxOpenFixPullRequests: null });
  });

  test("the answer picked wins over the stored one, while the form is open", () => {
    expect(
      getPickedFixPullRequestLimit({
        maxOpenFixPullRequests: null,
        fixPullRequestLimit: FixPullRequestLimit.Limit,
      }),
    ).toBe(FixPullRequestLimit.Limit);
    expect(getPickedFixPullRequestLimit({ maxOpenFixPullRequests: 0 })).toBe(
      FixPullRequestLimit.Blocked,
    );
  });

  test("the form asks the choice, and the number only for a limit", () => {
    const fields: Array<FormField> = formFields();
    const choice: FormField | undefined = fields.find((field: FormField) => {
      return field.overrideFieldKey === "fixPullRequestLimit";
    });
    const number: FormField | undefined = fields.find((field: FormField) => {
      return (
        Object.keys(field.field || {})[0] === "maxOpenFixPullRequests" &&
        !field.overrideFieldKey
      );
    });

    expect(choice).toBeDefined();
    expect(choice!.formOnly).toBe(true);
    expect(
      (choice!.radioButtonOptions || []).map((option: { title: string }) => {
        return option.title;
      }),
    ).toEqual(["No limit", "A limit", "None"]);
    expect(
      choice!.getDefaultValue!(values({ maxOpenFixPullRequests: 0 })),
    ).toBe(FixPullRequestLimit.Blocked);

    for (const [picked, asked] of [
      [FixPullRequestLimit.NoLimit, false],
      [FixPullRequestLimit.Limit, true],
      [FixPullRequestLimit.Blocked, false],
    ] as Array<[FixPullRequestLimit, boolean]>) {
      const form: FormValues<CodeRepository> = values({
        fixPullRequestLimit: picked,
      });

      expect({ picked, shown: number!.showIf!(form) }).toEqual({
        picked,
        shown: asked,
      });
      expect({
        picked,
        required:
          typeof number!.required === "function"
            ? number!.required(form)
            : number!.required,
      }).toEqual({ picked, required: asked });
    }

    expect(number!.validation?.minValue).toBe(1);

    // A pick writes the column.
    const set: Array<Record<string, unknown>> = [];

    choice!.onChange!(
      FixPullRequestLimit.Blocked,
      values({ maxOpenFixPullRequests: 5 }),
      (next: FormValues<CodeRepository>) => {
        set.push(next as Record<string, unknown>);
      },
    );

    expect(set[0]).toMatchObject({ maxOpenFixPullRequests: 0 });
  });

  test("the page says the stored limit in words", () => {
    const shown: DetailField | undefined = detailFields().find(
      (field: DetailField) => {
        return Object.keys(field.field || {})[0] === "maxOpenFixPullRequests";
      },
    );

    expect(shown?.getElement).toBeDefined();

    const text: (stored: number | null) => string = (
      stored: number | null,
    ): string => {
      const repository: CodeRepository = new CodeRepository();
      repository.maxOpenFixPullRequests = stored as number;

      const drawn: ReturnType<typeof render> = render(
        shown!.getElement!(repository),
      );
      const content: string = drawn.container.textContent || "";

      drawn.unmount();

      return content;
    };

    expect(text(null)).toBe("No limit");
    expect(text(0)).toBe("None: AI opens no fix pull requests here");
    // A bare "4" beside the title read as four pull requests.
    expect(text(4)).toBe("Up to 4 open at once");
    expect(text(1)).toBe("Up to 1 open at once");
  });

  test("the page names the limit as its Edit form's choice does", () => {
    const shown: DetailField | undefined = detailFields().find(
      (field: DetailField) => {
        return Object.keys(field.field || {})[0] === "maxOpenFixPullRequests";
      },
    );
    const choice: FormField | undefined = formFields().find(
      (field: FormField) => {
        return field.overrideFieldKey === "fixPullRequestLimit";
      },
    );

    expect(choice?.title).toBe("AI Fix Pull Requests");
    expect(shown?.title).toBe(choice?.title);
    expect((shown as { description?: string }).description).toBe(
      "How many fix pull requests AI may have open at once in this repository.",
    );
  });
});

describe("the Pull Requests card", () => {
  test("asks the main branch and the limit on one page: no build or test command, no trigger label", () => {
    const columns: Array<string> = formFields().map(
      (field: FormField): string => {
        return Object.keys(
          (field.field || field.overrideField || {}) as Record<string, unknown>,
        )[0]!;
      },
    );

    expect(columns).toEqual([
      "mainBranchName",
      "maxOpenFixPullRequests",
      "maxOpenFixPullRequests",
    ]);
    expect(page()["formSteps"]).toBeUndefined();
  });

  test("shows the main branch and the limit, nothing more", () => {
    expect(
      detailFields().map((field: DetailField): string => {
        return Object.keys(field.field || {})[0]!;
      }),
    ).toEqual(["mainBranchName", "maxOpenFixPullRequests"]);
  });

  /*
   * Code calls it a repository: the card's button and its dialog name what
   * it edits - its pull requests - not the model's own "Code Repository".
   */
  test("its button and dialog name what it edits", () => {
    const card: Record<string, unknown> = page();

    expect((card["cardProps"] as { title: string }).title).toBe(
      "Pull Requests",
    );
    expect(card["editButtonText"]).toBe("Edit");
    expect(card["editModalTitle"]).toBe("Pull Requests");
  });
});
