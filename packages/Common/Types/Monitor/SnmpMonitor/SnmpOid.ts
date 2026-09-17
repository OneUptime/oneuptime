export default interface SnmpOid {
  oid: string;
  name?: string | undefined;
  description?: string | undefined;
}

export class SnmpOidTemplates {
  public static getCommonOids(): Array<SnmpOid> {
    return [
      // System MIB
      {
        oid: "1.3.6.1.2.1.1.1.0",
        name: "sysDescr",
        description: "System Description",
      },
      {
        oid: "1.3.6.1.2.1.1.3.0",
        name: "sysUpTime",
        description: "System Uptime (in ticks)",
      },
      {
        oid: "1.3.6.1.2.1.1.5.0",
        name: "sysName",
        description: "System Name",
      },
      {
        oid: "1.3.6.1.2.1.1.6.0",
        name: "sysLocation",
        description: "System Location",
      },
      {
        oid: "1.3.6.1.2.1.1.4.0",
        name: "sysContact",
        description: "System Contact",
      },
      // Interface MIB
      {
        oid: "1.3.6.1.2.1.2.1.0",
        name: "ifNumber",
        description: "Number of Network Interfaces",
      },
      // Host Resources MIB
      {
        oid: "1.3.6.1.2.1.25.1.1.0",
        name: "hrSystemUptime",
        description: "Host System Uptime",
      },
      {
        oid: "1.3.6.1.2.1.25.1.5.0",
        name: "hrSystemNumUsers",
        description: "Number of Users",
      },
      {
        oid: "1.3.6.1.2.1.25.1.6.0",
        name: "hrSystemProcesses",
        description: "Number of Running Processes",
      },
    ];
  }
}
