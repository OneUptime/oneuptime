export default (singularName: string, pluralName: string) => {
    return (ctr: Function) => {
        ctr.prototype.singularName = singularName;
        ctr.prototype.pluralName = pluralName;
    };
};
