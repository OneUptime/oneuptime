import Dictionary from "../Dictionary";

/*
 * WHO READS WHAT A RUN OF ONEUPTIME'S OWN WRITES (#9576).
 *
 * An AI investigation reads as OneUptime and writes its report into its
 * incident's or alert's feed, and sometimes into the Slack and Microsoft
 * Teams channels the subject is posted to: everyone who may see the subject
 * reads it at once. So the run reads as root, and only what every one of
 * them may read (Server/Utils/ReadAudience/ReadAudienceScope):
 *
 *   - a record of a kind no role, team or API key of the project reads only
 *     by owner or label: every one of them. Everyone who may read the
 *     subject and that kind reads all of it, so nothing is lost in a project
 *     that narrows nobody - the many that set no permission scope;
 *   - a record of a kind some of them read only by owner or label, as
 *     nobody in particular may read it: none that an owner or a label sets
 *     apart (#9562), beside what the subject names itself;
 *   - never a private incident, alert or episode, other than the subject.
 *
 * Plain data, worked out once per run (ReadAudienceReader) and carried on
 * the run's props (DatabaseCommonInteractionProps.readAudience), so every
 * read made with them - a tool's, a starting context's - is narrowed where
 * the permission layer narrows a person's: one rule, never one per read.
 */
export default interface ReadAudience {
  _type: "ReadAudience";
  // The project the run reads, by id.
  projectId: string;
  /*
   * The permissions some team, custom role or API key of the project holds
   * only for the records its members or the team own (an allow row scoped
   * to Owned), each once.
   */
  ownedOnlyPermissions: Array<string>;
  /*
   * The permissions some team, custom role or API key of the project holds
   * only for records carrying some labels, or is blocked from for some
   * labels, each once.
   */
  labelledPermissions: Array<string>;
  /*
   * What the subject names itself, by model name ("Monitor", "Host"): its
   * own record and those its Affected Resources list - the monitors, hosts,
   * clusters, services and SLOs its feed, emails and channels already name
   * to every reader of it. Ids are lower case. Read whoever owns them and
   * whatever labels they carry.
   */
  named: Dictionary<Array<string>>;
  /*
   * The telemetry-owning resources (services, hosts, clusters, monitors...)
   * a telemetry read leaves out: the ones set apart by an owner or a label
   * on a kind some reader reads only by owner or label, the subject's own
   * excepted. Lower case.
   */
  telemetryBlockedIds: Array<string>;
}
