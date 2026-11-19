import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import Domain from "../Types/Domain";
import DatabaseService from "./DatabaseService";
import BadDataException from "../../Types/Exception/BadDataException";
import Text from "../../Types/Text";
import Model from "../../Models/DatabaseModels/Domain";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  // A domain's name as it is saved and compared: trimmed and lower-cased.
  public static normalizeName(value: unknown): string {
    if (value === undefined || value === null) {
      return "";
    }

    return String(value).trim().toLowerCase();
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    if (createBy.data.domain) {
      let domain: string | undefined = undefined;

      if (createBy.data.domain instanceof Domain) {
        domain = createBy.data.domain.toString();
      } else if (typeof createBy.data.domain === "string") {
        domain = createBy.data.domain;
      } else {
        throw new BadDataException(
          "Domain must be a string or an instance of Domain.",
        );
      }

      createBy.data.domain = new Domain(domain.trim().toLowerCase());
    }

    /*
     * Prevent setting isVerified during creation, EXCEPT for test domains
     * Test domains can be auto-verified since they are reserved TLDs that can't have real DNS records
     */
    if (!createBy.props.isRoot && createBy.data.isVerified) {
      const domainStr: string = createBy.data.domain?.toString() || "";

      if (!Domain.isTestDomain(domainStr)) {
        throw new BadDataException(
          "Domain cannot be verified during creation. Please verify the domain after creation. Please set isVerified to false.",
        );
      }
    }

    createBy.data.domainVerificationText =
      "oneuptime-verification-" + Text.generateRandomText(20);
    return Promise.resolve({ createBy, carryForward: null });
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    /*
     * A domain is verified by its name. Renamed, it is a domain nobody has
     * proved: the rename takes its verification away, and an update that
     * renames it does not verify it in the same write - its TXT record is
     * checked again from its row, under the new name. A verified domain
     * offers its project's SSO providers to every address on it at Sign in
     * with SSO (#9824), so a verified name carried over to another would
     * offer them for a domain the project never proved it owns. Saving the
     * same name back changes nothing.
     */
    if (updateBy.data.domain !== undefined && !updateBy.props.isRoot) {
      const name: string = Service.normalizeName(updateBy.data.domain);

      if (name) {
        updateBy.data.domain = new Domain(name);
      }

      const rows: Array<Model> = await this.findRowsAndHoldUpdateToThem(
        updateBy,
        {
          domain: true,
        },
      );

      const renames: boolean = rows.some((row: Model): boolean => {
        return Service.normalizeName(row.domain) !== name;
      });

      if (renames) {
        updateBy.data.isVerified = false;
      }
    }

    if (updateBy.data.isVerified && !updateBy.props.isRoot) {
      // A domain is verified within a project: the one named, or the caller's.
      if (!updateBy.query.projectId && !updateBy.props.tenantId) {
        throw new BadDataException(
          "Project ID is required to verify the domain.",
        );
      }

      /*
       * Every domain the update verifies - the ones its caller may write -
       * with the update held to them, so none is verified unchecked.
       */
      const items: Array<Model> = await this.findRowsAndHoldUpdateToThem(
        updateBy,
        {
          domain: true,
          domainVerificationText: true,
        },
      );

      for (const item of items) {
        const domain: string | undefined = item?.domain?.toString();
        const verificationText: string | undefined =
          item?.domainVerificationText?.toString();

        if (!domain) {
          throw new BadDataException("Domain not found.");
        }

        if (!verificationText) {
          throw new BadDataException(
            "Domain verification text with id " + item._id + " not found.",
          );
        }

        // Skip DNS verification for test domains (reserved TLDs for testing)
        if (!Domain.isTestDomain(domain)) {
          const isVerified: boolean = await Domain.verifyTxtRecord(
            domain,
            verificationText,
          );

          if (!isVerified) {
            throw new BadDataException(
              "Verification TXT record " +
                verificationText +
                " not found in domain " +
                domain +
                ". Please add a TXT record to verify the domain. If you have already added the TXT record, please wait for few hours to let DNS to propagate.",
            );
          }
        }
      }
    }

    return { carryForward: null, updateBy };
  }
}
export default new Service();
