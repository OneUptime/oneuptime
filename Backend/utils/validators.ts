const ObjectID = require('mongoose').mongo.ObjectID;

export const isValidId = (value: $TSFixMe): boolean => { return value instanceof ObjectID };
