import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * Owner and label rules for the CloudResource table, on each product's
 * Settings pages. One table holds App Platforms' environments and the
 * resources in Cloud's accounts, and one table of rules serves both: a rule
 * names the kind of row it is for. Each product's pages list its own rules
 * and those made before the two products split (for both, with a pill that
 * says so), and a rule made on a product's page is that product's. The
 * rule tables are captured so what each page hands them is asserted
 * exactly.
 */

const labelRuleTableMock: MockFunction = getJestMockFunction();
const ruleTableMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Components/LabelRule/LabelRuleTable", () => {
  return {
    __esModule: true,
    default: (props: unknown) => {
      labelRuleTableMock(props);
      return <div data-testid="label-rule-table" />;
    },
  };
});

jest.mock("../../../UI/Components/RuleRun/RuleTable", () => {
  return {
    __esModule: true,
    default: (props: unknown) => {
      ruleTableMock(props);
      return <div data-testid="rule-table" />;
    },
  };
});

import AppPlatformsLabelRulesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/AppPlatforms/Settings/LabelRules";
import AppPlatformsOwnerRulesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/AppPlatforms/Settings/OwnerRules";
import CloudLabelRulesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Cloud/Settings/LabelRules";
import CloudOwnerRulesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Cloud/Settings/OwnerRules";
import {
  ALSO_IN_APP_PLATFORMS,
  ALSO_IN_CLOUD,
  BOTH_PRODUCTS_RULE_RUN_NOUNS,
  BOTH_PRODUCTS_RULE_TOOLTIP,
  CLOUD_ENVIRONMENT_RULE_RUN_NOUNS,
  CLOUD_RESOURCE_RULE_RUN_NOUNS,
  CloudRuleName,
  getAlsoAppliesInText,
  getCloudRuleListKind,
  getCloudRuleRunNouns,
  getCloudRuleWording,
  withCloudRuleKind,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudRuleKind";
import RuleCriteriaSubject from "../../../Types/Rules/RuleCriteriaSubject";
import { RuleRunResourceNouns } from "../../../Types/Rules/RuleRun";
import { RuleWording } from "../../../UI/Components/RuleRun/RuleView";
import RuleSettingsPageProps from "../../../../App/FeatureSet/Dashboard/src/Pages/RuleSettingsPageProps";
import CloudResourceLabelRule from "../../../Models/DatabaseModels/CloudResourceLabelRule";
import CloudResourceOwnerRule from "../../../Models/DatabaseModels/CloudResourceOwnerRule";
import Route from "../../../Types/API/Route";
import EqualToOrNull from "../../../Types/BaseDatabase/EqualToOrNull";
import { CloudResourceKind } from "../../../Types/Cloud/CloudResourceKind";
import ObjectID from "../../../Types/ObjectID";

const RULE_ID: string = "9c4a2b1e-7d3f-4e8a-9b6c-1f2e3d4c5b6a";

type Props = Record<string, any>;

interface PageCase {
  name: string;
  Page: React.FunctionComponent<RuleSettingsPageProps>;
  model: typeof CloudResourceLabelRule | typeof CloudResourceOwnerRule;
  table: MockFunction;
  kind: CloudResourceKind;
  listUrl: string;
  tableId: string;
  // The pill a rule for both products wears on this page.
  alsoIn: string;
  // What the rule's match criteria name the rows.
  rowNoun: string;
  // A cloud tag is a resource's: environments have none.
  matchesCloudTags: boolean;
  // What the create button, the pager and a rule's view call one and many.
  singular: string;
  plural: string;
  /*
   * What the rules' conditions are about, and what their Run Now runs over,
   * where the page says it itself: App Platforms' environments. Cloud's are
   * the model's own words (cloud resources).
   */
  subject: RuleCriteriaSubject | undefined;
  runNouns: RuleRunResourceNouns | undefined;
}

const APP_PLATFORMS: string = `/dashboard/${PROJECT_ID}/app-platforms`;
const CLOUD: string = `/dashboard/${PROJECT_ID}/cloud`;

const PAGES: Array<PageCase> = [
  {
    name: "App Platforms' label rules",
    Page: AppPlatformsLabelRulesPage,
    model: CloudResourceLabelRule,
    table: labelRuleTableMock,
    kind: CloudResourceKind.Environment,
    listUrl: `${APP_PLATFORMS}/settings/label-rules`,
    tableId: "app-platforms-label-rules-table",
    alsoIn: "Also in Cloud",
    rowNoun: "Environment",
    matchesCloudTags: false,
    singular: "Cloud Environment Label Rule",
    plural: "Cloud Environment Label Rules",
    subject: RuleCriteriaSubject.CloudEnvironments,
    runNouns: CLOUD_ENVIRONMENT_RULE_RUN_NOUNS,
  },
  {
    name: "App Platforms' owner rules",
    Page: AppPlatformsOwnerRulesPage,
    model: CloudResourceOwnerRule,
    table: ruleTableMock,
    kind: CloudResourceKind.Environment,
    listUrl: `${APP_PLATFORMS}/settings/owner-rules`,
    tableId: "app-platforms-owner-rules-table",
    alsoIn: "Also in Cloud",
    rowNoun: "Environment",
    matchesCloudTags: false,
    singular: "Cloud Environment Owner Rule",
    plural: "Cloud Environment Owner Rules",
    subject: RuleCriteriaSubject.CloudEnvironments,
    runNouns: CLOUD_ENVIRONMENT_RULE_RUN_NOUNS,
  },
  {
    name: "Cloud's label rules",
    Page: CloudLabelRulesPage,
    model: CloudResourceLabelRule,
    table: labelRuleTableMock,
    kind: CloudResourceKind.Resource,
    listUrl: `${CLOUD}/settings/label-rules`,
    tableId: "cloud-resource-label-rules-table",
    alsoIn: "Also in App Platforms",
    rowNoun: "Resource",
    matchesCloudTags: true,
    singular: "Cloud Resource Label Rule",
    plural: "Cloud Resource Label Rules",
    subject: undefined,
    runNouns: undefined,
  },
  {
    name: "Cloud's owner rules",
    Page: CloudOwnerRulesPage,
    model: CloudResourceOwnerRule,
    table: ruleTableMock,
    kind: CloudResourceKind.Resource,
    listUrl: `${CLOUD}/settings/owner-rules`,
    tableId: "cloud-resource-owner-rules-table",
    alsoIn: "Also in App Platforms",
    rowNoun: "Resource",
    matchesCloudTags: true,
    singular: "Cloud Resource Owner Rule",
    plural: "Cloud Resource Owner Rules",
    subject: undefined,
    runNouns: undefined,
  },
];

function renderPage(page: PageCase, url: string): void {
  goTo(url);
  render(
    <MemoryRouter initialEntries={[url]}>
      <page.Page
        pageRoute={new Route(url)}
        currentProject={null}
        hasPaymentMethod={true}
        ruleViewModelType={page.model}
      />
    </MemoryRouter>,
  );
}

function tableProps(page: PageCase): Props {
  expect(page.table).toHaveBeenCalled();
  return page.table.mock.calls[page.table.mock.calls.length - 1]![0] as Props;
}

function nameColumnElement(page: PageCase, rule: Props): ReactElement {
  const column: Props = tableProps(page)["columns"].find((candidate: Props) => {
    return Boolean(candidate["field"]["name"]);
  });

  return column["getElement"](rule) as ReactElement;
}

beforeEach(() => {
  labelRuleTableMock.mockReset();
  ruleTableMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe.each(PAGES)("$name", (page: PageCase) => {
  test("lists the rules for its own kind of row, and those for both", () => {
    renderPage(page, page.listUrl);

    const query: Props = tableProps(page)["query"];
    expect(Object.keys(query)).toEqual(["cloudResourceKind"]);
    expect(query["cloudResourceKind"]).toBeInstanceOf(EqualToOrNull);
    expect(query["cloudResourceKind"].value).toBe(page.kind);
    // Read with each rule, for its pill.
    expect(tableProps(page)["selectMoreFields"]).toMatchObject({
      cloudResourceKind: true,
    });
  });

  test("a rule made here is for its own kind of row", async () => {
    renderPage(page, page.listUrl);

    const rule: Props = new page.model();
    const created: Props = await tableProps(page)["onBeforeCreate"](rule);

    expect(created).toBe(rule);
    expect(created["cloudResourceKind"]).toBe(page.kind);
  });

  test("has a table of its own, apart from the other product's", () => {
    renderPage(page, page.listUrl);

    expect(tableProps(page)["modelType"]).toBe(page.model);
    expect(tableProps(page)["id"]).toBe(page.tableId);
    expect(tableProps(page)["userPreferencesKey"]).toBe(page.tableId);
  });

  test("its list and a rule's view are the product's addresses", () => {
    renderPage(page, page.listUrl);

    expect(String(tableProps(page)["listRoute"])).toBe(page.listUrl);

    const rule: Props = new page.model();
    rule["id"] = new ObjectID(RULE_ID);
    expect(String(tableProps(page)["getRuleViewRoute"](rule))).toBe(
      `${page.listUrl}/${RULE_ID}`,
    );
  });

  test("routed as a rule's view page, it shows the rule the address names", () => {
    renderPage(page, `${page.listUrl}/${RULE_ID}`);

    expect(tableProps(page)["viewRuleId"]).toEqual(new ObjectID(RULE_ID));
  });

  test("names the rows it matches as this product calls them", () => {
    renderPage(page, page.listUrl);

    const matchFields: Array<Props> = tableProps(page)["formFields"].filter(
      (field: Props): boolean => {
        return field["stepId"] === "match-criteria";
      },
    );
    const titles: Array<string> = matchFields.map((field: Props): string => {
      return field["title"];
    });

    expect(titles.slice(0, 3)).toEqual([
      `${page.rowNoun} Labels`,
      `${page.rowNoun} Name`,
      `${page.rowNoun} Description`,
    ]);
    expect(
      matchFields.some((field: Props): boolean => {
        return Boolean(field["field"]["cloudTagPattern"]);
      }),
    ).toBe(page.matchesCloudTags);
  });

  /*
   * The rule model is shared, and its own nouns are Cloud's: a table names
   * its rules by the props it is handed first, then by the model's.
   */
  test("calls its rules by what they are for", () => {
    renderPage(page, page.listUrl);

    const model: Props = new page.model();
    const singular: string =
      tableProps(page)["singularName"] || model["singularName"];
    const plural: string =
      tableProps(page)["pluralName"] || model["pluralName"];

    expect(singular).toBe(page.singular);
    expect(plural).toBe(page.plural);
    expect(tableProps(page)["cardProps"]["title"]).toBe(page.plural);
  });

  test("a rule of its own shows its name alone", () => {
    renderPage(page, page.listUrl);

    render(
      nameColumnElement(page, {
        name: "Payments team",
        cloudResourceKind: page.kind,
      }),
    );

    expect(screen.getByText("Payments team")).toBeInTheDocument();
    expect(screen.queryByText(page.alsoIn)).toBeNull();
  });

  test("a rule made before the split says it applies in the other product too", () => {
    renderPage(page, page.listUrl);

    render(nameColumnElement(page, { name: "Production owners" }));

    expect(screen.getByText("Production owners")).toBeInTheDocument();
    expect(screen.getByText(page.alsoIn)).toBeInTheDocument();
  });

  /*
   * A rule's own page, its create and edit forms and its Run Now speak the
   * product's words too: "All cloud environments", "Edit Cloud Environment
   * Owner Rule", "for the cloud environments that already exist".
   */
  test("names a rule's records and its run as this product does, on every page of the rule", () => {
    renderPage(page, `${page.listUrl}/${RULE_ID}`);

    expect(tableProps(page)["ruleCriteriaSubject"]).toBe(page.subject);
    expect(tableProps(page)["ruleRunNouns"]).toBe(page.runNouns);
    expect(
      tableProps(page)["singularName"] || new page.model().singularName,
    ).toBe(page.singular);
  });

  test("a rule made before the split wears its pill on its own page, and runs over both products", () => {
    renderPage(page, `${page.listUrl}/${RULE_ID}`);

    const wording: RuleWording<CloudResourceOwnerRule> =
      tableProps(page)["ruleWording"];
    expect(wording.select).toEqual({ cloudResourceKind: true });

    const bothProducts: CloudResourceOwnerRule = new CloudResourceOwnerRule();
    bothProducts.name = "Production owners";
    render(wording.getBadge!(bothProducts)!);
    expect(screen.getByText(page.alsoIn)).toBeInTheDocument();
    expect(wording.getRunNouns!(bothProducts)).toBe(
      BOTH_PRODUCTS_RULE_RUN_NOUNS,
    );

    const own: CloudResourceOwnerRule = new CloudResourceOwnerRule();
    own.cloudResourceKind = page.kind;
    expect(wording.getBadge!(own)).toBeNull();
    expect(wording.getRunNouns!(own)).toEqual(
      page.kind === CloudResourceKind.Environment
        ? CLOUD_ENVIRONMENT_RULE_RUN_NOUNS
        : CLOUD_RESOURCE_RULE_RUN_NOUNS,
    );
  });
});

describe("the rule kind helpers", () => {
  test("each product lists its own kind and those for both", () => {
    const kind: EqualToOrNull<string> = getCloudRuleListKind(
      CloudResourceKind.Environment,
    );

    expect(kind).toBeInstanceOf(EqualToOrNull);
    expect(kind.value).toBe("environment");
    expect(getCloudRuleListKind(CloudResourceKind.Resource).value).toBe(
      "resource",
    );
  });

  test("a rule made on a page takes its product's kind, whatever it carried", async () => {
    const rule: CloudResourceOwnerRule = new CloudResourceOwnerRule();
    rule.cloudResourceKind = CloudResourceKind.Environment;

    const created: CloudResourceOwnerRule =
      await withCloudRuleKind<CloudResourceOwnerRule>(
        CloudResourceKind.Resource,
      )(rule);

    expect(created.cloudResourceKind).toBe(CloudResourceKind.Resource);
  });

  test("the pill names the other product", () => {
    expect(getAlsoAppliesInText(CloudResourceKind.Resource)).toBe(
      ALSO_IN_APP_PLATFORMS,
    );
    expect(getAlsoAppliesInText(CloudResourceKind.Environment)).toBe(
      ALSO_IN_CLOUD,
    );
    expect(ALSO_IN_APP_PLATFORMS).toBe("Also in App Platforms");
    expect(ALSO_IN_CLOUD).toBe("Also in Cloud");
  });

  test("a rule runs over the rows of its own kind, and one made before the split over both", () => {
    const rule: CloudResourceLabelRule = new CloudResourceLabelRule();

    expect(getCloudRuleRunNouns(rule)).toEqual({
      resourceSingular: "cloud resource or environment",
      resourcePlural: "cloud resources and environments",
    });

    rule.cloudResourceKind = CloudResourceKind.Environment;
    expect(getCloudRuleRunNouns(rule)).toEqual({
      resourceSingular: "cloud environment",
      resourcePlural: "cloud environments",
    });

    rule.cloudResourceKind = CloudResourceKind.Resource;
    expect(getCloudRuleRunNouns(rule)).toEqual({
      resourceSingular: "cloud resource",
      resourcePlural: "cloud resources",
    });
  });

  test("each product's wording names the other product in its pill", () => {
    const bothProducts: CloudResourceLabelRule = new CloudResourceLabelRule();

    render(
      getCloudRuleWording<CloudResourceLabelRule>(CloudResourceKind.Environment)
        .getBadge!(bothProducts)!,
    );
    expect(screen.getByText("Also in Cloud")).toBeInTheDocument();

    cleanup();

    render(
      getCloudRuleWording<CloudResourceLabelRule>(CloudResourceKind.Resource)
        .getBadge!(bothProducts)!,
    );
    expect(screen.getByText("Also in App Platforms")).toBeInTheDocument();
  });

  test("the pill says why", () => {
    const rule: CloudResourceLabelRule = new CloudResourceLabelRule();
    rule.name = "Tag production";

    const { container } = render(
      <CloudRuleName rule={rule} kind={CloudResourceKind.Resource} />,
    );

    expect(container).toHaveTextContent("Tag production");
    expect(container).toHaveTextContent("Also in App Platforms");
    expect(BOTH_PRODUCTS_RULE_TOOLTIP).toContain(
      "Made before Cloud and App Platforms were split",
    );
  });
});
