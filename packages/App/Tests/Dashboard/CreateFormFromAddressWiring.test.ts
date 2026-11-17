import {
  PALETTE_LIST_CREATE_ACTIONS,
  PaletteListCreateAction,
} from "../../FeatureSet/Dashboard/src/Components/CommandPalette/DashboardCommandPaletteHelpers";
import PageMap from "../../FeatureSet/Dashboard/src/Utils/PageMap";
import { CREATE_FORM_QUERY_STRING } from "Common/Types/CreateFormAddress";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * SEARCH'S CREATE ACTIONS LAND ON A FORM THAT OPENS (#7035).
 *
 * Create Status Page, Create On-Call Policy, Create On-Call Schedule, Create
 * Dashboard, Create Workflow and Invite User open their list with
 * ?create=1. Nothing else notices a list that never opens its form from it,
 * or a page's own create dialog that leaves the ask in the address (Back
 * would open it again): the App suite has no renderer, so these read the
 * pages' sources, as the other *Wiring tests do. The shared table's own
 * handling is pinned in Common's ModelTableCreateFormFromAddress, and the
 * Users page's in InviteUserFromAddress.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);
const LOCALES: string = path.join(DASHBOARD_SRC, "Locales");
const WHITESPACE: RegExp = /\s+/g;

function readPage(relativePath: string): string {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, ...relativePath.split("/")), "utf8")
    .replace(WHITESPACE, " ");
}

function between(source: string, from: string, to: string): string {
  const start: number = source.indexOf(from);

  if (start < 0) {
    throw new Error(`Expected the source to contain "${from}".`);
  }

  const end: number = source.indexOf(to, start + from.length);

  return end >= 0 ? source.slice(start, end) : source.slice(start);
}

// The page each action's list is drawn by, and how it draws its form.
const LIST_PAGES: Record<string, { file: string; ownDialog?: string }> = {
  [PageMap.STATUS_PAGES]: { file: "Pages/StatusPages/StatusPages.tsx" },
  [PageMap.ON_CALL_DUTY_POLICIES]: {
    file: "Pages/OnCallDuty/OnCallDutyPolicies.tsx",
  },
  [PageMap.ON_CALL_DUTY_SCHEDULES]: {
    file: "Pages/OnCallDuty/OnCallDutySchedules.tsx",
  },
  [PageMap.DASHBOARDS]: {
    file: "Pages/Dashboards/Dashboards.tsx",
    ownDialog: "<CreateDashboardModal",
  },
  [PageMap.WORKFLOWS]: {
    file: "Pages/Workflow/Workflows.tsx",
    ownDialog: "<CreateWorkflowModal",
  },
  [PageMap.USERS]: { file: "Pages/Users/Index.tsx" },
};

const TABLE_LISTS: Array<PaletteListCreateAction> =
  PALETTE_LIST_CREATE_ACTIONS.filter(
    (action: PaletteListCreateAction): boolean => {
      return action.page !== PageMap.USERS;
    },
  );

describe("each list Search opens a create form on opens it from ?create=1", () => {
  test("every action's list is one of these pages", () => {
    for (const action of PALETTE_LIST_CREATE_ACTIONS) {
      expect({ id: action.id, page: LIST_PAGES[action.page] }).toEqual({
        id: action.id,
        page: expect.objectContaining({ file: expect.any(String) }),
      });
    }

    expect(CREATE_FORM_QUERY_STRING).toBe("?create=1");
  });

  test.each(
    TABLE_LISTS.map(
      (action: PaletteListCreateAction): [string, PaletteListCreateAction] => {
        return [action.title, action];
      },
    ),
  )(
    "%s: the list's table opens its form from the address, once",
    (_title: string, action: PaletteListCreateAction) => {
      const source: string = readPage(LIST_PAGES[action.page]!.file);

      expect(source.split("opensCreateFormFromAddress={true}").length - 1).toBe(
        1,
      );
      // On the list's own creatable table.
      expect(
        between(source, "<ModelTable<", "opensCreateFormFromAddress={true}"),
      ).not.toContain("</");
    },
  );

  test.each(
    TABLE_LISTS.filter((action: PaletteListCreateAction): boolean => {
      return Boolean(LIST_PAGES[action.page]!.ownDialog);
    }).map(
      (action: PaletteListCreateAction): [string, PaletteListCreateAction] => {
        return [action.title, action];
      },
    ),
  )(
    "%s: the page's own create dialog takes the ask off the address when it closes, and when it creates",
    (_title: string, action: PaletteListCreateAction) => {
      const page: { file: string; ownDialog?: string } =
        LIST_PAGES[action.page]!;
      const source: string = readPage(page.file);
      const dialog: string = between(source, page.ownDialog!, "/>");

      expect(between(dialog, "onClose={", "}}")).toContain(
        "CreateFormAddress.clear();",
      );
      expect(between(dialog, "onCreated={", "}}")).toContain(
        "CreateFormAddress.clear();",
      );
      // Before the new record's page opens.
      const onCreated: string = between(dialog, "onCreated={", "}}");
      expect(onCreated.indexOf("CreateFormAddress.clear();")).toBeLessThan(
        onCreated.indexOf("Navigation.navigate("),
      );
    },
  );

  test("Invite User: the Users page opens its own invite for whoever may invite, and every way out of it takes the ask off", () => {
    const source: string = readPage(LIST_PAGES[PageMap.USERS]!.file);

    expect(source).toContain(
      "const isInviteAskedForByAddress: boolean = CreateFormAddress.isAskedFor();",
    );
    expect(source).toContain(
      "PermissionGate.check( new TeamMember(), ModelAction.Create, ).isAllowed",
    );
    // The invite the button opens, not one of its own (no second invite).
    expect(source).toContain("void openInviteUserModal();");
    expect(source.split("<ModelFormModal<TeamMember>").length - 1).toBe(1);

    // Its Cancel, its Invite and the SCIM note each take it off.
    expect(
      between(source, "<ModelFormModal<TeamMember>", "submitButtonText"),
    ).toContain("CreateFormAddress.clear();");
    expect(
      between(source, "onSuccess={(teamMember: TeamMember | null) => {", "if"),
    ).toContain("CreateFormAddress.clear();");
    expect(
      between(source, "<ConfirmModal", "/>").includes(
        "CreateFormAddress.clear();",
      ),
    ).toBe(true);
  });
});

describe("each action is worded in every language the Dashboard speaks", () => {
  const languages: Array<string> = fs
    .readdirSync(LOCALES)
    .filter((file: string): boolean => {
      return file.endsWith(".json");
    });

  test("17 languages and English", () => {
    expect(languages).toHaveLength(18);
  });

  test.each(languages)("%s holds every action's title", (file: string) => {
    const words: Record<string, unknown> = JSON.parse(
      fs.readFileSync(path.join(LOCALES, file), "utf8"),
    ) as Record<string, unknown>;

    for (const action of PALETTE_LIST_CREATE_ACTIONS) {
      const word: unknown = words[action.title];

      expect({
        title: action.title,
        isWorded: typeof word === "string" && word.trim().length > 0,
      }).toEqual({
        title: action.title,
        isWorded: true,
      });

      if (file !== "en.json") {
        // The phrase is the language's own, not the English left in.
        expect({ title: action.title, word }).not.toEqual({
          title: action.title,
          word: action.title,
        });
      }
    }
  });
});
