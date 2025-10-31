import Modal, { ModalWidth } from "../Modal/Modal";
import React, { FunctionComponent, ReactElement, useState } from "react";
import { BILLING_ENABLED, IS_ENTERPRISE } from "../../Config";

export interface ComponentProps {
  className?: string | undefined;
}

const ENTERPRISE_URL: string = "https://oneuptime.com/enterprise/demo";

const EditionLabel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isDialogOpen, setIsDialogOpen] = useState<boolean>(false);

  if (BILLING_ENABLED) {
    return <></>;
  }

  const editionName: string = IS_ENTERPRISE
    ? "Enterprise Edition"
    : "Community Edition";

  const indicatorColor: string = IS_ENTERPRISE
    ? "bg-emerald-500"
    : "bg-indigo-400";

  const ctaLabel: string = IS_ENTERPRISE ? "View benefits" : "Learn more";

  const openDialog: () => void = () => {
    setIsDialogOpen(true);
  };

  const closeDialog: () => void = () => {
    setIsDialogOpen(false);
  };

  const handlePrimaryAction: () => void = () => {
    if (typeof window !== "undefined") {
      window.open(ENTERPRISE_URL, "_blank", "noopener,noreferrer");
    }

    closeDialog();
  };

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        className={`group inline-flex items-center gap-2 rounded-full border border-indigo-100 bg-white px-3 py-1 text-xs font-medium text-indigo-700 shadow-sm transition hover:border-indigo-300 hover:bg-indigo-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
          props.className ? props.className : ""
        }`}
        aria-label={`${editionName} details`}
      >
        <span
          className={`h-2 w-2 rounded-full transition group-hover:scale-110 ${indicatorColor}`}
        ></span>
        <span className="tracking-wide">{editionName}</span>
        <span className="text-[11px] text-indigo-500 group-hover:text-indigo-600">
          {ctaLabel}
        </span>
      </button>

      {isDialogOpen && (
        <Modal
          title={editionName}
          submitButtonText={IS_ENTERPRISE ? "Learn More" : "Talk to Sales"}
          closeButtonText="Close"
          onClose={closeDialog}
          onSubmit={handlePrimaryAction}
          modalWidth={ModalWidth.Large}
        >
          <div className="space-y-3 text-sm text-gray-600">
            {IS_ENTERPRISE ? (
              <>
                <p>
                  You are running the Enterprise Edition of OneUptime. This
                  includes premium capabilities such as enterprise-grade
                  support, governance controls, and unlimited project scale.
                </p>
                <p>
                  Reach out to our team if you need help enabling additional
                  enterprise features or onboarding new teams.
                </p>
              </>
            ) : (
              <>
                <p>
                  You are running the Community Edition of OneUptime. Here is a
                  quick comparison to help you decide if Enterprise is the right
                  fit for your team.
                </p>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                    <h3 className="text-sm font-semibold text-gray-900">
                      Community Edition
                    </h3>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-gray-600">
                      <li>Core monitoring, incident response, and reliability workflows.</li>
                      <li>Self-managed upgrades and configuration.</li>
                      <li>Community-driven support through docs and forums.</li>
                    </ul>
                  </div>
                  <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-4 shadow-sm">
                    <h3 className="text-sm font-semibold text-indigo-900">
                      Enterprise Edition
                    </h3>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-indigo-900">
                      <li>Enterprise (hardened and secure) Docker images.</li>
                      <li>Dedicated enterprise support phone number available 24/7/365.</li>
                      <li>Priority chat and email support.</li>
                      <li>
                        Dedicated engineer who can build custom features to integrate OneUptime with
                        your ecosystem.
                      </li>
                      <li>Compliance reports (ISO, SOC, GDPR, HIPAA).</li>
                      <li>Legal indemnification.</li>
                      <li>Audit logs.</li>
                    </ul>
                  </div>
                </div>
                <p className="text-xs text-gray-500">
                  Ready to unlock enterprise capabilities? Click “Talk to Sales” to start the
                  conversation.
                </p>
              </>
            )}
          </div>
        </Modal>
      )}
    </>
  );
};

export default EditionLabel;
