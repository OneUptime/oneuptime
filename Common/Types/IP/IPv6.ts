import IP from './IP';
import { IPType } from '../../Tests/Types/IP/IPType';

export default class IPv6 extends IP {
    public constructor(ip: string) {
        // TODO: Validate if this is actually ipv6 before calling super()
        super(ip, IPType.IPv6);
    }
}
