import ProjectUtil from "Common/UI/Utils/Project";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import Icon, { SizeProp, ThickProp } from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import { BILLING_ENABLED, IS_ENTERPRISE_EDITION } from "Common/UI/Config";
import React, { FunctionComponent, ReactElement, useMemo } from "react";

export const isAuditLogsEnterpriseEligible: () => boolean = (): boolean => {
  if (IS_ENTERPRISE_EDITION) {
    return true;
  }
  if (BILLING_ENABLED) {
    return ProjectUtil.getCurrentPlan() === PlanType.Enterprise;
  }
  return false;
};

export interface ComponentProps {
  title: string;
  description: string;
  featureDescription?: string | undefined;
}

interface Benefit {
  icon: IconProp;
  title: string;
  subtitle: string;
}

const BENEFITS: Array<Benefit> = [
  {
    icon: IconProp.ClipboardDocumentList,
    title: "Track every change",
    subtitle:
      "Who changed what, when, and how — across monitors, incidents, on-call, status pages, and more.",
  },
  {
    icon: IconProp.ShieldCheck,
    title: "Compliance-ready",
    subtitle:
      "Retain a tamper-resistant history to support SOC 2, ISO 27001, HIPAA and internal reviews.",
  },
  {
    icon: IconProp.MagnifyingGlass,
    title: "Diff-level detail",
    subtitle:
      "See exact field-level before/after values for every create, update and delete action.",
  },
  {
    icon: IconProp.Clock,
    title: "Configurable retention",
    subtitle:
      "Keep audit history for 7 to 180 days to match your compliance requirements.",
  },
];

const AuditLogsEnterpriseUpgrade: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const isCloud: boolean = useMemo(() => {
    return BILLING_ENABLED;
  }, []);

  const ctaTitle: string = isCloud
    ? "Upgrade to Enterprise"
    : "Learn about Enterprise Edition";
  const ctaIcon: IconProp = isCloud ? IconProp.Billing : IconProp.Info;
  const ctaUrl: string = isCloud
    ? "https://oneuptime.com/pricing"
    : "https://oneuptime.com/enterprise";

  const pitchLine: string = isCloud
    ? "Audit Logs are available on the Enterprise plan. Upgrade to turn on audit logging for this project."
    : "Audit Logs are a OneUptime Enterprise Edition feature. Switch to the Enterprise Edition build to enable audit logging.";

  return (
    <Card
      title={props.title}
      description={props.description}
      rightElement={
        <Button
          title={ctaTitle}
          buttonStyle={ButtonStyleType.PRIMARY}
          icon={ctaIcon}
          onClick={() => {
            window.open(ctaUrl, "_blank");
          }}
        />
      }
    >
      <div className="px-4 pb-6 pt-2">
        <div className="flex flex-col items-start gap-4 rounded-xl border border-indigo-100 bg-gradient-to-br from-indigo-50 via-white to-white p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm">
              <Icon
                icon={IconProp.ClipboardDocumentList}
                size={SizeProp.Large}
                thick={ThickProp.Thick}
                className="h-6 w-6"
              />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold text-gray-900">
                  Audit Logs
                </h3>
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                  <Icon
                    icon={IconProp.Star}
                    size={SizeProp.Small}
                    thick={ThickProp.Thick}
                    className="h-2.5 w-2.5"
                  />
                  Enterprise
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-0.5">
                {props.featureDescription ||
                  "Record every create, update and delete performed on this project's resources."}
              </p>
            </div>
          </div>

          <p className="text-sm text-gray-700">{pitchLine}</p>

          <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
            {BENEFITS.map((benefit: Benefit) => {
              return (
                <div
                  key={benefit.title}
                  className="flex items-start gap-3 rounded-lg border border-gray-100 bg-white px-3 py-2.5 shadow-sm"
                >
                  <div className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-indigo-50 text-indigo-600">
                    <Icon
                      icon={benefit.icon}
                      size={SizeProp.Small}
                      thick={ThickProp.Thick}
                      className="h-4 w-4"
                    />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-gray-900">
                      {benefit.title}
                    </div>
                    <div className="text-[11px] leading-snug text-gray-500 mt-0.5">
                      {benefit.subtitle}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              title={ctaTitle}
              buttonStyle={ButtonStyleType.PRIMARY}
              icon={ctaIcon}
              onClick={() => {
                window.open(ctaUrl, "_blank");
              }}
            />
            {isCloud ? (
              <Button
                title="Compare plans"
                buttonStyle={ButtonStyleType.OUTLINE}
                icon={IconProp.List}
                onClick={() => {
                  window.open("https://oneuptime.com/pricing", "_blank");
                }}
              />
            ) : (
              <Button
                title="Read docs"
                buttonStyle={ButtonStyleType.OUTLINE}
                icon={IconProp.Book}
                onClick={() => {
                  window.open(
                    "https://oneuptime.com/docs/self-hosted/enterprise",
                    "_blank",
                  );
                }}
              />
            )}
          </div>
        </div>
      </div>
    </Card>
  );
};

export default AuditLogsEnterpriseUpgrade;
