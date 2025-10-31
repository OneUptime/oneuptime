import Modal from "../Modal/Modal";
import React, {
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import { BILLING_ENABLED, IS_ENTERPRISE } from "../../Config";

export interface ComponentProps {
  className?: string | undefined;
}

const ENTERPRISE_URL: string = "https://oneuptime.com/enterprise";

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
        className={`inline-flex items-center justify-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-indigo-700 transition hover:bg-indigo-100 focus:outline-none focus-visible:ring focus-visible:ring-indigo-300 ${
          props.className ? props.className : ""
        }`}
      >
        {editionName}
      </button>

      {isDialogOpen && (
        <Modal
          title={editionName}
          submitButtonText={IS_ENTERPRISE ? "Learn More" : "Talk to Sales"}
          closeButtonText="Close"
          onClose={closeDialog}
          onSubmit={handlePrimaryAction}
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
                  You are running the Community Edition of OneUptime. Upgrade to
                  Enterprise to unlock advanced automation, security controls,
                  and priority support.
                </p>
                <ul className="list-disc space-y-1 pl-5">
                  <li>Unlimited monitors, workflows, and integrations.</li>
                  <li>Role-based access controls and audit trails.</li>
                  <li>24/7 priority support with guaranteed SLAs.</li>
                </ul>
              </>
            )}
          </div>
        </Modal>
      )}
    </>
  );
};

export default EditionLabel;
