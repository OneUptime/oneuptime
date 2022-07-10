import Permission from "../../Permission";

interface AccessControl {
    read: Array<Permission>;
    create: Array<Permission>;
    delete: Array<Permission>;
    update: Array<Permission>;
}

export default AccessControl;