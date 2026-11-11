import { CustomDomainCopy } from "./CustomDomainCopy";
import {
  DnsRecordCheck,
  DnsRecordCheckOutcome,
} from "Common/Types/CustomDomain/DnsRecordCheck";
import {
  DNS_RECORD_STATUS,
  DnsRecordCheckDescription,
  DnsRecordCheckSentence,
  describeDnsRecordCheck,
} from "Common/Types/CustomDomain/DnsRecordCheckWords";
import { Gray500, Green, Red, Yellow } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import OneUptimeDate from "Common/Types/Date";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import Pill, { PillSize } from "Common/UI/Components/Pill/Pill";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The DNS records a custom domain still needs, each with its own status:
 * DNS Setup's body. One record (the CNAME) once the project's domain is
 * verified; two (its TXT, then the CNAME) while it is not, so nobody has to
 * leave the status page to verify a domain somewhere else.
 *
 * Each record is shown the way DNS providers ask for it - type, name,
 * value, each with a copy button - under a line that says what it is for.
 * Once Check now has looked it up, its status sits beside it, and under it
 * what was looked up, what came back and what to change
 * (DnsRecordCheckWords): "We looked up the CNAME record of
 * status.example.com and got other.example.net, but expected ...".
 */

export interface CustomDomainRecordTestIds {
  record: string;
  type: string;
  name: string;
  value: string;
  status: string;
  lookedUp: string;
}

export interface CustomDomainRecord {
  type: string;
  name: string;
  value: string;
  // What the record is for, in one line, with {{domain}}.
  purpose: string;
  purposeDomain: string;
  // What its last check found; none until Check now looks.
  check?: DnsRecordCheck | undefined;
  testIds: CustomDomainRecordTestIds;
}

export interface ComponentProps {
  records: Array<CustomDomainRecord>;
}

const STATUS_COLOR: Record<DnsRecordCheckOutcome, Color> = {
  [DnsRecordCheckOutcome.Found]: Green,
  [DnsRecordCheckOutcome.WrongValue]: Red,
  [DnsRecordCheckOutcome.NotFound]: Yellow,
  [DnsRecordCheckOutcome.NameNotFound]: Yellow,
  [DnsRecordCheckOutcome.LookupFailed]: Gray500,
  [DnsRecordCheckOutcome.NotCheckedYet]: Gray500,
};

const CustomDomainRecords: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const say: (part: DnsRecordCheckSentence) => string = (
    part: DnsRecordCheckSentence,
  ): string => {
    return translator.translateTemplate(part.template, part.values);
  };

  return (
    <div className="space-y-4">
      {props.records.map((record: CustomDomainRecord): ReactElement => {
        const description: DnsRecordCheckDescription | undefined = record.check
          ? describeDnsRecordCheck(record.check)
          : undefined;

        const fields: Array<{
          label: string;
          value: string;
          copyTitle: string;
          testId: string;
        }> = [
          {
            label: CustomDomainCopy.dnsSetupRecordType,
            value: record.type,
            copyTitle: CustomDomainCopy.dnsSetupCopyRecordType,
            testId: record.testIds.type,
          },
          {
            label: CustomDomainCopy.dnsSetupRecordName,
            value: record.name,
            copyTitle: CustomDomainCopy.dnsSetupCopyRecordName,
            testId: record.testIds.name,
          },
          {
            label: CustomDomainCopy.dnsSetupRecordValue,
            value: record.value,
            copyTitle: CustomDomainCopy.dnsSetupCopyRecordValue,
            testId: record.testIds.value,
          },
        ];

        return (
          <section key={record.testIds.record} className="space-y-2">
            {/*
             * The line wraps beside its status, which keeps to the end of
             * the first line: a status on a line of its own read as a
             * heading of the record under it.
             */}
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 flex-1 text-sm leading-6 text-gray-600">
                {translator.translateTemplate(record.purpose, {
                  domain: record.purposeDomain,
                })}
              </p>
              {record.check ? (
                <span
                  className="mt-0.5 shrink-0"
                  data-testid={record.testIds.status}
                  data-outcome={record.check.outcome}
                >
                  <Pill
                    text={DNS_RECORD_STATUS[record.check.outcome]}
                    color={STATUS_COLOR[record.check.outcome]}
                    size={PillSize.Small}
                  />
                </span>
              ) : (
                <></>
              )}
            </div>

            <dl
              className="divide-y divide-gray-200 rounded-md border border-gray-200"
              data-testid={record.testIds.record}
            >
              {fields.map(
                (field: {
                  label: string;
                  value: string;
                  copyTitle: string;
                  testId: string;
                }): ReactElement => {
                  return (
                    <div
                      key={field.testId}
                      className="flex items-center justify-between gap-3 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <dt className="text-xs font-medium text-gray-500">
                          {translator.translateText(field.label)}
                        </dt>
                        <dd
                          className="mt-0.5 break-all font-mono text-sm text-gray-900"
                          data-testid={field.testId}
                        >
                          {field.value}
                        </dd>
                      </div>
                      <CopyTextButton
                        textToBeCopied={field.value}
                        title={field.copyTitle}
                        size="sm"
                        variant="ghost"
                        iconOnly={true}
                        className="shrink-0"
                      />
                    </div>
                  );
                },
              )}
            </dl>

            {description && record.check ? (
              <div
                className="space-y-1 text-sm leading-6 text-gray-600"
                data-testid={record.testIds.lookedUp}
              >
                <p className="break-words">
                  {say(description.lookedUp)}
                  {description.whatToDo ? (
                    <> {say(description.whatToDo)}</>
                  ) : (
                    <></>
                  )}
                </p>
                {description.warning ? (
                  <p className="break-words text-amber-700">
                    {say(description.warning)}
                  </p>
                ) : (
                  <></>
                )}
                {record.check.checkedAt &&
                record.check.outcome !== DnsRecordCheckOutcome.NotCheckedYet ? (
                  <p className="text-xs text-gray-500">
                    {translator.translateTemplate(
                      CustomDomainCopy.dnsSetupCheckedAt,
                      {
                        time: OneUptimeDate.getLocalHourAndMinuteFromDate(
                          record.check.checkedAt,
                        ),
                      },
                    )}
                  </p>
                ) : (
                  <></>
                )}
              </div>
            ) : (
              <></>
            )}
          </section>
        );
      })}
    </div>
  );
};

export default CustomDomainRecords;
