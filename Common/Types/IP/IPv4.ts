import IP from './IP';

enum IPType {
    IPv4 = 'IPv4',
}

export default class IPv4 extends IP {
    public constructor(ip: string) {
        // TODO: Validate if this is actually ipv4 before calling super()
        super(ip, IPType.IPv4);
    }

    public override isIPv4(): boolean {
        if (IPv4.isValidIpv4(this.ip)) {
            return true;
        }
        return false;
    }

    public override isIPv6(): boolean {
        if (IPv4.isValidIpv6(this.ip)) {
            return true;
        }
        return false;
    }
}
