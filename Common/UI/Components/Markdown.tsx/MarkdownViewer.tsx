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
    <div className="max-w-none p-6 bg-white rounded-lg shadow-md border border-gray-200">
      <ReactMarkdown
        components={{
          // because tailwind does not supply <h1 ... /> styles https://tailwindcss.com/docs/preflight#headings-are-unstyled
          h1: ({ ...props }: any) => {
            return (
              <h1
                className="text-4xl mt-8 mb-6 border-b-2 border-blue-500 pb-2 text-gray-900 font-bold"
                {...props}
              />
            );
          },
          h2: ({ ...props }: any) => {
            return (
              <h2
                className="text-3xl mt-6 mb-4 border-b border-gray-300 pb-1 text-gray-900 font-semibold"
                {...props}
              />
            );
          },
          h3: ({ ...props }: any) => {
            return (
              <h3
                className="text-2xl mt-6 mb-3 text-gray-900 font-semibold"
                {...props}
              />
            );
          },
          h4: ({ ...props }: any) => {
            return (
              <h4
                className="text-xl mt-5 mb-3 text-gray-900 font-medium"
                {...props}
              />
            );
          },
          h5: ({ ...props }: any) => {
            return (
              <h5
                className="text-lg mt-4 mb-2 text-gray-900 font-medium"
                {...props}
              />
            );
          },
          h6: ({ ...props }: any) => {
            return (
              <h6
                className="text-base mt-3 mb-2 text-gray-900 font-medium"
                {...props}
              />
            );
          },
          p: ({ ...props }: any) => {
            return <p className="text-base mt-3 mb-4 text-gray-700 leading-relaxed" {...props} />;
          },
          a: ({ ...props }: any) => {
            return (
              <a className="underline text-blue-600 hover:text-blue-800 font-medium transition-colors" {...props} />
            );
          },

          pre: ({ ...props }: any) => {
            return (
              <pre
                className="bg-gray-900 text-gray-100 mt-4 mb-4 p-4 rounded-lg text-sm overflow-x-auto border border-gray-700"
                {...props}
              />
            );
          },
          strong: ({ ...props }: any) => {
            return (
              <strong
                className="text-base font-semibold text-gray-900"
                {...props}
              />
            );
          },
          li: ({ ...props }: any) => {
            return (
              <li className="text-base mt-2 mb-1 text-gray-700 leading-relaxed" {...props} />
            );
          },
          ul: ({ ...props }: any) => {
            return <ul className="list-disc pl-8 mt-2 mb-4" {...props} />;
          },
          ol: ({ ...props }: any) => {
            return <ol className="list-decimal pl-8 mt-2 mb-4" {...props} />;
          },
          blockquote: ({ ...props }: any) => {
            return (
              <blockquote className="border-l-4 border-blue-500 pl-4 italic text-gray-600 bg-gray-50 py-2 my-4" {...props} />
            );
          },
          table: ({ ...props }: any) => {
            return (
              <table className="min-w-full table-auto border-collapse border border-gray-300 mt-4 mb-4" {...props} />
            );
          },
          thead: ({ ...props }: any) => {
            return (
              <thead className="bg-gray-100" {...props} />
            );
          },
          tbody: ({ ...props }: any) => {
            return (
              <tbody {...props} />
            );
          },
          tr: ({ ...props }: any) => {
            return (
              <tr className="border-b border-gray-200" {...props} />
            );
          },
          th: ({ ...props }: any) => {
            return (
              <th className="px-4 py-2 text-left text-sm font-semibold text-gray-900 border border-gray-300" {...props} />
            );
          },
          td: ({ ...props }: any) => {
            return (
              <td className="px-4 py-2 text-sm text-gray-700 border border-gray-300" {...props} />
            );
          },
          hr: ({ ...props }: any) => {
            return <hr className="border-gray-300 my-6" {...props} />;
          },
          code: (props: any) => {
            const { children, className, ...rest } = props;

            const match: RegExpExecArray | null = new RegExp(
              "language-(\\w+)",
            ).exec(className || "");

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
                : "text-sm px-2 py-1 bg-gray-200 rounded text-gray-900 font-mono";

            return match ? (
              <SyntaxHighlighter
                {...rest}
                PreTag="div"
                // eslint-disable-next-line react/no-children-prop
                children={content}
                language={match[1]}
                style={a11yDark}
                className="rounded-lg mt-4 mb-4"
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
