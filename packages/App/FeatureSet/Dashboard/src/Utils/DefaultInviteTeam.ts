/*
 * The team adding someone to a project starts on - the project's members
 * team, when the person may hand it on.
 *
 * The rule lives in Common (Common/UI/Utils/DefaultInviteTeam), because the
 * Admin Dashboard adds people to projects too and starts on the same team.
 * This module keeps the Dashboard's own import path for it: Invite User and
 * the SSO and SCIM provider forms read it from here, and their tests replace
 * the lookup by mocking this path.
 */
export * from "Common/UI/Utils/DefaultInviteTeam";
