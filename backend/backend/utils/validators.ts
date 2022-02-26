const ObjectID = require('mongoose').mongo.ObjectID;

export const isValidId = (value: $TSFixMe) => value instanceof ObjectID;
