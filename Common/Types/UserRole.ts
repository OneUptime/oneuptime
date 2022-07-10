import { JSONObject } from './JSON';
import ObjectID from './ObjectID';
import Permission from './Permission';

export default class UserRole {
    public projectId!: ObjectID;
    public userId!: ObjectID;
    public permissions!: Array<Permission>;

    public constructor(projectId: ObjectID, userId: ObjectID, permissions: Array<Permission>) {
        this.projectId = projectId;
        this.userId = userId;
        this.permissions = permissions;
    }

    public toJSON(): JSONObject {
        return {
            userId: this.userId.toString(),
            projectId: this.projectId.toString(),
            permissions: this.permissions,
        };
    }

    public static fromJSON(data: JSONObject): UserRole {
        return new UserRole(
            new ObjectID(data['projectId'] as string),
            new ObjectID(data['userId'] as string),
            data['permission'] as Array<Permission>
        );
    }
}
