
import CodeType from 'Common/Types/Code/CodeType';

import React, {
    FunctionComponent,
    ReactElement,
    useEffect,
    useState,
} from 'react';

import Editor from "@monaco-editor/react";

export interface ComponentProps {
    initialValue?: undefined | string;
    onClick?: undefined | (() => void);
    placeholder?: undefined | string;
    className?: undefined | string;
    onChange?: undefined | ((value: string) => void);
    value?: string | undefined;
    readOnly?: boolean | undefined;
    type: CodeType;
    onFocus?: (() => void) | undefined;
    onBlur?: (() => void) | undefined;
    dataTestId?: string;
    tabIndex?: number | undefined;
    error?: string | undefined;
}

const CodeEditor: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    let className: string = '';

    if (!props.className) {
        className =
            'block w-full rounded-md border border-gray-300 bg-white py-2 pl-3 pr-3 text-sm placeholder-gray-500 focus:border-indigo-500 focus:text-gray-900 focus:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 sm:text-sm';
    } else {
        className = props.className;
    }

    if (props.error) {
        className =
            'block w-full rounded-md border bg-white py-2 pl-3 pr-3 text-sm placeholder-gray-500 focus:border-red-500 focus:text-gray-900 focus:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500 sm:text-sm border-red-300 pr-10 text-red-900 placeholder-red-300 focus:border-red-500 focus:outline-none focus:ring-red-500';
    }

    const [value, setValue] = useState<string>('');

    useEffect(() => {
        props.onChange && props.onChange(value);
    }, [value]);

    useEffect(() => {
        if (props.initialValue) {
            setValue(props.initialValue);
        }

        if (props.value) {
            setValue(props.value);
        }
    }, []);

    useEffect(() => {
        setValue(props.value ? props.value : '');
    }, [props.value]);

    useEffect(() => {
        if (props.initialValue) {
            setValue(props.initialValue);
        }
    }, [props.initialValue]);


    return (
        <div
            id="code-editor"
            onClick={() => {
                props.onClick && props.onClick();
                props.onFocus && props.onFocus();
            }}
        >
            <Editor
                defaultLanguage={props.type}
                height="25vh"
                value={value}
                onChange={(code: string | undefined) => {
                    if (code === undefined) {
                        code = ""
                    }
                    return setValue(code);

                }}
                
                defaultValue={props.initialValue || ''}
                className={className}
                options={{
                    "acceptSuggestionOnCommitCharacter": true,
                    "acceptSuggestionOnEnter": "on",
                    "accessibilitySupport": "auto",

                    "automaticLayout": true,
                    "codeLens": false,
                    "colorDecorators": true,
                    "contextmenu": false,
                    "cursorBlinking": "blink",

                    "cursorStyle": "line",
                    "disableLayerHinting": false,
                    "disableMonospaceOptimizations": false,
                    "dragAndDrop": false,
                    "fixedOverflowWidgets": false,
                    "folding": true,
                    "foldingStrategy": "auto",
                    "fontLigatures": false,
                    "formatOnPaste": false,
                    "formatOnType": false,
                    "hideCursorInOverviewRuler": false,
                    "links": true,
                    "mouseWheelZoom": false,
                    "multiCursorMergeOverlapping": true,
                    "multiCursorModifier": "alt",
                    "overviewRulerBorder": true,
                    "overviewRulerLanes": 2,
                    "quickSuggestions": true,
                    "quickSuggestionsDelay": 100,
                    "readOnly": props.readOnly || false,
                    "renderControlCharacters": false,

                    "renderLineHighlight": "all",
                    "renderWhitespace": "none",
                    "revealHorizontalRightPadding": 30,
                    "roundedSelection": true,
                    "rulers": [],
                    "scrollBeyondLastColumn": 5,
                    "scrollBeyondLastLine": true,
                    "selectOnLineNumbers": true,
                    "selectionClipboard": true,
                    "selectionHighlight": true,
                    "showFoldingControls": "mouseover",
                    "smoothScrolling": false,
                    "suggestOnTriggerCharacters": true,
                    "wordBasedSuggestions": true,
                    "wordSeparators": "~!@#$%^&*()-=+[{]}|;:'\",.<>/?",
                    "wordWrap": "off",
                    "wordWrapBreakAfterCharacters": "\t})]?|&,;",
                    "wordWrapBreakBeforeCharacters": "{([+",
                    "wordWrapColumn": 80,
                    "wrappingIndent": "none"
                }}
            />
            {props.error && (
                <p className="mt-1 text-sm text-red-400">{props.error}</p>
            )}
        </div>
    );
};

export default CodeEditor;
