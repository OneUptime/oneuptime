import { JSONArray, JSONObject } from 'Common/Types/JSON';

import Json2Csv from 'json2csv';

export default {
    ToCsv: (json: JSONArray): string => {
        if (json.length === 0) {
            throw new Error(
                'Cannot convert to CSV when the object length is 0'
            );
        }
        const fields: Array<string> = Object.keys(json[0] || {});
        const opts: JSONObject = { fields };
        const parser: Json2Csv.Parser<JSONArray> = new Json2Csv.Parser(opts);
        return parser.parse(json);
    },
};
