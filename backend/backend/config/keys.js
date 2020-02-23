/**
 *
 * Copyright HackerBay, Inc.
 *
 */

module.exports = {
    jwtSecretKey: process.env['JWT_SECRET'],
    dbURL: process.env['MONGO_URL'],
    redisURL: process.env['REDIS_HOST'],
    airtableApiKey: process.env['AIRTABLE_API_KEY'],
    airtableBaseId: process.env['AIRTABLE_BASE_ID']
};

