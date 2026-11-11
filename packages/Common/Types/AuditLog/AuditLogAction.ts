enum AuditLogAction {
  Create = "Create",
  Update = "Update",
  Delete = "Delete",
  /*
   * Someone took a copy of something sensitive out of OneUptime: a packet
   * capture's pcap file. Nothing changed, but who has the traffic matters.
   */
  Download = "Download",
  /*
   * A person's sessions (issue #6762): who signed in to OneUptime, how and
   * from where, and how each session ended - signed out, timed out, or
   * revoked because the password changed or the account was blocked. Each
   * is filed in every project its person is a member of, as an entry about
   * the session (Types/AuditLog/AuditLogSessionEvent).
   */
  SignIn = "SignIn",
  SignOut = "SignOut",
  SessionTimeout = "SessionTimeout",
  SessionRevoked = "SessionRevoked",
}

export default AuditLogAction;
