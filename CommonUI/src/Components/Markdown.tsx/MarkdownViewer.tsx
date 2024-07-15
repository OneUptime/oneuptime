import React, { FunctionComponent, ReactElement } from "react";
// https://github.com/remarkjs/react-markdown
import ReactMarkdown from "react-markdown";
// https://github.com/remarkjs/remark-gfm
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { a11yDark } from "react-syntax-highlighter/dist/esm/styles/prism";

export interface ComponentProps {
  text: string;
}

const MarkdownViewer: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div>
      <ReactMarkdown
        components={{
          // because tailwind does not supply <h1 ... /> styles https://tailwindcss.com/docs/preflight#headings-are-unstyled
          h1: ({ ...props }: any) => {
            return (
              <h1
                className="text-3xl mt-5 border border-gray-200 border-r-0  border-l-0 border-t-0 pb-1 mb-8 text-gray-800 font-medium"
                {...props}
              />
            );
          },
          h2: ({ ...props }: any) => {
            return (
              <h2
                className="text-2xl mt-4 border border-gray-200 border-r-0  border-l-0 border-t-0 pb-1 mb-8 text-gray-800 font-medium"
                {...props}
              />
            );
          },
          h3: ({ ...props }: any) => {
            return (
              <h3
                className="text-xl mt-12 mb-3 text-gray-800 font-medium"
                {...props}
              />
            );
          },
          h4: ({ ...props }: any) => {
            return (
              <h4
                className="text-lg mt-8 mb-3 text-gray-800 font-medium"
                {...props}
              />
            );
          },
          h5: ({ ...props }: any) => {
            return (
              <h5
                className="text-lg mt-5 mb-1 text-gray-800 font-medium"
                {...props}
              />
            );
          },
          h6: ({ ...props }: any) => {
            return (
              <h6
                className="text-base mt-3 text-gray-800 font-medium"
                {...props}
              />
            );
          },
          p: ({ ...props }: any) => {
            return <p className="text-sm mt-2 mb-3 text-gray-500" {...props} />;
          },
          a: ({ ...props }: any) => {
            return (
              <a className="underline text-blue-500 font-medium" {...props} />
            );
          },

          pre: ({ ...props }: any) => {
            return (
              <pre
                className="text-gray-600 mt-4 mb-2 rounded text-sm text-sm overflow-x-auto "
                {...props}
              />
            );
          },
          strong: ({ ...props }: any) => {
            return (
              <strong
                className="text-sm mt-2 text-gray-900 font-medium"
                {...props}
              />
            );
          },
          li: ({ ...props }: any) => {
            return (
              <li className="text-sm mt-2 text-gray-500 list-disc" {...props} />
            );
          },
          ul: ({ ...props }: any) => {
            return <ul className="list-disc px-6 m-1" {...props} />;
          },
          code: (props: any) => {
            const { children, className, ...rest } = props;

            // eslint-disable-next-line wrap-regex
            const match: RegExpExecArray | null = /language-(\w+)/.exec(
              className || "",
            );

            const content: string = String(children as string).replace(
              /\n$/,
              "",
            );

            const codeClassName: string =
              content.includes("\n") ||
              (match &&
                match?.filter((item: string) => {
                  return item.includes("language-");
                }).length > 0)
                ? ""
                : "text-sm p-1 bg-gray-100 rounded text-gray-900 pl-2 pr-2 text-xs";

            return match ? (
              <SyntaxHighlighter
                {...rest}
                PreTag="div"
                // eslint-disable-next-line react/no-children-prop
                children={content}
                language={match[1]}
                style={a11yDark}
              />
            ) : (
              <code className={codeClassName} {...rest}>
                {children}
              </code>
            );
          },
        }}
        remarkPlugins={[remarkGfm]}
      >
        {props.text}
      </ReactMarkdown>
    </div>
  );
};

export default MarkdownViewer;
