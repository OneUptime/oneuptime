import AlertEpisodeMember, {
  AlertEpisodeMemberAddedBy,
} from "../../../Models/DatabaseModels/AlertEpisodeMember";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test, beforeEach } from "@jest/globals";

describe("AlertEpisodeMemberService", () => {
  const projectId: ObjectID = ObjectID.generate();
  const alertId: ObjectID = ObjectID.generate();
  const episodeId: ObjectID = ObjectID.generate();
  const memberId: ObjectID = ObjectID.generate();

  let mockMember: AlertEpisodeMember;
  let mockEpisode: AlertEpisode;

  beforeEach(() => {
    mockMember = new AlertEpisodeMember();
    mockMember._id = memberId.toString();
    mockMember.id = memberId;
    mockMember.projectId = projectId;
    mockMember.alertId = alertId;
    mockMember.alertEpisodeId = episodeId;
    mockMember.addedBy = AlertEpisodeMemberAddedBy.Rule;

    mockEpisode = new AlertEpisode();
    mockEpisode._id = episodeId.toString();
    mockEpisode.id = episodeId;
    mockEpisode.projectId = projectId;
    mockEpisode.title = "Test Episode";
  });

  describe("AlertEpisodeMember Model", () => {
    test("should create a new AlertEpisodeMember instance", () => {
      const member: AlertEpisodeMember = new AlertEpisodeMember();
      expect(member).toBeInstanceOf(AlertEpisodeMember);
    });

    test("should create AlertEpisodeMember with an ID", () => {
      const id: ObjectID = ObjectID.generate();
      const member: AlertEpisodeMember = new AlertEpisodeMember(id);
      expect(member.id).toEqual(id);
    });

    test("should set and get projectId correctly", () => {
      const member: AlertEpisodeMember = new AlertEpisodeMember();
      const projectId: ObjectID = ObjectID.generate();
      member.projectId = projectId;
      expect(member.projectId).toEqual(projectId);
    });

    test("should set and get alertId correctly", () => {
      const member: AlertEpisodeMember = new AlertEpisodeMember();
      const alertId: ObjectID = ObjectID.generate();
      member.alertId = alertId;
      expect(member.alertId).toEqual(alertId);
    });

    test("should set and get alertEpisodeId correctly", () => {
      const member: AlertEpisodeMember = new AlertEpisodeMember();
      const episodeId: ObjectID = ObjectID.generate();
      member.alertEpisodeId = episodeId;
      expect(member.alertEpisodeId).toEqual(episodeId);
    });

    test("should set addedBy to Rule", () => {
      const member: AlertEpisodeMember = new AlertEpisodeMember();
      member.addedBy = AlertEpisodeMemberAddedBy.Rule;
      expect(member.addedBy).toBe(AlertEpisodeMemberAddedBy.Rule);
    });

    test("should set addedBy to Manual", () => {
      const member: AlertEpisodeMember = new AlertEpisodeMember();
      member.addedBy = AlertEpisodeMemberAddedBy.Manual;
      expect(member.addedBy).toBe(AlertEpisodeMemberAddedBy.Manual);
    });

    test("should set addedBy to API", () => {
      const member: AlertEpisodeMember = new AlertEpisodeMember();
      member.addedBy = AlertEpisodeMemberAddedBy.API;
      expect(member.addedBy).toBe(AlertEpisodeMemberAddedBy.API);
    });

    test("should set and get matchedRuleId correctly", () => {
      const member: AlertEpisodeMember = new AlertEpisodeMember();
      const ruleId: ObjectID = ObjectID.generate();
      member.matchedRuleId = ruleId;
      expect(member.matchedRuleId).toEqual(ruleId);
    });
  });

  describe("AlertEpisodeMember with full data", () => {
    test("should handle complete member record", () => {
      const id: ObjectID = ObjectID.generate();
      const projectId: ObjectID = ObjectID.generate();
      const alertId: ObjectID = ObjectID.generate();
      const episodeId: ObjectID = ObjectID.generate();
      const ruleId: ObjectID = ObjectID.generate();

      const member: AlertEpisodeMember = new AlertEpisodeMember(id);
      member.projectId = projectId;
      member.alertId = alertId;
      member.alertEpisodeId = episodeId;
      member.addedBy = AlertEpisodeMemberAddedBy.Rule;
      member.matchedRuleId = ruleId;

      expect(member.id).toEqual(id);
      expect(member.projectId).toEqual(projectId);
      expect(member.alertId).toEqual(alertId);
      expect(member.alertEpisodeId).toEqual(episodeId);
      expect(member.addedBy).toBe(AlertEpisodeMemberAddedBy.Rule);
      expect(member.matchedRuleId).toEqual(ruleId);
    });

    test("should create member with minimal data", () => {
      const member: AlertEpisodeMember = new AlertEpisodeMember();
      const alertId: ObjectID = ObjectID.generate();
      const episodeId: ObjectID = ObjectID.generate();

      member.alertId = alertId;
      member.alertEpisodeId = episodeId;

      expect(member.alertId).toEqual(alertId);
      expect(member.alertEpisodeId).toEqual(episodeId);
      expect(member.matchedRuleId).toBeUndefined();
    });
  });

  describe("Multiple members", () => {
    test("should create distinct member instances", () => {
      const member1: AlertEpisodeMember = new AlertEpisodeMember();
      const member2: AlertEpisodeMember = new AlertEpisodeMember();

      const alertId1: ObjectID = ObjectID.generate();
      const alertId2: ObjectID = ObjectID.generate();

      member1.alertId = alertId1;
      member2.alertId = alertId2;

      expect(member1.alertId).toEqual(alertId1);
      expect(member2.alertId).toEqual(alertId2);
      expect(member1.alertId).not.toEqual(member2.alertId);
    });

    test("should allow same alert to be linked to different episodes (model level)", () => {
      /*
       * Note: The service layer enforces single-episode constraint,
       * but the model itself allows it
       */
      const alertId: ObjectID = ObjectID.generate();
      const episodeId1: ObjectID = ObjectID.generate();
      const episodeId2: ObjectID = ObjectID.generate();

      const member1: AlertEpisodeMember = new AlertEpisodeMember();
      member1.alertId = alertId;
      member1.alertEpisodeId = episodeId1;

      const member2: AlertEpisodeMember = new AlertEpisodeMember();
      member2.alertId = alertId;
      member2.alertEpisodeId = episodeId2;

      expect(member1.alertId).toEqual(member2.alertId);
      expect(member1.alertEpisodeId).not.toEqual(member2.alertEpisodeId);
    });

    test("should allow different alerts to be in same episode", () => {
      const episodeId: ObjectID = ObjectID.generate();
      const alertId1: ObjectID = ObjectID.generate();
      const alertId2: ObjectID = ObjectID.generate();

      const member1: AlertEpisodeMember = new AlertEpisodeMember();
      member1.alertId = alertId1;
      member1.alertEpisodeId = episodeId;

      const member2: AlertEpisodeMember = new AlertEpisodeMember();
      member2.alertId = alertId2;
      member2.alertEpisodeId = episodeId;

      expect(member1.alertEpisodeId).toEqual(member2.alertEpisodeId);
      expect(member1.alertId).not.toEqual(member2.alertId);
    });
  });

  describe("AddedBy enum values", () => {
    test("should have Rule value", () => {
      expect(AlertEpisodeMemberAddedBy.Rule).toBeDefined();
      expect(AlertEpisodeMemberAddedBy.Rule).toBe("rule");
    });

    test("should have Manual value", () => {
      expect(AlertEpisodeMemberAddedBy.Manual).toBeDefined();
      expect(AlertEpisodeMemberAddedBy.Manual).toBe("manual");
    });

    test("should have API value", () => {
      expect(AlertEpisodeMemberAddedBy.API).toBeDefined();
      expect(AlertEpisodeMemberAddedBy.API).toBe("api");
    });
  });
});
