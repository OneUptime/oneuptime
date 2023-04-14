import BadDataException from '../Exception/BadDataException';
import IP from './IP';

export default class IPv4 extends IP {
    public constructor(ip: string) {

        super(ip);

        if(!this.isIPv4()){
            throw new BadDataException('IP is not a valid IPv4 address');
        }
    }
}
