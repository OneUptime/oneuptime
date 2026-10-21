import { Context, createContext, useCallback, useMemo, useState } from "react";

/*
 * Which folded sections of a form are open right now - what a form dialog
 * needs to size itself by what is on screen (Forms/Utils/FormModalWidth.ts).
 *
 * A Markdown editor folded away in a collapsed section - the optional note
 * of an Acknowledge or Resolve confirm, a description under "Advanced" - is
 * not on screen until the section is opened. The dialog opens at its own
 * width and grows to the wide one when someone opens the section to write,
 * so a short confirm is not a wide, mostly empty dialog, and the editor
 * still gets the room its toolbar needs once it is shown.
 *
 * The dialog (ModelFormModal, BasicFormModal) keeps the record with
 * useOpenFormSections and hands its reporter down through
 * OpenFormSectionsContext; each folded section (CollapsibleFormSection)
 * reports itself opening, folding and going away. A form drawn anywhere
 * else has no dialog above it, and its sections report to no one.
 */

export interface FormSectionOpenReport {
  // One section on screen: the same section drawn twice reports twice.
  instanceId: string;
  // The section's id (FormFieldCollapsibleSection.id).
  sectionId: string;
  isOpen: boolean;
}

export type ReportFormSectionOpenFunction = (
  report: FormSectionOpenReport,
) => void;

export const OpenFormSectionsContext: Context<ReportFormSectionOpenFunction | null> =
  createContext<ReportFormSectionOpenFunction | null>(null);

export interface OpenFormSections {
  // The ids of the sections that are open, each once.
  openSectionIds: Array<string>;
  // Stable across renders, so a section's report effect runs only on a change.
  reportSectionOpen: ReportFormSectionOpenFunction;
}

/*
 * The open sections, by the section on screen that reported them. A report
 * that changes nothing keeps the record as it was, so the dialog does not
 * draw again for it.
 */
export type UpdateOpenSectionsFunction = (
  openSections: Readonly<Record<string, string>>,
  report: FormSectionOpenReport,
) => Readonly<Record<string, string>>;

export const updateOpenSections: UpdateOpenSectionsFunction = (
  openSections: Readonly<Record<string, string>>,
  report: FormSectionOpenReport,
): Readonly<Record<string, string>> => {
  const isRecordedOpen: boolean =
    openSections[report.instanceId] === report.sectionId;

  if (report.isOpen === isRecordedOpen) {
    return openSections;
  }

  const next: Record<string, string> = { ...openSections };

  if (report.isOpen) {
    next[report.instanceId] = report.sectionId;
  } else {
    delete next[report.instanceId];
  }

  return next;
};

export type UseOpenFormSectionsFunction = () => OpenFormSections;

export const useOpenFormSections: UseOpenFormSectionsFunction =
  (): OpenFormSections => {
    const [openSections, setOpenSections] = useState<
      Readonly<Record<string, string>>
    >({});

    const reportSectionOpen: ReportFormSectionOpenFunction = useCallback(
      (report: FormSectionOpenReport): void => {
        setOpenSections(
          (
            previous: Readonly<Record<string, string>>,
          ): Readonly<Record<string, string>> => {
            return updateOpenSections(previous, report);
          },
        );
      },
      [],
    );

    const openSectionIds: Array<string> = useMemo((): Array<string> => {
      return Array.from(new Set<string>(Object.values(openSections)));
    }, [openSections]);

    return {
      openSectionIds: openSectionIds,
      reportSectionOpen: reportSectionOpen,
    };
  };
