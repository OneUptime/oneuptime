enum UserType {
  API = "API",
  User = "User",
  MasterAdmin = "MasterAdmin",
  Public = "Public",
  /*
   * A step of one of the project's workflows, acting in that project with
   * the permissions of a Project Admin (WorkflowPrincipal). Like an API key,
   * it is no person: it carries no userId and is never anyone's creator.
   */
  Workflow = "Workflow",
}

export default UserType;
