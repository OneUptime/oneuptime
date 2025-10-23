import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FieldType from "Common/UI/Components/Types/FieldType";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import Card from "Common/UI/Components/Card/Card";
import { APP_API_URL } from "Common/UI/Config";
import HiddenText from "Common/UI/Components/HiddenText/HiddenText";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/MarkdownViewer";

const StatusPageEmbeddedStatus: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const [showRegenerateTokenModal, setShowRegenerateTokenModal] =
    useState<boolean>(false);
  const [isRegenerating, setIsRegenerating] = useState<boolean>(false);
  const [token, setToken] = useState<string | undefined>(undefined);
  const [isEmbeddedStatusEnabled, setIsEmbeddedStatusEnabled] =
    useState<boolean>(false);

  const regenerateToken: () => Promise<void> = async (): Promise<void> => {
    setIsRegenerating(true);
    try {
      // Generate a cryptographically safe token based on ObjectID
      const newToken: string = ObjectID.generate().toString();

      await ModelAPI.updateById<StatusPage>({
        id: modelId,
        modelType: StatusPage,
        data: {
          embeddedOverallStatusToken: newToken,
        },
      });

      setShowRegenerateTokenModal(false);
      window.location.reload();
    } catch {
      // Error will be handled by ModelAPI
    } finally {
      setIsRegenerating(false);
    }
  };

  const badgeUrlWithToken: string | null = token
    ? `${APP_API_URL}/status-page/badge/${modelId.toString()}?token=${token}`
    : null;
  const badgeUrlDocumentation: string =
    badgeUrlWithToken ||
    `${APP_API_URL}/status-page/badge/${modelId.toString()}?token={TOKEN_PLACEHOLDER}`;

  const introMessage: string =
    isEmbeddedStatusEnabled && token
      ? "Your embedded status badge is currently enabled and can be embedded using the snippets below."
      : "Enable the embedded status badge and generate a security token to activate the snippets below.";

  const documentationMarkdown: string = `## Badge Usage

${introMessage}

### Badge URL
\`${badgeUrlDocumentation}\`

### HTML Embed
\`\`\`html
<img src="${badgeUrlDocumentation}" alt="Status Badge" />
\`\`\`

### Markdown Embed
\`\`\`markdown
![Status](${badgeUrlDocumentation})
\`\`\`

### Markdown with Link
\`\`\`markdown
[![Status](${badgeUrlDocumentation})](https://your-status-page-url.com)
\`\`\`

### Use Cases
- Add to your company website to show real-time status
- Include in project README.md files on GitHub
- Embed in documentation sites
- Display on internal dashboards
- Include in status emails or reports

### Security
Regenerating the token invalidates all existing embeds. Rotate the token whenever you suspect the URL has been shared publicly.
`;

  return (
    <Fragment>
      <CardModelDetail<StatusPage>
        name="Status Page > Embedded Status Badge"
        cardProps={{
          title: "Embedded Status Badge",
          description:
            "Enable a lightweight status badge that can be embedded on external websites. The badge displays the current overall status of your status page.",
        }}
        editButtonText="Edit Settings"
        isEditable={true}
        formFields={[
          {
            field: {
              enableEmbeddedOverallStatus: true,
            },
            title: "Enable Embedded Status Badge",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            description:
              "When enabled, you can embed a status badge on external websites using the badge URL with the security token.",
          },
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: StatusPage,
          id: "model-detail-status-page-embedded-badge",
          fields: [
            {
              field: {
                enableEmbeddedOverallStatus: true,
              },
              fieldType: FieldType.Boolean,
              title: "Enable Embedded Status Badge",
            },
          ],
          modelId: modelId,
          onItemLoaded: (item: StatusPage) => {
            setToken(item.embeddedOverallStatusToken || undefined);
            setIsEmbeddedStatusEnabled(
              Boolean(item.enableEmbeddedOverallStatus),
            );
          },
        }}
      />

      <Card
        title="Security Token"
        description="Review and copy the token required to access the embedded badge. Keep it confidential to prevent unauthorized access."
      >
        <div className="space-y-3">
          {token ? (
            <HiddenText text={token} isCopyable={true} />
          ) : (
            <p className="text-sm text-gray-500">
              No token has been generated yet. Enable the embedded badge to
              create one.
            </p>
          )}
          <p className="text-sm text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-md p-3">
            Anyone with this token can render your badge. Rotate it immediately
            if you suspect exposure.
          </p>
        </div>
      </Card>

      <Card
        title="Token Rotation"
        description="Regenerate the security token to invalidate all existing embedded badges."
      >
        <div className="space-y-2">
          <Button
            title="Regenerate Token"
            buttonStyle={ButtonStyleType.NORMAL}
            icon={IconProp.Refresh}
            onClick={() => {
              setShowRegenerateTokenModal(true);
            }}
          />
          <p className="text-sm text-gray-500">
            Regenerating the token will invalidate any existing embedded
            badges.
          </p>
        </div>
      </Card>

      <Card
        title="Badge Preview"
        description="Preview the live badge rendering using the current security token."
      >
        {isEmbeddedStatusEnabled ? (
          badgeUrlWithToken ? (
            <img
              src={badgeUrlWithToken}
              alt="Status Badge"
              className="rounded-md border border-gray-200"
            />
          ) : (
            <p className="text-sm text-gray-500">
              Generate a security token to see the live preview.
            </p>
          )
        ) : (
          <p className="text-sm text-gray-500">
            Enable the embedded status badge to view the live preview.
          </p>
        )}
      </Card>

      <Card
        title="Badge Documentation"
        description="Review the rendered documentation before sharing with your team."
      >
        <MarkdownViewer text={documentationMarkdown} />
      </Card>

      {showRegenerateTokenModal && (
        <ConfirmModal
          title="Regenerate Security Token"
          description="Are you sure you want to regenerate the security token? This will invalidate the current token and any existing embedded badges will stop working until you update them with the new token."
          onClose={() => {
            setShowRegenerateTokenModal(false);
          }}
          submitButtonText="Regenerate Token"
          onSubmit={regenerateToken}
          isLoading={isRegenerating}
        />
      )}
    </Fragment>
  );
};

export default StatusPageEmbeddedStatus;
