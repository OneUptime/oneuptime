import { FindOperator } from 'typeorm/find-options/FindOperator';
import DatabaseProperty from './Database/DatabaseProperty';
import BadDataException from './Exception/BadDataException';
import PositiveNumber from './PositiveNumber';
import Typeof from './Typeof';

export default class Port extends DatabaseProperty {
    private _port: PositiveNumber = new PositiveNumber(0);
    public get port(): PositiveNumber {
        return this._port;
    }
    public set port(v: PositiveNumber) {
        this._port = v;
    }

    public constructor(port: number | string) {
        super();
        if (typeof port === Typeof.String) {
            try {
                port = Number.parseInt(port.toString(), 10);
            } catch (error) {
                throw new BadDataException(`Invalid port: ${port}`);
            }
        }

        if (port >= 0 && port <= 65535) {
            this.port = new PositiveNumber(port);
        } else {
            throw new BadDataException(
                'Port should be in the range from 0 to 65535'
            );
        }
    }

    public static override toDatabase(
        value: Port | FindOperator<Port>
    ): number | null {
        
        if (value instanceof Port) {
            return value.toNumber();
        } else if (typeof value === "string") {
            return parseInt(value)
        }

        return null;
    }

    public static override fromDatabase(_value: string | number): Port | null {
        if (_value) {
            return new Port(_value);
        }

        return null;
    }

    public override toString(): string {
        return this.port.toString();
    }

    public toNumber(): number {
        return this.port.toNumber();
    }
}
