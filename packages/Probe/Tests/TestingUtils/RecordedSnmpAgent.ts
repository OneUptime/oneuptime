import dgram from "dgram";
import fs from "fs";
import path from "path";
import snmp from "net-snmp";

/*
 * An SNMP agent on loopback that answers from a recording in the simulator's
 * format (Examples/snmp-simulator/data/<device>/<community>.snmprec): the
 * same files `docker compose up` serves through snmpsim, served here through
 * net-snmp's own agent over a real UDP socket. GET, GETNEXT and GETBULK are
 * net-snmp's, SNMPv3 is net-snmp's USM, so a poll reads the recording the
 * way it reads the simulator, and the switch the recording was modelled on.
 *
 * What snmpsim does beyond replaying values, done the same way here:
 *
 *   - `numeric` (`65:numeric|rate=2,wrap=1`): a counter that grows by `rate`
 *     a second from `initial`, wrapping at 2^32 when it is a Counter32 and
 *     `wrap` is set. It grows on a clock the test moves (advance), so two
 *     polls read a known delta however long the test takes.
 *   - SNMPv3 contexts: snmpsim serves a recording in the context named after
 *     its file, which is how a Brocade chassis serves each logical switch of
 *     a Virtual Fabric ("VF:20"): one engine, one address, and the scoped
 *     PDU's context name picks what a request reads. Here each context's
 *     recording is a MIB of its own, and a request naming the context is
 *     answered from it. (net-snmp's own Forwarder proxies a context to a
 *     second agent, but drops every GETBULK it forwards - and a poll walks
 *     with GETBULK - so it is not used.) A request naming a context the
 *     agent does not serve gets no answer, as from snmpsim.
 */

export interface RecordedSnmpAgentOptions {
  recording: string;
  // The v1/v2c community it answers; none, and it answers SNMPv3 only.
  community?: string | undefined;
  users?: Array<snmp.User> | undefined;
  // Context name -> recording, served over SNMPv3 in that context.
  contexts?: Record<string, string> | undefined;
  /*
   * The agent's SNMPv3 engine ID, as hex: what its Reports to a poll's
   * discovery say, and what its traps would be sent as. A random one when
   * absent, as net-snmp makes one.
   */
  engineId?: string | undefined;
  /*
   * Serve SNMP-FRAMEWORK-MIB's snmpEngine group (RFC 3411) - snmpEngineID,
   * snmpEngineBoots, snmpEngineTime, snmpEngineMaxMessageSize - to every
   * version, the engine ID the one its Reports say: as a real agent does
   * whose view includes it (Net-SNMP with a full view, Cisco's v1default).
   * Off, it is an agent whose community's view leaves it out (Net-SNMP's
   * `systemonly`): a GET for it is answered noSuchObject.
   */
  servesSnmpEngineGroup?: boolean | undefined;
  /*
   * false: an agent that speaks v1 and v2c only. An SNMPv3 message - a
   * poll's, or engine discovery - gets no answer at all, as from an agent
   * with SNMPv3 switched off.
   */
  answersSnmpV3?: boolean | undefined;
}

interface NumericVariation {
  rate: number;
  initial: number;
  wrap: boolean;
}

export interface RecordedValue {
  oid: string;
  type: number;
  value: unknown;
  numeric?: NumericVariation | undefined;
}

type MibNode = {
  value?: unknown;
  valueType?: number;
};

type AgentMib = {
  registerProvider: (provider: Record<string, unknown>) => void;
  getProvider: (name: string) => Record<string, unknown>;
  addProviderToNode: (provider: Record<string, unknown>) => MibNode;
  addNodesForOid: (oid: string) => MibNode;
  lookup: (oid: string) => MibNode | null;
};

type AgentMessage = {
  pdu: { type: number; contextName?: string };
};

type SnmpAgent = {
  getAuthorizer: () => {
    addCommunity: (community: string) => void;
    addUser: (user: snmp.User) => void;
  };
  getMib: () => AgentMib;
  mib: AgentMib;
  onProxyRequest: (
    socket: unknown,
    message: AgentMessage,
    rinfo: unknown,
  ) => void;
  getRequest: (socket: unknown, message: AgentMessage, rinfo: unknown) => void;
  getNextRequest: (
    socket: unknown,
    message: AgentMessage,
    rinfo: unknown,
  ) => void;
  getBulkRequest: (
    socket: unknown,
    message: AgentMessage,
    rinfo: unknown,
  ) => void;
  close: (callback?: () => void) => void;
  engine: { engineID: Buffer };
  listener: { sockets: Record<string, dgram.Socket> };
};

// SNMP-FRAMEWORK-MIB's snmpEngine group (RFC 3411).
export const SNMP_ENGINE_ID_OID: string = "1.3.6.1.6.3.10.2.1.1.0";
const SNMP_ENGINE_BOOTS_OID: string = "1.3.6.1.6.3.10.2.1.2.0";
const SNMP_ENGINE_TIME_OID: string = "1.3.6.1.6.3.10.2.1.3.0";
const SNMP_ENGINE_MAX_MESSAGE_SIZE_OID: string = "1.3.6.1.6.3.10.2.1.4.0";

// Whether a datagram is SNMPv3: a SEQUENCE whose first element is INTEGER 3.
function isSnmpV3(datagram: Buffer): boolean {
  if (datagram.length < 2 || datagram[0] !== 0x30) {
    return false;
  }

  // Past the SEQUENCE's length, short or long form.
  const lengthOctet: number = datagram[1]!;
  const start: number = lengthOctet & 0x80 ? 2 + (lengthOctet & 0x7f) : 2;

  return (
    datagram[start] === 0x02 &&
    datagram[start + 1] === 0x01 &&
    datagram[start + 2] === 0x03
  );
}

const TWO_TO_THE_32: bigint = BigInt(2) ** BigInt(32);
const TWO_TO_THE_64: bigint = BigInt(2) ** BigInt(64);

// The repository's Examples/snmp-simulator/data/<device>/<file>.
export function simulatorRecording(device: string, file: string): string {
  return path.resolve(
    __dirname,
    "../../../../Examples/snmp-simulator/data",
    device,
    file,
  );
}

function typeOf(tag: string): number {
  switch (tag) {
    case "2":
      return snmp.ObjectType.Integer;
    case "4":
    case "4x":
      return snmp.ObjectType.OctetString;
    case "6":
      return snmp.ObjectType.OID;
    case "64":
      return snmp.ObjectType.IpAddress;
    case "65":
      return snmp.ObjectType.Counter;
    case "66":
      return snmp.ObjectType.Gauge;
    case "67":
      return snmp.ObjectType.TimeTicks;
    case "70":
      return snmp.ObjectType.Counter64;
    default:
      throw new Error(`Unsupported snmprec type "${tag}"`);
  }
}

function counter64(value: bigint): Buffer {
  const buffer: Buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(
    ((value % TWO_TO_THE_64) + TWO_TO_THE_64) % TWO_TO_THE_64,
  );
  return buffer;
}

function staticValue(tag: string, text: string): unknown {
  switch (tag) {
    case "4":
      return text;
    case "4x":
      return Buffer.from(text, "hex");
    case "6":
    case "64":
      return text;
    case "70":
      return counter64(BigInt(text));
    default:
      return parseInt(text, 10);
  }
}

function parseNumeric(args: string): NumericVariation {
  const values: Map<string, string> = new Map();

  for (const pair of args.split(",")) {
    const [key, value] = pair.split("=");

    if (key && value !== undefined) {
      values.set(key.trim(), value.trim());
    }
  }

  return {
    rate: parseFloat(values.get("rate") || "0"),
    initial: parseFloat(values.get("initial") || "0"),
    wrap: values.get("wrap") === "1",
  };
}

// One record per line, `OID|type|value` or `OID|type:numeric|args`.
export function parseRecording(text: string): Array<RecordedValue> {
  const values: Array<RecordedValue> = [];

  for (const line of text.split("\n")) {
    if (!line.trim()) {
      continue;
    }

    const first: number = line.indexOf("|");
    const second: number = line.indexOf("|", first + 1);

    if (first < 0 || second < 0) {
      throw new Error(`Not an snmprec record: "${line}"`);
    }

    const oid: string = line.substring(0, first);
    const tag: string = line.substring(first + 1, second);
    const rest: string = line.substring(second + 1);
    const [baseTag, variation] = tag.split(":") as [string, string | undefined];

    if (variation === "numeric") {
      const numeric: NumericVariation = parseNumeric(rest);

      values.push({
        oid: oid,
        type: typeOf(baseTag),
        value: undefined,
        numeric: numeric,
      });
      continue;
    }

    if (variation) {
      throw new Error(`Unsupported snmpsim variation "${variation}"`);
    }

    values.push({
      oid: oid,
      type: typeOf(baseTag),
      value: staticValue(baseTag, rest),
    });
  }

  return values;
}

function findFreeUdpPort(): Promise<number> {
  return new Promise(
    (resolve: (port: number) => void, reject: (reason?: Error) => void) => {
      const socket: dgram.Socket = dgram.createSocket("udp4");

      socket.once("error", (error: Error) => {
        reject(error);
      });

      socket.bind(0, "127.0.0.1", () => {
        const port: number = socket.address().port;
        socket.close(() => {
          resolve(port);
        });
      });
    },
  );
}

export default class RecordedSnmpAgent {
  public readonly port: number;
  private readonly agent: SnmpAgent;
  private readonly numericNodes: Array<{
    node: MibNode;
    type: number;
    numeric: NumericVariation;
  }> = [];
  private readonly contextMibs: Map<string, AgentMib> = new Map();
  private elapsedSeconds: number = 0;

  private constructor(agent: SnmpAgent, port: number) {
    this.agent = agent;
    this.port = port;
  }

  public static async start(
    options: RecordedSnmpAgentOptions,
  ): Promise<RecordedSnmpAgent> {
    const port: number = await findFreeUdpPort();

    const agent: SnmpAgent = snmp.createAgent(
      {
        port: port,
        address: "127.0.0.1",
        disableAuthorization: false,
        ...(options.engineId ? { engineID: options.engineId } : {}),
      },
      () => {
        // Agent-side errors surface to the client as a timeout.
      },
    ) as unknown as SnmpAgent;

    if (options.community) {
      agent.getAuthorizer().addCommunity(options.community);
    }

    for (const user of options.users || []) {
      agent.getAuthorizer().addUser(user);
    }

    const recorded: RecordedSnmpAgent = new RecordedSnmpAgent(agent, port);
    recorded.load(agent.getMib(), fs.readFileSync(options.recording, "utf8"));

    for (const [context, recording] of Object.entries(options.contexts || {})) {
      const mib: AgentMib = snmp.createMib() as unknown as AgentMib;
      recorded.load(mib, fs.readFileSync(recording, "utf8"));
      recorded.contextMibs.set(context, mib);
    }

    if (options.servesSnmpEngineGroup) {
      recorded.serveSnmpEngineGroup(agent.getMib());
    }

    recorded.watchRequests(options.answersSnmpV3 !== false);

    /*
     * net-snmp hands every request that names a context to onProxyRequest.
     * Answer it from that context's MIB, the way the agent answers the
     * default context from its own: the request is served synchronously, so
     * the agent reads the context's MIB for exactly this request.
     */
    agent.onProxyRequest = (
      socket: unknown,
      message: AgentMessage,
      rinfo: unknown,
    ): void => {
      const mib: AgentMib | undefined = recorded.contextMibs.get(
        message.pdu.contextName || "",
      );

      if (!mib) {
        return;
      }

      const ownMib: AgentMib = agent.mib;
      agent.mib = mib;

      try {
        if (message.pdu.type === snmp.PduType.GetRequest) {
          agent.getRequest(socket, message, rinfo);
        } else if (message.pdu.type === snmp.PduType.GetNextRequest) {
          agent.getNextRequest(socket, message, rinfo);
        } else if (message.pdu.type === snmp.PduType.GetBulkRequest) {
          agent.getBulkRequest(socket, message, rinfo);
        }
      } finally {
        agent.mib = ownMib;
      }
    };

    return recorded;
  }

  /*
   * Every record under one provider at 1.3.6.1, read-only: GET answers an
   * instance with its value, GETNEXT and GETBULK walk the instances in OID
   * order, as an agent does.
   */
  private load(mib: AgentMib, text: string): void {
    mib.registerProvider({
      name: "recording",
      type: snmp.MibProviderType.Scalar,
      oid: "1.3.6.1",
      scalarType: snmp.ObjectType.Integer,
      maxAccess: snmp.MaxAccess["read-only"],
    });
    mib.addProviderToNode(mib.getProvider("recording"));

    for (const value of parseRecording(text)) {
      const node: MibNode = mib.addNodesForOid(value.oid);
      node.valueType = value.type;

      if (value.numeric) {
        this.numericNodes.push({
          node: node,
          type: value.type,
          numeric: value.numeric,
        });
      } else {
        node.value = value.value;
      }
    }

    this.updateNumericValues();
  }

  private updateNumericValues(): void {
    for (const entry of this.numericNodes) {
      const grown: bigint = BigInt(
        Math.floor(
          entry.numeric.initial + entry.numeric.rate * this.elapsedSeconds,
        ),
      );

      if (entry.type === snmp.ObjectType.Counter64) {
        entry.node.value = counter64(grown);
      } else if (entry.numeric.wrap) {
        entry.node.value = Number(grown % TWO_TO_THE_32);
      } else {
        entry.node.value = Number(grown);
      }
    }
  }

  // The agent's SNMPv3 engine ID, as hex in capitals.
  public get engineId(): string {
    return this.agent.engine.engineID.toString("hex").toUpperCase();
  }

  // Every datagram the agent was sent, SNMPv3 ones told apart.
  public readonly requests: Array<{ isSnmpV3: boolean; datagram: Buffer }> = [];

  /*
   * snmpEngineID and the rest of its group, as the agent's own engine says
   * them, beside whatever the recording holds (which wins).
   */
  private serveSnmpEngineGroup(mib: AgentMib): void {
    const group: Array<{ oid: string; type: number; value: unknown }> = [
      {
        oid: SNMP_ENGINE_ID_OID,
        type: snmp.ObjectType.OctetString,
        value: Buffer.from(this.agent.engine.engineID),
      },
      { oid: SNMP_ENGINE_BOOTS_OID, type: snmp.ObjectType.Integer, value: 1 },
      { oid: SNMP_ENGINE_TIME_OID, type: snmp.ObjectType.Integer, value: 120 },
      {
        oid: SNMP_ENGINE_MAX_MESSAGE_SIZE_OID,
        type: snmp.ObjectType.Integer,
        // What Net-SNMP 5.9.4's snmpd says.
        value: 1500,
      },
    ];

    for (const entry of group) {
      const existing: MibNode | null = mib.lookup(entry.oid);

      if (existing && existing.valueType !== undefined) {
        continue;
      }

      const node: MibNode = mib.addNodesForOid(entry.oid);
      node.valueType = entry.type;
      node.value = entry.value;
    }
  }

  /*
   * Keeps every datagram the agent is sent (requests), and drops the SNMPv3
   * ones unanswered when it speaks v1 and v2c only.
   */
  private watchRequests(answersSnmpV3: boolean): void {
    for (const socket of Object.values(this.agent.listener.sockets || {})) {
      const handlers: Array<(...args: Array<unknown>) => void> =
        socket.listeners("message") as Array<(...args: Array<unknown>) => void>;

      socket.removeAllListeners("message");

      socket.on("message", (datagram: Buffer, rinfo: unknown): void => {
        const isV3: boolean = isSnmpV3(datagram);

        this.requests.push({ isSnmpV3: isV3, datagram: datagram });

        if (isV3 && !answersSnmpV3) {
          return;
        }

        for (const handler of handlers) {
          handler(datagram, rinfo);
        }
      });
    }
  }

  // Moves every growing counter on, in every context.
  public advance(seconds: number): void {
    this.elapsedSeconds += seconds;
    this.updateNumericValues();
  }

  /*
   * Changes one recorded value, as the device would between two polls: in
   * the default context, or in the one named.
   */
  public setValue(oid: string, value: unknown, context?: string): void {
    const mib: AgentMib | undefined = context
      ? this.contextMibs.get(context)
      : this.agent.getMib();
    const node: MibNode | null = mib ? mib.lookup(oid) : null;

    if (!node || node.valueType === undefined) {
      throw new Error(`${oid} is not in the recording`);
    }

    this.numericNodes.splice(
      0,
      this.numericNodes.length,
      ...this.numericNodes.filter((entry: { node: MibNode }) => {
        return entry.node !== node;
      }),
    );
    node.value = value;
  }

  public close(): void {
    this.agent.close();
  }
}

export { counter64 };
