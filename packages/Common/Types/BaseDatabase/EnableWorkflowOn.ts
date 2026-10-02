export default interface EnableWorkflowOn {
  create?: boolean | undefined;
  update?: boolean | undefined;
  delete?: boolean | undefined;
  read?: boolean | undefined;
  /*
   * False for a table only OneUptime writes, such as a call log: create,
   * update and delete then offer their On Create / On Update / On Delete
   * triggers, but not the steps that write rows. Those steps run as root, so
   * offering them would let a workflow forge or rewrite the log. Defaults to
   * true.
   */
  writeSteps?: boolean | undefined;
}
