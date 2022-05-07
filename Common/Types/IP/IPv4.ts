import IP from './IP';

export default class IPv4 extends IP {
    public constructor(ip: string) {
        // TODO: Validate if this is actually ipv4 before calling super()
        super(ip);
    }

    public override isIPv4(): boolean {
        return true;
    }

    public override isIPv6(): boolean {
        return false;
    }
}
