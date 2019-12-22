/**
 *
 * Copyright HackerBay, Inc.
 *
 */

module.exports = {
    jwtSecretKey: process.env['JWT_SECRET'] || 'idfn39847392879483',
    dbURL: process.env['MONGO_URL'] || 'mongodb://localhost/fyipedb',
    redisURL: process.env['REDIS_URL'] || 'redis://redis',
    clusterKey: process.env['CLUSTER_KEY'] || '33b674ca-9fdd-11e9-a2a3-2a2ae2dbcce4',
    airtableApiKey: process.env['AIRTABLE_API_KEY'] || 'keymeYVqxhbdFHsAa',
    airtableBaseId: process.env['AIRTABLE_BASE_ID'] || 'appgek0ngJaHhppeJ'
};

