module.exports = {

    excludeDefault: ['deleted', 'deletedAt', 'deletedById', '__v'],
    
    mapToMongodbProjectionDocument: exclude =>
        exclude.reduce((fields, key) => {
            fields[key] = 0;
            return fields;
        }, {})
        
};