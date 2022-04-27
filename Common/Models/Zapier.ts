import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
/**
 * Represents the Zapier Schema in the database.
 * @let {object} zapierSchema
 * @property {string} project - The `ID` of the project the incident is created on.
 * @property {string} url - The zapier hook that the oneuptime server pings with new incidents.
 * @property {string} type - The name of trigger that receives the incident object.
 * @property {number} counter - The number of incidents send to the zapier `url`.
 *
 */
export default interface Model extends BaseModel{
    project: string,
    url: URL,
    type: string,
    monitors: [String],
    deleted: boolean,
}








