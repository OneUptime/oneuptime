const axios = require('axios');
const { apiUrl } = require('./config');

const postApi = (url, data) => {

  axios({
    method: 'POST',
    url: `${apiUrl}/${url}`,
    data: data
  })
  .then(function (res) {
    return res
  })
  .catch(function (error) {
    console.error(error)
  });
}

// Testing the getAPI
const getApi = (url) => {
  axios({
    method: 'GET',
    url: `${apiUrl}/${url}`
  })
  .then(function (res) {
    if (res.data === 'Server Error.') console.log('success')
  })
  .catch(function (error) {
    console.error(error)
  });
}

module.exports = { 
  postApi,
  getApi
}
