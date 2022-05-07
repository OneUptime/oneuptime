import Hostname from 'Common/Types/API/Hostname';
import IPv4 from 'Common/Types/IP/IPv4';
import IPv6 from 'Common/Types/IP/IPv6';
import PositiveNumber from 'Common/Types/PositiveNumber';
import NotImplementedException from 'Common/Types/Exception/NotImplementedException';

export interface PingResponse {
    isAlive: boolean;
    responseTimeInMS: PositiveNumber;
}

export default class Ping {
    public static async fetch(
        _host: Hostname | IPv4 | IPv6
    ): Promise<PingResponse> {
        throw new NotImplementedException();
    }
}
