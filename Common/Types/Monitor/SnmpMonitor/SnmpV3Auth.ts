import SnmpAuthProtocol from "./SnmpAuthProtocol";
import SnmpPrivProtocol from "./SnmpPrivProtocol";
import SnmpSecurityLevel from "./SnmpSecurityLevel";

export default interface SnmpV3Auth {
  securityLevel: SnmpSecurityLevel;
  username: string;
  authProtocol?: SnmpAuthProtocol | undefined;
  authKey?: string | undefined;
  privProtocol?: SnmpPrivProtocol | undefined;
  privKey?: string | undefined;
}
