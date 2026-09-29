import Team from "Common/Models/DatabaseModels/Team";
import User from "Common/Models/DatabaseModels/User";

export type ResourceOwnerEntry =
  | { kind: "user"; user: User }
  | { kind: "team"; team: Team };
