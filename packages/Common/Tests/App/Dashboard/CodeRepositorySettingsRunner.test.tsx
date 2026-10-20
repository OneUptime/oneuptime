import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import React, { ReactElement } from "react";

/*
 * Code -> a repository -> Settings, and a Runner's own page: where a
 * repository's Runner is picked, and where a Runner says which
 * repositories pick it.
 *
 *   - the repository's settings form has a Runner step, between GitHub
 *     Commands and Build & Test, whose one field is the Runner picker for a
 *     repository (CodeRepositoryRunnerPicker): optional, Global Runner when
 *     empty, and it writes the Runner's id, or nothing for Global Runner;
 *   - the settings card says what the repository runs on
 *     (CodeRepositoryRunnerValue);
 *   - a Runner's page lists the repositories that pick it, each linked to
 *     the repository's settings - or says none does, and how to change
 *     that.
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
  CodeRepositoryRunnerValue,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeRepositoryRunner";
import RunnerCodeRepositories, {
  MAX_LISTED_CODE_REPOSITORIES,
  RUNNER_CODE_REPOSITORIES_TEST_ID,
  RunnerCodeRepositoriesCopy,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Runner/RunnerCodeRepositories";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import CodeRepository from "../../../Models/DatabaseModels/CodeRepository";
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

function page(): Record<string, unknown> {
  render(<CodeRepositorySettings {...({} as unknown as PageComponentProps)} />);

  return mockDetails[mockDetails.length - 1]!;
}

beforeEach(() => {
  mockDetails.length = 0;
  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockReturnValue(new ObjectID(REPOSITORY_ID));
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a repository's settings: its Runner", () => {
  test("the form asks for it on a step of its own, after GitHub Commands and before Build & Test", () => {
    const steps: Array<{ title: string; id: string }> = page()[
      "formSteps"
    ] as Array<{ title: string; id: string }>;

    expect(
      steps.map((step: { id: string }) => {
        return step.id;
      }),
    ).toEqual(["pull-requests", "github-commands", "runner", "build-and-test"]);
    expect(steps[2]!.title).toBe("Runner");
  });

  test("its one field is the Runner picker for a repository, optional, and it writes the Runner picked or nothing", () => {
    const fields: Array<FormField> = page()["formFields"] as Array<FormField>;
    const runner: FormField | undefined = fields.find((field: FormField) => {
      return Boolean(
        (field.field as Record<string, boolean> | undefined)?.["runnerId"],
      );
    });

    expect(runner).toBeDefined();
    expect(runner!.stepId).toBe("runner");
    expect(runner!.title).toBe(CodeRepositoryRunnerCopy.fieldTitle);
    expect(runner!.fieldType).toBe(FormFieldSchemaType.CustomComponent);
    expect(runner!.required).toBe(false);
    expect(runner!.customElementDrawsOwnLabel).toBe(true);

    const written: Array<unknown> = [];
    const element: ReactElement = runner!.getCustomElement!(
      { runnerId: new ObjectID(RUNNER_ID) } as FormValues<CodeRepository>,
      {
        onChange: (value: unknown): void => {
          written.push(value);
        },
      } as CustomElementProps,
    ) as ReactElement;

    expect(element.type).toBe(CodeRepositoryRunnerPicker);
    expect(String(element.props.value)).toBe(RUNNER_ID);

    element.props.onChange(null);
    element.props.onChange(RUNNER_ID);

    expect(written).toEqual([null, RUNNER_ID]);
  });

  test("the settings card says what the repository runs on", () => {
    const fields: Array<DetailField> = (
      page()["modelDetailProps"] as { fields: Array<DetailField> }
    ).fields;
    const runner: DetailField | undefined = fields.find(
      (field: DetailField) => {
        return Boolean(field.field?.["runnerId"]);
      },
    );

    expect(runner).toBeDefined();
    expect(runner!.title).toBe(CodeRepositoryRunnerCopy.fieldTitle);
    expect(runner!.description).toBe(CodeRepositoryRunnerCopy.fieldDescription);

    const item: CodeRepository = new CodeRepository();
    item.runnerId = new ObjectID(RUNNER_ID);

    const element: ReactElement = runner!.getElement!(item);

    expect(element.type).toBe(CodeRepositoryRunnerValue);
    expect(String(element.props.runnerId)).toBe(RUNNER_ID);
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

  test("each repository that picks it, linked to the repository's settings", async () => {
    const getList: jest.SpiedFunction<typeof ModelAPI.getList> = lists([
      { id: REPOSITORY_ID, name: "checkout" },
    ]);

    render(<RunnerCodeRepositories runnerId={new ObjectID(RUNNER_ID)} />);

    const card: HTMLElement = await screen.findByTestId(
      RUNNER_CODE_REPOSITORIES_TEST_ID,
    );

    expect(card).toHaveTextContent("checkout");
    expect(
      screen.getByTestId(`${RUNNER_CODE_REPOSITORIES_TEST_ID}-link`),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/code/repositories/${REPOSITORY_ID}/settings`,
    );
    expect(
      screen.getByText(RunnerCodeRepositoriesCopy.description),
    ).toBeInTheDocument();

    const read: {
      modelType: unknown;
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      limit: number;
    } = getList.mock.calls[0]![0] as unknown as {
      modelType: unknown;
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      limit: number;
    };

    expect(read.modelType).toBe(CodeRepository);
    expect(String(read.query["runnerId"])).toBe(RUNNER_ID);
    expect(read.select).toEqual({ _id: true, name: true });
    expect(read.limit).toBe(MAX_LISTED_CODE_REPOSITORIES);
  });

  test("none: it says so, and where a repository picks it", async () => {
    lists([]);

    render(<RunnerCodeRepositories runnerId={new ObjectID(RUNNER_ID)} />);

    expect(
      await screen.findByTestId(`${RUNNER_CODE_REPOSITORIES_TEST_ID}-empty`),
    ).toHaveTextContent(RunnerCodeRepositoriesCopy.empty);
  });

  test("someone who may not read repositories sees no card at all", async () => {
    const getList: jest.SpiedFunction<typeof ModelAPI.getList> = lists(
      new Error("Permission denied"),
    );

    render(<RunnerCodeRepositories runnerId={new ObjectID(RUNNER_ID)} />);

    await waitFor(() => {
      expect(getList).toHaveBeenCalled();
    });

    expect(screen.queryByTestId(RUNNER_CODE_REPOSITORIES_TEST_ID)).toBeNull();
  });

  test("the Runner's page draws it once the Runner loads, and never for the Kubernetes agent's Runner", () => {
    const source: string = fs.readFileSync(
      path.join(
        __dirname,
        "../../../../App/FeatureSet/Dashboard/src/Pages/Runbook/Runners/RunnerView.tsx",
      ),
      "utf8",
    );

    expect(source).toContain(
      "{isRunnerLoaded && !formRestrictions.areShellCapabilitiesLocked ? (",
    );
    expect(source).toContain("<RunnerCodeRepositories runnerId={modelId} />");
  });
});
