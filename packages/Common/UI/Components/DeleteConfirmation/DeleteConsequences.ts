import {
  getGlobalTranslator,
  translationKey,
  Translator,
} from "../../Utils/TranslateTemplate";

/*
 * What else goes when a record is deleted, said under every Delete question
 * about it: the row's Delete in a list, a bulk Delete of many, and the
 * record's own Delete page. "Are you sure you want to delete Production?" is
 * a question about one status page; the hundreds of subscribers that go with
 * it are what the person deciding most needs to know, and the one thing the
 * question never said.
 *
 * One sentence per kind of record, written about the kind ("Deleting a status
 * page also deletes ...") so it reads the same under one row's question and
 * under "Are you sure you want to delete 12 status pages?". It says only what
 * a person would not expect: records the database deletes along with it,
 * things that stop working, what comes back on its own, and - where people
 * fear it goes too - what stays. A kind with nothing to add has no entry,
 * and its dialogs ask the question alone.
 *
 * Every claim is held to the code by DeleteConsequencesGuard: a table named
 * as deleted with it has an ON DELETE CASCADE relation to it, a list it is
 * said to be taken out of is a many-to-many list of it whose join rows go
 * with it, a table named as staying has no ON DELETE CASCADE relation to it,
 * work a service does on delete is in its delete hook, and a kind said to
 * come back has the ingest code that adds it again.
 */

/*
 * A record ingest names again - a host still sending telemetry, a cluster its
 * agent still reports - is added again as a new record. The labels, owners,
 * description and settings a person gave the old one went with it.
 */
export const ADDED_BACK_BY_INGEST_SENTENCE: string = translationKey(
  "If OneUptime still receives data about it, it is added back, without the labels, owners and settings you gave it.",
);

/*
 * Work a service does when one is deleted (rather than the database), and
 * the text in that service's source that does it.
 */
export interface DeleteSideEffect {
  // The service file, under Common/Server/Services, without ".ts".
  service: string;
  /*
   * Code its source holds that does the work the sentence describes (the
   * delete hook, or ingest's find-or-create), word for word.
   */
  code: string;
}

// A many-to-many list on another record that holds this one.
export interface ManyToManyList {
  // The table whose records hold the list.
  table: string;
  // The list's property on that model.
  property: string;
}

export interface DeleteConsequence {
  // What deleting one of these takes with it, as the dialogs say it.
  sentence?: string | undefined;
  /*
   * The tables whose rows go with it because their relation to it is ON
   * DELETE CASCADE - each one the sentence names, as the database's own
   * relations say.
   */
  deletedWith?: ReadonlyArray<string> | undefined;
  /*
   * The records the sentence says it is taken out of, where the link is a
   * many-to-many list on them (an SLO's monitors): the table that owns the
   * list and the list's property. The join table's rows go with it, so the
   * record leaves every such list and the records themselves stay.
   */
  takenOutOf?: ReadonlyArray<ManyToManyList> | undefined;
  /*
   * The tables the sentence says stay. None of them has an ON DELETE
   * CASCADE relation to it.
   */
  stays?: ReadonlyArray<string> | undefined;
  // What its service's delete hook does that the sentence describes.
  sideEffects?: ReadonlyArray<DeleteSideEffect> | undefined;
  /*
   * Ingest adds it again when data about it still arrives: the service and
   * method that do. Adds ADDED_BACK_BY_INGEST_SENTENCE after the sentence.
   */
  addedBackBy?: DeleteSideEffect | undefined;
}

/*
 * Keyed by the model's table name (the same for every front end). The kinds
 * of record a list or a Delete page offers to delete, where there is
 * something to say.
 */
export const DELETE_CONSEQUENCES: Readonly<Record<string, DeleteConsequence>> =
  {
    StatusPage: {
      sentence: translationKey(
        "Deleting a status page also deletes its subscribers, private users and custom domains.",
      ),
      deletedWith: [
        "StatusPageSubscriber",
        "StatusPagePrivateUser",
        "StatusPageDomain",
      ],
    },
    Monitor: {
      /*
       * SLOs are named because an SLO left with no monitors stops being
       * evaluated - the monitor's own Delete page warns about each one
       * (SloImpactWarning); a list's Delete, often of many monitors at
       * once, says it here.
       */
      sentence: translationKey(
        "Deleting a monitor also deletes its status history and takes it off status pages, monitor groups and SLOs. Its incidents and alerts stay.",
      ),
      deletedWith: [
        "MonitorStatusTimeline",
        "StatusPageResource",
        "MonitorGroupResource",
      ],
      takenOutOf: [{ table: "ServiceLevelObjective", property: "monitors" }],
      stays: ["Incident", "Alert", "ServiceLevelObjective"],
    },
    Incident: {
      sentence: translationKey(
        "Deleting an incident also deletes its notes and state timeline, and takes it off status pages. Linked alerts stay.",
      ),
      deletedWith: [
        "IncidentPublicNote",
        "IncidentInternalNote",
        "IncidentStateTimeline",
      ],
      stays: ["Alert"],
    },
    Alert: {
      sentence: translationKey(
        "Deleting an alert also deletes its notes and state timeline. Linked incidents stay.",
      ),
      deletedWith: ["AlertInternalNote", "AlertStateTimeline"],
      stays: ["Incident"],
    },
    ScheduledMaintenance: {
      sentence: translationKey(
        "Deleting a scheduled maintenance event also deletes its notes and state timeline, and takes it off status pages.",
      ),
      deletedWith: [
        "ScheduledMaintenancePublicNote",
        "ScheduledMaintenanceInternalNote",
        "ScheduledMaintenanceStateTimeline",
      ],
    },
    IncidentEpisode: {
      sentence: translationKey(
        "Deleting an incident episode also deletes its notes and state timeline. Its incidents stay.",
      ),
      deletedWith: [
        "IncidentEpisodePublicNote",
        "IncidentEpisodeInternalNote",
        "IncidentEpisodeStateTimeline",
      ],
      stays: ["Incident"],
    },
    AlertEpisode: {
      sentence: translationKey(
        "Deleting an alert episode also deletes its notes and state timeline. Its alerts stay.",
      ),
      deletedWith: ["AlertEpisodeInternalNote", "AlertEpisodeStateTimeline"],
      stays: ["Alert"],
    },
    MonitorGroup: {
      sentence: translationKey(
        "Deleting a monitor group takes it off status pages. Its monitors stay.",
      ),
      deletedWith: ["StatusPageResource"],
      stays: ["Monitor"],
    },
    OnCallDutyPolicy: {
      sentence: translationKey(
        "Deleting an on-call policy also deletes its escalation rules and user overrides, so nobody is paged through it any more.",
      ),
      deletedWith: [
        "OnCallDutyPolicyEscalationRule",
        "OnCallDutyPolicyUserOverride",
      ],
    },
    OnCallDutyPolicySchedule: {
      sentence: translationKey(
        "Deleting an on-call schedule also deletes its layers and takes it out of every escalation rule that pages it.",
      ),
      deletedWith: [
        "OnCallDutyPolicyScheduleLayer",
        "OnCallDutyPolicyEscalationRuleSchedule",
      ],
    },
    IncomingCallPolicy: {
      sentence: translationKey(
        "Deleting an incoming call policy also releases its phone numbers, so they can no longer be called, and deletes its escalation rules and call logs.",
      ),
      deletedWith: [
        "IncomingCallPolicyPhoneNumber",
        "IncomingCallPolicyEscalationRule",
        "IncomingCallLog",
      ],
      sideEffects: [
        {
          service: "IncomingCallPolicyService",
          code: "releaseIncomingCallPhoneNumber(",
        },
      ],
    },
    Workflow: {
      sentence: translationKey(
        "Deleting a workflow also deletes its variables and run logs.",
      ),
      deletedWith: ["WorkflowVariable", "WorkflowLog"],
    },
    Dashboard: {
      sentence: translationKey(
        "Deleting a dashboard also deletes its custom domains.",
      ),
      deletedWith: ["DashboardDomain"],
    },
    Runbook: {
      sentence: translationKey(
        "Deleting a runbook also deletes its run history.",
      ),
      deletedWith: ["RunbookExecution"],
    },
    ServiceLevelObjective: {
      sentence: translationKey(
        "Deleting an SLO also deletes its burn rate rules.",
      ),
      deletedWith: ["ServiceLevelObjectiveBurnRateRule"],
    },
    Service: {
      sentence: translationKey(
        "Deleting a service also deletes its source maps, and the metric pipeline rules and LLM cost budgets set for it.",
      ),
      deletedWith: [
        "TelemetrySourceMap",
        "MetricPipelineRule",
        "LlmCostBudget",
      ],
      addedBackBy: {
        service: "OpenTelemetryIngestService",
        code: "await ServiceService.create(",
      },
    },
    NetworkDevice: {
      sentence: translationKey(
        "Deleting a network device also deletes its interfaces, links, endpoints and any monitor OneUptime created for it, with that monitor's history.",
      ),
      deletedWith: ["NetworkInterface", "NetworkDeviceLink", "NetworkEndpoint"],
      sideEffects: [
        {
          service: "NetworkDeviceService",
          code: "autoProvisionedNetworkDeviceId: device.id",
        },
      ],
    },
    Probe: {
      sentence: translationKey(
        "Deleting a probe takes it off every monitor it checks.",
      ),
      deletedWith: ["MonitorProbe"],
    },
    Team: {
      sentence: translationKey(
        "Deleting a team takes away the permissions it gave its members. Anyone for whom it was their only team loses access to the project.",
      ),
      deletedWith: ["TeamPermission", "TeamMember"],
      sideEffects: [
        {
          service: "TeamService",
          code: "await TeamMemberService.deleteBy(",
        },
      ],
    },
    ApiKey: {
      sentence: translationKey(
        "Deleting an API key stops anything that uses it from working.",
      ),
      deletedWith: ["ApiKeyPermission", "ApiKeyCustomRole"],
    },
    /*
     * The permissions the role gave go from every team and API key that has
     * it, in the same delete: the copies of them (TeamPermission,
     * ApiKeyPermission) and the hold of the role (TeamCustomRole,
     * ApiKeyCustomRole) cascade with it.
     */
    CustomRole: {
      sentence: translationKey(
        "Deleting a custom role takes its permissions from every team and API key that has it. The teams and keys themselves stay, with everything else they have.",
      ),
      deletedWith: [
        "CustomRolePermission",
        "TeamCustomRole",
        "TeamPermission",
        "ApiKeyCustomRole",
        "ApiKeyPermission",
      ],
      stays: ["Team", "TeamMember", "ApiKey"],
    },
    TelemetryIngestionKey: {
      sentence: translationKey(
        "Deleting an ingestion key makes OneUptime refuse telemetry that is still sent with it.",
      ),
    },
    StatusPageAnnouncement: {
      sentence: translationKey(
        "Deleting an announcement takes it off every status page that shows it.",
      ),
    },
    TracePipeline: {
      sentence: translationKey(
        "Deleting a pipeline also deletes its processors.",
      ),
      deletedWith: ["TracePipelineProcessor"],
    },
    LogPipeline: {
      sentence: translationKey(
        "Deleting a pipeline also deletes its processors.",
      ),
      deletedWith: ["LogPipelineProcessor"],
    },
    Form: {
      sentence: translationKey(
        "Deleting a form also deletes its submissions. The incidents and events it created stay.",
      ),
      deletedWith: ["FormSubmission"],
      stays: ["Incident", "ScheduledMaintenance"],
    },
    SecurityCase: {
      sentence: translationKey(
        "Deleting a security case also deletes its detections, notes, timeline and playbook runs.",
      ),
      deletedWith: [
        "SecurityDetection",
        "SecurityCaseNote",
        "SecurityCaseFeed",
        "SecurityPlaybookRun",
      ],
    },
    IoTFleet: {
      sentence: translationKey(
        "Deleting an IoT fleet also deletes its device registry, so registered devices can no longer sign in.",
      ),
      deletedWith: ["IoTDeviceCredential"],
      addedBackBy: {
        service: "IoTFleetService",
        code: "public async findOrCreateByName(",
      },
    },
    DatabaseServer: {
      sentence: translationKey(
        "Deleting a database also deletes the endpoints it is reached at.",
      ),
      deletedWith: ["DatabaseServerEndpoint"],
      addedBackBy: {
        service: "DatabaseServerService",
        code: "public async findOrCreateByEndpoint(",
      },
    },
    /*
     * The resources telemetry describes, whose records below them (pods,
     * containers, datastores) are snapshots ingest writes again: what a
     * person loses is what they gave the record, and only if data about it
     * still arrives does that matter.
     */
    Host: {
      addedBackBy: {
        service: "HostService",
        code: "public async findOrCreateByHostIdentifier(",
      },
    },
    DockerHost: {
      addedBackBy: {
        service: "DockerHostService",
        code: "public async findOrCreateByHostIdentifier(",
      },
    },
    PodmanHost: {
      addedBackBy: {
        service: "PodmanHostService",
        code: "public async findOrCreateByHostIdentifier(",
      },
    },
    KubernetesCluster: {
      addedBackBy: {
        service: "KubernetesClusterService",
        code: "public async findOrCreateByClusterIdentifier(",
      },
    },
    DockerSwarmCluster: {
      addedBackBy: {
        service: "DockerSwarmClusterService",
        code: "public async findOrCreateByName(",
      },
    },
    ProxmoxCluster: {
      addedBackBy: {
        service: "ProxmoxClusterService",
        code: "public async findOrCreateByName(",
      },
    },
    VMwareVCenter: {
      addedBackBy: {
        service: "VMwareVCenterService",
        code: "public async findOrCreateByName(",
      },
    },
    CephCluster: {
      addedBackBy: {
        service: "CephClusterService",
        code: "public async findOrCreateByName(",
      },
    },
    StorageArray: {
      addedBackBy: {
        service: "StorageArrayService",
        code: "public async findOrCreateByName(",
      },
    },
    ServerlessFunction: {
      addedBackBy: {
        service: "ServerlessFunctionService",
        code: "public async findOrCreateByFunctionIdentifier(",
      },
    },
    MessageQueue: {
      addedBackBy: {
        service: "MessageQueueService",
        code: "public async findOrCreateByIdentity(",
      },
    },
    CloudConnection: {
      sentence: translationKey(
        "Deleting a cloud connection stops OneUptime reading the account. Its resources stay, with their metrics.",
      ),
      stays: ["CloudResource"],
    },
    CloudResource: {
      addedBackBy: {
        service: "CloudResourceService",
        code: "public async findOrCreateByResourceIdentifier(",
      },
    },
    RumApplication: {
      addedBackBy: {
        service: "RumApplicationService",
        code: "public async findOrCreateByAppIdentifier(",
      },
    },
    InventoryItem: {
      addedBackBy: {
        service: "InventoryItemService",
        code: "private async upsertEntity(",
      },
    },
    /*
     * OneUptime Cloud's Admin Dashboard (ee/AdminDashboard/EnterpriseLicenses):
     * what deleting a license does to the self-hosted installations that use
     * its key. Nothing switches them off - an installation keeps the signed
     * license it already holds (its expiry is inside it) and ignores a
     * refusal of its daily report (ee/Server/License/Jobs/ReportUserCount).
     * What stops is everything the key is asked for: the license server
     * answers "License key is invalid" to Refresh license, to activation and
     * to the daily seat report (ee/Server/LicenseServer/EnterpriseLicenseAPI),
     * and its instances (the license page's Instances card) go with it.
     * ee/Tests/Server/LicenseServer/DeletedLicenseClaims holds those claims
     * to the code.
     */
    EnterpriseLicense: {
      sentence: translationKey(
        "Deleting a license also deletes its instances. Installations that use its key keep the license they already hold until it expires, but can no longer refresh or reactivate it, and their seat reports are refused.",
      ),
      deletedWith: ["EnterpriseLicenseInstance"],
    },
  };

/*
 * The English sentences said about deleting a record of this table: its
 * consequence, then that it comes back. Empty for a kind with nothing to add.
 */
export const getDeleteConsequenceSentences: (
  tableName: string | null | undefined,
) => Array<string> = (tableName: string | null | undefined): Array<string> => {
  const consequence: DeleteConsequence | undefined = tableName
    ? DELETE_CONSEQUENCES[tableName]
    : undefined;

  if (!consequence) {
    return [];
  }

  const sentences: Array<string> = [];

  if (consequence.sentence) {
    sentences.push(consequence.sentence);
  }

  if (consequence.addedBackBy) {
    sentences.push(ADDED_BACK_BY_INGEST_SENTENCE);
  }

  return sentences;
};

/*
 * A sentence that ends the way Chinese and Japanese end one - with a
 * full-width full stop, question or exclamation mark. Those scripts put no
 * space between sentences: "...削除されます。 すべて..." reads as a stray gap.
 */
const ENDS_WITH_FULL_WIDTH_STOP: RegExp = /[。！？]$/u;

/*
 * Whole sentences, each translated on its own, run together as one
 * paragraph the way the reader's script writes them: a space after each,
 * except after a full-width stop. Empty ones are left out.
 */
export const joinSentences: (sentences: ReadonlyArray<string>) => string = (
  sentences: ReadonlyArray<string>,
): string => {
  return sentences
    .map((sentence: string): string => {
      return sentence.trim();
    })
    .filter((sentence: string): boolean => {
      return sentence.length > 0;
    })
    .reduce((paragraph: string, sentence: string): string => {
      if (!paragraph) {
        return sentence;
      }

      return ENDS_WITH_FULL_WIDTH_STOP.test(paragraph)
        ? `${paragraph}${sentence}`
        : `${paragraph} ${sentence}`;
    }, "");
};

/*
 * The same sentences in the reader's language, as one string: each one is a
 * whole sentence translated on its own, never a piece of another. "" for a
 * kind with nothing to add.
 */
export const getDeleteConsequence: (
  tableName: string | null | undefined,
  translator?: Translator | undefined,
) => string = (
  tableName: string | null | undefined,
  translator?: Translator | undefined,
): string => {
  const reader: Translator = translator || getGlobalTranslator();

  return joinSentences(
    getDeleteConsequenceSentences(tableName).map((sentence: string): string => {
      return reader.translateText(sentence) || sentence;
    }),
  );
};
