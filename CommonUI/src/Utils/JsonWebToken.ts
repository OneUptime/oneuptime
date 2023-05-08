import { JSONObject } from 'Common/Types/JSON';
import JSONFunctions from 'Common/Types/JSONFunctions';

export default class JsonWebToken {
    public static decode(token: string): JSONObject | null {
        if (token && token.includes('.')) {
            return JSONFunctions.parse(
                window.atob(token.split('.')[1] as string)
            );
        }

        return null;
    }
}
