import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicySchedule from "Common/Models/DatabaseModels/OnCallDutyPolicySchedule";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import {
  getToolImportSourceDefinition,
  getToolImportSourcesThatFill,
} from "Common/Types/ToolImport/ToolImportCatalog";
import ToolImportResourceKind from "Common/Types/ToolImport/ToolImportResourceKind";
import ToolImportSource from "Common/Types/ToolImport/ToolImportSource";
import type EmptyStateOptions from "Common/UI/Components/ModelTable/EmptyStateOptions";
import {
  TableEmptyStateAction,
  TableEmptyStateActionStyle,
} from "Common/UI/Components/Table/TableEmptyState";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import {
  composedValue,
  formatList,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import { formatNameList } from "../AiAccess/AiAccessModes";
import {
  getToolImportQueryString,
  ToolImportEntryPoint,
} from "./ToolImportLinks";

/*
 * "IMPORT FROM ..." UNDER AN EMPTY LIST (issue #6809).
 *
 * Someone with a PagerDuty account full of schedules, or an UptimeRobot
 * account full of checks, stands on an empty On-Call or Monitors list on
 * their first day. The empty state offers the list's Create, and beside
 * it one quiet link to the importer, naming the tools that fill that list:
 * "Import from UptimeRobot, Better Stack, Pingdom and others". It opens the
 * importer on those tools (?kind=), and says where it came from (?from=).
 *
 * Offered only to someone who may create the list's record, as its Create
 * button is: the server lets a person read a tool only when they may create
 * at least one thing it brings over (ToolImportAPIAccess), and an import
 * from this list brings this list's records. The link joins the empty
 * state's actions, so a search or filter that hides every row - whose
 * state offers only to clear it - never shows it.
 */

export interface ToolImportListOffer {
  // What the list holds, and so which tools fill it.
  kind: ToolImportResourceKind;
  // Where the importer says it was opened from (importer/opened's `from`).
  from: ToolImportEntryPoint;
  // The list's record: offered to whoever may create one.
  modelType: { new (): BaseModel };
}

export const MONITORS_IMPORT_OFFER: ToolImportListOffer = {
  kind: ToolImportResourceKind.Monitor,
  from: ToolImportEntryPoint.MonitorsEmpty,
  modelType: Monitor,
};

export const ON_CALL_POLICIES_IMPORT_OFFER: ToolImportListOffer = {
  kind: ToolImportResourceKind.OnCallPolicy,
  from: ToolImportEntryPoint.OnCallPoliciesEmpty,
  modelType: OnCallDutyPolicy,
};

export const ON_CALL_SCHEDULES_IMPORT_OFFER: ToolImportListOffer = {
  kind: ToolImportResourceKind.OnCallSchedule,
  from: ToolImportEntryPoint.OnCallSchedulesEmpty,
  modelType: OnCallDutyPolicySchedule,
};

export const STATUS_PAGES_IMPORT_OFFER: ToolImportListOffer = {
  kind: ToolImportResourceKind.StatusPage,
  from: ToolImportEntryPoint.StatusPagesEmpty,
  modelType: StatusPage,
};

export const TOOL_IMPORT_OFFER_TEST_ID: string = "empty-table-import-link";

/*
 * How many tools the link names before "and others": the most used first,
 * as the importer lists them, and few enough to sit on one line beside the
 * Create button.
 */
export const TOOL_IMPORT_OFFER_NAMED_TOOLS: number = 3;

export const TOOL_IMPORT_OFFER_WITH_OTHERS_TEXT: string = translationKey(
  "Import from {{tools}} and others",
);

export const TOOL_IMPORT_OFFER_TEXT: string = translationKey(
  "Import from {{tools}}",
);

/*
 * The link's words: "Import from UptimeRobot, Better Stack, Pingdom and
 * others" for a list five tools fill, "Import from UptimeRobot, Atlassian
 * Statuspage or Better Stack" for one three fill. The tools' names are
 * brands, never translated; the list and its words are the reader's.
 */
export function getToolImportOfferTitle(data: {
  kind: ToolImportResourceKind;
  translator: Translator;
}): string {
  const names: Array<string> = getToolImportSourcesThatFill(data.kind).map(
    (source: ToolImportSource): string => {
      return getToolImportSourceDefinition(source).title;
    },
  );
  const named: Array<string> = names.slice(0, TOOL_IMPORT_OFFER_NAMED_TOOLS);

  if (names.length > named.length) {
    return data.translator.translateTemplate(
      TOOL_IMPORT_OFFER_WITH_OTHERS_TEXT,
      {
        tools: composedValue((translator: Translator): string => {
          return formatList(named, translator);
        }),
      },
    );
  }

  return data.translator.translateTemplate(TOOL_IMPORT_OFFER_TEXT, {
    tools: composedValue((translator: Translator): string => {
      return formatNameList(named, "or", translator);
    }),
  });
}

// The importer, in this project, on the tools that fill the list.
export function getToolImportOfferRoute(offer: ToolImportListOffer): Route {
  const importer: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.SETTINGS_IMPORT_FROM_TOOL] as Route,
  );

  return new Route(
    `${importer.toString()}${getToolImportQueryString({
      from: offer.from,
      kind: offer.kind,
    })}`,
  );
}

// Whether the person may run the import this list offers.
export function canRunToolImportFor(offer: ToolImportListOffer): boolean {
  return PermissionGate.check(new offer.modelType(), ModelAction.Create)
    .isAllowed;
}

/*
 * The empty state's link to the importer, for someone who may run it;
 * nothing for anyone else (a read-only member, or before the permissions
 * have loaded), and nothing for a list no tool fills.
 */
export function getToolImportEmptyStateAction(data: {
  offer: ToolImportListOffer;
  translator: Translator;
}): TableEmptyStateAction | undefined {
  if (
    getToolImportSourcesThatFill(data.offer.kind).length === 0 ||
    !canRunToolImportFor(data.offer)
  ) {
    return undefined;
  }

  return {
    title: getToolImportOfferTitle({
      kind: data.offer.kind,
      translator: data.translator,
    }),
    icon: IconProp.InboxArrowDown,
    style: TableEmptyStateActionStyle.Link,
    dataTestId: TOOL_IMPORT_OFFER_TEST_ID,
    onClick: (): void => {
      Navigation.navigate(getToolImportOfferRoute(data.offer));
    },
  };
}

// A list's empty state, with the link to the importer after its own actions.
export function withToolImportOffer(data: {
  emptyState?: EmptyStateOptions | undefined;
  offer: ToolImportListOffer;
  translator: Translator;
}): EmptyStateOptions {
  const emptyState: EmptyStateOptions = data.emptyState || {};
  const action: TableEmptyStateAction | undefined =
    getToolImportEmptyStateAction({
      offer: data.offer,
      translator: data.translator,
    });

  if (!action) {
    return emptyState;
  }

  return {
    ...emptyState,
    actions: [...(emptyState.actions || []), action],
  };
}
