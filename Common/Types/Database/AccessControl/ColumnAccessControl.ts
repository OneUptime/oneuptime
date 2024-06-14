import BaseModel from '../../../Models/BaseModel';
import { ColumnAccessControl } from '../../BaseDatabase/AccessControl';
import Dictionary from '../../Dictionary';
import { ReflectionMetadataType } from '../../Reflection';
import 'reflect-metadata';

const accessControlSymbol: symbol = Symbol('ColumnAccessControl');

export default (accessControl: ColumnAccessControl): ReflectionMetadataType => {
    return Reflect.metadata(accessControlSymbol, accessControl);
};

type GetColumnAccessControlFunction = (
    target: BaseModel,
    propertyKey: string
) => ColumnAccessControl;

export const getColumnAccessControl: GetColumnAccessControlFunction = (
    target: BaseModel,
    propertyKey: string
): ColumnAccessControl => {
    return Reflect.getMetadata(
        accessControlSymbol,
        target,
        propertyKey
    ) as ColumnAccessControl;
};

type GetColumnAccessControlForAllColumnsFunction = <T extends BaseModel>(
    target: T
) => Dictionary<ColumnAccessControl>;

export const getColumnAccessControlForAllColumns: GetColumnAccessControlForAllColumnsFunction =
    <T extends BaseModel>(target: T): Dictionary<ColumnAccessControl> => {
        const dictonary: Dictionary<ColumnAccessControl> = {};
        const keys: Array<string> = Object.keys(target);

        for (const key of keys) {
            if (Reflect.getMetadata(accessControlSymbol, target, key)) {
                dictonary[key] = Reflect.getMetadata(
                    accessControlSymbol,
                    target,
                    key
                ) as ColumnAccessControl;
            }
        }

        return dictonary;
    };
