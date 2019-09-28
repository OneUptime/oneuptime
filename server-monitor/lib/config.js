// get the projectId and api Key and monitor name and send to backend to authenticate
// connect to a route at the backend to validate api and projectId
// update serverStat model based on the projectId

const apiUrl = process.env.API_URL || 'http://localhost:3002';

module.exports = { apiUrl };
