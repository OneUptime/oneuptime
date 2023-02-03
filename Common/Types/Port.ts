import type { FindOperator } from 'typeorm/find-options/FindOperator';
import DatabaseProperty from './Database/DatabaseProperty';
import BadDataException from './Exception/BadDataException';
import PositiveNumber from './PositiveNumber';
import Typeof from './Typeof';

export default class Port extends DatabaseProperty {
    private _port: PositiveNumber = new PositiveNumber(0);

    public get port(): PositiveNumber {
        return this._port;
    }
    public set port(value: PositiveNumber) {
        if (Port.isValid(value)) {
            this._port = value;
        } else {
            throw new BadDataException('Port is not in valid format.');
        }
    }

    public static isValid(port: number | string | PositiveNumber): boolean {
        if (typeof port === Typeof.String) {
            try {
                port = Number.parseInt(port.toString(), 10);
            } catch (error) {
                return false;
            }
        }

        if (port instanceof PositiveNumber) {
            port = port.toNumber();
        }

        if (port >= 0 && port <= 65535) {
            return true;
        }
        return false;
    }

    public constructor(port: number | string) {
        super();
        this.port = new PositiveNumber(port);
    }

    public static override toDatabase(
        value: Port | FindOperator<Port>
    ): number | null {
        if (value instanceof Port) {
            return value.toNumber();
        } else if (typeof value === 'string') {
            return parseInt(value);
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
