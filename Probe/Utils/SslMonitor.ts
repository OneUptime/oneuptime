import type Hostname from 'Common/Types/API/Hostname';
import NotImplementedException from 'Common/Types/Exception/NotImplementedException';

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
