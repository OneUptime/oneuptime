import { SnmpTableRows } from "./EndpointTableParsers";
import {
  CISCO_FC_IF_COLUMNS,
  CISCO_FC_IF_ERROR_COLUMNS,
  CISCO_FC_IF_ERROR_TABLE_OID,
  CISCO_FC_IF_TABLE_OID,
  CONN_UNIT_PORT_STAT_COLUMNS,
  CONN_UNIT_PORT_STAT_TABLE_OID,
  FibreChannelInterfaceCandidate,
  SW_FC_PORT_COLUMNS,
  SW_FC_PORT_TABLE_OID,
  parseBrocadeFibreChannelPorts,
  parseCiscoFibreChannelPorts,
} from "./FibreChannelParsers";
import { TransceiverSnmpAccess } from "./TransceiverWalker";
import SnmpFibreChannelUtil, {
  SnmpFibreChannelPort,
} from "Common/Types/Monitor/SnmpMonitor/SnmpFibreChannel";
import SnmpOidListUtil from "Common/Types/Monitor/SnmpMonitor/SnmpOidListUtil";

/*
 * Reads a SAN switch's Fibre Channel ports during its poll: their type,
 * why a down one is down, and their error counters, by ifIndex, for the
 * interface walk to attach to the interfaces it found.
 *
 * Only a device that reports Fibre Channel interfaces (IF-MIB ifType 56)
 * is read, and only from the MIB its maker implements: Brocade's
 * (SW-MIB, then FCMGMT-MIB) for its Fibre Channel arc, Cisco's
 * (CISCO-FC-FE-MIB) for Cisco. Any other device - an Ethernet switch, a
 * router - costs nothing at all.
 *
 * Every column is read whole, every poll: the counters are what changes,
 * and a SAN switch is a few hundred ports at most. A read that times out,
 * or a table longer than MAX_FIBRE_CHANNEL_PORT_ROWS, throws: the caller
 * then attaches nothing this poll, and the next poll's rates are worked out
 * over the longer window rather than from a half-read table.
 */

// Wall-clock budget for the whole Fibre Channel phase of one poll.
export const FIBRE_CHANNEL_WALK_BUDGET_MS: number = 20000;

// Far above a real chassis (an X7-8 director has 512 ports, an MDS 9718 768).
export const MAX_FIBRE_CHANNEL_PORT_ROWS: number = 2048;

const BROCADE_FIBRE_CHANNEL_ARC: string = "1.3.6.1.4.1.1588.2.1.1";
const CISCO_ARC: string = "1.3.6.1.4.1.9";

export enum FibreChannelSource {
  Brocade = "Brocade",
  Cisco = "Cisco",
}

export interface FibreChannelWalkInput {
  sysObjectId?: string | undefined;
  interfaces: Array<
    FibreChannelInterfaceCandidate & {
      interfaceType?: number | undefined;
    }
  >;
  access: TransceiverSnmpAccess;
}

export interface FibreChannelWalkResult {
  ports: Map<number, SnmpFibreChannelPort>;
  // The MIB the ports were read from; undefined when none was tried.
  source?: FibreChannelSource | undefined;
}

export class FibreChannelWalkError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "FibreChannelWalkError";
  }
}

function isUnder(oid: string, arc: string): boolean {
  return oid === arc || oid.startsWith(`${arc}.`);
}

export default class FibreChannelPortWalker {
  // Which MIB a device's Fibre Channel ports are read from, if any.
  public static getSource(
    sysObjectId: string | undefined,
  ): FibreChannelSource | undefined {
    const oid: string = SnmpOidListUtil.normalizeOid(sysObjectId);

    if (isUnder(oid, BROCADE_FIBRE_CHANNEL_ARC)) {
      return FibreChannelSource.Brocade;
    }

    if (isUnder(oid, CISCO_ARC)) {
      return FibreChannelSource.Cisco;
    }

    return undefined;
  }

  public static hasFibreChannelInterfaces(
    interfaces: FibreChannelWalkInput["interfaces"],
  ): boolean {
    return interfaces.some(
      (candidate: { interfaceType?: number | undefined }) => {
        return SnmpFibreChannelUtil.isFibreChannelInterfaceType(
          candidate.interfaceType,
        );
      },
    );
  }

  public static async collect(
    input: FibreChannelWalkInput,
  ): Promise<FibreChannelWalkResult> {
    const source: FibreChannelSource | undefined =
      FibreChannelPortWalker.getSource(input.sysObjectId);

    if (
      !source ||
      !FibreChannelPortWalker.hasFibreChannelInterfaces(input.interfaces)
    ) {
      return { ports: new Map() };
    }

    if (source === FibreChannelSource.Brocade) {
      return {
        ports: await FibreChannelPortWalker.collectBrocade(input),
        source: source,
      };
    }

    return {
      ports: await FibreChannelPortWalker.collectCisco(input),
      source: source,
    };
  }

  private static async collectBrocade(
    input: FibreChannelWalkInput,
  ): Promise<Map<number, SnmpFibreChannelPort>> {
    const portRows: SnmpTableRows = await FibreChannelPortWalker.walk(
      input.access,
      SW_FC_PORT_TABLE_OID,
      [
        SW_FC_PORT_COLUMNS.phyState,
        SW_FC_PORT_COLUMNS.opStatus,
        SW_FC_PORT_COLUMNS.admStatus,
        SW_FC_PORT_COLUMNS.linkState,
        SW_FC_PORT_COLUMNS.noTxCredits,
        SW_FC_PORT_COLUMNS.rxCrcs,
        SW_FC_PORT_COLUMNS.rxEncOutFrs,
        SW_FC_PORT_COLUMNS.c3Discards,
        SW_FC_PORT_COLUMNS.specifier,
        SW_FC_PORT_COLUMNS.brcdType,
      ],
    );

    if (Object.keys(portRows).length === 0) {
      return new Map();
    }

    /*
     * FCMGMT-MIB answers only once the FA-MIB is turned on (`snmpconfig
     * --set mibCapability`). Off, it answers nothing - or an error from a
     * v1 agent - and the SW-MIB counters stand in.
     */
    let statRows: SnmpTableRows = {};

    try {
      statRows = await FibreChannelPortWalker.walk(
        input.access,
        CONN_UNIT_PORT_STAT_TABLE_OID,
        Object.values(CONN_UNIT_PORT_STAT_COLUMNS),
      );
    } catch (err) {
      if (FibreChannelPortWalker.isTimeout(err)) {
        throw err;
      }
      statRows = {};
    }

    return parseBrocadeFibreChannelPorts({
      portRows: portRows,
      statRows: statRows,
      interfaces: input.interfaces,
    });
  }

  private static async collectCisco(
    input: FibreChannelWalkInput,
  ): Promise<Map<number, SnmpFibreChannelPort>> {
    const errorRows: SnmpTableRows = await FibreChannelPortWalker.walk(
      input.access,
      CISCO_FC_IF_ERROR_TABLE_OID,
      Object.values(CISCO_FC_IF_ERROR_COLUMNS),
    );

    // A Cisco device with no CISCO-FC-FE-MIB stops here, one request in.
    if (Object.keys(errorRows).length === 0) {
      return new Map();
    }

    const interfaceRows: SnmpTableRows = await FibreChannelPortWalker.walk(
      input.access,
      CISCO_FC_IF_TABLE_OID,
      Object.values(CISCO_FC_IF_COLUMNS),
    );

    return parseCiscoFibreChannelPorts({
      interfaceRows: interfaceRows,
      errorRows: errorRows,
      interfaces: input.interfaces,
    });
  }

  private static async walk(
    access: TransceiverSnmpAccess,
    tableOid: string,
    columns: Array<number>,
  ): Promise<SnmpTableRows> {
    const rows: SnmpTableRows = await access.walkColumns(
      tableOid,
      columns,
      MAX_FIBRE_CHANNEL_PORT_ROWS,
    );

    if (Object.keys(rows).length >= MAX_FIBRE_CHANNEL_PORT_ROWS) {
      throw new FibreChannelWalkError(
        `The device reports more than ${MAX_FIBRE_CHANNEL_PORT_ROWS} rows in ${tableOid}, more than OneUptime reads for Fibre Channel ports; their errors were not read this poll.`,
      );
    }

    return rows;
  }

  public static isTimeout(err: unknown): boolean {
    const error: Error | undefined = err as Error | undefined;
    return (
      error?.name === "RequestTimedOutError" ||
      /time(d)?\s?out|time budget|deadline/i.test(error?.message || "")
    );
  }
}
