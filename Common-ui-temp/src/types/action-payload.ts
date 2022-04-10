import { JSONValue } from 'common/Types/JSON';

export default interface ActionPayload {
    [x: string]: JSONValue | Function;
}
