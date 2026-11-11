import {
  ParsedCustomDomainAddress,
  ProjectDomainOption,
  findProjectDomainForAddress,
  getDomainToAddForAddress,
  getSubdomainOnDomain,
  parseCustomDomainAddress,
  CustomDomainAddressCopy,
} from "./CustomDomainAddress";
import { CustomDomainCopy } from "./CustomDomainCopy";
import {
  CustomDomainKind,
  CustomDomainModel,
  getCustomDomainInstallation,
} from "./CustomDomainKinds";
import CustomDomainDnsSetupModal, {
  CustomDomainDnsSetupDomain,
  CustomDomainDnsSetupProjectDomain,
} from "./CustomDomainDnsSetupModal";
import CustomDomainServerReadinessNotice from "./CustomDomainServerReadinessNotice";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import DomainType from "Common/Types/Domain";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import Fields from "Common/UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Domain from "Common/Models/DatabaseModels/Domain";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * Add Custom Domain, for a status page, a dashboard or a form: one field,
 * the address people will open (status.example.com).
 *
 * It used to ask for a subdomain and one of the project's verified domains,
 * from a list with every unverified domain left out - and a link that
 * opened Project Settings in a new tab, where the domain had to be added,
 * verified with a TXT record, waited for, and then the dialog opened again.
 * Now the dialog works out the project domain the address belongs to
 * (CustomDomainAddress) and:
 *
 *   - when the project has verified it, adds the custom domain at once, and
 *     the table opens its DNS Setup with the CNAME record, as before;
 *   - when it has not, adds the domain to the project if it is missing, and
 *     becomes DNS Setup with both records - the domain's TXT, then the
 *     address's CNAME - each with its own status. One Check now checks the
 *     TXT, adds the custom domain the moment it is found, and checks the
 *     CNAME. Project Settings -> Domains stays where the domains are listed.
 *
 * The TXT record stays: a CNAME on status.example.com shows control of that
 * one name, while the TXT shows the project owns example.com, which matters
 * where one verified domain serves many pages. Who may claim a domain is a
 * security decision, left as it was.
 *
 * The certificate options stay folded under Advanced, as they were.
 *
 * On a self-hosted server, what the server still needs before any custom
 * domain can work is said above the field (CustomDomainServerReadiness).
 */

export interface ComponentProps {
  kind: CustomDomainKind;
  // The status page, dashboard or form the domain is for.
  parentId: ObjectID;
  projectId: ObjectID;
  onClose: () => void;
  /*
   * The custom domain was added on a verified project domain: the table
   * opens its DNS Setup.
   */
  onAdded: (domain: CustomDomainModel) => void;
  // The table is stale: a custom domain was added, or verified, in here.
  onChanged: () => void;
}

interface AddValues {
  address?: string;
  isCustomCertificate?: boolean;
  customCertificate?: string;
  customCertificateKey?: string;
}

// The project domain, and the custom domain waiting on its TXT record.
interface PendingDomain {
  fullDomain: string;
  subdomain: string;
  projectDomain: CustomDomainDnsSetupProjectDomain;
  values: AddValues;
}

/*
 * The certificate options, folded: nearly every domain runs on the free
 * certificate we issue and renew, and the folded header says so.
 */
const certificateSection: FormFieldCollapsibleSection<AddValues> =
  getAdvancedFormSection<AddValues>({
    getSummary: (values: FormValues<AddValues>): Array<string> => {
      return [
        values.isCustomCertificate
          ? CustomDomainCopy.advancedSummaryUploadedCertificate
          : getCustomDomainInstallation().issuesFreeCertificates
            ? CustomDomainCopy.advancedSummaryFreeCertificate
            : CustomDomainCopy.advancedSummaryWithoutFreeCertificate,
      ];
    },
  });

export const getAddCustomDomainFields: (
  kind: CustomDomainKind,
) => Fields<AddValues> = (kind: CustomDomainKind): Fields<AddValues> => {
  return [
    {
      field: {
        address: true,
      },
      title: CustomDomainCopy.addAddressTitle,
      description: CustomDomainCopy.addAddressDescription,
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: kind.copy.addressPlaceholder,
      disableSpellCheck: true,
      customValidation: (values: FormValues<AddValues>): string | null => {
        if (!values.address) {
          return null;
        }

        return parseCustomDomainAddress(values.address as string)
          ? null
          : CustomDomainAddressCopy.invalidAddress;
      },
    },
    {
      field: {
        isCustomCertificate: true,
      },
      title: "Upload Custom Certificate",
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
      defaultValue: false,
      description:
        "If you have a custom certificate, you can upload it here. If you do not have a certificate, we will order a free SSL certificate for you.",
      collapsibleSection: certificateSection,
    },
    {
      field: {
        customCertificate: true,
      },
      title: "Certificate",
      fieldType: FormFieldSchemaType.LongText,
      required: (values: FormValues<AddValues>): boolean => {
        return Boolean(values.isCustomCertificate);
      },
      placeholder: "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----",
      disableSpellCheck: true,
      showIf: (values: FormValues<AddValues>): boolean => {
        return Boolean(values.isCustomCertificate);
      },
      collapsibleSection: certificateSection,
    },
    {
      field: {
        customCertificateKey: true,
      },
      title: "Certificate Private Key",
      fieldType: FormFieldSchemaType.LongText,
      required: (values: FormValues<AddValues>): boolean => {
        return Boolean(values.isCustomCertificate);
      },
      placeholder: "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----",
      disableSpellCheck: true,
      showIf: (values: FormValues<AddValues>): boolean => {
        return Boolean(values.isCustomCertificate);
      },
      collapsibleSection: certificateSection,
    },
  ];
};

// The project's domains, as the dialog compares them; none when unreadable.
export const loadProjectDomains: (
  projectId: ObjectID,
) => Promise<Array<ProjectDomainOption>> = async (
  projectId: ObjectID,
): Promise<Array<ProjectDomainOption>> => {
  const result: ListResult<Domain> = await ModelAPI.getList<Domain>({
    modelType: Domain,
    query: {
      projectId: projectId,
    },
    limit: LIMIT_MAX,
    skip: 0,
    select: {
      _id: true,
      domain: true,
      isVerified: true,
      domainVerificationText: true,
    },
    sort: {},
  });

  return result.data
    .filter((domain: Domain): boolean => {
      return Boolean(domain.id && domain.domain);
    })
    .map((domain: Domain): ProjectDomainOption => {
      return {
        id: domain.id!.toString(),
        domain: domain.domain!.toString(),
        isVerified: Boolean(domain.isVerified),
        verificationText: domain.domainVerificationText?.toString() || "",
      };
    });
};

const AddCustomDomainModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [pending, setPending] = useState<PendingDomain | null>(null);

  // Checking a domain's TXT record verifies it: an update of the domain.
  const verifyDomainGate: PermissionGateResult = PermissionGate.check(
    new Domain(),
    ModelAction.Update,
  );

  // Check now on the custom domain changes it.
  const checkNowGate: PermissionGateResult = PermissionGate.check(
    new props.kind.modelType(),
    ModelAction.Update,
  );

  // Adds the custom domain on its project domain, with what was typed.
  const createCustomDomain: (data: {
    fullDomain: string;
    subdomain: string;
    projectDomainId: string;
    values: AddValues;
  }) => Promise<CustomDomainModel> = async (data: {
    fullDomain: string;
    subdomain: string;
    projectDomainId: string;
    values: AddValues;
  }): Promise<CustomDomainModel> => {
    const model: CustomDomainModel = new props.kind.modelType();
    const row: Record<string, unknown> = model as unknown as Record<
      string,
      unknown
    >;

    row["subdomain"] = data.subdomain;
    row["domainId"] = new ObjectID(data.projectDomainId);
    row["projectId"] = props.projectId;
    row[props.kind.parentColumn] = props.parentId;
    row["isCustomCertificate"] = Boolean(data.values.isCustomCertificate);

    if (data.values.isCustomCertificate) {
      row["customCertificate"] = data.values.customCertificate || "";
      row["customCertificateKey"] = data.values.customCertificateKey || "";
    }

    const response: { data: unknown } = await ModelAPI.create<CustomDomainModel>(
      {
        model: model,
        modelType: props.kind.modelType,
      },
    );

    const created: CustomDomainModel = BaseModel.fromJSONObject(
      (response.data || {}) as JSONObject,
      props.kind.modelType as { new (): CustomDomainModel },
    ) as CustomDomainModel;

    /*
     * The answer leaves out what the caller may not read (a role that may
     * add domains, not read them): what DNS Setup needs is what was typed.
     */
    const createdRow: Record<string, unknown> = created as unknown as Record<
      string,
      unknown
    >;

    if (createdRow["fullDomain"] === undefined) {
      createdRow["fullDomain"] = data.fullDomain;
    }

    if (createdRow["subdomain"] === undefined) {
      createdRow["subdomain"] = data.subdomain;
    }

    return created;
  };

  const onSubmit: (values: AddValues) => Promise<void> = async (
    values: AddValues,
  ): Promise<void> => {
    const parsed: ParsedCustomDomainAddress | undefined =
      parseCustomDomainAddress(values.address);

    if (!parsed) {
      setError(translator.translateText(CustomDomainAddressCopy.invalidAddress));
      return;
    }

    setIsSubmitting(true);
    setError("");

    try {
      let projectDomains: Array<ProjectDomainOption> = [];

      try {
        projectDomains = await loadProjectDomains(props.projectId);
      } catch {
        // Unreadable: the domain is added below, or refused with a reason.
      }

      let projectDomain: ProjectDomainOption | undefined =
        findProjectDomainForAddress(parsed.fullDomain, projectDomains);

      if (projectDomain?.isVerified) {
        const created: CustomDomainModel = await createCustomDomain({
          fullDomain: parsed.fullDomain,
          subdomain: getSubdomainOnDomain(
            parsed.fullDomain,
            projectDomain.domain,
          ),
          projectDomainId: projectDomain.id,
          values: values,
        });

        props.onChanged();
        props.onAdded(created);
        return;
      }

      if (!projectDomain) {
        const domainToAdd: string = getDomainToAddForAddress(parsed.fullDomain);

        if (!PermissionGate.check(new Domain(), ModelAction.Create).isAllowed) {
          setError(
            translator.translateTemplate(
              CustomDomainCopy.addNeedsDomainPermission,
              { domain: domainToAdd },
            ),
          );
          return;
        }

        const domain: Domain = new Domain();
        domain.domain = new DomainType(domainToAdd);
        domain.projectId = props.projectId;

        await ModelAPI.create<Domain>({
          model: domain,
          modelType: Domain,
        });

        // Read back for its verification text, which the server writes.
        projectDomain = findProjectDomainForAddress(
          parsed.fullDomain,
          await loadProjectDomains(props.projectId),
        );

        if (!projectDomain) {
          throw new Error(
            translator.translateTemplate(
              CustomDomainCopy.addNeedsDomainPermission,
              { domain: domainToAdd },
            ),
          );
        }
      }

      setPending({
        fullDomain: parsed.fullDomain,
        subdomain: getSubdomainOnDomain(parsed.fullDomain, projectDomain.domain),
        projectDomain: {
          id: new ObjectID(projectDomain.id),
          domain: projectDomain.domain,
          verificationText: projectDomain.verificationText || "",
        },
        values: values,
      });
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (pending) {
    const pendingDomain: CustomDomainDnsSetupDomain = {
      fullDomain: pending.fullDomain,
      subdomain: pending.subdomain,
      isCustomCertificate: Boolean(pending.values.isCustomCertificate),
    };

    return (
      <CustomDomainDnsSetupModal
        kind={props.kind}
        domain={pendingDomain}
        checkNowGate={checkNowGate}
        projectDomain={pending.projectDomain}
        verifyDomainGate={verifyDomainGate}
        createCustomDomain={async (): Promise<CustomDomainDnsSetupDomain> => {
          return await createCustomDomain({
            fullDomain: pending.fullDomain,
            subdomain: pending.subdomain,
            projectDomainId: pending.projectDomain.id.toString(),
            values: pending.values,
          });
        }}
        onCreated={() => {
          props.onChanged();
        }}
        onVerified={() => {
          props.onChanged();
        }}
        onClose={props.onClose}
      />
    );
  }

  return (
    <BasicFormModal<AddValues>
      title={CustomDomainCopy.addTitle}
      isLoading={isSubmitting}
      error={error}
      submitButtonText={CustomDomainCopy.addSubmit}
      onClose={props.onClose}
      beforeFormElement={<CustomDomainServerReadinessNotice kind={props.kind} />}
      onSubmit={(values: AddValues): void => {
        void onSubmit(values);
      }}
      formProps={{
        initialValues: {
          address: "",
          isCustomCertificate: false,
        },
        fields: getAddCustomDomainFields(props.kind),
      }}
    />
  );
};

export default AddCustomDomainModal;
