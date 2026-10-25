import "@testing-library/jest-dom";
/*
 * jest itself is the global one: @jest/globals types jest.spyOn() as a mock
 * the global jest.SpiedFunction annotations here do not accept.
 */
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import React, { ReactElement } from "react";

/*
 * Code -> a repository -> Settings, and a Runner's own page: where a
 * repository's Runner is picked, and where a Runner says which
 * repositories pick it.
 *
 *   - the repository's settings have a Runner card of their own, whose Edit
 *     asks one thing on one page - no steps: the Runner picker for a
 *     repository (CodeRepositoryRunnerPicker), a field like the others -
 *     the form draws its title and its description, with no "(Optional)"
 *     since empty is an answer of its own (the project's default Runner,
 *     the Global Runner while there is none) - and its one choice writes the
 *     two columns it is stored in (CodeRepositoryRunnerChoice): the
 *     Runner's id, or none, and whether it picked the Global Runner itself;
 *   - the card says what the repository runs on
 *     (CodeRepositoryRunnerValueView, from the Runner choices the page
 *     read once for the card and for More settings' folded header), under
 *     its own title alone;
 *   - a Runner's page lists the repositories that pick it in its Runner
 *     Details, where the "Runs AI Code Fixes" switch was, each linked to
 *     the repository's settings at its Runner (#runner: More settings, where
 *     the Runner is, opens there) - or says none does, and where a
 *     repository picks its Runner.
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

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

import CodeRepositorySettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Code/Repository/Settings";
import {
  CodeRepositoryRunnerCopy,
  CodeRepositoryRunnerPicker,
  CodeRepositoryRunnerValueView,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeRepositoryRunner";
import RunnerCodeRepositoryList, {
  MAX_LISTED_CODE_REPOSITORIES,
  RUNNER_CODE_REPOSITORIES_TEST_ID,
  RunnerCodeRepositoriesCopy,
  RunnerCodeRepositoryRow,
  loadRunnerCodeRepositories,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Runner/RunnerCodeRepositories";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import RunnerChoicesLoader, {
  RunnerChoices,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Runner/RunnerChoices";
import { CODE_REPOSITORY_RUNNER_CHOICE_FIELD_KEY } from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeRepositoryRunnerChoice";
import { GLOBAL_RUNNER_PICK_VALUE } from "../../../../App/FeatureSet/Dashboard/src/Components/Runner/RunnerPickerModel";
import CodeRepository from "../../../Models/DatabaseModels/CodeRepository";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import ObjectID from "../../../Types/ObjectID";
import { CustomElementProps } from "../../../UI/Components/Forms/Types/Field";
import { ModelField } from "../../../UI/Components/Forms/ModelForm";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";
import fs from "fs";
import path from "path";

const PROJECT_ID: string = "dddddddd-0000-4000-8000-000000000003";
const RUNNER_ID: string = "aaaaaaaa-0000-4000-8000-000000000021";
const REPOSITORY_ID: string = "eeeeeeee-0000-4000-8000-000000000021";

type FormField = ModelField<CodeRepository>;

interface DetailField {
  field?: Record<string, boolean>;
  title?: string;
  description?: string;
  getElement?: ((item: CodeRepository) => ReactElement) | undefined;
}

// The Runner card, as the settings page drew it.
function page(): Record<string, unknown> {
  render(<CodeRepositorySettings {...({} as unknown as PageComponentProps)} />);

  return mockDetails.filter((props: Record<string, unknown>): boolean => {
    return props["name"] === "Repository > Runner";
  })[0]!;
}

beforeEach(() => {
  mockDetails.length = 0;
  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockReturnValue(new ObjectID(REPOSITORY_ID));
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  /*
   * The page reads the Runner choices once, for the card and for More
   * settings' folded header: left on their way here (the card's value is
   * drawn from them, null until they arrive).
   */
  jest
    .spyOn(RunnerChoicesLoader, "loadForCodeRepository")
    .mockReturnValue(new Promise<RunnerChoices>(() => {}));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a repository's settings: its Runner", () => {
  test("a card of its own, whose Edit asks for it alone, on one page", () => {
    const card: Record<string, unknown> = page();

    expect((card["cardProps"] as { title: string }).title).toBe("Runner");
    expect((card["cardProps"] as { description: string }).description).toBe(
      CodeRepositoryRunnerCopy.fieldDescription,
    );
    expect(card["editButtonText"]).toBe("Edit");
    expect(card["editModalTitle"]).toBe("Runner");
    // No steps: the old dialog's Runner step was the third of four.
    expect(card["formSteps"]).toBeUndefined();

    /*
     * One field drawn - the Runner picker - and the two columns its choice
     * writes, never drawn.
     */
    const fields: Array<FormField> = card["formFields"] as Array<FormField>;
    const drawn: Array<FormField> = fields.filter((field: FormField) => {
      return !field.showIf || field.showIf({} as FormValues<CodeRepository>);
    });

    expect(drawn).toHaveLength(1);
    expect(fields).toHaveLength(3);
  });

  // The one choice, as the form holds it.
  function choiceField(): FormField {
    const fields: Array<FormField> = page()["formFields"] as Array<FormField>;

    return fields.find((field: FormField) => {
      return field.overrideFieldKey === CODE_REPOSITORY_RUNNER_CHOICE_FIELD_KEY;
    })!;
  }

  test("its one field is the Runner picker for a repository, a field like the others, held as one choice that is never sent", () => {
    const runner: FormField = choiceField();

    expect(runner).toBeDefined();
    expect(runner.formOnly).toBe(true);
    expect(runner.stepId).toBeUndefined();
    expect(runner.title).toBe(CodeRepositoryRunnerCopy.fieldTitle);
    expect(runner.fieldType).toBe(FormFieldSchemaType.CustomComponent);
    expect(runner.required).toBe(false);
    /*
     * The form draws the title and the line under it, as for every other
     * field of the dialog - the card's own words - and no "(Optional)":
     * empty is an answer of its own.
     */
    expect(runner.customElementDrawsOwnLabel).toBeFalsy();
    expect(runner.description).toBe(CodeRepositoryRunnerCopy.fieldDescription);
    expect(runner.hideOptionalLabel).toBe(true);

    const written: Array<unknown> = [];
    const element: ReactElement = runner.getCustomElement!(
      { runnerId: new ObjectID(RUNNER_ID) } as FormValues<CodeRepository>,
      {
        onChange: (value: unknown): void => {
          written.push(value);
        },
        ariaLabelledby: "field-label-runner",
      } as CustomElementProps,
    ) as ReactElement;

    expect(element.type).toBe(CodeRepositoryRunnerPicker);
    expect(String(element.props.value)).toBe(RUNNER_ID);
    // The menu is named by the label the form drew.
    expect(element.props.ariaLabelledby).toBe("field-label-runner");

    element.props.onChange("");
    element.props.onChange(GLOBAL_RUNNER_PICK_VALUE);
    element.props.onChange(RUNNER_ID);

    expect(written).toEqual(["", GLOBAL_RUNNER_PICK_VALUE, RUNNER_ID]);
  });

  test("it starts on what the repository stores, read as one choice", () => {
    const runner: FormField = choiceField();
    const start: (values: Record<string, unknown>) => unknown = (
      values: Record<string, unknown>,
    ): unknown => {
      return runner.getDefaultValue!(values as FormValues<CodeRepository>);
    };

    expect(start({ runnerId: new ObjectID(RUNNER_ID) })).toBe(RUNNER_ID);
    expect(start({ runnerId: null, isGlobalRunnerPicked: true })).toBe(
      GLOBAL_RUNNER_PICK_VALUE,
    );
    expect(start({ runnerId: null, isGlobalRunnerPicked: false })).toBe("");
    expect(start({})).toBe("");
    // A pick wins over a stale Global Runner pick.
    expect(start({ runnerId: RUNNER_ID, isGlobalRunnerPicked: true })).toBe(
      RUNNER_ID,
    );

    // While it is edited, what was picked is what the picker shows.
    const element: ReactElement = runner.getCustomElement!(
      {
        runnerId: new ObjectID(RUNNER_ID),
        [CODE_REPOSITORY_RUNNER_CHOICE_FIELD_KEY]: GLOBAL_RUNNER_PICK_VALUE,
      } as unknown as FormValues<CodeRepository>,
      { onChange: (): void => {} } as unknown as CustomElementProps,
    ) as ReactElement;

    expect(element.props.value).toBe(GLOBAL_RUNNER_PICK_VALUE);
  });

  test("a choice writes the two columns it is stored in, and keeps the form's other values", () => {
    const runner: FormField = choiceField();
    const written: Array<Record<string, unknown>> = [];
    const write: (choice: string) => Record<string, unknown> = (
      choice: string,
    ): Record<string, unknown> => {
      runner.onChange!(
        choice,
        { name: "checkout" } as unknown as FormValues<CodeRepository>,
        (values: FormValues<CodeRepository>): void => {
          written.push(values as unknown as Record<string, unknown>);
        },
      );

      return written[written.length - 1]!;
    };

    // Picked none: it follows the project's default Runner.
    expect(write("")).toEqual({
      name: "checkout",
      runnerId: null,
      isGlobalRunnerPicked: false,
    });

    // The Global Runner itself: never the default.
    expect(write(GLOBAL_RUNNER_PICK_VALUE)).toEqual({
      name: "checkout",
      runnerId: null,
      isGlobalRunnerPicked: true,
    });

    // A Runner of the project's own.
    const picked: Record<string, unknown> = write(RUNNER_ID);
    expect(String(picked["runnerId"])).toBe(RUNNER_ID);
    expect(picked["runnerId"]).toBeInstanceOf(ObjectID);
    expect(picked["isGlobalRunnerPicked"]).toBe(false);
  });

  test("the two columns are fields of the form - so it reads and sends them - and never drawn", () => {
    const fields: Array<FormField> = page()["formFields"] as Array<FormField>;

    for (const column of ["runnerId", "isGlobalRunnerPicked"]) {
      const field: FormField | undefined = fields.find(
        (candidate: FormField) => {
          return Boolean(
            (candidate.field as Record<string, boolean> | undefined)?.[column],
          );
        },
      );

      expect({ column, found: Boolean(field) }).toEqual({
        column,
        found: true,
      });
      expect(field!.showIf!({} as FormValues<CodeRepository>)).toBe(false);
      expect(field!.formOnly).toBeFalsy();
    }
  });

  test("the card says what the repository runs on, under the card's own title alone", () => {
    const fields: Array<DetailField> = (
      page()["modelDetailProps"] as { fields: Array<DetailField> }
    ).fields;
    const runner: DetailField | undefined = fields.find(
      (field: DetailField) => {
        return Boolean(field.field?.["runnerId"]);
      },
    );

    expect(fields).toHaveLength(1);
    expect(runner).toBeDefined();
    // The card is titled Runner and says what it is for: no label again.
    expect(runner!.title).toBeUndefined();
    expect(runner!.description).toBeUndefined();

    const item: CodeRepository = new CodeRepository();
    item.runnerId = new ObjectID(RUNNER_ID);
    // Commands set or not, the value says the same: what the Runner does.
    item.setupCommand = "npm ci";

    const element: ReactElement = runner!.getElement!(item);

    /*
     * Drawn from the choices the page read (null while they are on their
     * way): one read for the card and for what More settings says of the
     * Runner while it is folded.
     */
    expect(element.type).toBe(CodeRepositoryRunnerValueView);
    expect(String(element.props.runnerId)).toBe(RUNNER_ID);
    expect(Object.keys(element.props).sort()).toEqual([
      "choices",
      "isGlobalRunnerPicked",
      "runnerId",
    ]);
    expect(element.props.choices).toBeNull();

    // Whether it picked the Global Runner itself reaches the value too.
    const global: CodeRepository = new CodeRepository();
    global.isGlobalRunnerPicked = true;

    expect(runner!.getElement!(global).props.isGlobalRunnerPicked).toBe(true);
  });

  test("the card reads whether the repository picked the Global Runner itself", () => {
    const detail: { selectMoreFields?: Record<string, boolean> } = page()[
      "modelDetailProps"
    ] as { selectMoreFields?: Record<string, boolean> };

    expect(detail.selectMoreFields).toEqual({ isGlobalRunnerPicked: true });
  });
});

describe("a Runner's page: the repositories that pick it", () => {
  function lists(
    rows: Array<{ id: string; name: string }> | Error,
  ): jest.SpiedFunction<typeof ModelAPI.getList> {
    return jest
      .spyOn(ModelAPI, "getList")
      .mockImplementation(async (): Promise<ListResult<never>> => {
        if (rows instanceof Error) {
          throw rows;
        }

        return {
          data: rows.map((row: { id: string; name: string }) => {
            return Object.assign(new CodeRepository(), {
              _id: row.id,
              name: row.name,
            });
          }) as Array<never>,
          count: rows.length,
          skip: 0,
          limit: MAX_LISTED_CODE_REPOSITORIES,
        };
      });
  }

  test("the repositories that pick it are read by their Runner, by name, as many as the row lists", async () => {
    const getList: jest.SpiedFunction<typeof ModelAPI.getList> = lists([
      { id: REPOSITORY_ID, name: "checkout" },
    ]);

    const rows: Array<RunnerCodeRepositoryRow> | null =
      await loadRunnerCodeRepositories(new ObjectID(RUNNER_ID));

    expect(rows).toEqual([{ id: REPOSITORY_ID, name: "checkout" }]);

    const read: {
      modelType: unknown;
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      sort: Record<string, unknown>;
      limit: number;
    } = getList.mock.calls[0]![0] as unknown as {
      modelType: unknown;
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      sort: Record<string, unknown>;
      limit: number;
    };

    expect(read.modelType).toBe(CodeRepository);
    expect(String(read.query["runnerId"])).toBe(RUNNER_ID);
    expect(read.select).toEqual({ _id: true, name: true });
    expect(Object.keys(read.sort)).toEqual(["name"]);
    expect(read.limit).toBe(MAX_LISTED_CODE_REPOSITORIES);
  });

  /*
   * The project's default Runner works in the repositories that pick none
   * as well - unless one picked the Global Runner itself - so its page lists
   * them with the ones that pick it, by name.
   */
  test("the project's default Runner lists the repositories that follow it too, by name - never one that picked the Global Runner", async () => {
    const getList: jest.SpiedFunction<typeof ModelAPI.getList> = jest
      .spyOn(ModelAPI, "getList")
      .mockImplementation(
        async (data: {
          query: Record<string, unknown>;
        }): Promise<ListResult<never>> => {
          const rows: Array<CodeRepository> =
            data.query["runnerId"] instanceof IsNull
              ? [
                  Object.assign(new CodeRepository(), {
                    _id: "eeeeeeee-0000-4000-8000-000000000031",
                    name: "web-app",
                  }),
                  Object.assign(new CodeRepository(), {
                    _id: "eeeeeeee-0000-4000-8000-000000000032",
                    name: "api",
                    isGlobalRunnerPicked: false,
                  }),
                  Object.assign(new CodeRepository(), {
                    _id: "eeeeeeee-0000-4000-8000-000000000033",
                    name: "public-docs",
                    isGlobalRunnerPicked: true,
                  }),
                ]
              : [
                  Object.assign(new CodeRepository(), {
                    _id: REPOSITORY_ID,
                    name: "checkout",
                  }),
                ];

          return {
            data: rows as Array<never>,
            count: rows.length,
            skip: 0,
            limit: MAX_LISTED_CODE_REPOSITORIES,
          };
        },
      );

    const rows: Array<RunnerCodeRepositoryRow> | null =
      await loadRunnerCodeRepositories(new ObjectID(RUNNER_ID), {
        isProjectDefault: true,
      });

    expect(rows).toEqual([
      { id: "eeeeeeee-0000-4000-8000-000000000032", name: "api" },
      { id: REPOSITORY_ID, name: "checkout" },
      { id: "eeeeeeee-0000-4000-8000-000000000031", name: "web-app" },
    ]);

    const following: { select: Record<string, unknown> } = getList.mock
      .calls[1]![0] as unknown as { select: Record<string, unknown> };
    expect(following.select).toEqual({
      _id: true,
      name: true,
      isGlobalRunnerPicked: true,
    });
  });

  test("a Runner that is not the project's default lists only the repositories that pick it", async () => {
    const getList: jest.SpiedFunction<typeof ModelAPI.getList> = lists([
      { id: REPOSITORY_ID, name: "checkout" },
    ]);

    await loadRunnerCodeRepositories(new ObjectID(RUNNER_ID), {
      isProjectDefault: false,
    });

    expect(getList).toHaveBeenCalledTimes(1);
  });

  test("a read that is refused is null - the row is left out - not an empty list", async () => {
    lists(new Error("Permission denied"));

    expect(await loadRunnerCodeRepositories(new ObjectID(RUNNER_ID))).toBe(
      null,
    );
  });

  test("each repository that picks it, linked to the repository's settings at its Runner", () => {
    render(
      <RunnerCodeRepositoryList
        repositories={[
          { id: REPOSITORY_ID, name: "checkout" },
          { id: "eeeeeeee-0000-4000-8000-000000000022", name: "web-app" },
        ]}
      />,
    );

    const list: HTMLElement = screen.getByTestId(
      RUNNER_CODE_REPOSITORIES_TEST_ID,
    );
    const links: Array<HTMLElement> = screen.getAllByTestId(
      `${RUNNER_CODE_REPOSITORIES_TEST_ID}-link`,
    );

    expect(list.tagName).toBe("UL");
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveTextContent("checkout");
    expect(links[0]).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/code/repositories/${REPOSITORY_ID}/settings#runner`,
    );
    expect(links[1]).toHaveTextContent("web-app");
    expect(
      screen.queryByTestId(`${RUNNER_CODE_REPOSITORIES_TEST_ID}-empty`),
    ).toBeNull();
  });

  test("none: one short line says so, and where a repository picks its Runner", () => {
    render(<RunnerCodeRepositoryList repositories={[]} />);

    const empty: HTMLElement = screen.getByTestId(
      `${RUNNER_CODE_REPOSITORIES_TEST_ID}-empty`,
    );

    expect(empty).toHaveTextContent(RunnerCodeRepositoriesCopy.empty);
    expect(RunnerCodeRepositoriesCopy.empty).toBe(
      "None. A repository picks its Runner in its settings in Code.",
    );
    expect(empty.className).toContain("text-gray-500");
    expect(screen.queryByRole("link")).toBeNull();
  });

  /*
   * Where the "Runs AI Code Fixes" switch was: a row of Runner Details,
   * after what the Runner may run and before its labels - not a card of its
   * own, which put an empty box between Runner Status and the setup
   * command on every Runner no repository picks.
   */
  test("the Runner's page lists them in Runner Details, after what the Runner may run, and never for the Kubernetes agent's Runner or a reader who cannot read them", () => {
    const source: string = fs.readFileSync(
      path.join(
        __dirname,
        "../../../../App/FeatureSet/Dashboard/src/Pages/Runbook/Runners/RunnerView.tsx",
      ),
      "utf8",
    );

    /*
     * What the Runner may run is "Runs Runbooks" alone: "Runs AI
     * Remediation Commands" went the same way as the AI code fix switch -
     * an auto remediation rule, or a cluster's AI settings, picks the
     * Runner OneUptime AI runs its commands on.
     */
    const runsRunbooks: number = source.indexOf('title: "Runs Runbooks"');
    const row: number = source.indexOf(
      "title: RunnerCodeRepositoriesCopy.title",
    );
    const labels: number = source.indexOf('title: "Labels"');
    const statusCard: number = source.indexOf('name="Runner Status"');

    expect(runsRunbooks).toBeGreaterThan(-1);
    expect(source).not.toContain('title: "Runs AI Remediation Commands"');
    expect(row).toBeGreaterThan(runsRunbooks);
    expect(labels).toBeGreaterThan(row);
    // Inside Runner Details, which ends where Runner Status begins.
    expect(statusCard).toBeGreaterThan(labels);

    const rowSource: string = source.slice(row, labels);

    expect(rowSource).toContain("Array.isArray(codeRepositories)");
    expect(rowSource).toContain("!isKubernetesAgentRunnerRow(item)");
    expect(rowSource).toContain("<RunnerCodeRepositoryList");

    // No card of its own any more.
    expect(source).not.toContain("<RunnerCodeRepositories ");
    /*
     * Read with whether this Runner is the project's default, and again
     * when that changes: the repositories that follow the default move with
     * it.
     */
    expect(source).toContain(
      "loadRunnerCodeRepositories(modelId, { isProjectDefault })",
    );
    expect(source).toContain("}, [modelId.toString(), isProjectDefault]);");
  });

  /*
   * The setup command is the card's body: a card hides its description
   * below md, so a phone showed "Setup Instructions" and nothing under it.
   */
  test("the Setup Instructions are the card's body, so a phone shows them", () => {
    const source: string = fs.readFileSync(
      path.join(
        __dirname,
        "../../../../App/FeatureSet/Dashboard/src/Pages/Runbook/Runners/RunnerView.tsx",
      ),
      "utf8",
    );
    const card: number = source.indexOf('<Card title="Setup Instructions">');

    expect(card).toBeGreaterThan(-1);
    // The card's tag closes after its title: no description holds them.
    const body: string = source.slice(card, source.indexOf("</Card>", card));

    expect(body).toContain("<RunnerInstallInstructions");
  });
});
