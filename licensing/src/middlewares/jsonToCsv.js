/**
 *
 * Copyright HackerBay, Inc.
 *
 */
const replacer = (key, value) => (value === null ? '' : value); // specify how you want to handle null values here

module.exports = {
    ToCsv: json => {
        return new Promise((resolve, reject) => {
            try {
                if (json.length > 0) {
                    const header = Object.keys(json[0]);
                    let csv = json.map(row =>
                        header
                            .map(fieldName =>
                                JSON.stringify(row[fieldName], replacer)
                            )
                            .join(',')
                    );
                    csv.unshift(header.join(','));
                    csv = csv.join('\r\n');
                    resolve(csv);
                } else {
                    resolve('');
                }
            } catch (error) {
                reject(error);
            }
        });
    },
};
