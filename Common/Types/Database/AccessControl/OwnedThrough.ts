import GenericFunction from "../../GenericFunction";

export interface OwnedThroughMetadata {
  fkColumn: string;
  parentModel: GenericFunction;
}

export default (fkColumn: string, parentModel: GenericFunction) => {
  return (ctr: GenericFunction) => {
    ctr.prototype.ownedThrough = { fkColumn, parentModel };
  };
};
