import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import Domain from "../Types/Domain";
import DatabaseService from "./DatabaseService";
import BadDataException from "../../Types/Exception/BadDataException";
import Text from "../../Types/Text";
import Model from "../../Models/DatabaseModels/Domain";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

/*
 * What a create or a rename is told when its domain holds no name: a
 * number, a list, an object of another kind. A name that is not a domain
 * is told so by Domain itself ("Domain x is not in valid format.").
 */
export const DOMAIN_NAME_REFUSAL_MESSAGE: string =
  'Domain must be a domain name such as example.com, sent as text or as {"_type": "Domain", "value": "example.com"}.';

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * A domain's name as it is saved and compared: trimmed and lower-cased,
   * read from the value however it arrives (Domain.getNameFrom). Empty for
   * no value, and for a value that holds no name.
   */
  public static normalizeName(value: unknown): string {
    return (Domain.getNameFrom(value) || "").trim().toLowerCase();
  }

  /*
   * The domain a create or a rename stores, under its normalized name.
   * Text, a Domain of either class and the JSON of one all hold the same
   * name: the Dashboard and the API reference send the JSON, which the
   * server reads back as the shared class, never as its own subclass, so
   * asking which class a value is refused every domain Add Custom Domain
   * added (#9997). A value that holds no name is refused, in words that say
   * what to send - never stored as its text ("[object Object]").
   */
  public static toStoredDomain(value: unknown): Domain {
    const name: string = Service.normalizeName(value);

    if (!name) {
      throw new BadDataException(DOMAIN_NAME_REFUSAL_MESSAGE);
    }

    return new Domain(name);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    if (createBy.data.domain !== undefined && createBy.data.domain !== null) {
      createBy.data.domain = Service.toStoredDomain(createBy.data.domain);
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
      updateBy.data.domain = Service.toStoredDomain(updateBy.data.domain);

      const name: string = Service.normalizeName(updateBy.data.domain);

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
