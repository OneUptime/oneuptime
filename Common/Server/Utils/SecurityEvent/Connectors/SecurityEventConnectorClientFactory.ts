import SecurityEventConnection from "../../../../Models/DatabaseModels/SecurityEventConnection";
import SecurityEventConnectorType from "../../../../Types/SecurityEvent/SecurityEventConnectorType";
import BadDataException from "../../../../Types/Exception/BadDataException";
import AwsSecurityHubClient from "./AwsSecurityHubClient";
import CloudflareSecurityEventClient from "./CloudflareSecurityEventClient";
import CrowdStrikeFalconClient from "./CrowdStrikeFalconClient";
import GoogleSecurityCommandCenterClient from "./GoogleSecurityCommandCenterClient";
import MicrosoftGraphSecurityClient from "./MicrosoftGraphSecurityClient";
import OktaSystemLogClient from "./OktaSystemLogClient";
import SplunkEnterpriseSecurityClient from "./SplunkEnterpriseSecurityClient";
import {
  SecurityEventConnectorClient,
  SecurityEventConnectorHttpRequest,
} from "./Types";

export default class SecurityEventConnectorClientFactory {
  public static create(
    connection: SecurityEventConnection,
    request?: SecurityEventConnectorHttpRequest | undefined,
  ): SecurityEventConnectorClient {
    switch (connection.provider) {
      case SecurityEventConnectorType.AwsSecurityHub:
        return new AwsSecurityHubClient(connection, request);
      case SecurityEventConnectorType.MicrosoftDefender:
        return new MicrosoftGraphSecurityClient(connection, request);
      case SecurityEventConnectorType.Cloudflare:
        return new CloudflareSecurityEventClient(connection, request);
      case SecurityEventConnectorType.CrowdStrikeFalcon:
        return new CrowdStrikeFalconClient(connection, request);
      case SecurityEventConnectorType.GoogleSecurityCommandCenter:
        return new GoogleSecurityCommandCenterClient(connection, request);
      case SecurityEventConnectorType.Okta:
        return new OktaSystemLogClient(connection, request);
      case SecurityEventConnectorType.SplunkEnterpriseSecurity:
        return new SplunkEnterpriseSecurityClient(connection, request);
      default:
        throw new BadDataException(
          "The security event connection provider is not supported.",
        );
    }
  }
}
