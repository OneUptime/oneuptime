// import axios from 'axios';

// class API {
//     static getHeaders: () => {
//         return {
//     'Access-Control-Allow-Origin': '*',
//     Accept: 'application/json',
//     'Content-Type': 'application/json;charset=UTF-8',
//     clusterKey: config.clusterKey,
// };
//     }

// deleteApi: (url: string, data: $TSFixMe) => {
//     const headers = _this.getHeaders();
//     return new Promise((resolve, reject) => {
//         axios({
//             method: 'DELETE',
//             url: `${config.serverUrl}/${url}`,
//             headers,
//             data,
//         })
//             .then(response => {
//                 resolve(response.data);
//             })
//             .then(error => {
//                 if (error && error.response && error.response.data)
//                     error = error.response.data;
//                 if (error && error.data) {
//                     error = error.data;
//                 }
//                 reject(error);
//             });
//     });
// }

// export default _this;
