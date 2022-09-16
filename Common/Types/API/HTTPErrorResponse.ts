import { JSONObject } from '../JSON';
import Typeof from '../Typeof';
import HTTPResponse from './HTTPResponse';

export default class HTTPErrorResponse extends HTTPResponse<JSONObject> {
    public get message(): string {
        if (!this.data) {
            return '';
        }

        if (!this.data['error']) {
            return '';
        }

        if (this.data['data'] && Typeof.String === this.data['data']) {
            return this.data['data'] as string;
        }

        return this.data['error'] as string;
    }
}
