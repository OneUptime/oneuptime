import { JSONObject } from '../JSON';
import HTTPResponse from './HTTPResponse';

export default class HTTPErrorResponse extends HTTPResponse<JSONObject> {
    public get message(): string {
        if (!this.data) {
            return ''
        }

        if (!this.data["error"]) {
            return ''
        }
        return this.data["error"] as string;
    }    
}
