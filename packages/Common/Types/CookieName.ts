enum CookieName {
  UserID = "user-id",
  Email = "user-email",
  Token = "user-token",
  RefreshToken = "user-refresh-token",
  GlobalSSOToken = "global-sso-token",
  Name = "user-name",
  Timezone = "user-timezone",
  IsMasterAdmin = "user-is-master-admin",
  ProfilePicID = "user-profile-pic-id",
  StatusPageMasterPassword = "status-page-master-password",
  DashboardMasterPassword = "dashboard-master-password",
  /*
   * A dashboard private user's session on one dashboard's public link
   * (CookieUtil.setDashboardPrivateUserCookie), each followed by the
   * dashboard's id: its access token, its refresh token, and the cookie
   * that names it for its sign-out.
   */
  DashboardPrivateUserToken = "dashboard-private-user-token",
  DashboardPrivateUserRefreshToken = "dashboard-private-user-refresh-token",
  DashboardPrivateUserSignOut = "dashboard-private-user-sign-out",
}

export default CookieName;
