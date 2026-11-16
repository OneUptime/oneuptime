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
   * the session (Types/AuditLog/AuditLogSessionEvent). A private status
   * page's readers' sessions are filed in that status page's project only
   * (issue #6790, Types/AuditLog/AuditLogStatusPageSession).
   */
  SignIn = "SignIn",
  /*
   * A sign-in to an existing account that failed (issue #6788): a wrong
   * password or second factor, a blocked or unverified account, a single
   * sign-on OneUptime refused. Filed like a sign-in, in every project the
   * account's person is a member of, and only a few an hour for one
   * account (Types/AuditLog/AuditLogSignInFailure).
   */
  SignInFailed = "SignInFailed",
  SignOut = "SignOut",
  SessionTimeout = "SessionTimeout",
  SessionRevoked = "SessionRevoked",
}

export default AuditLogAction;
