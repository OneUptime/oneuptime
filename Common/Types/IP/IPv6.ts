import IP from './IP';

enum IPType {
    IPv6 = 'IPv6',
}

export default class IPv6 extends IP {
    public constructor(ip: string) {
        // TODO: Validate if this is actually ipv6 before calling super()
        super(ip, IPType.IPv6);
    }

    public override isIPv4(): boolean {
        if (IPv6.isValidIpv4(this.ip)) {
            return true;
        }
        return false;
    }

    public override isIPv6(): boolean {
        if (IPv6.isValidIpv6(this.ip)) {
            return true;
        }
        return false;
    }
}
