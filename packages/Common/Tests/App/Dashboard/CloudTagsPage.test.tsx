import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import CloudRequiredTag from "../../../Models/DatabaseModels/CloudRequiredTag";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import {
  CloudTagProblem,
  CloudTagSuggestionSource,
} from "../../../Types/Cloud/CloudRequiredTags";
import {
  CloudTagCoverageJSON,
  CloudTagSpendState,
} from "../../../Types/Cloud/CloudTagCoverage";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { createTranslator, Translator } from "../../../Types/Translator";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import { MORE_SETTINGS_SECTION_TITLE } from "../../../UI/Components/FoldedSection/FoldedSectionTitles";
import { getJestSpyOn } from "../../Spy";
import { CloudStatTile } from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudStatStrip";
import { getCloudTagTrendSeries } from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudTagCoverageCards";
import {
  fromRequiredTagFormValues,
  toRequiredTagFormValues,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudRequiredTagsCard";
import CloudTagsView from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudTagsView";
import {
  SPEND_AWS_WITHOUT_RESOURCES,
  SPEND_NO_COSTS,
  formatCoverage,
  getCloudTagTiles,
  getCoverageTone,
  getMissingProblemText,
  getSpendNotMeasuredReason,
  getSuggestionSourceText,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudTagWords";
import { getUntaggedCommands } from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudUntaggedResourcesCard";
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";

/*
 * CLOUD > TAGS (#11012), as a reader sees it: the strip's three shares -
 * spend never 0% when it could not be measured - each tag's share, the
 * trend, the resources that lack a tag with what to put there and the
 * command that does it, and with no required tag yet only the way to
 * require one. Its words read in English here; every language's are held
 * by the locale guards.
 */

const english: Translator = createTranslator(
  (text: string): string | undefined => {
    return (englishLocale as unknown as Record<string, string>)[text];
  },
  "en",
);

const PROJECT: ObjectID = new ObjectID("11012000-0000-4000-8000-00000000f001");
const ACCOUNT: string = "11012000-0000-4000-8000-00000000f0b1";

function coverage(
  overrides: Partial<CloudTagCoverageJSON> = {},
): CloudTagCoverageJSON {
  return {
    hasRules: true,
    requiredTags: [
      {
        key: "team",
        allowedValues: ["payments", "search"],
        cloudAccountId: null,
      },
      { key: "env", allowedValues: [], cloudAccountId: null },
    ],
    currency: "USD",
    periodDays: 30,
    accounts: [
      {
        cloudAccountId: ACCOUNT,
        name: "prod",
        provider: "aws",
        accountId: "123456789012",
        keys: ["team", "env"],
        spendState: CloudTagSpendState.Measured,
        currency: "USD",
        spend: {
          all: { covered: 750, total: 1000 },
          byKey: {
            team: { covered: 800, total: 1000 },
            env: { covered: 900, total: 1000 },
          },
        },
        resources: {
          all: { covered: 3, total: 4 },
          byKey: {
            team: { covered: 3, total: 4 },
            env: { covered: 4, total: 4 },
          },
        },
      },
    ],
    total: {
      spend: {
        all: { covered: 750, total: 1000 },
        byKey: {
          team: { covered: 800, total: 1000 },
          env: { covered: 900, total: 1000 },
        },
      },
      resources: {
        all: { covered: 3, total: 4 },
        byKey: {
          team: { covered: 3, total: 4 },
          env: { covered: 4, total: 4 },
        },
      },
    },
    trend: [
      {
        week: "2026-11-09",
        spend: { covered: 50, total: 100 },
        resources: { covered: 1, total: 4 },
      },
      { week: "2026-11-16", spend: null, resources: { covered: 3, total: 4 } },
    ],
    untagged: [
      {
        cloudResourceId: "11012000-0000-4000-8000-00000000f0c1",
        name: "web-4",
        provider: "aws",
        type: "AWS::EC2::Instance",
        cloudAccountId: ACCOUNT,
        accountName: "prod",
        spend: 250,
        currency: "USD",
        missing: [
          {
            key: "team",
            problem: CloudTagProblem.Missing,
            suggestion: {
              key: "team",
              value: "payments",
              source: CloudTagSuggestionSource.OwnerTeam,
              detail: "Payments",
            },
            command:
              "aws resourcegroupstaggingapi tag-resources --region eu-west-1 --resource-arn-list arn:aws:ec2:eu-west-1:123456789012:instance/i-0abc --tags team=payments",
          },
        ],
        declaredCode: null,
      },
    ],
    untaggedCount: 1,
    ...overrides,
  };
}

describe("the words and figures of the page", () => {
  test("a share in percent, a little one with a decimal; none when there is nothing to measure", () => {
    expect(formatCoverage({ covered: 3, total: 4 })).toBe("75%");
    expect(formatCoverage({ covered: 1, total: 30 })).toBe("3.3%");
    expect(formatCoverage({ covered: 0, total: 30 })).toBe("0%");
    expect(formatCoverage({ covered: 0, total: 0 })).toBeNull();
    expect(formatCoverage(null)).toBeNull();
  });

  test("its tone: red below half, amber below 80%, green above, grey with nothing to measure", () => {
    expect(getCoverageTone({ covered: 1, total: 4 })).toBe("danger");
    expect(getCoverageTone({ covered: 3, total: 4 })).toBe("warning");
    expect(getCoverageTone({ covered: 4, total: 5 })).toBe("positive");
    expect(getCoverageTone(null)).toBe("neutral");
  });

  test("why an account's spend share is not measured: an AWS account without Costs per resource, or no costs read", () => {
    expect(
      getSpendNotMeasuredReason({
        spendState: CloudTagSpendState.AwsWithoutResources,
      }),
    ).toBe(SPEND_AWS_WITHOUT_RESOURCES);
    expect(
      getSpendNotMeasuredReason({ spendState: CloudTagSpendState.NoCosts }),
    ).toBe(SPEND_NO_COSTS);
    expect(
      getSpendNotMeasuredReason({ spendState: CloudTagSpendState.Measured }),
    ).toBeNull();
  });

  test("the strip: the spend's share with its amounts, the resources' with their counts, and how many lack a tag", () => {
    const tiles: Array<CloudStatTile> = getCloudTagTiles({
      coverage: coverage(),
      translator: english,
    });

    expect(
      tiles.map((tile: CloudStatTile) => {
        return { key: tile.key, value: tile.value, tone: tile.tone };
      }),
    ).toEqual([
      { key: "spend-tagged", value: "75%", tone: "warning" },
      { key: "resources-tagged", value: "75%", tone: "warning" },
      { key: "missing-tags", value: "1", tone: "warning" },
    ]);
    expect(tiles[0]!.sublabel).toBe("$750 of $1,000");
    expect(tiles[1]!.sublabel).toBe("3 of 4 resources");
  });

  test("spend that could not be measured says so, never 0%", () => {
    const tiles: Array<CloudStatTile> = getCloudTagTiles({
      coverage: coverage({
        total: {
          spend: null,
          resources: { all: { covered: 0, total: 2 }, byKey: {} },
        },
        untaggedCount: 0,
      }),
      translator: english,
    });

    expect(tiles[0]!.value).toBe("Not measured");
    expect(tiles[0]!.sublabel).toBeUndefined();
    expect(tiles[0]!.tone).toBe("neutral");
    expect(tiles[1]!.value).toBe("0%");
    expect(tiles[2]!.tone).toBe("positive");
  });

  test("what a resource lacks, and where its suggestion comes from", () => {
    expect(
      getMissingProblemText({
        missing: { key: "team", problem: CloudTagProblem.Missing },
        translator: english,
      }),
    ).toBe("Missing");
    expect(
      getMissingProblemText({
        missing: {
          key: "team",
          problem: CloudTagProblem.NotAllowed,
          value: "billing",
        },
        translator: english,
      }),
    ).toBe("billing is not allowed");
    expect(
      getSuggestionSourceText({
        suggestion: {
          key: "team",
          value: "payments",
          source: CloudTagSuggestionSource.Neighbours,
          detail: "checkout-stack",
          count: 3,
        },
        translator: english,
      }),
    ).toBe("From the resources beside it, in checkout-stack.");
    expect(
      getSuggestionSourceText({
        suggestion: {
          key: "env",
          value: "prod",
          source: CloudTagSuggestionSource.OnlyAllowedValue,
        },
        translator: english,
      }),
    ).toBe("The only value the tag allows.");
  });

  test("a resource's commands, one a line, and none for one declared in code", () => {
    const resource: CloudTagCoverageJSON["untagged"][number] =
      coverage().untagged[0]!;

    expect(getUntaggedCommands(resource)).toBe(resource.missing[0]!.command);
    expect(
      getUntaggedCommands({
        missing: [
          { key: "a", problem: CloudTagProblem.Missing, command: "one" },
          { key: "b", problem: CloudTagProblem.Missing },
          { key: "c", problem: CloudTagProblem.Missing, command: "two" },
        ],
        declaredCode: null,
      }),
    ).toBe("one\ntwo");
    expect(
      getUntaggedCommands({ ...resource, declaredCode: "Terraform" }),
    ).toBe("");
  });

  test("the trend's two lines: a week with nothing to measure has no point", () => {
    const series: ReturnType<typeof getCloudTagTrendSeries> =
      getCloudTagTrendSeries({
        trend: coverage().trend,
        spendName: "Spend",
        resourcesName: "Resources",
      });

    expect(
      series.map((line: (typeof series)[number]) => {
        return {
          name: line.seriesName,
          points: line.data.map((point: { x: unknown; y: unknown }) => {
            return point.y;
          }),
        };
      }),
    ).toEqual([
      { name: "Spend", points: [50] },
      { name: "Resources", points: [25, 75] },
    ]);
    expect(
      getCloudTagTrendSeries({ trend: [], spendName: "S", resourcesName: "R" }),
    ).toEqual([]);
  });

  test("a required tag as its form edits it, and back: values one list, an account page's account fixed", () => {
    const tag: CloudRequiredTag = Object.assign(new CloudRequiredTag(), {
      tagKey: "team",
      allowedValues: ["payments", "search"],
      description: "Who pays.",
    });

    expect(toRequiredTagFormValues(tag, null)).toEqual({
      tagKey: "team",
      allowedValuesText: "payments, search",
      cloudAccountId: "",
      description: "Who pays.",
    });
    expect(toRequiredTagFormValues(null, new ObjectID(ACCOUNT))).toEqual({
      tagKey: "",
      allowedValuesText: "",
      cloudAccountId: ACCOUNT,
      description: "",
    });

    const saved: ReturnType<typeof fromRequiredTagFormValues> =
      fromRequiredTagFormValues({
        tagKey: "  team ",
        allowedValuesText: "payments,\n search, Payments, platform-*",
        cloudAccountId: ACCOUNT,
        description: " Who pays. ",
      });

    expect(saved.tagKey).toBe("team");
    expect(saved.allowedValues).toEqual(["payments", "search", "platform-*"]);
    expect(saved.cloudAccountId?.toString()).toBe(ACCOUNT);
    expect(saved.description).toBe("Who pays.");
    expect(
      fromRequiredTagFormValues({
        tagKey: "env",
        allowedValuesText: "",
        cloudAccountId: "",
        description: "",
      }).cloudAccountId,
    ).toBeNull();
  });
});

describe("the page, drawn", () => {
  let answer: CloudTagCoverageJSON;
  let posted: Array<string>;

  beforeEach(() => {
    posted = [];
    getJestSpyOn(API, "post").mockImplementation((async (options: {
      url: { toString: () => string };
    }): Promise<unknown> => {
      const url: string = options.url.toString();

      // The page's one read; anything else a card asks answers empty.
      if (!url.includes("/cloud-required-tag/coverage")) {
        return new HTTPResponse<JSONObject>(200, {}, {});
      }

      posted.push(url);
      return new HTTPResponse<JSONObject>(
        200,
        answer as unknown as JSONObject,
        {},
      );
    }) as never);
    getJestSpyOn(ModelAPI, "getList").mockImplementation(
      (async (): Promise<unknown> => {
        return { data: [], count: 0, skip: 0, limit: 10 };
      }) as never,
    );
    // The project's notice settings, made the first time More settings opens.
    getJestSpyOn(ModelAPI, "create").mockImplementation(
      (async (): Promise<unknown> => {
        return { data: {} };
      }) as never,
    );
    getJestSpyOn(ModelAPI, "getItem").mockImplementation(
      (async (): Promise<unknown> => {
        return null;
      }) as never,
    );
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  async function draw(cloudAccountId?: ObjectID): Promise<void> {
    await act(async () => {
      render(
        <MemoryRouter>
          <CloudTagsView
            projectId={PROJECT}
            accounts={[]}
            cloudAccountId={cloudAccountId}
          />
        </MemoryRouter>,
      );
    });
  }

  test("with no required tag yet: only the way to require one", async () => {
    answer = coverage({
      hasRules: false,
      requiredTags: [],
      untagged: [],
      untaggedCount: 0,
    });

    await draw();

    expect(posted).toEqual([
      expect.stringContaining("/cloud-required-tag/coverage"),
    ]);
    expect(screen.getByTestId("cloud-tags-no-rules")).toBeInTheDocument();
    expect(screen.queryByTestId("cloud-tags-strip")).not.toBeInTheDocument();
    expect(screen.queryByTestId("cloud-untagged")).not.toBeInTheDocument();
  });

  test("every account's: the strip, what lacks a tag with its suggestion and command, each tag, the trend and each account", async () => {
    answer = coverage();

    await draw();

    expect(screen.getByTestId("cloud-tags-strip")).toBeInTheDocument();

    const row: HTMLElement = screen.getByTestId("cloud-untagged-row");
    expect(within(row).getByText("web-4")).toBeInTheDocument();
    expect(within(row).getByTestId("cloud-untagged-command")).toHaveTextContent(
      "aws resourcegroupstaggingapi tag-resources",
    );
    expect(
      within(row).getByTestId("cloud-untagged-suggestion"),
    ).toHaveTextContent("payments");

    expect(screen.getAllByTestId("cloud-tags-by-key-row")).toHaveLength(2);
    expect(screen.getByTestId("cloud-tags-trend")).toHaveAttribute(
      "data-series",
      "2",
    );
    expect(screen.getByTestId("cloud-tags-accounts")).toBeInTheDocument();
    expect(screen.getByTestId("cloud-tags-more-settings")).toBeInTheDocument();
  });

  test("one account's: its own read, and no accounts card or project settings", async () => {
    answer = coverage();

    await draw(new ObjectID(ACCOUNT));

    expect(posted).toHaveLength(1);
    expect(screen.getByTestId("cloud-tags-strip")).toBeInTheDocument();
    expect(screen.queryByTestId("cloud-tags-accounts")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("cloud-tags-more-settings"),
    ).not.toBeInTheDocument();
  });

  test("a resource declared in code names its code, and gives no command a deploy would undo", async () => {
    answer = coverage({
      untagged: [
        {
          ...coverage().untagged[0]!,
          declaredCode: 'CloudFormation stack "checkout"',
        },
      ],
    });

    await draw();

    const row: HTMLElement = screen.getByTestId("cloud-untagged-row");
    expect(
      within(row).getByTestId("cloud-untagged-declared"),
    ).toHaveTextContent('CloudFormation stack "checkout"');
    expect(
      within(row).queryByTestId("cloud-untagged-command"),
    ).not.toBeInTheDocument();
  });

  /*
   * Who is told, and where an alert goes, are folded under More settings:
   * a link to either - the email's, a teammate's - opens the fold there.
   */
  test("More settings is folded, and a link to either card it holds opens it there", async () => {
    answer = coverage();
    window.history.replaceState(null, "", "/");

    await draw();

    const fold: () => HTMLElement = (): HTMLElement => {
      return within(screen.getByTestId("cloud-tags-more-settings")).getByRole(
        "button",
        { name: MORE_SETTINGS_SECTION_TITLE },
      );
    };

    expect(fold()).toHaveAttribute("aria-expanded", "false");
    cleanup();

    for (const key of ["who-is-told", "where-alerts-go"]) {
      window.history.replaceState(null, "", `/#${key}`);

      await draw();

      expect({ key, expanded: fold().getAttribute("aria-expanded") }).toEqual({
        key,
        expanded: "true",
      });
      expect(fold()).toHaveAttribute("aria-expanded", "true");
      cleanup();
    }

    window.history.replaceState(null, "", "/");
  });
});
