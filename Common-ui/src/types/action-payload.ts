import { JSONValue } from 'Common/Types/JSON';

export default interface ActionPayload {
    [x: string]: JSONValue | Function;
}
