import { JSONValue } from 'common/types/JSON';

export default interface ActionPayload {
    [x: string]: JSONValue | Function;
}
