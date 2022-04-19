"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DBRef = exports.isDBRefLike = void 0;
var utils_1 = require("./parser/utils");
/** @internal */
function isDBRefLike(value) {
    return (utils_1.isObjectLike(value) &&
        value.$id != null &&
        typeof value.$ref === 'string' &&
        (value.$db == null || typeof value.$db === 'string'));
}
exports.isDBRefLike = isDBRefLike;
/**
 * A class representation of the BSON DBRef type.
 * @public
 */
var DBRef = /** @class */ (function () {
    /**
     * @param collection - the collection name.
     * @param oid - the reference ObjectId.
     * @param db - optional db name, if omitted the reference is local to the current db.
     */
    function DBRef(collection, oid, db, fields) {
        if (!(this instanceof DBRef))
            return new DBRef(collection, oid, db, fields);
        // check if namespace has been provided
        var parts = collection.split('.');
        if (parts.length === 2) {
            db = parts.shift();
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            collection = parts.shift();
        }
        this.collection = collection;
        this.oid = oid;
        this.db = db;
        this.fields = fields || {};
    }
    Object.defineProperty(DBRef.prototype, "namespace", {
        // Property provided for compatibility with the 1.x parser
        // the 1.x parser used a "namespace" property, while 4.x uses "collection"
        /** @internal */
        get: function () {
            return this.collection;
        },
        set: function (value) {
            this.collection = value;
        },
        enumerable: false,
        configurable: true
    });
    DBRef.prototype.toJSON = function () {
        var o = Object.assign({
            $ref: this.collection,
            $id: this.oid
        }, this.fields);
        if (this.db != null)
            o.$db = this.db;
        return o;
    };
    /** @internal */
    DBRef.prototype.toExtendedJSON = function (options) {
        options = options || {};
        var o = {
            $ref: this.collection,
            $id: this.oid
        };
        if (options.legacy) {
            return o;
        }
        if (this.db)
            o.$db = this.db;
        o = Object.assign(o, this.fields);
        return o;
    };
    /** @internal */
    DBRef.fromExtendedJSON = function (doc) {
        var copy = Object.assign({}, doc);
        delete copy.$ref;
        delete copy.$id;
        delete copy.$db;
        return new DBRef(doc.$ref, doc.$id, doc.$db, copy);
    };
    /** @internal */
    DBRef.prototype[Symbol.for('nodejs.util.inspect.custom')] = function () {
        return this.inspect();
    };
    DBRef.prototype.inspect = function () {
        // NOTE: if OID is an ObjectId class it will just print the oid string.
        var oid = this.oid === undefined || this.oid.toString === undefined ? this.oid : this.oid.toString();
        return "new DBRef(\"" + this.namespace + "\", new ObjectId(\"" + oid + "\")" + (this.db ? ", \"" + this.db + "\"" : '') + ")";
    };
    return DBRef;
}());
exports.DBRef = DBRef;
Object.defineProperty(DBRef.prototype, '_bsontype', { value: 'DBRef' });
//# sourceMappingURL=db_ref.js.map