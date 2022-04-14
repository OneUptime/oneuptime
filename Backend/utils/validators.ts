const ObjectID = require('mongoose').mongo.ObjectID;

export const isValidId: Function = (value: $TSFixMe): boolean => {
    return value instanceof ObjectID;
};
