import GenericFunction from "../GenericFunction";

export default () => {
  return (ctr: GenericFunction) => {
    ctr.prototype.enableMCP = true;
  };
};
