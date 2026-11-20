import { JSONObject, JSONValue } from "../../Types/JSON";
import {
  SecurityCaseEdgeActivityJson,
  SecurityCaseEdgeAddressJson,
  SecurityCaseEdgeJson,
} from "../../Types/SecurityCase/SecurityCaseContext";
import EdgeAction, { isEdgeAction } from "../../Types/SecurityEvent/EdgeAction";
import SecurityEventRequestOutcome from "../../Types/SecurityEvent/SecurityEventRequestOutcome";

/*
 * THE EDGE BESIDE THE APP, FROM ONE GROUPED READ OF THE CASE'S ADDRESSES.
 *
 * The case's Impact reads its addresses' web requests over its window
 * grouped by address, product, edge action and request outcome
 * (SecurityCaseImpact's buildEdgeActivityStatement): a row's `requests` is
 * the sum of its events' sample intervals, and `maxSampleInterval` says
 * whether any of them stood for more than one request. This folds those
 * rows into one entry per address: what each edge product did with its
 * requests, and how far the requests OneUptime saw in the app itself got.
 *
 * An address no edge acted on is left out: the section is about the edge.
 * Pure, so the server builds it and a test reads it the same way.
 */

// The longest a list of edges is: one connection per edge product.
const MAX_EDGES_PER_ADDRESS: number = 5;

function readCount(value: JSONValue | undefined): number {
  const number: number = Number(value);

  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

function readText(value: JSONValue | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function emptyActivity(edge: string): SecurityCaseEdgeActivityJson {
  return {
    edge,
    blocked: 0,
    challenged: 0,
    passedChallenge: 0,
    logged: 0,
    letThrough: 0,
    other: 0,
    isEstimate: false,
  };
}

function addToActivity(
  activity: SecurityCaseEdgeActivityJson,
  action: EdgeAction,
  requests: number,
): void {
  switch (action) {
    case EdgeAction.Blocked:
      activity.blocked += requests;
      return;
    case EdgeAction.Challenged:
      activity.challenged += requests;
      return;
    case EdgeAction.PassedChallenge:
      activity.passedChallenge += requests;
      return;
    case EdgeAction.Logged:
      activity.logged += requests;
      return;
    case EdgeAction.LetThrough:
      activity.letThrough += requests;
      return;
    default:
      activity.other += requests;
  }
}

export function foldEdgeActivityRows(data: {
  rows: Array<JSONObject>;
  // The case's addresses, in the case's order: the entries keep it.
  addresses: Array<string>;
}): SecurityCaseEdgeJson {
  const byAddress: Map<string, SecurityCaseEdgeAddressJson> = new Map<
    string,
    SecurityCaseEdgeAddressJson
  >();

  const entryOf: (address: string) => SecurityCaseEdgeAddressJson = (
    address: string,
  ): SecurityCaseEdgeAddressJson => {
    let entry: SecurityCaseEdgeAddressJson | undefined = byAddress.get(address);

    if (!entry) {
      entry = {
        address,
        edges: [],
        app: { rejected: 0, reachedApp: 0, errored: 0, reachedDatabase: 0 },
      };
      byAddress.set(address, entry);
    }

    return entry;
  };

  for (const row of data.rows) {
    const address: string = readText(row["principalIp"]);

    if (!address) {
      continue;
    }

    const action: string = readText(row["edgeAction"]);
    const requests: number = readCount(row["requests"]);
    const entry: SecurityCaseEdgeAddressJson = entryOf(address);

    if (action) {
      const edge: string = readText(row["vendorName"]) || "Edge";
      let activity: SecurityCaseEdgeActivityJson | undefined = entry.edges.find(
        (candidate: SecurityCaseEdgeActivityJson): boolean => {
          return candidate.edge === edge;
        },
      );

      if (!activity) {
        if (entry.edges.length >= MAX_EDGES_PER_ADDRESS) {
          continue;
        }

        activity = emptyActivity(edge);
        entry.edges.push(activity);
      }

      addToActivity(
        activity,
        isEdgeAction(action) ? action : EdgeAction.Other,
        requests,
      );

      if (readCount(row["maxSampleInterval"]) > 1) {
        activity.isEstimate = true;
      }

      continue;
    }

    // A request OneUptime saw in the app itself: counted by how far it got.
    switch (readText(row["requestOutcome"])) {
      case SecurityEventRequestOutcome.Rejected:
        entry.app.rejected += requests;
        break;
      case SecurityEventRequestOutcome.ReachedApp:
        entry.app.reachedApp += requests;
        break;
      case SecurityEventRequestOutcome.Errored:
        entry.app.errored += requests;
        break;
      case SecurityEventRequestOutcome.ReachedDatabase:
        entry.app.reachedDatabase += requests;
        break;
      default:
        break;
    }
  }

  const addresses: Array<SecurityCaseEdgeAddressJson> = [];
  const ordered: Array<string> = [
    ...data.addresses,
    ...Array.from(byAddress.keys()).filter((address: string): boolean => {
      return !data.addresses.includes(address);
    }),
  ];

  for (const address of ordered) {
    const entry: SecurityCaseEdgeAddressJson | undefined =
      byAddress.get(address);

    if (entry && entry.edges.length > 0) {
      addresses.push(entry);
    }
  }

  return { addresses };
}

// The requests an edge turned away before the app saw them.
export function getEdgeStoppedCount(
  activity: SecurityCaseEdgeActivityJson,
): number {
  return activity.blocked + activity.challenged;
}

// The requests an edge let on to the app, whatever it then did.
export function getEdgeLetOnCount(
  activity: SecurityCaseEdgeActivityJson,
): number {
  return activity.passedChallenge + activity.logged + activity.letThrough;
}

// The address's requests OneUptime saw get past the app's front door.
export function getAppReachedCount(entry: SecurityCaseEdgeAddressJson): number {
  return entry.app.reachedApp + entry.app.errored + entry.app.reachedDatabase;
}

// Whether OneUptime saw any of the address's requests in the app itself.
export function hasAppRequests(entry: SecurityCaseEdgeAddressJson): boolean {
  return getAppReachedCount(entry) + entry.app.rejected > 0;
}
