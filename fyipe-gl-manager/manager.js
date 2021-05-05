'use strict';

const MFS = require('greenlock-manager-fs');

const Manager = module.exports;
Manager.create = function(opts) {
    const mfs = MFS.create(opts);
    const manager = {};

    //
    // REQUIRED (basic issuance)
    //
    if (mfs.get) {
        manager.get = async function({ servername, wildname }) {
            // (optional) `wildcard` may or may not exist
            // if *you* support wildcard domains, *you* should handle them
            return mfs.get({ servername, wildname });
        };
    } else {
        // (optional)
        // because the current version doesn't have get()
        manager.get = createGetFromFind();
    }

    //
    // REQUIRED (basic issuance)
    //
    manager.set = async function(opts) {
        return mfs.set(opts);
    };

    //
    // Optional (Fully Automatic Renewal)
    //
    manager.find = async function(opts) {
        // { subject, servernames, altnames, renewBefore }
        return mfs.find(opts);
    };

    //
    // Optional (Special Remove Functionality)
    // The default behavior is to set `deletedAt`
    //
    manager.remove = async function(opts) {
        return mfs.remove(opts);
    };

    //
    // Optional (special settings save)
    // Implemented here because this module IS the fallback
    //
    manager.defaults = async function(opts) {
        return mfs.defaults(opts);
    };

    //
    // Optional (for common deps and/or async initialization)
    //
    manager.init = async function(deps) {
        return mfs.init(deps);
    };

    return manager;

    //
    // IGNORE
    // Backwards compat for the first versions of greenlock-manager-fs
    //
    function createGetFromFind() {
        return async function({ servername, wildname }) {
            const servernames = [servername];
            if (wildname) {
                servernames.push(wildname);
            }
            return mfs
                .find({
                    servernames: servernames,
                    // because the original manager used altnames here
                    altnames: servernames,
                })
                .then(function(sites) {
                    return sites[0] || null;
                });
        };
    }
};
