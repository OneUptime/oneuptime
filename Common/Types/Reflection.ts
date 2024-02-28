import GenericFunction from './GenericFunction';
import GenericObject from './GenericObject';

export type ReflectionMetadataType = {
    (target: GenericFunction): void;
    (target: GenericObject, propertyKey: string | symbol): void;
};
