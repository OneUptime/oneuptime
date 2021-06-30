module.exports = async (populateArray, query) => {
    let result;
    for (let populateItem of populateArray) {
        result = await query.populate(populateItem.table, populateItem.field);
    }
    return result;
};
