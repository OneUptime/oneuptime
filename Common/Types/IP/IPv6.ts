import IP from './IP';

export default class IPv6 extends IP {
    public constructor(ip: string) {
        // TODO: Validate if this is actually ipv6 before calling super()
        super(ip);
    }

    public override isIPv4(): boolean {
        return false;
    }

    public override isIPv6(): boolean {
        return true;
    }
}
