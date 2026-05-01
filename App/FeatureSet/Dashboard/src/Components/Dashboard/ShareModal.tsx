import React, { FunctionComponent, ReactElement, useState } from "react";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";

export interface ComponentProps {
  dashboardName: string;
  onClose: () => void;
}

const ShareModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [copied, setCopied] = useState<boolean>(false);

  /*
   * Use the current location for the share URL — anyone in the same
   * project with at least Read permission on this dashboard can open it.
   * A public-link-with-TTL flow (DB-backed share tokens) is a follow-up;
   * this gives teams an immediate "send a link in chat" path without
   * requiring a backend change.
   */
  const url: string = typeof window !== "undefined" ? window.location.href : "";

  const copyLink: () => void = (): void => {
    if (!url || typeof navigator === "undefined" || !navigator.clipboard) {
      return;
    }
    navigator.clipboard
      .writeText(url)
      .then(() => {
        setCopied(true);
        setTimeout(() => {
          setCopied(false);
        }, 2000);
      })
      .catch(() => {
        /*
         * Older browsers / insecure contexts — fall back to selecting
         * the URL so the user can copy manually.
         */
      });
  };

  const printDashboard: () => void = (): void => {
    if (typeof window !== "undefined" && typeof window.print === "function") {
      window.print();
    }
  };

  return (
    <Modal
      title={`Share "${props.dashboardName}"`}
      description="Share this dashboard with teammates or print a snapshot."
      onClose={props.onClose}
      modalWidth={ModalWidth.Medium}
      submitButtonText="Close"
      submitButtonStyleType={ButtonStyleType.NORMAL}
      onSubmit={props.onClose}
    >
      <div className="space-y-4">
        {/* Direct link */}
        <div>
          <div className="flex items-center gap-1.5 mb-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">
            <Icon icon={IconProp.Link} className="w-3.5 h-3.5" />
            <span>Direct link</span>
          </div>
          <p className="text-xs text-gray-400 mb-2">
            Anyone on this project with read access can open this link.
          </p>
          <div className="flex items-stretch gap-2">
            <input
              type="text"
              readOnly
              value={url}
              className="flex-1 px-3 py-2 rounded-md border border-gray-200 bg-gray-50 text-xs text-gray-700 font-mono focus:outline-none focus:ring-1 focus:ring-indigo-300"
              onFocus={(e: React.FocusEvent<HTMLInputElement>) => {
                e.target.select();
              }}
            />
            <button
              type="button"
              onClick={copyLink}
              className={`px-3 py-2 rounded-md text-xs font-medium transition-colors cursor-pointer border ${
                copied
                  ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                  : "bg-indigo-50 border-indigo-100 text-indigo-700 hover:bg-indigo-100"
              }`}
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>

        {/* Print / PDF */}
        <div className="border-t border-gray-100 pt-4">
          <div className="flex items-center gap-1.5 mb-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">
            <Icon icon={IconProp.File} className="w-3.5 h-3.5" />
            <span>Snapshot</span>
          </div>
          <p className="text-xs text-gray-400 mb-2">
            Use your browser&apos;s print dialog to save the current view as a
            PDF or PNG.
          </p>
          <button
            type="button"
            onClick={printDashboard}
            className="px-3 py-2 rounded-md text-xs font-medium border bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
          >
            Open print dialog…
          </button>
        </div>

        {/* Public link / embed (deferred) */}
        <div className="border-t border-gray-100 pt-4">
          <div className="flex items-center gap-1.5 mb-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">
            <Icon icon={IconProp.ExternalLink} className="w-3.5 h-3.5" />
            <span>Public link &amp; embed</span>
          </div>
          <p className="text-xs text-gray-400">
            Token-protected public links and iframe embeds are coming soon. For
            now, OneUptime&apos;s separate Public Dashboard surface is the
            authenticated-bypass route.
          </p>
        </div>
      </div>
    </Modal>
  );
};

export default ShareModal;
