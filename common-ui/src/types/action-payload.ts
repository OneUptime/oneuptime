import { JSONValue } from 'common/types/json';

export default interface ActionPayload {
    [x: string]: JSONValue | Function;
}
