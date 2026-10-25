import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * The Threat Intel page leads with the "how threat intel works" card, and
 * its feeds table's help (?) modal shows the same guide, so the two cannot
 * disagree. Both tables are mocked to capture their props and render a
 * marker, so the page's own composition is what is under test.
 */

type CapturedFormField = {
  field: Record<string, boolean>;
  title: string;
  validation?:
    | { minValue?: number | undefined; maxValue?: number | undefined }
    | undefined;
};

type CapturedTableProps = {
  formFields?: Array<CapturedFormField>;
  formSteps?: Array<{
    id: string;
    title: string;
    showIf?: ((values: Record<string, unknown>) => boolean) | undefined;
  }>;
  actionButtons?: Array<{
    title: string;
    placement?: string | undefined;
    onClick: (
      item: Record<string, unknown>,
      onCompleteAction: () => void,
      onError: (error: Error) => void,
    ) => void;
  }>;
  // The page hears how many feeds the table read (the how-it-works card).
  onFetchSuccess?:
    | ((data: Array<unknown>, totalCount: number) => void)
    | undefined;
  createInitialValues?: Record<string, unknown>;
  helpContent?:
    | {
        title?: string | undefined;
        description?: string | undefined;
        markdown?: string | undefined;
      }
    | undefined;
};

let capturedFeedTableProps: CapturedTableProps | null = null;

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: CapturedTableProps) => {
      capturedFeedTableProps = props;
      return React.createElement("div", { "data-testid": "feeds-table" });
    },
  };
});

// The Update Credentials dialog, as the fields it is handed.
let capturedCredentialsDialog: {
  formProps: { fields: Array<Record<string, unknown>> };
} | null = null;

jest.mock("../../../UI/Components/FormModal/BasicFormModal", () => {
  return {
    __esModule: true,
    default: (props: {
      formProps: { fields: Array<Record<string, unknown>> };
    }) => {
      capturedCredentialsDialog = props;
      return React.createElement("div", {
        "data-testid": "credentials-dialog",
      });
    },
  };
});

jest.mock("../../../UI/Components/ModelTable/AnalyticsModelTable", () => {
  return {
    __esModule: true,
    default: () => {
      return React.createElement("div", { "data-testid": "indicators-table" });
    },
  };
});

// The Free Lists tiles read which lists the project has: none, here.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/ThreatIntelRecommendedLists",
  () => {
    return {
      __esModule: true,
      default: () => {
        return React.createElement("div", { "data-testid": "free-lists" });
      },
    };
  },
);

import ThreatIntelPage from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/ThreatIntel";
import ThreatIntelGuide from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/HowItWorks/ThreatIntelGuide";
import { guideToMarkdown } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/HowItWorks/SecurityEventsGuide";
import Project from "../../../Models/DatabaseModels/Project";
import Reseller from "../../../Models/DatabaseModels/Reseller";
import ProjectUtil from "../../../UI/Utils/Project";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ObjectID from "../../../Types/ObjectID";
import Route from "../../../Types/API/Route";
import {
  THREAT_INTEL_DEFAULT_POLL_INTERVAL_IN_MINUTES,
  THREAT_INTEL_POLL_INTERVAL_MAX_IN_MINUTES,
  THREAT_INTEL_POLL_INTERVAL_MIN_IN_MINUTES,
} from "../../../Types/SecurityEvent/ThreatIntelConstants";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

function renderPage(project?: Project): void {
  const currentProject: Project = project || new Project();
  currentProject.id = PROJECT_ID;

  render(
    <MemoryRouter>
      <ThreatIntelPage
        pageRoute={new Route("/dashboard/security-events/threat-intel")}
        currentProject={currentProject}
        hasPaymentMethod={true}
      />
    </MemoryRouter>,
  );
}

function fieldTitled(title: string): CapturedFormField {
  const field: CapturedFormField | undefined =
    capturedFeedTableProps?.formFields?.find(
      (formField: CapturedFormField): boolean => {
        return formField.title === title;
      },
    );

  expect(field).toBeDefined();

  return field!;
}

// The feeds table answers with this many feeds, as its first read would.
function feedsRead(count: number): void {
  act(() => {
    capturedFeedTableProps!.onFetchSuccess!([], count);
  });
}

function isBefore(first: HTMLElement, second: HTMLElement): boolean {
  return Boolean(
    first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

describe("Threat Intel page", () => {
  beforeEach(() => {
    capturedFeedTableProps = null;
    window.localStorage.clear();
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
    jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed: true });
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
    window.localStorage.clear();
  });

  test("leads with the how-it-works card, then the free lists, above the feeds and indicators tables", () => {
    renderPage();

    const card: HTMLElement = screen.getByTestId(
      `how-it-works-${ThreatIntelGuide.id}`,
    );

    expect(card).toHaveTextContent(ThreatIntelGuide.title);
    expect(isBefore(card, screen.getByTestId("free-lists"))).toBe(true);
    expect(
      isBefore(
        screen.getByTestId("free-lists"),
        screen.getByTestId("feeds-table"),
      ),
    ).toBe(true);
    expect(
      isBefore(
        screen.getByTestId("feeds-table"),
        screen.getByTestId("indicators-table"),
      ),
    ).toBe(true);
  });

  test("the card shows the threat levels, one chip per confidence band plus unscored", () => {
    renderPage();
    // A project with no feed: the card opens.
    feedsRead(0);

    expect(screen.getAllByTestId("how-it-works-level")).toHaveLength(
      ThreatIntelGuide.levels.items.length,
    );
    expect(screen.getByText("Threat levels")).toBeInTheDocument();
  });

  test("the card waits folded while the feeds are read, and stays folded over a project's feeds", () => {
    renderPage();

    const toggle: HTMLElement = screen.getByTestId("how-it-works-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryAllByTestId("how-it-works-step")).toHaveLength(0);

    feedsRead(2);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    // A search narrowing the table later does not open it either.
    feedsRead(0);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  test("Create Monitor and Update Credentials wait in a feed's menu: Edit is its button", () => {
    renderPage();

    const placements: Record<string, string | undefined> = {};
    for (const button of capturedFeedTableProps?.actionButtons || []) {
      placements[button.title] = button.placement;
    }

    expect(placements["Create Monitor"]).toBe("MoreMenu");
    expect(placements["Update Credentials"]).toBe("MoreMenu");
    // View Error still leads a row with something to read.
    expect(placements["View Error"]).toBe("Primary");
  });

  test("the feeds table's help (?) modal shows the same guide as the card", () => {
    renderPage();

    expect(capturedFeedTableProps?.helpContent).toEqual({
      title: ThreatIntelGuide.guideTitle,
      description: ThreatIntelGuide.guideDescription,
      markdown: guideToMarkdown(ThreatIntelGuide),
    });
  });

  test("the poll interval form bounds are the ones the guide states", () => {
    renderPage();

    const pollInterval: CapturedFormField = fieldTitled(
      "Poll Interval (Minutes)",
    );

    expect(pollInterval.validation?.minValue).toBe(
      THREAT_INTEL_POLL_INTERVAL_MIN_IN_MINUTES,
    );
    expect(pollInterval.validation?.maxValue).toBe(
      THREAT_INTEL_POLL_INTERVAL_MAX_IN_MINUTES,
    );
    expect(capturedFeedTableProps?.createInitialValues).toMatchObject({
      pollIntervalInMinutes: THREAT_INTEL_DEFAULT_POLL_INTERVAL_IN_MINUTES,
    });
  });

  describe("adding a feed: where its indicators come from, how to sign in to it, what a match does", () => {
    type FormField = Record<string, unknown> & {
      field?: Record<string, boolean>;
      title: string;
      stepId?: string;
      showIf?: (values: Record<string, unknown>) => boolean;
      required?: boolean | ((values: Record<string, unknown>) => boolean);
      doNotShowWhenEditing?: boolean;
      doNotShowWhenCreating?: boolean;
      formOnly?: boolean;
      overrideFieldKey?: string;
      defaultValue?: unknown;
      radioButtonOptions?: Array<{
        value: string;
        title: string;
        description?: string;
      }>;
    };

    function fields(): Array<FormField> {
      return (capturedFeedTableProps?.formFields ||
        []) as unknown as Array<FormField>;
    }

    function byColumn(column: string): FormField {
      const found: FormField | undefined = fields().find(
        (field: FormField): boolean => {
          return Object.keys(field.field || {})[0] === column;
        },
      );

      expect(found).toBeDefined();

      return found!;
    }

    function byKey(key: string): FormField {
      const found: FormField | undefined = fields().find(
        (field: FormField): boolean => {
          return field.overrideFieldKey === key;
        },
      );

      expect(found).toBeDefined();

      return found!;
    }

    function isRequired(
      field: FormField,
      values: Record<string, unknown>,
    ): boolean {
      return typeof field.required === "function"
        ? field.required(values)
        : Boolean(field.required);
    }

    const ANONYMOUS: Record<string, unknown> = { taxiiSignIn: "anonymous" };
    const TOKEN: Record<string, unknown> = { taxiiSignIn: "api-token" };
    const BASIC: Record<string, unknown> = { taxiiSignIn: "basic-auth" };

    test("the source, then its own step, then Sign-in for a TAXII collection, then On Match", () => {
      renderPage();

      expect(
        (capturedFeedTableProps?.formSteps || []).map(
          (step: { id: string; title: string }) => {
            return [step.id, step.title];
          },
        ),
      ).toEqual([
        ["source", "Source"],
        ["list", "List"],
        ["taxii-server", "TAXII Server"],
        ["google-secops", "Google SecOps"],
        ["sign-in", "Sign-in"],
        ["on-match", "On Match"],
      ]);
    });

    test("each source walks only its own steps", () => {
      renderPage();

      const walked: (values: Record<string, unknown>) => Array<string> = (
        values: Record<string, unknown>,
      ): Array<string> => {
        return (capturedFeedTableProps?.formSteps || [])
          .filter(
            (step: {
              showIf?:
                | ((values: Record<string, unknown>) => boolean)
                | undefined;
            }) => {
              return !step.showIf || step.showIf(values);
            },
          )
          .map((step: { id: string }) => {
            return step.id;
          });
      };

      expect(walked({ feedType: "list", ...ANONYMOUS })).toEqual([
        "source",
        "list",
        "on-match",
      ]);
      expect(walked({ feedType: "taxii", ...ANONYMOUS })).toEqual([
        "source",
        "taxii-server",
        "sign-in",
        "on-match",
      ]);
      expect(walked({ feedType: "google-secops", ...ANONYMOUS })).toEqual([
        "source",
        "google-secops",
        "on-match",
      ]);
      // A feed saved before there were sources is a TAXII collection.
      expect(walked({ apiRootUrl: "https://taxii.example.com/api1/" })).toEqual(
        ["source", "taxii-server", "on-match"],
      );
    });

    test("Sign-in is one choice of three, a new feed's only, starting on No sign-in", () => {
      renderPage();

      const choice: FormField = byKey("taxiiSignIn");

      expect(choice.formOnly).toBe(true);
      expect(choice.doNotShowWhenEditing).toBe(true);
      expect(choice.stepId).toBe("sign-in");
      expect(choice.defaultValue).toBe("anonymous");
      expect(
        (choice.radioButtonOptions || []).map(
          (option: { value: string; title: string }) => {
            return [option.value, option.title];
          },
        ),
      ).toEqual([
        ["anonymous", "No sign-in"],
        ["api-token", "Bearer token"],
        ["basic-auth", "Username and password"],
      ]);
    });

    test("each answer asks only for its own secrets, and requires them", () => {
      renderPage();

      const token: FormField = byColumn("apiToken");
      const username: FormField = byColumn("basicAuthUsername");
      const password: FormField = byColumn("basicAuthPassword");

      for (const [values, shown] of [
        [ANONYMOUS, []],
        [TOKEN, ["apiToken"]],
        [BASIC, ["basicAuthUsername", "basicAuthPassword"]],
      ] as Array<[Record<string, unknown>, Array<string>]>) {
        expect({
          values,
          shown: [token, username, password]
            .filter((field: FormField) => {
              return field.showIf!(values);
            })
            .map((field: FormField) => {
              return Object.keys(field.field || {})[0];
            }),
          required: [token, username, password]
            .filter((field: FormField) => {
              return isRequired(field, values);
            })
            .map((field: FormField) => {
              return Object.keys(field.field || {})[0];
            }),
        }).toEqual({ values, shown, required: shown });
      }
    });

    test("an existing feed's Edit form shows the username it signs in with, and never a secret", () => {
      renderPage();

      const signInStep: {
        showIf?: ((values: Record<string, unknown>) => boolean) | undefined;
      } = (capturedFeedTableProps?.formSteps || []).find(
        (step: { id: string }) => {
          return step.id === "sign-in";
        },
      )!;

      // Editing: no choice is asked.
      expect(
        byColumn("basicAuthUsername").showIf!({ basicAuthUsername: "svc" }),
      ).toBe(true);
      expect(byColumn("basicAuthUsername").showIf!({})).toBe(false);
      expect(signInStep.showIf!({ basicAuthUsername: "svc" })).toBe(true);
      expect(signInStep.showIf!({})).toBe(false);
      // Creating a TAXII feed: the step is always walked; another source never signs in.
      expect(signInStep.showIf!(ANONYMOUS)).toBe(true);
      expect(signInStep.showIf!({ ...ANONYMOUS, feedType: "list" })).toBe(
        false,
      );
      expect(
        signInStep.showIf!({ ...ANONYMOUS, feedType: "google-secops" }),
      ).toBe(false);

      expect(byColumn("apiToken").doNotShowWhenEditing).toBe(true);
      expect(byColumn("basicAuthPassword").doNotShowWhenEditing).toBe(true);
    });

    test("a new feed is polled: Enabled is the Edit form's", () => {
      renderPage();

      expect(byColumn("isEnabled").doNotShowWhenCreating).toBe(true);
      expect(capturedFeedTableProps?.createInitialValues).toMatchObject({
        isEnabled: true,
      });
    });

    test("what a match raises is the detection rules' choice, on the On Match step", () => {
      renderPage();

      const choice: FormField = byKey("securityMatchRaises");

      expect(choice.stepId).toBe("on-match");
      expect(
        (choice.radioButtonOptions || []).map((option: { value: string }) => {
          return option.value;
        }),
      ).toEqual(["alert", "incident", "both", "neither"]);
    });

    test("the description, the poll interval and the confidence floor wait under More fields", () => {
      renderPage();

      for (const column of [
        "description",
        "pollIntervalInMinutes",
        "minimumConfidence",
      ]) {
        const field: FormField = byColumn(column);

        expect({
          column,
          step: field.stepId,
          folded: Boolean(field["collapsibleSection"]),
        }).toEqual({ column, step: "source", folded: true });
      }
    });

    test("Update Credentials offers the same answers, No sign-in clearing what is stored", () => {
      capturedCredentialsDialog = null;
      renderPage();

      const update:
        | {
            onClick: (
              item: Record<string, unknown>,
              onCompleteAction: () => void,
              onError: (error: Error) => void,
            ) => void;
          }
        | undefined = capturedFeedTableProps?.actionButtons?.find(
        (button: { title: string }) => {
          return button.title === "Update Credentials";
        },
      );

      expect(update).toBeDefined();

      act(() => {
        update!.onClick(
          { _id: "22222222-2222-4222-8222-222222222222" },
          () => {
            // completed
          },
          () => {
            // no error
          },
        );
      });

      const mode: FormField = capturedCredentialsDialog!.formProps
        .fields[0] as unknown as FormField;

      expect(mode.title).toBe("Sign-in");
      expect(
        (mode.radioButtonOptions || []).map(
          (option: { value: string; title: string; description?: string }) => {
            return [option.value, option.title, option.description];
          },
        ),
      ).toEqual([
        [
          "anonymous",
          "No sign-in",
          "Clears the stored token, username and password.",
        ],
        [
          "api-token",
          "Bearer token",
          "A token from the TAXII server's operator.",
        ],
        ["basic-auth", "Username and password", "HTTP basic authentication."],
      ]);
    });

    test("a severity's line says what an empty pick does, and not again that it is optional", () => {
      renderPage();

      expect(byColumn("alertSeverity")["description"]).toBe(
        "Left empty, the indicator's confidence picks one of this project's alert severities.",
      );
      expect(byColumn("incidentSeverity")["description"]).toBe(
        "Left empty, the indicator's confidence picks one of this project's incident severities.",
      );
    });
  });

  test("a reseller plan without telemetry sees neither the card nor the tables", () => {
    const project: Project = new Project();
    const reseller: Reseller = new Reseller();
    reseller.enableTelemetryFeatures = false;
    project.reseller = reseller;

    renderPage(project);

    expect(
      screen.queryByTestId(`how-it-works-${ThreatIntelGuide.id}`),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("feeds-table")).not.toBeInTheDocument();
    expect(
      screen.getByText(/did not include telemetry features/),
    ).toBeInTheDocument();
  });
});
