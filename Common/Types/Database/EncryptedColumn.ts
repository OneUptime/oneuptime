import 'reflect-metadata';
import BaseModel from '../../Models/BaseModel';
import { ReflectionMetadataType } from '../Reflection';
import Columns from './Columns';

const encryptedColumnSymbol: Symbol = Symbol('EncryptedColumn');

export default (): ReflectionMetadataType => {
    return Reflect.metadata(encryptedColumnSymbol, true);
};

export const isEncryptedColumn: Function = (
    target: BaseModel,
    propertyKey: string
): boolean => {
    return Reflect.getMetadata(
        encryptedColumnSymbol,
        target,
        propertyKey
    ) as boolean;
};

export const getEncryptedColumns: Function = <T extends BaseModel>(
    target: T
): Columns => {
    const keys: Array<string> = Object.keys(target);
    const columns: Array<string> = [];

    for (const key of keys) {
        if (Reflect.getMetadata(encryptedColumnSymbol, target, key)) {
            columns.push(key);
        }
    }

    return new Columns(columns);
};
