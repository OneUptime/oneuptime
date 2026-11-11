import {
  getRouteForCitationTarget,
  targetTypeToIcon,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/CitationTargetNav";
import { friendlyToolNames } from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/ChatActivityFeed";
import {
  describeCitationTargetPage,
  describeEvidenceTool,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/InvestigationEvidenceFormat";
import Route from "../../../Types/API/Route";
import { AIChatCitationTargetType } from "../../../Types/AI/AIChatTypes";
import IconProp from "../../../Types/Icon/IconProp";
import Navigation from "../../../UI/Utils/Navigation";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * WHAT ASK AI SAYS IT DID WHEN IT READ A TABLE'S LINEAGE, AND WHERE ITS
 * CITATION OPENS.
 *
 * get_data_table_lineage reads what a watched table is built from and what
 * is built from it. While it runs, Ask AI's live line says so; once it ran,
 * an investigation's Evidence checked list does; and what it cites - one
 * table's lineage - opens that table's Lineage tab, named as the tab is,
 * with the tab's own icon. The freshness tool's citation still opens the
 * table itself.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const TABLE_ID: string = "20000000-0000-4000-8000-000000000042";

afterEach(() => {
  jest.restoreAllMocks();
});

describe("what Ask AI cites of a table opens where it read it", () => {
  test.each([
    [
      AIChatCitationTargetType.DataTableView,
      `data-observability/tables/${TABLE_ID}`,
    ],
    [
      AIChatCitationTargetType.DataTableLineageView,
      `data-observability/tables/${TABLE_ID}/lineage`,
    ],
  ])("%s opens %s", (type: AIChatCitationTargetType, path: string) => {
    Navigation.setLocation({
      pathname: `/dashboard/${PROJECT_ID}/ai/chat`,
      search: "",
      hash: "",
      state: null,
      key: "data-table-lineage-citation-test",
    });

    const route: Route | undefined = getRouteForCitationTarget({
      type,
      params: { dataAssetId: TABLE_ID },
    });

    // The project is filled in from the current project when it is opened.
    expect(route?.toString()).toBe(`/dashboard/:projectId/${path}`);
  });

  test("the lineage is named as its tab is, with the tab's icon", () => {
    expect(
      describeCitationTargetPage(AIChatCitationTargetType.DataTableLineageView),
    ).toBe("Lineage");
    expect(
      describeCitationTargetPage(AIChatCitationTargetType.DataTableView),
    ).toBe("Data table");
    expect(
      targetTypeToIcon[AIChatCitationTargetType.DataTableLineageView],
    ).toBe(IconProp.Workflow);
  });
});

describe("the step, as Ask AI and an investigation say it", () => {
  test("while it runs: reading a table's lineage", () => {
    expect(friendlyToolNames["get_data_table_lineage"]).toBe(
      "Reading a table's lineage",
    );
  });

  test("once it ran: read a table's lineage, among Data observability's steps", () => {
    expect(describeEvidenceTool("get_data_table_lineage")).toEqual({
      description: "Read a table's lineage",
      icon: IconProp.Workflow,
      category: "Data observability",
    });
    // Beside the freshness check, which it does not replace.
    expect(describeEvidenceTool("get_data_table_freshness")).toEqual({
      description: "Checked whether a table is fresh",
      icon: IconProp.TableCells,
      category: "Data observability",
    });
  });
});
