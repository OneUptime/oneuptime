const axios = require('axios');
const { apiUrl } = require('./config');

const postApi = (url, data, apiKey) => {
  return axios({
    method: 'POST',
    url: `${apiUrl}/${url}`,
    headers: { apiKey },
    data
  })
    .then(({ status, data }) => status === 200 ? data : null);
};

// Testing the getAPI
const getApi = (url, apiKey) => {
  return axios({
    method: 'GET',
    url: `${apiUrl}/${url}`,
    headers: { apiKey }
  })
    .then(({ status, data }) => status === 200 ? data : null);
};

module.exports = {
  postApi,
  getApi
};
