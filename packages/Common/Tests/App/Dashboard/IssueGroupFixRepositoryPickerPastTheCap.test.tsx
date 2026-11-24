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
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";

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

// The reader's repositories, answered by Code's routes as the server answers them.
const world: {
  repositories: Array<FakeCodeRepository>;
  reads: Array<CodeRepositoriesQuery>;
  byIdReads: Array<Array<string>>;
} = { repositories: [], reads: [], byIdReads: [] };

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeApi",
  () => {
    return {
      __esModule: true,
      default: {
        getRepositories: async (query: CodeRepositoriesQuery) => {
          world.reads.push(query);

          return answerRepositoriesQuery({
            repositories: world.repositories,
            query,
          });
        },
        getRepositoriesById: async (
          ids: Array<string>,
          scope?: CodeRepositoriesScope,
        ) => {
          world.byIdReads.push(ids);

          return answerRepositoriesById({
            repositories: world.repositories,
            ids,
            scope,
          });
        },
      },
    };
  },
);

import IssueGroupFixModal, {
  ISSUE_GROUP_FIX_TEST_ID,
  getOfferedCandidates,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/IssueGroupFixModal";
import DataSecurityApi from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/DataSecurityApi";
import {
  CodeRepositoriesQuery,
  CodeRepositoriesScope,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeApi";
import {
  DataSecurityIssueGroupCause,
  DataSecurityIssueGroupJSON,
} from "../../../Types/DataSecurity/DataSecurityIssueGroup";
import {
  DataSecurityIssueGroupFixPart,
  DataSecurityIssueGroupFixPlanJSON,
  DataSecurityIssueGroupFixResultJSON,
} from "../../../Types/DataSecurity/DataSecurityIssueGroupFix";
import {
  DeclaredCodeOwnerCandidateJSON,
  DeclaredCodeOwnerReason,
} from "../../../Utils/AiRemediation/DeclaredCodeChange";
import Toast from "../../../UI/Utils/Toast";
import {
  FakeCodeRepository,
  answerRepositoriesById,
  answerRepositoriesQuery,
  repositoriesSortingFirst,
} from "./CodeRepositoriesServer";

/*
 * FIX THE CAUSE'S REPOSITORY, PAST A PROJECT'S FIRST REPOSITORIES (#10921).
 *
 * Every repository OneUptime AI can work in is a candidate for a group's
 * pull request, so the dialog listed all of them: complete, and one very
 * long list in a project of thousands. The picker is the repository search
 * the rest of Fix with AI uses now: the ranked repositories something
 * points to come first - the one the grouping found picked already, with
 * why under it - and the server searches every other connected repository
 * the person may ask OneUptime AI to work in.
 */

configure({ asyncUtilTimeout: 15000 });

const GROUP_ID: string = "10921000-0000-4000-8000-00000000c001";
const FOUND_ID: string = "10921000-0000-4000-8000-00000000c0f1";
const KIND_ID: string = "10921000-0000-4000-8000-00000000c0f2";
const NOTHING_ID: string = "10921000-0000-4000-8000-00000000c0f3";
const READ_ONLY_ID: string = "10921000-0000-4000-8000-00000000c0f4";
const WAREHOUSE_ID: string = "10921000-0000-4000-8000-00000000c0f5";

const GROUP: DataSecurityIssueGroupJSON = {
  groupId: GROUP_ID,
  checkId: "storage-public-access",
  cause: DataSecurityIssueGroupCause.Stack,
  facts: {
    cause: DataSecurityIssueGroupCause.Stack,
    checkId: "storage-public-access",
    stackName: "web",
  },
  name: "the static-site module",
  issueCount: 3,
  openIssueCount: 3,
  fixedIssueCount: 0,
};

function candidate(data: {
  id: string;
  name: string;
  reason: DeclaredCodeOwnerReason;
  matchedPaths?: Array<string>;
  isBest?: boolean;
  canAsk?: boolean;
}): DeclaredCodeOwnerCandidateJSON {
  return {
    repositoryId: data.id,
    name: data.name,
    fullName: `harbour/${data.name}`,
    reason: data.reason,
    matchedPaths: data.matchedPaths || [],
    isBest: Boolean(data.isBest),
    canAsk: data.canAsk !== false,
  };
}

// Ranked as the server ranks them: the one found, then by what points to each.
const CANDIDATES: Array<DeclaredCodeOwnerCandidateJSON> = [
  candidate({
    id: FOUND_ID,
    name: "zz-infra",
    reason: DeclaredCodeOwnerReason.HasNamedFile,
    matchedPaths: ["modules/static-site/main.tf"],
    isBest: true,
  }),
  candidate({
    id: KIND_ID,
    name: "zz-terraform-modules",
    reason: DeclaredCodeOwnerReason.HasCodeOfKind,
  }),
  candidate({
    id: READ_ONLY_ID,
    name: "zz-readonly-infra",
    reason: DeclaredCodeOwnerReason.HasCodeOfKind,
    canAsk: false,
  }),
  candidate({
    id: NOTHING_ID,
    name: "zz-nothing-points-here",
    reason: DeclaredCodeOwnerReason.NoEvidence,
  }),
];

function plan(data: {
  candidates?: Array<DeclaredCodeOwnerCandidateJSON>;
  foundId?: string | null;
}): DataSecurityIssueGroupFixPlanJSON {
  const foundId: string | null =
    data.foundId === undefined ? FOUND_ID : data.foundId;

  return {
    groupId: GROUP_ID,
    checkId: "storage-public-access",
    pullRequest: {
      stores: [
        {
          issueId: "10921000-0000-4000-8000-00000000d001",
          dataStoreId: "10921000-0000-4000-8000-00000000e001",
          name: "site-assets",
        },
      ],
      codeKind: "Terraform",
      ...(foundId
        ? {
            location: {
              repositoryId: foundId,
              repositoryName: "zz-infra",
              paths: ["modules/static-site/main.tf"],
            },
          }
        : {}),
      candidates: data.candidates || CANDIDATES,
    },
    leftOut: [],
    planFingerprint: "fingerprint-1",
  };
}

function repository(data: {
  id: string;
  name: string;
  isConnected?: boolean;
  canAsk?: boolean;
}): FakeCodeRepository {
  return {
    id: data.id,
    name: data.name,
    organizationName: "harbour",
    repositoryName: data.name,
    isConnected: data.isConnected !== false,
    provider: "GitHub",
    canAsk: data.canAsk,
    stats: { working: 0, waitingForYou: 0, openPullRequests: 0, taskCount: 0 },
  };
}

let fixes: Array<{ codeRepositoryId?: string | undefined }>;
let currentPlan: DataSecurityIssueGroupFixPlanJSON;

beforeEach(() => {
  world.repositories = [
    ...repositoriesSortingFirst(10050),
    repository({ id: FOUND_ID, name: "zz-infra" }),
    repository({ id: KIND_ID, name: "zz-terraform-modules" }),
    repository({ id: READ_ONLY_ID, name: "zz-readonly-infra", canAsk: false }),
    repository({ id: NOTHING_ID, name: "zz-nothing-points-here" }),
    repository({ id: WAREHOUSE_ID, name: "warehouse-infra" }),
  ];
  world.reads = [];
  world.byIdReads = [];
  fixes = [];
  currentPlan = plan({});

  jest
    .spyOn(DataSecurityApi, "getIssueGroupFixPlan")
    .mockImplementation(async () => {
      return currentPlan;
    });
  jest
    .spyOn(DataSecurityApi, "fixIssueGroup")
    .mockImplementation((async (data: {
      codeRepositoryId?: string | undefined;
    }): Promise<DataSecurityIssueGroupFixResultJSON> => {
      fixes.push({ codeRepositoryId: data.codeRepositoryId });

      return {
        pullRequest: { message: "Started.", aiRunId: "run-1" },
        leftOut: 0,
      };
    }) as never);
  jest.spyOn(Toast, "success").mockReturnValue("");
  jest.spyOn(Toast, "error").mockReturnValue("");
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function renderDialog(): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <IssueGroupFixModal
          group={GROUP}
          onClose={() => {}}
          onFixed={() => {}}
        />
      </MemoryRouter>,
    );
  });

  await screen.findByTestId(`${ISSUE_GROUP_FIX_TEST_ID}-pull-request`);
}

function pullRequestPart(): HTMLElement {
  return screen.getByTestId(`${ISSUE_GROUP_FIX_TEST_ID}-pull-request`);
}

async function openPicker(): Promise<void> {
  const value: HTMLElement | null = within(pullRequestPart()).queryByTestId(
    "entity-dropdown-value",
  );

  if (value) {
    await act(async () => {
      fireEvent.click(within(value).getAllByRole("button")[0]!);
    });
    return;
  }

  await act(async () => {
    fireEvent.focus(
      screen.getByTestId(`${ISSUE_GROUP_FIX_TEST_ID}-repository`),
    );
  });
}

async function search(text: string): Promise<void> {
  await openPicker();

  const field: HTMLElement = await screen.findByTestId(
    `${ISSUE_GROUP_FIX_TEST_ID}-repository`,
  );

  await act(async () => {
    fireEvent.change(field, { target: { value: text } });
  });
}

function optionNames(): Array<string> {
  return screen.queryAllByRole("option").map((option: HTMLElement): string => {
    return option.textContent || "";
  });
}

function fixButton(): HTMLElement {
  return screen.getByRole("button", { name: "Fix the Cause" });
}

describe("which ranked repositories Fix the Cause offers first", () => {
  test("those the person may ask in that something points to, and the one found - never one nothing points to, or one they may not ask in", () => {
    expect(
      getOfferedCandidates({
        candidates: CANDIDATES,
        foundRepositoryId: FOUND_ID.toUpperCase(),
      }).map((offered: DeclaredCodeOwnerCandidateJSON): string => {
        return offered.name;
      }),
    ).toEqual(["zz-infra", "zz-terraform-modules"]);

    // The one found is offered even when nothing else points to it.
    expect(
      getOfferedCandidates({
        candidates: [
          candidate({
            id: NOTHING_ID,
            name: "zz-nothing-points-here",
            reason: DeclaredCodeOwnerReason.NoEvidence,
          }),
        ],
        foundRepositoryId: NOTHING_ID,
      }),
    ).toHaveLength(1);
    expect(
      getOfferedCandidates({ candidates: [], foundRepositoryId: null }),
    ).toEqual([]);
  });
});

describe("Fix the Cause's repository, past a project's first 10,000", () => {
  test("the one the grouping found - past the first 10,000 - is picked already, by its name, with why under it, and read by no id", async () => {
    await renderDialog();

    const part: HTMLElement = pullRequestPart();

    expect(within(part).getByTestId("entity-dropdown-value")).toHaveTextContent(
      "zz-infra",
    );
    expect(part).toHaveTextContent(
      "Its Terraform code has a file named after the resource: modules/static-site/main.tf",
    );
    expect(world.byIdReads).toEqual([]);
    expect(fixButton()).not.toBeDisabled();
  });

  test("opened, the ranked ones something points to come first, then the server's first page - never one the person may not ask in", async () => {
    await renderDialog();
    await openPicker();

    await waitFor(() => {
      expect(optionNames().length).toBeGreaterThan(2);
    });

    const names: Array<string> = optionNames();

    expect(names[0]).toContain("zz-infra");
    expect(names[1]).toContain("zz-terraform-modules");
    expect(names[2]).toContain("ap-000001");
    expect(
      names.some((name: string): boolean => {
        return name.includes("zz-readonly-infra");
      }),
    ).toBe(false);
  });

  test("the search is held to the connected repositories the person may ask OneUptime AI to work in", async () => {
    await renderDialog();
    await search("zz-");

    await screen.findByRole("option", { name: /zz-nothing-points-here/ });

    expect(world.reads[world.reads.length - 1]).toMatchObject({
      search: "zz-",
      group: "connected",
      askableOnly: true,
    });
    // Searched for, one the person may not ask in is not offered either.
    expect(
      screen.queryByRole("option", { name: /zz-readonly-infra/ }),
    ).toBeNull();
  });

  test("a repository past the first 10,000 found by a search is picked, says nothing of why, and is the one asked for", async () => {
    await renderDialog();
    await search("warehouse");

    const option: HTMLElement = await screen.findByRole("option", {
      name: /warehouse-infra/,
    });

    await act(async () => {
      fireEvent.click(option);
    });

    const part: HTMLElement = pullRequestPart();

    expect(within(part).getByTestId("entity-dropdown-value")).toHaveTextContent(
      "warehouse-infra",
    );
    // Nothing ranked it: no reason under it.
    expect(part).not.toHaveTextContent("Its Terraform code has a file");

    await act(async () => {
      fireEvent.click(fixButton());
    });

    await waitFor(() => {
      expect(fixes).toEqual([{ codeRepositoryId: WAREHOUSE_ID }]);
    });
  });

  test("a ranked one nothing points to, found by the search, says so under it", async () => {
    await renderDialog();
    await search("nothing-points");

    const option: HTMLElement = await screen.findByRole("option", {
      name: /zz-nothing-points-here/,
    });

    await act(async () => {
      fireEvent.click(option);
    });

    expect(pullRequestPart()).toHaveTextContent(
      "Nothing says it holds this code.",
    );
  });

  test("with nothing found, Fix the Cause waits for a pick - then asks in the one picked", async () => {
    currentPlan = plan({
      foundId: null,
      candidates: CANDIDATES.map(
        (
          ranked: DeclaredCodeOwnerCandidateJSON,
        ): DeclaredCodeOwnerCandidateJSON => {
          return { ...ranked, isBest: false };
        },
      ),
    });

    await renderDialog();

    expect(
      within(pullRequestPart()).queryByTestId("entity-dropdown-value"),
    ).toBeNull();
    expect(fixButton()).toBeDisabled();

    await search("zz-terraform");

    const option: HTMLElement = await screen.findByRole("option", {
      name: /zz-terraform-modules/,
    });

    await act(async () => {
      fireEvent.click(option);
    });

    expect(fixButton()).not.toBeDisabled();
    expect(pullRequestPart()).toHaveTextContent("It holds Terraform code.");

    await act(async () => {
      fireEvent.click(fixButton());
    });

    await waitFor(() => {
      expect(fixes).toEqual([{ codeRepositoryId: KIND_ID }]);
    });
  });

  test("left out of the fix, the pull request asks for no repository", async () => {
    const consoleBucket: {
      issueId: string;
      dataStoreId: string;
      name: string;
    } = {
      issueId: "10921000-0000-4000-8000-00000000d002",
      dataStoreId: "10921000-0000-4000-8000-00000000e002",
      name: "console-bucket",
    };

    currentPlan = {
      ...plan({}),
      cloud: {
        action: "BlockPublicAccess" as never,
        // One kind of store: its own action, and the plan's.
        actions: [
          {
            action: "BlockPublicAccess" as never,
            kind: "AWS S3 Bucket",
            stores: [consoleBucket],
          },
        ],
        stores: [consoleBucket],
      },
    };

    await renderDialog();

    // Both parts offered: each has its Include box.
    const include: HTMLElement = await screen.findByTestId(
      `${ISSUE_GROUP_FIX_TEST_ID}-pull-request-included`,
    );

    expect(include).toBeChecked();

    await act(async () => {
      fireEvent.click(include);
    });

    expect(
      screen.queryByTestId(`${ISSUE_GROUP_FIX_TEST_ID}-repository`),
    ).toBeNull();

    await act(async () => {
      fireEvent.click(fixButton());
    });

    await waitFor(() => {
      expect(fixes).toEqual([{ codeRepositoryId: undefined }]);
    });
    expect(
      (DataSecurityApi.fixIssueGroup as unknown as jest.Mock).mock.calls[0]![0],
    ).toMatchObject({ parts: [DataSecurityIssueGroupFixPart.Cloud] });
  });
});
