import {
  BlocklistDestination,
  BlocklistDestinations,
  readBlockEnforcements,
  readBlocklistDestinations,
} from "../../SecurityEvents/Blocklist/BlocklistApi";
import SecurityAutomaticResponseAction from "Common/Models/DatabaseModels/SecurityAutomaticResponseAction";
import SecurityBlock from "Common/Models/DatabaseModels/SecurityBlock";
import SecurityBlockEnforcement from "Common/Models/DatabaseModels/SecurityBlockEnforcement";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import Includes from "Common/Types/BaseDatabase/Includes";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  SecurityBlockAction,
  SecurityBlockDuration,
  SecurityBlockIndicatorType,
  SecurityBlockSource,
  SecurityBlockState,
  isSecurityBlockInForce,
  isSecurityBlockSource,
  readSecurityBlockValue,
} from "Common/Types/SecurityBlocklist/SecurityBlock";
import {
  SecurityBlockEnforcementShape,
  SecurityBlockEnforcementState,
  SecurityBlockEnforcementSummary,
  getSecurityBlockEnforcementSummary,
  isSecurityBlockEnforcementHolding,
} from "Common/Types/SecurityBlocklist/SecurityBlockEnforcement";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import {
  ResponseAddressBlock,
  ResponseAddressBlocking,
  ResponsePlaybookRunState,
} from "Common/Utils/SecurityCase/ResponsePlan/ResponsePlanTypes";

/*
 * WHAT A CASE'S BLOCK STEP READS OF THE PROJECT'S BLOCKLIST (#10342): where
 * the blocklist is enforced, the active blocks that hold the case's
 * addresses - its own, or a range around one - with where each holds, and
 * the calls its buttons make: Block (a one-step run of the playbook engine,
 * Common/Server/API/SecurityPlaybookRunAPI's block-address) and Lift (the
 * Blocklist's own lift).
 *
 * React-free, so each rule is pinned in a plain test.
 */

export const BLOCK_FROM_CASE_PATH: string =
  "/security-playbook-run/block-address";

// The most ranges the step reads to find one that holds an address.
export const ADDRESS_BLOCK_RANGES_LIMIT: number = 200;

const BLOCK_SELECT: {
  _id: true;
  value: true;
  indicatorType: true;
  action: true;
  state: true;
  expiresAt: true;
  createdAt: true;
  source: true;
  createdByUser: { _id: true; name: true; email: true };
  securityAutomaticResponsePolicy: { _id: true; name: true; kind: true };
} = {
  _id: true,
  value: true,
  indicatorType: true,
  action: true,
  state: true,
  expiresAt: true,
  createdAt: true,
  source: true,
  createdByUser: { _id: true, name: true, email: true },
  // The automatic response policy that made it (#10350): "by the Scanners policy".
  securityAutomaticResponsePolicy: { _id: true, name: true, kind: true },
};

// A block and where it is enforced, as the step reads it.
export function readResponseAddressBlock(data: {
  block: SecurityBlock;
  enforcements: Array<SecurityBlockEnforcement>;
  now: Date;
  // How long an automatic response policy's block took, from the address's first request (#10350).
  timeToBlockInSeconds?: number | undefined;
}): ResponseAddressBlock | null {
  const { block } = data;
  const id: string = block._id?.toString() || block.id?.toString() || "";

  if (!id || !block.value) {
    return null;
  }

  const rows: Array<SecurityBlockEnforcementShape> =
    data.enforcements as Array<SecurityBlockEnforcementShape>;
  const summary: SecurityBlockEnforcementSummary =
    getSecurityBlockEnforcementSummary(rows, data.now);
  const pendingAt: Array<string> = data.enforcements
    .filter((row: SecurityBlockEnforcement): boolean => {
      return row.state === SecurityBlockEnforcementState.Pending;
    })
    .map((row: SecurityBlockEnforcement): string => {
      return (row.destinationName || "").trim();
    })
    .filter((name: string): boolean => {
      return Boolean(name);
    });
  let enforcedSince: Date | undefined = undefined;

  for (const row of data.enforcements) {
    if (!isSecurityBlockEnforcementHolding(row, data.now)) {
      continue;
    }

    const applied: Date | null = row.appliedAt
      ? new Date(row.appliedAt)
      : row.lastConfirmedAt
        ? new Date(row.lastConfirmedAt)
        : null;

    if (
      applied &&
      (!enforcedSince || applied.getTime() < enforcedSince.getTime())
    ) {
      enforcedSince = applied;
    }
  }

  const createdByName: string =
    block.createdByUser?.name?.toString() ||
    block.createdByUser?.email?.toString() ||
    "";
  const policyName: string = (
    block.securityAutomaticResponsePolicy?.name || ""
  ).trim();

  return {
    id,
    value: block.value,
    action:
      block.action === SecurityBlockAction.Challenge
        ? SecurityBlockAction.Challenge
        : SecurityBlockAction.Block,
    ...(block.createdAt ? { createdAt: new Date(block.createdAt) } : {}),
    expiresAt: block.expiresAt ? new Date(block.expiresAt) : null,
    ...(createdByName ? { createdByName } : {}),
    ...(policyName
      ? {
          policyName,
          policyKind: block.securityAutomaticResponsePolicy?.kind || undefined,
        }
      : {}),
    ...(policyName && typeof data.timeToBlockInSeconds === "number"
      ? { timeToBlockInSeconds: data.timeToBlockInSeconds }
      : {}),
    ...(isSecurityBlockSource(block.source)
      ? { source: block.source as SecurityBlockSource }
      : {}),
    enforcedAt: summary.enforcedAt,
    ...(enforcedSince ? { enforcedSince } : {}),
    pendingAt,
    notAppliedAt: summary.notEnforcedAt.filter(
      (entry: { name: string; reason: string | null }): boolean => {
        return !pendingAt.includes(entry.name);
      },
    ),
  };
}

/*
 * Where the blocklist is enforced, by name, as the step names it: none when
 * nothing does. Null when OneUptime cannot tell - the read failed, or a
 * kind of destination could not be listed and none was - and the step is
 * then one done by hand, as before the blocklist.
 */
export function readDestinationNames(
  found: BlocklistDestinations,
): Array<string> | null {
  const names: Array<string> = [];

  for (const destination of found.destinations as Array<BlocklistDestination>) {
    const name: string = destination.name.trim();

    if (name && !names.includes(name)) {
      names.push(name);
    }
  }

  if (names.length === 0 && found.cannotTell) {
    return null;
  }

  return names;
}

/*
 * What the case's block steps read, for these addresses: undefined when the
 * reader cannot read where the blocklist is enforced, so the plan says the
 * step is done by hand rather than guess.
 */
/*
 * How long each automatic response policy's block took, from the address's
 * first request to holding at an edge (#10350), by block. Nothing when the
 * reader may not read what the policies did: the line then names the
 * policy without it.
 */
export async function readTimesToBlock(
  blocks: Array<SecurityBlock>,
): Promise<Map<string, number>> {
  const times: Map<string, number> = new Map();
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
  const ids: Array<ObjectID> = blocks
    .filter((block: SecurityBlock): boolean => {
      return (
        block.source === SecurityBlockSource.AutomaticResponse &&
        Boolean(block.id)
      );
    })
    .map((block: SecurityBlock): ObjectID => {
      return block.id!;
    });

  if (!projectId || ids.length === 0) {
    return times;
  }

  try {
    const result: ListResult<SecurityAutomaticResponseAction> =
      await ModelAPI.getList<SecurityAutomaticResponseAction>({
        modelType: SecurityAutomaticResponseAction,
        query: {
          projectId,
          isTrialRun: false,
          securityBlockId: new Includes(ids),
        },
        select: {
          _id: true,
          securityBlockId: true,
          timeToBlockInSeconds: true,
        },
        sort: { createdAt: SortOrder.Descending },
        skip: 0,
        limit: ids.length * 2,
      });

    for (const action of result.data) {
      const blockId: string = action.securityBlockId?.toString() || "";
      const seconds: number | undefined = action.timeToBlockInSeconds;

      if (blockId && typeof seconds === "number" && !times.has(blockId)) {
        times.set(blockId, seconds);
      }
    }
  } catch {
    // The line names the policy without how long it took.
  }

  return times;
}

export async function loadAddressBlocking(data: {
  addresses: Array<string>;
  runStates: Record<string, ResponsePlaybookRunState>;
  now?: Date | undefined;
}): Promise<ResponseAddressBlocking | undefined> {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  if (!projectId || data.addresses.length === 0) {
    return undefined;
  }

  let destinations: Array<string> | null;

  try {
    destinations = readDestinationNames(await readBlocklistDestinations());
  } catch {
    return undefined;
  }

  if (!destinations) {
    return undefined;
  }

  const now: Date = data.now || new Date();
  // The addresses as blocks are written: an IPv6 address compressed (RFC 5952).
  const values: Array<string> = data.addresses.map(
    (address: string): string => {
      return readSecurityBlockValue(address)?.value || address;
    },
  );

  const [own, ranges]: [ListResult<SecurityBlock>, ListResult<SecurityBlock>] =
    await Promise.all([
      ModelAPI.getList<SecurityBlock>({
        modelType: SecurityBlock,
        query: {
          projectId,
          state: SecurityBlockState.Active,
          value: new Includes(values),
        },
        select: BLOCK_SELECT,
        sort: { createdAt: SortOrder.Descending },
        skip: 0,
        limit: values.length,
      }),
      ModelAPI.getList<SecurityBlock>({
        modelType: SecurityBlock,
        query: {
          projectId,
          state: SecurityBlockState.Active,
          indicatorType: SecurityBlockIndicatorType.IpRange,
        },
        select: BLOCK_SELECT,
        sort: { createdAt: SortOrder.Descending },
        skip: 0,
        limit: ADDRESS_BLOCK_RANGES_LIMIT,
      }),
    ]);

  const blocks: Array<SecurityBlock> = [...own.data, ...ranges.data].filter(
    (block: SecurityBlock): boolean => {
      return isSecurityBlockInForce(block, now);
    },
  );

  const [enforcements, timesToBlock]: [
    Map<string, Array<SecurityBlockEnforcement>>,
    Map<string, number>,
  ] = await Promise.all([
    readBlockEnforcements(
      blocks
        .map((block: SecurityBlock): ObjectID | undefined => {
          return block.id || undefined;
        })
        .filter((id: ObjectID | undefined): id is ObjectID => {
          return Boolean(id);
        }),
    ),
    readTimesToBlock(blocks),
  ]);

  return {
    destinations,
    blocks: blocks
      .map((block: SecurityBlock): ResponseAddressBlock | null => {
        return readResponseAddressBlock({
          block,
          enforcements: enforcements.get(block.id?.toString() || "") || [],
          now,
          timeToBlockInSeconds: timesToBlock.get(block.id?.toString() || ""),
        });
      })
      .filter(
        (block: ResponseAddressBlock | null): block is ResponseAddressBlock => {
          return block !== null;
        },
      ),
    runStates: data.runStates,
  };
}

// What a one-click block from the case asks for.
export interface BlockFromCaseRequest {
  securityCaseId: ObjectID;
  value: string;
  blockAction: SecurityBlockAction;
  duration: SecurityBlockDuration;
}

export interface BlockFromCaseStarted {
  runId: string;
  // The block waits for someone else's approval before it is made.
  needsApproval: boolean;
}

/*
 * Blocks one of the case's addresses through the playbook engine, or says
 * why not - already blocked, protected, not the case's to block - as the
 * server words it.
 */
export async function blockFromCase(
  request: BlockFromCaseRequest,
): Promise<BlockFromCaseStarted> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: URL.fromURL(APP_API_URL).addRoute(BLOCK_FROM_CASE_PATH),
      headers: ModelAPI.getCommonHeaders(),
      data: {
        securityCaseId: request.securityCaseId.toString(),
        value: request.value,
        blockAction: request.blockAction,
        duration: request.duration,
      },
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  const data: JSONObject = (response.data || {}) as JSONObject;

  return {
    runId: typeof data["runId"] === "string" ? data["runId"] : "",
    needsApproval: data["needsApproval"] === true,
  };
}

// Lifts a block from the case's step, as the Blocklist lifts one.
export async function liftBlockFromCase(data: {
  blockId: string;
  reason?: string | undefined;
}): Promise<void> {
  await ModelAPI.updateById<SecurityBlock>({
    modelType: SecurityBlock,
    id: new ObjectID(data.blockId),
    data: {
      state: SecurityBlockState.Lifted,
      ...(data.reason ? { liftReason: data.reason } : {}),
    },
  });
}
