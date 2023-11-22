import Hostname from 'Common/Types/API/Hostname';
import NotImplementedException from 'Common/Types/Exception/NotImplementedException';
// import https from 'https';
// import { parse } from 'url';

export interface SslResponse {
    isSelfSigned: boolean;
    createdAt: Date;
    expiresAt: Date;
    commonName: string;
    organizationalUnit: string;
    organization: string;
    locality: string;
    state: string;
    country: string;
    serialNumber: string;
    fingerprint: string;
    fingerprint256: string;
    fingerprint512: string;
}

export default class SSL {
    public static async fetch(_host: Hostname): Promise<SslResponse> {
        throw new NotImplementedException();
    }
}


// function checkCertificate(url) {
//     const options = {
//         host: parse(url).hostname,
//         port: 443,
//         method: 'GET',
//         agent: new https.Agent({  
//             rejectUnauthorized: false
//         })
//     };

//     const req = https.request(options, res => {
//         const certificate = res.connection.getPeerCertificate();
        
//         if (certificate.valid_to) {
//             const validTo = new Date(certificate.valid_to);
//             const diffDays = Math.ceil(Math.abs(validTo - new Date()) / (1000 * 60 * 60 * 24));
//             if (diffDays < 45) {
//                 console.log(`The SSL certificate for ${url} expires in less than 45 days.`);
//             }
//         }
//     });

//     req.on('error', error => {
//         console.error(error);
//     });

//     req.end();
// }

