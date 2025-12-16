import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test, beforeEach } from "@jest/globals";

describe("TeamMember Model", () => {
  let teamMember: TeamMember;

  beforeEach(() => {
    teamMember = new TeamMember();
  });

  describe("constructor", () => {
    test("should create a new TeamMember instance", () => {
      expect(teamMember).toBeInstanceOf(TeamMember);
    });

    test("should create TeamMember with an ID", () => {
      const id: ObjectID = ObjectID.generate();
      const memberWithId: TeamMember = new TeamMember(id);
      expect(memberWithId.id).toEqual(id);
    });
  });

  describe("userId property", () => {
    test("should set and get userId correctly", () => {
      const userId: ObjectID = ObjectID.generate();
      teamMember.userId = userId;
      expect(teamMember.userId).toEqual(userId);
    });
  });

  describe("teamId property", () => {
    test("should set and get teamId correctly", () => {
      const teamId: ObjectID = ObjectID.generate();
      teamMember.teamId = teamId;
      expect(teamMember.teamId).toEqual(teamId);
    });
  });

  describe("projectId property", () => {
    test("should set and get projectId correctly", () => {
      const projectId: ObjectID = ObjectID.generate();
      teamMember.projectId = projectId;
      expect(teamMember.projectId).toEqual(projectId);
    });
  });

  describe("hasAcceptedInvitation property", () => {
    test("should default to false or undefined", () => {
      expect(teamMember.hasAcceptedInvitation).toBeFalsy();
    });

    test("should set hasAcceptedInvitation to true", () => {
      teamMember.hasAcceptedInvitation = true;
      expect(teamMember.hasAcceptedInvitation).toBe(true);
    });

    test("should set hasAcceptedInvitation to false explicitly", () => {
      teamMember.hasAcceptedInvitation = false;
      expect(teamMember.hasAcceptedInvitation).toBe(false);
    });
  });

  describe("TeamMember with full data", () => {
    test("should handle complete team member record", () => {
      const id: ObjectID = ObjectID.generate();
      const userId: ObjectID = ObjectID.generate();
      const teamId: ObjectID = ObjectID.generate();
      const projectId: ObjectID = ObjectID.generate();

      const fullMember: TeamMember = new TeamMember(id);
      fullMember.userId = userId;
      fullMember.teamId = teamId;
      fullMember.projectId = projectId;
      fullMember.hasAcceptedInvitation = true;

      expect(fullMember.id).toEqual(id);
      expect(fullMember.userId).toEqual(userId);
      expect(fullMember.teamId).toEqual(teamId);
      expect(fullMember.projectId).toEqual(projectId);
      expect(fullMember.hasAcceptedInvitation).toBe(true);
    });

    test("should create team member with minimal data", () => {
      const minMember: TeamMember = new TeamMember();
      const userId: ObjectID = ObjectID.generate();
      minMember.userId = userId;

      expect(minMember.userId).toEqual(userId);
      expect(minMember.teamId).toBeUndefined();
      expect(minMember.hasAcceptedInvitation).toBeFalsy();
    });
  });

  describe("Multiple team members", () => {
    test("should create distinct team member instances", () => {
      const member1: TeamMember = new TeamMember();
      const member2: TeamMember = new TeamMember();

      const userId1: ObjectID = ObjectID.generate();
      const userId2: ObjectID = ObjectID.generate();

      member1.userId = userId1;
      member2.userId = userId2;

      expect(member1.userId).toEqual(userId1);
      expect(member2.userId).toEqual(userId2);
      expect(member1.userId).not.toEqual(member2.userId);
    });

    test("should allow same user in different teams", () => {
      const userId: ObjectID = ObjectID.generate();
      const teamId1: ObjectID = ObjectID.generate();
      const teamId2: ObjectID = ObjectID.generate();

      const member1: TeamMember = new TeamMember();
      member1.userId = userId;
      member1.teamId = teamId1;

      const member2: TeamMember = new TeamMember();
      member2.userId = userId;
      member2.teamId = teamId2;

      expect(member1.userId).toEqual(member2.userId);
      expect(member1.teamId).not.toEqual(member2.teamId);
    });
  });
});
