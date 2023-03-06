import { JSONObject } from "Common/Types/JSON";

export default class JsonWebToken {
    public static decode(token: string): JSONObject | null {

        if(token && token.includes(".")){
            return JSON.parse(window.atob(token.split('.')[1] as string));
        }

        return null;
    }
}