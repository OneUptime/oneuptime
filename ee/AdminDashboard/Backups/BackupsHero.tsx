import { BackupsCopy } from "./BackupsCopy";
import Route from "Common/Types/API/Route";
import {
  BACKUP_DOCS_PATH,
  BackupProviderCatalog,
  BackupProviderDefinition,
} from "Common/Types/Backup/BackupDestinationCatalog";
import IconProp from "Common/Types/Icon/IconProp";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import ProviderLogoOrIcon from "Common/UI/Components/ProviderLogo/ProviderLogoOrIcon";
import Navigation from "Common/UI/Utils/Navigation";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The Backups page before anything is set up: what backups are for, the
 * three things they do (a schedule, a retention, a safe restore), one
 * button that opens the setup, the guide, and the storage they work with -
 * the recommended destinations the setup offers.
 */

export interface ComponentProps {
  canSetUp: boolean;
  setUpDisabledReason?: string | undefined;
  onSetUp: () => void;
}

export const openBackupsDocs: () => void = (): void => {
  Navigation.navigate(Route.fromString(BACKUP_DOCS_PATH), {
    openInNewTab: true,
  });
};

const BackupsHero: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const points: Array<{ icon: IconProp; title: string; text: string }> = [
    {
      icon: IconProp.Clock,
      title: BackupsCopy.heroScheduleTitle,
      text: BackupsCopy.heroScheduleText,
    },
    {
      icon: IconProp.Archive,
      title: BackupsCopy.heroRetentionTitle,
      text: BackupsCopy.heroRetentionText,
    },
    {
      icon: IconProp.ShieldCheck,
      title: BackupsCopy.heroRestoreTitle,
      text: BackupsCopy.heroRestoreText,
    },
  ];

  return (
    <div
      className="rounded-lg border border-gray-200 bg-white px-5 py-8 shadow-sm sm:px-8"
      data-testid="backups-hero"
    >
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
        <div className="flex h-12 w-12 flex-none items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
          <Icon icon={IconProp.Database} className="h-6 w-6" />
        </div>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-gray-900">
            {translator.translateText(BackupsCopy.heroTitle)}
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-gray-600">
            {translator.translateText(BackupsCopy.heroDescription)}
          </p>
        </div>
      </div>

      <ul className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-3">
        {points.map(
          (point: { icon: IconProp; title: string; text: string }) => {
            return (
              <li
                key={point.title}
                className="flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4"
              >
                <div className="mt-0.5 flex-none text-indigo-600">
                  <Icon icon={point.icon} className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-900">
                    {translator.translateText(point.title)}
                  </div>
                  <div className="mt-0.5 text-sm text-gray-600">
                    {translator.translateText(point.text)}
                  </div>
                </div>
              </li>
            );
          },
        )}
      </ul>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center [&>button]:ml-0 [&>button]:md:ml-0 [&>*>button]:ml-0 [&>*>button]:md:ml-0">
        <Button
          title={BackupsCopy.setUpButton}
          icon={IconProp.Add}
          buttonStyle={ButtonStyleType.PRIMARY}
          disabled={!props.canSetUp}
          tooltip={props.canSetUp ? undefined : props.setUpDisabledReason}
          dataTestId="backups-set-up"
          onClick={props.onSetUp}
        />
        <Button
          title={BackupsCopy.docsLink}
          icon={IconProp.Book}
          buttonStyle={ButtonStyleType.LINK}
          dataTestId="backups-docs"
          onClick={openBackupsDocs}
        />
      </div>

      {props.canSetUp ? (
        <></>
      ) : (
        <p
          className="mt-2 text-sm text-gray-500"
          data-testid="backups-set-up-note"
        >
          {translator.translateText(props.setUpDisabledReason || "")}
        </p>
      )}

      <div className="mt-8 border-t border-gray-200 pt-5">
        <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
          {translator.translateText(BackupsCopy.recommendedTitle)}
        </div>
        <ul
          className="mt-3 flex flex-wrap gap-2"
          data-testid="backups-recommended-destinations"
        >
          {BackupProviderCatalog.map((provider: BackupProviderDefinition) => {
            return (
              <li
                key={provider.provider}
                className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1 text-sm text-gray-700"
              >
                <ProviderLogoOrIcon
                  logo={provider.logo}
                  icon={provider.icon}
                  isBare={true}
                  isDecorative={true}
                  iconClassName="h-4 w-4 text-gray-500"
                />
                <span>{translator.translateText(provider.title)}</span>
              </li>
            );
          })}
        </ul>
        <p className="mt-4 text-sm text-gray-500">
          {translator.translateText(BackupsCopy.movingHint)}
        </p>
      </div>
    </div>
  );
};

export default BackupsHero;
