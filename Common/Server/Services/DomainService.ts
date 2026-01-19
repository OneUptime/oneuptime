import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import Domain from "../Types/Domain";
import DatabaseService from "./DatabaseService";
import BadDataException from "../../Types/Exception/BadDataException";
import Text from "../../Types/Text";
import Model from "../../Models/DatabaseModels/Domain";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import ObjectID from "../../Types/ObjectID";
import { FindWhere } from "../../Types/BaseDatabase/Query";
export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
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
    if (updateBy.data.isVerified && !updateBy.props.isRoot) {
      const projectId: FindWhere<ObjectID> | undefined =
        updateBy.query.projectId || updateBy.props.tenantId;

      if (!projectId) {
        throw new BadDataException(
          "Project ID is required to verify the domain.",
        );
      }

      // check the verification of the domain.

      const items: Array<Model> = await this.findBy({
        query: {
          projectId,
          ...updateBy.query,
        },
        select: {
          domain: true,
          domainVerificationText: true,
        },

        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      for (const item of items) {
        const domain: string | undefined = item?.domain?.toString();
        const verificationText: string | undefined =
          item?.domainVerificationText?.toString();

        if (!domain) {
          throw new BadDataException("Domain not found.");
        }

        if (!verificationText) {
          throw new BadDataException(
            "Domain verification text with id " +
              updateBy.query._id +
              " not found.",
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
