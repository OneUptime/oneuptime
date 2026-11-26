import { SecurityConnectorCheck } from "../../../../Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import { isBlockingTurnedOn } from "../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import { redactLogString } from "../../LogRedaction";
import ConnectorErrorMessage from "../ConnectorErrorMessage";
import CrowdStrikeFalconResponseClient, {
  CrowdStrikeIoc,
} from "../Response/CrowdStrikeFalconResponseClient";
import MicrosoftDefenderEndpointClient, {
  DEFENDER_INDICATORS_PERMISSION,
  DEFENDER_MAX_ACTIVE_INDICATORS,
  DefenderIndicator,
} from "../Response/MicrosoftDefenderEndpointClient";
import {
  ConnectorTransport,
  SecurityConnectorSettings,
  makeCheck,
  readSettingString,
} from "./Types";

/*
 * TEST CONNECTION, FOR A CONNECTION THAT BLOCKS (#10346): with its blocking
 * switch on - Block domains, addresses and files with Defender, Block files
 * with CrowdStrike - a connection's test also checks the permission
 * blocking takes, without writing anything:
 *
 *   Microsoft Defender  the app registration holds the WindowsDefenderATP
 *                       application permission Ti.ReadWrite.All (the access
 *                       token's roles say), and the indicators read;
 *   CrowdStrike Falcon  the API client holds IOC Management: Read (one IOC
 *                       ID listed) and Write (an update of no IOC, which
 *                       Falcon refuses 403 without it).
 *
 * The check says how many of OneUptime's indicators the product holds -
 * and, for Defender, of the 15,000 a tenant takes - so the connection's
 * report says what blocking uses there. With the switch off it adds
 * nothing: the connection only reads.
 */

export const BLOCK_CHECK_KEY: string = "block-permission";

export const DEFENDER_BLOCK_CHECK_NAME: string =
  "Block with Microsoft Defender";
// Named apart from the connection's switch, Block files with CrowdStrike, which the Dashboard translates.
export const CROWDSTRIKE_BLOCK_CHECK_NAME: string =
  "Block with CrowdStrike Falcon";

export const DEFENDER_BLOCK_REMEDIATION: string =
  "In the Microsoft Entra admin center, open the app registration's API permissions, add the APIs my organization uses > WindowsDefenderATP application permission Ti.ReadWrite.All, and grant admin consent. Or turn off Block domains, addresses and files with Defender.";

export const CROWDSTRIKE_BLOCK_REMEDIATION: string =
  "In the Falcon console, open Support and resources > API clients and keys, edit the API client and give it IOC Management: Read and Write. Or turn off Block files with CrowdStrike.";

/*
 * A connection's checks with the blocking check after them, when its
 * switch is on: run when it authenticated, skipped - saying why - when it
 * did not.
 */
export async function withBlockingCheck(data: {
  settings: SecurityConnectorSettings;
  checks: Array<SecurityConnectorCheck>;
  name: string;
  check: () => Promise<SecurityConnectorCheck>;
}): Promise<Array<SecurityConnectorCheck>> {
  if (!isBlockingTurnedOn(data.settings.config)) {
    return data.checks;
  }

  const hasAuthenticated: boolean = data.checks.some(
    (check: SecurityConnectorCheck): boolean => {
      return check.key === "authentication" && check.status === "pass";
    },
  );

  if (!hasAuthenticated) {
    return [
      ...data.checks,
      makeCheck({
        key: BLOCK_CHECK_KEY,
        name: data.name,
        status: "skip",
        startedAtMs: Date.now(),
        message: "Skipped because authentication failed.",
      }),
    ];
  }

  return [...data.checks, await data.check()];
}

function errorText(error: unknown): string {
  return redactLogString(
    ConnectorErrorMessage.toMessage(error, { truncate: false }),
  );
}

// Microsoft Defender: Ti.ReadWrite.All, and the indicators read.
export async function checkDefenderBlocking(data: {
  settings: SecurityConnectorSettings;
  transport: ConnectorTransport;
}): Promise<SecurityConnectorCheck> {
  const startedAtMs: number = Date.now();

  try {
    const client: MicrosoftDefenderEndpointClient =
      new MicrosoftDefenderEndpointClient({
        tenantId: readSettingString(data.settings.config, "tenantId"),
        clientId: readSettingString(data.settings.config, "clientId"),
        clientSecret: readSettingString(data.settings.secrets, "clientSecret"),
        cloud: readSettingString(data.settings.config, "cloud") || "public",
        transport: data.transport,
      });

    const roles: Array<string> = await client.readApplicationPermissions();

    if (!roles.includes(DEFENDER_INDICATORS_PERMISSION)) {
      return makeCheck({
        key: BLOCK_CHECK_KEY,
        name: DEFENDER_BLOCK_CHECK_NAME,
        status: "fail",
        startedAtMs,
        message: `The app registration does not hold ${DEFENDER_INDICATORS_PERMISSION} on Microsoft Defender for Endpoint, so OneUptime cannot add the indicators that block what you block.`,
        remediation: DEFENDER_BLOCK_REMEDIATION,
      });
    }

    const indicators: Array<DefenderIndicator> = await client.listIndicators();

    return makeCheck({
      key: BLOCK_CHECK_KEY,
      name: DEFENDER_BLOCK_CHECK_NAME,
      status: "pass",
      startedAtMs,
      message: `The app registration holds ${DEFENDER_INDICATORS_PERMISSION}. OneUptime holds ${indicators.length.toLocaleString("en-US")} of the ${DEFENDER_MAX_ACTIVE_INDICATORS.toLocaleString("en-US")} indicators a Defender tenant takes, the tenant's own included.`,
      details: {
        oneUptimeIndicators: indicators.length,
        tenantIndicatorLimit: DEFENDER_MAX_ACTIVE_INDICATORS,
      },
    });
  } catch (error) {
    return makeCheck({
      key: BLOCK_CHECK_KEY,
      name: DEFENDER_BLOCK_CHECK_NAME,
      status: "fail",
      startedAtMs,
      message: errorText(error),
      remediation: DEFENDER_BLOCK_REMEDIATION,
    });
  }
}

// CrowdStrike Falcon: IOC Management Read and Write.
export async function checkCrowdStrikeBlocking(data: {
  settings: SecurityConnectorSettings;
  transport: ConnectorTransport;
}): Promise<SecurityConnectorCheck> {
  const startedAtMs: number = Date.now();

  try {
    const client: CrowdStrikeFalconResponseClient =
      new CrowdStrikeFalconResponseClient({
        cloud: readSettingString(data.settings.config, "cloud") || "us-1",
        clientId: readSettingString(data.settings.config, "clientId"),
        clientSecret: readSettingString(data.settings.secrets, "clientSecret"),
        transport: data.transport,
      });

    const scopes: { canRead: boolean; canWrite: boolean } =
      await client.checkIocScopes();

    if (!scopes.canRead || !scopes.canWrite) {
      const missing: string =
        !scopes.canRead && !scopes.canWrite
          ? "IOC Management: Read and Write"
          : !scopes.canRead
            ? "IOC Management: Read"
            : "IOC Management: Write";

      return makeCheck({
        key: BLOCK_CHECK_KEY,
        name: CROWDSTRIKE_BLOCK_CHECK_NAME,
        status: "fail",
        startedAtMs,
        message: `The API client does not hold ${missing}, so OneUptime cannot add the IOCs that block the files you block.`,
        remediation: CROWDSTRIKE_BLOCK_REMEDIATION,
      });
    }

    const iocs: Array<CrowdStrikeIoc> = await client.listIocs();

    return makeCheck({
      key: BLOCK_CHECK_KEY,
      name: CROWDSTRIKE_BLOCK_CHECK_NAME,
      status: "pass",
      startedAtMs,
      message: `The API client holds IOC Management: Read and Write. OneUptime holds ${iocs.length.toLocaleString("en-US")} custom IOCs in Falcon.`,
      details: { oneUptimeIocs: iocs.length },
    });
  } catch (error) {
    return makeCheck({
      key: BLOCK_CHECK_KEY,
      name: CROWDSTRIKE_BLOCK_CHECK_NAME,
      status: "fail",
      startedAtMs,
      message: errorText(error),
      remediation: CROWDSTRIKE_BLOCK_REMEDIATION,
    });
  }
}
