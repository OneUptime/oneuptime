import { BACKUP_PLURALS, BackupsCopy } from "./BackupsCopy";
import { describeBackupSchedule, formatBackupSize } from "./BackupFormat";
import BackupSetting from "Common/Models/DatabaseModels/BackupSetting";
import {
  BackupProviderDefinition,
  resolveBackupProvider,
} from "Common/Types/Backup/BackupDestinationCatalog";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * What the backups are set to, in four lines: where they go, when they
 * run, how long they are kept and what they hold (with each database's
 * size now) - and Edit, which opens the same form as the setup.
 */

export interface ComponentProps {
  setting: BackupSetting;
  location: string | null;
  postgresSizeInBytes?: number | undefined;
  clickhouseSizeInBytes?: number | undefined;
  canEdit: boolean;
  editDisabledReason?: string | undefined;
  onEdit: () => void;
}

const Row: FunctionComponent<{
  label: string;
  children: ReactElement | Array<ReactElement>;
  testId: string;
}> = (props: {
  label: string;
  children: ReactElement | Array<ReactElement>;
  testId: string;
}): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div
      className="grid grid-cols-1 gap-1 border-t border-gray-100 py-3 first:border-t-0 first:pt-0 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4"
      data-testid={props.testId}
    >
      <div className="text-sm font-medium text-gray-500">
        {translator.translateText(props.label)}
      </div>
      <div className="min-w-0 text-sm text-gray-900">{props.children}</div>
    </div>
  );
};

const BackupSettingsCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const provider: BackupProviderDefinition | undefined = resolveBackupProvider({
    type: props.setting.destinationType,
    provider: props.setting.destinationProvider,
  });
  const includesClickhouse: boolean =
    props.setting.includesClickhouse !== false;
  const retention: number = props.setting.retentionInDays || 30;

  const size: (bytes: number | undefined) => string = (
    bytes: number | undefined,
  ): string => {
    return typeof bytes === "number"
      ? translator.translateTemplate(BackupsCopy.sizeNow, {
          size: formatBackupSize(bytes, translator.language),
        })
      : "";
  };

  return (
    <Card
      title={BackupsCopy.settingsTitle}
      description={BackupsCopy.settingsDescription}
      buttons={[
        {
          title: BackupsCopy.editButton,
          icon: IconProp.Edit,
          buttonStyle: ButtonStyleType.NORMAL,
          disabled: !props.canEdit,
          tooltip: props.canEdit ? undefined : props.editDisabledReason,
          onClick: props.onEdit,
        },
      ]}
    >
      <div data-testid="backups-settings">
        <Row
          label={BackupsCopy.destinationLabel}
          testId="backups-settings-destination"
        >
          <div className="flex min-w-0 items-start gap-2">
            {provider ? (
              <Icon
                icon={provider.icon}
                className="mt-0.5 h-4 w-4 flex-none text-gray-500"
              />
            ) : (
              <></>
            )}
            <div className="min-w-0">
              <div className="font-medium">
                {translator.translateText(provider?.title || "")}
              </div>
              {props.location ? (
                <div
                  className="break-all text-xs text-gray-500"
                  data-testid="backups-settings-location"
                  dir="ltr"
                >
                  {props.location}
                </div>
              ) : (
                <></>
              )}
            </div>
          </div>
        </Row>
        <Row
          label={BackupsCopy.scheduleLabel}
          testId="backups-settings-schedule"
        >
          <span>
            {describeBackupSchedule({
              schedule: {
                frequency: props.setting.frequency,
                timeOfDay: props.setting.timeOfDay || "",
                dayOfWeek: props.setting.dayOfWeek ?? 0,
              },
              translator,
            })}
          </span>
        </Row>
        <Row
          label={BackupsCopy.retentionLabel}
          testId="backups-settings-retention"
        >
          <span>
            {translator.translatePlural(BACKUP_PLURALS.days, retention)}
          </span>
        </Row>
        <Row
          label={BackupsCopy.contentsLabel}
          testId="backups-settings-contents"
        >
          <div className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:gap-x-6">
            <span>
              <span className="font-medium">
                {translator.translateText(BackupsCopy.databasePostgres)}
              </span>
              <span className="text-gray-500">
                {` · ${translator.translateText(BackupsCopy.databasePostgresHint)}`}
                {size(props.postgresSizeInBytes)
                  ? ` · ${size(props.postgresSizeInBytes)}`
                  : ""}
              </span>
            </span>
            {includesClickhouse ? (
              <span>
                <span className="font-medium">
                  {translator.translateText(BackupsCopy.databaseClickhouse)}
                </span>
                <span className="text-gray-500">
                  {` · ${translator.translateText(BackupsCopy.databaseClickhouseHint)}`}
                  {size(props.clickhouseSizeInBytes)
                    ? ` · ${size(props.clickhouseSizeInBytes)}`
                    : ""}
                </span>
              </span>
            ) : (
              <span className="text-gray-500">
                {translator.translateText(BackupsCopy.contentsPostgres)}
              </span>
            )}
          </div>
        </Row>
      </div>
    </Card>
  );
};

export default BackupSettingsCard;
