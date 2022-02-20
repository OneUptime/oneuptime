const ObjectID = require('mongoose').mongo.ObjectID;

export const isValidId = value => value instanceof ObjectID;
