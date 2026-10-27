import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import fs from "fs";
import path from "path";
import React from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * A STEP'S SECRET PICKER TELLS EACH READER WHAT THEY CAN DO.
 *
 * Runbook variables are written by a project owner or admin (or Create /
 * Edit Runbook Variable); a Runbook Admin reads them, to pick them in the
 * steps it writes, but does not change them. The picker used to tell every
 * reader to "Add one under Runbooks › Settings › Global Variables" and to
 * "Add the Runner to the variable's Runners", which a Runbook Admin may not
 * do. Now someone who may not is told to ask a project owner or admin - and,
 * for a secret its Runner may not use, that it can pick one of the
 * variable's own Runners for the step instead.
 *
 * Before the permission snapshot lands nobody is told they may not: the
 * words for whoever may are shown, as before.
 */

let mockPermissions: Array<string> = [];

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return mockPermissions;
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

import RunbookVariablePicker from "../../../../App/FeatureSet/Dashboard/src/Components/Runbook/Steps/RunbookVariablePicker";
import {
  RunbookVariableChoices,
  RunbookVariableChoice,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Runbook/Steps/RunbookVariableChoices";
import {
  NOT_FOR_RUNNER_ASK_TEMPLATE,
  NOT_FOR_RUNNER_EDIT_TEMPLATE,
  NO_SECRET_VARIABLES_ADD_ONE_TEMPLATE,
  NO_SECRET_VARIABLES_ASK_TEMPLATE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Runbook/RunbookVariableCopy";
import { RunbookVariableScope } from "../../../Types/Runbook/RunbookVariableReference";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

const LOCALES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

const STEP_RUNNER_ID: string = "eeeeeeee-0000-4000-8000-000000000001";
const OTHER_RUNNER_ID: string = "eeeeeeee-0000-4000-8000-000000000002";

const LOCATION: string = "Runbooks › Settings › Global Variables";

// A secret only another Runner may use.
const SECRET_FOR_ANOTHER_RUNNER: RunbookVariableChoice = {
  scope: RunbookVariableScope.Global,
  name: "PROD_DB_SSH_KEY",
  reference: "{{global.variables.PROD_DB_SSH_KEY}}",
  isSecret: true,
  runnerIds: [OTHER_RUNNER_ID],
  isAvailableToGlobalRunners: false,
};

const NO_VARIABLES: RunbookVariableChoices = {
  variables: [],
  isReadable: true,
};

const ONE_SECRET: RunbookVariableChoices = {
  variables: [SECRET_FOR_ANOTHER_RUNNER],
  isReadable: true,
};

type RenderPickerFunction = (data: {
  choices: RunbookVariableChoices;
  value?: string | undefined;
  noneLabel?: string | undefined;
}) => HTMLElement;

const renderPicker: RenderPickerFunction = (data: {
  choices: RunbookVariableChoices;
  value?: string | undefined;
  noneLabel?: string | undefined;
}): HTMLElement => {
  render(
    <MemoryRouter>
      <RunbookVariablePicker
        label="Sign in with"
        value={data.value || ""}
        onChange={(): void => {}}
        choices={data.choices}
        runnerId={STEP_RUNNER_ID}
        noneLabel={data.noneLabel}
        helperText="A key or a password."
        dataTestId="sign-in"
      />
    </MemoryRouter>,
  );

  return screen.getByTestId("sign-in");
};

// The sentence, with the link's words where {{location}} is.
const said: (template: string, values?: Record<string, string>) => string = (
  template: string,
  values?: Record<string, string>,
): string => {
  let text: string = template.replace("{{location}}", LOCATION);

  for (const [key, value] of Object.entries(values || {})) {
    text = text.replace(`{{${key}}}`, value);
  }

  return text;
};

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/runbooks/runbook/steps`);
  mockPermissions = [];
});

afterEach(() => {
  cleanup();
});

describe("with no secret variable to pick", () => {
  test.each(["ProjectOwner", "ProjectAdmin", "CreateRunbookSecret"])(
    "%s, who may add one, is told to add one, and where",
    (permission: string) => {
      mockPermissions = [permission];

      const picker: HTMLElement = renderPicker({ choices: NO_VARIABLES });

      expect(
        within(picker).getByTestId("sign-in-nothing-to-pick"),
      ).toHaveTextContent(said(NO_SECRET_VARIABLES_ADD_ONE_TEMPLATE));
      expect(
        within(picker).getByRole("link", { name: LOCATION }),
      ).toHaveAttribute(
        "href",
        `/dashboard/${PROJECT_ID}/runbooks/settings/variables`,
      );
    },
  );

  test.each(["RunbookAdmin", "ReadRunbookSecret", "EditRunbook"])(
    "%s, who may not, is told to ask a project owner or admin - with the same link",
    (permission: string) => {
      mockPermissions = [permission];

      const picker: HTMLElement = renderPicker({ choices: NO_VARIABLES });

      expect(
        within(picker).getByTestId("sign-in-nothing-to-pick"),
      ).toHaveTextContent(said(NO_SECRET_VARIABLES_ASK_TEMPLATE));
      expect(picker).not.toHaveTextContent("Add one under");
      expect(
        within(picker).getByRole("link", { name: LOCATION }),
      ).toBeInTheDocument();
    },
  );

  test("before the permission snapshot lands, the words for whoever may add one stay", () => {
    mockPermissions = [];

    const picker: HTMLElement = renderPicker({ choices: NO_VARIABLES });

    expect(
      within(picker).getByTestId("sign-in-nothing-to-pick"),
    ).toHaveTextContent(said(NO_SECRET_VARIABLES_ADD_ONE_TEMPLATE));
  });

  test("a kubeconfig picker, which still works with the Runner's own access, hints the same way", () => {
    mockPermissions = ["RunbookAdmin"];

    const picker: HTMLElement = renderPicker({
      choices: NO_VARIABLES,
      noneLabel: "The Runner's own access",
    });

    expect(
      within(picker).getByTestId("sign-in-add-variable"),
    ).toHaveTextContent(said(NO_SECRET_VARIABLES_ASK_TEMPLATE));
  });

  test("a project admin's kubeconfig picker is told to add one", () => {
    mockPermissions = ["ProjectAdmin"];

    const picker: HTMLElement = renderPicker({
      choices: NO_VARIABLES,
      noneLabel: "The Runner's own access",
    });

    expect(
      within(picker).getByTestId("sign-in-add-variable"),
    ).toHaveTextContent(said(NO_SECRET_VARIABLES_ADD_ONE_TEMPLATE));
  });
});

describe("a secret the step's Runner may not use", () => {
  test.each(["ProjectOwner", "ProjectAdmin", "EditRunbookSecret"])(
    "%s, who may change the variable, is told to add the Runner to it",
    (permission: string) => {
      mockPermissions = [permission];

      const picker: HTMLElement = renderPicker({
        choices: ONE_SECRET,
        value: SECRET_FOR_ANOTHER_RUNNER.reference,
      });

      expect(within(picker).getByTestId("sign-in-problem")).toHaveTextContent(
        said(NOT_FOR_RUNNER_EDIT_TEMPLATE, { name: "PROD_DB_SSH_KEY" }),
      );
    },
  );

  test.each(["RunbookAdmin", "ReadRunbookSecret"])(
    "%s, who may not, is told to pick one of its Runners or ask",
    (permission: string) => {
      mockPermissions = [permission];

      const picker: HTMLElement = renderPicker({
        choices: ONE_SECRET,
        value: SECRET_FOR_ANOTHER_RUNNER.reference,
      });

      const problem: HTMLElement =
        within(picker).getByTestId("sign-in-problem");

      expect(problem).toHaveTextContent(
        said(NOT_FOR_RUNNER_ASK_TEMPLATE, { name: "PROD_DB_SSH_KEY" }),
      );
      expect(problem).not.toHaveTextContent("Add the Runner to");
      expect(
        within(problem).getByRole("link", { name: LOCATION }),
      ).toBeInTheDocument();
    },
  );
});

describe("the words", () => {
  test("say the same thing to both readers, but what each can do", () => {
    expect(NO_SECRET_VARIABLES_ADD_ONE_TEMPLATE).toBe(
      "No secret variables yet. Add one under {{location}}, then pick it here.",
    );
    expect(NO_SECRET_VARIABLES_ASK_TEMPLATE).toBe(
      "No secret variables yet. Ask a project owner or admin to add one under {{location}}, then pick it here.",
    );
    expect(
      NOT_FOR_RUNNER_ASK_TEMPLATE.startsWith(
        "The Runner picked above may not use {{name}}, so the step will fail when it runs.",
      ),
    ).toBe(true);
    expect(
      NOT_FOR_RUNNER_EDIT_TEMPLATE.startsWith(
        "The Runner picked above may not use {{name}}, so the step will fail when it runs.",
      ),
    ).toBe(true);
  });

  test("every Dashboard language has them, translated, with their slots", () => {
    const files: Array<string> = fs
      .readdirSync(LOCALES_DIR)
      .filter((file: string): boolean => {
        return file.endsWith(".json");
      });

    expect(files).toHaveLength(17);

    for (const file of files) {
      const locale: Record<string, string> = JSON.parse(
        fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"),
      );

      for (const key of [
        NO_SECRET_VARIABLES_ADD_ONE_TEMPLATE,
        NO_SECRET_VARIABLES_ASK_TEMPLATE,
        NOT_FOR_RUNNER_EDIT_TEMPLATE,
        NOT_FOR_RUNNER_ASK_TEMPLATE,
      ]) {
        const value: string | undefined = locale[key];

        expect([file, key, typeof value]).toEqual([file, key, "string"]);

        if (file === "en.json") {
          expect(value).toBe(key);
          continue;
        }

        expect([file, key, value === key]).toEqual([file, key, false]);
        expect([file, key, value!.split("{{location}}").length - 1]).toEqual([
          file,
          key,
          1,
        ]);
      }

      for (const key of [
        NOT_FOR_RUNNER_EDIT_TEMPLATE,
        NOT_FOR_RUNNER_ASK_TEMPLATE,
      ]) {
        expect([
          file,
          key,
          (locale[key] as string).split("{{name}}").length - 1,
        ]).toEqual([file, key, 1]);
      }
    }
  });
});
