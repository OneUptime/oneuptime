import { READINESS_METHOD_TYPE_PUSH } from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/Readiness/ReadinessTypes";
import { ReadinessMethodType } from "../../../Server/Services/OnCallReadinessService";
import { describe, expect, test } from "@jest/globals";

/*
 * A push device that is not verified stopped receiving notifications (its
 * push service, or Expo, said it was gone): the readiness surfaces and the
 * admin's list of a member's methods label it "Not receiving notifications"
 * and "Waiting for Jane to register it again" by its methodType. That value
 * is the server's ReadinessMethodType.Push; were the two to differ, every
 * push device would quietly go back to "Unverified" and "Waiting for Jane to
 * verify". The constant is typed as the server's value, so a rename also
 * fails to compile.
 */
describe("the methodType a push device is listed under", () => {
  test("is the server's ReadinessMethodType.Push", () => {
    expect(READINESS_METHOD_TYPE_PUSH).toBe(ReadinessMethodType.Push);
    expect(READINESS_METHOD_TYPE_PUSH).toBe("Push");
  });
});
