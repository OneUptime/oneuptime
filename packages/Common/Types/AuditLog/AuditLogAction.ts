enum AuditLogAction {
  Create = "Create",
  Update = "Update",
  Delete = "Delete",
  /*
   * Someone took a copy of something sensitive out of OneUptime: a packet
   * capture's pcap file. Nothing changed, but who has the traffic matters.
   */
  Download = "Download",
}

export default AuditLogAction;
