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
  /*
   * The SNMPv3 context the requests name (contextName). Empty, the agent's
   * default context. A switch with Virtual Fabrics answers each logical
   * switch only in its own context ("VF:128" on Brocade Fabric OS), so a
   * device with one is polled as that logical switch.
   */
  contextName?: string | undefined;
}
