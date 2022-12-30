export type ReflectionMetadataType = {
    (target: Function): void;
    (target: Object, propertyKey: string | symbol): void;
};
