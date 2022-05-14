import { checkIfIPisV4, checkIfIPisV6 } from '../../Tests/Types/IP/lib/helper';
import BadDataException from '../Exception/BadDataException';
import IP from './IP';

export default class IPv6 extends IP {
    public constructor(ip: string) {
        // TODO: Validate if this is actually ipv6 before calling super()
        super(ip);
    }

    public override isIPv4(): boolean {
        if (checkIfIPisV4(this.ip)) {
            return true;
        }
        throw new BadDataException('This IP address is not valid IPv4');
    }

    public override isIPv6(): boolean {
        if (checkIfIPisV6(this.ip)) {
            return true;
        }
        throw new BadDataException('This IP address is not valid IPv6');
    }
}
