import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import { ShowToastNotification } from "Common/UI/Components/Toast/ToastInit";
import { ToastType } from "Common/UI/Components/Toast/Toast";
import React, { FunctionComponent, ReactElement, useState } from "react";

/**
 * PostUpdateComposer
 *
 * The inline "post an update" box at the top of an event's activity feed — the
 * one-composer-many-surfaces pattern. It is intentionally default-SAFE: the
 * first visibility option (Internal) is selected by default, and any option
 * marked `danger` (e.g. Public / status page) gets a loud "customers will see
 * this" warning so an internal note is never posted publicly by accident.
 */

export interface UpdateVisibilityOption {
  key: string;
  label: string;
  // Marks a customer-facing option (shows a warning when selected).
  danger?: boolean | undefined;
}

export interface ComponentProps {
  visibilityOptions: Array<UpdateVisibilityOption>;
  onPost: (args: { note: string; visibility: string }) => Promise<void>;
  placeholder?: string | undefined;
  successMessage?: string | undefined;
}

const PostUpdateComposer: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [note, setNote] = useState<string>("");
  const [visibility, setVisibility] = useState<string>(
    props.visibilityOptions[0]?.key || "",
  );
  const [isPosting, setIsPosting] = useState<boolean>(false);

  const selected: UpdateVisibilityOption | undefined =
    props.visibilityOptions.find((o: UpdateVisibilityOption): boolean => {
      return o.key === visibility;
    }) || props.visibilityOptions[0];

  const post: () => Promise<void> = async (): Promise<void> => {
    const trimmed: string = note.trim();
    if (!trimmed || isPosting) {
      return;
    }
    setIsPosting(true);
    try {
      await props.onPost({ note: trimmed, visibility: visibility });
      setNote("");
      ShowToastNotification({
        title: props.successMessage || "Update posted",
        description: "",
        type: ToastType.SUCCESS,
      });
    } catch (err) {
      ShowToastNotification({
        title: "Couldn't post update",
        description: err instanceof Error ? err.message : "Please try again.",
        type: ToastType.DANGER,
      });
    } finally {
      setIsPosting(false);
    }
  };

  return (
    <div className="mb-4 rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
      <textarea
        value={note}
        rows={2}
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
          setNote(e.target.value);
        }}
        placeholder={props.placeholder || "Post an update…"}
        aria-label="Post an update"
        className="w-full resize-none border-0 bg-transparent p-1 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-0"
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1">
          {props.visibilityOptions.map(
            (option: UpdateVisibilityOption): ReactElement => {
              const isActive: boolean = option.key === visibility;
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => {
                    setVisibility(option.key);
                  }}
                  className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                    isActive
                      ? option.danger
                        ? "bg-amber-100 text-amber-700"
                        : "bg-indigo-100 text-indigo-700"
                      : "text-gray-500 hover:bg-gray-100"
                  }`}
                >
                  {option.danger && (
                    <Icon icon={IconProp.Public} className="h-3.5 w-3.5" />
                  )}
                  {option.label}
                </button>
              );
            },
          )}
        </div>
        <button
          type="button"
          disabled={!note.trim() || isPosting}
          onClick={post}
          className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPosting ? "Posting…" : "Post"}
        </button>
      </div>
      {selected?.danger && (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-amber-600">
          <Icon icon={IconProp.Public} className="h-3.5 w-3.5" />
          Customers will see this on your status page.
        </div>
      )}
    </div>
  );
};

export default PostUpdateComposer;
