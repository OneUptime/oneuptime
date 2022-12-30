import IP from './IP';
import IPType from './IPType';

export default class IPv4 extends IP {
    public constructor(ip: string) {
        // TODO: Validate if this is actually ipv4 before calling super()
        super(ip, IPType.IPv4);
    }
}
