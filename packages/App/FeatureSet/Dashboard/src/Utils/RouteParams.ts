enum RouteParams {
  ProjectID = ":projectId",
  ModelID = ":id",
  SubModelID = ":subModelId",
  /*
   * A third level, where a sub-model's page lists parts with a page of
   * their own: a storage array's inventory kind, then one of its parts.
   */
  PartID = ":partId",
}

export default RouteParams;
