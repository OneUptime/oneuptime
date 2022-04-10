"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RoleArray = void 0;
var Role;
(function (Role) {
    Role["Owner"] = "Owner";
    Role["Administrator"] = "Administrator";
    Role["Member"] = "Member";
    Role["Viewer"] = "Viewer";
})(Role || (Role = {}));
exports.RoleArray = [...new Set(Object.keys(Role))]; // returns ["Owner", "Administrator"...]
exports.default = Role;
