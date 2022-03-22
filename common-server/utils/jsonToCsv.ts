import { JSONArray } from 'common/types/json';

import Json2Csv from 'json2csv';

export default {
    ToCsv: (json: JSONArray) => {
        if (json.length === 0) {
            throw new Error(
                'Cannot convert to CSV when the object length is 0'
            );
        }
        const fields = Object.keys(json[0] || {});
        const opts = { fields };
        const parser = new Json2Csv.Parser(opts);
        return parser.parse(json);
    },
};
