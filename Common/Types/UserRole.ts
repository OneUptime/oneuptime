import { JSONObject } from "./JSON";
import ObjectID from "./ObjectID";
import Role from "./Role";

export default class UserRole {
    
    public projectId!: ObjectID;
    public userId!: ObjectID;
    public role!: Role;

    public constructor(projectId: ObjectID, userId: ObjectID, role: Role) {
        this.projectId = projectId;
        this.userId = userId;
        this.role = role;
    }

    public toJSON(): JSONObject {
        return {
            "userId": this.userId.toString(),
            "projectId": this.projectId.toString(),
            "role": this.role
        }
    }

    public static fromJSON(data: JSONObject): UserRole{
        return new UserRole(
            new ObjectID(data["projectId"] as string),
            new ObjectID(data["userId"] as string),
            data["role"] as Role
        )
    }
}