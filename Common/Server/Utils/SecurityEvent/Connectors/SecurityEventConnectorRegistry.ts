import BadDataException from "../../../../Types/Exception/BadDataException";
import SecurityEventConnectorProvider from "../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import { SecurityEventConnector } from "./Types";
import MicrosoftSentinelConnector from "./MicrosoftSentinel/MicrosoftSentinelConnector";
import MicrosoftDefenderXdrConnector from "./MicrosoftDefenderXdr/MicrosoftDefenderXdrConnector";
import CrowdStrikeFalconConnector from "./CrowdStrikeFalcon/CrowdStrikeFalconConnector";
import SplunkConnector from "./Splunk/SplunkConnector";
import ElasticSecurityConnector from "./ElasticSecurity/ElasticSecurityConnector";
import AwsSecurityHubConnector from "./AwsSecurityHub/AwsSecurityHubConnector";
import OktaConnector from "./Okta/OktaConnector";
import GoogleSecOpsConnector from "./GoogleSecOps/GoogleSecOpsConnector";

/*
 * One connector instance per provider. Connectors are stateless (every
 * call carries its own settings and opens its own HTTP session), so the
 * singletons are safe to share across requests and tenants.
 */
export default class SecurityEventConnectorRegistry {
  private static connectors: Array<SecurityEventConnector> = [
    new MicrosoftSentinelConnector(),
    new MicrosoftDefenderXdrConnector(),
    new CrowdStrikeFalconConnector(),
    new SplunkConnector(),
    new ElasticSecurityConnector(),
    new AwsSecurityHubConnector(),
    new OktaConnector(),
    new GoogleSecOpsConnector(),
  ];

  public static getConnector(
    provider: SecurityEventConnectorProvider | string | undefined,
  ): SecurityEventConnector {
    const connector: SecurityEventConnector | undefined = this.connectors.find(
      (candidate: SecurityEventConnector): boolean => {
        return candidate.provider === provider;
      },
    );

    if (!connector) {
      throw new BadDataException(
        `No connector is registered for security event provider: ${String(provider || "")}`,
      );
    }

    return connector;
  }

  public static getRegisteredProviders(): Array<SecurityEventConnectorProvider> {
    return this.connectors.map(
      (connector: SecurityEventConnector): SecurityEventConnectorProvider => {
        return connector.provider;
      },
    );
  }
}
