export default () => {
    return (ctr: Function) => {
        ctr.prototype.enableDocumentation = true;
    };
};
