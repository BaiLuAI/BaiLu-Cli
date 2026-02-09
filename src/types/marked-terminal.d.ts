/**
 * Type definitions for marked-terminal
 * marked-terminal 的类型声明
 */

declare module 'marked-terminal' {
  interface TerminalRendererOptions {
    code?: (code: string, language: string) => string;
    blockquote?: (quote: string) => string;
    html?: (html: string) => string;
    heading?: (text: string, level: number) => string;
    hr?: () => string;
    list?: (body: string, ordered: boolean) => string;
    listitem?: (text: string) => string;
    paragraph?: (text: string) => string;
    table?: (header: string, body: string) => string;
    tablerow?: (content: string) => string;
    tablecell?: (content: string, flags: { header: boolean; align: string }) => string;
    strong?: (text: string) => string;
    em?: (text: string) => string;
    codespan?: (code: string) => string;
    del?: (text: string) => string;
    link?: (href: string, title: string, text: string) => string;
    image?: (href: string, title: string, text: string) => string;
    br?: () => string;
    text?: (text: string) => string;
    firstHeading?: string;
    showSectionPrefix?: boolean;
    unescape?: boolean;
    emoji?: boolean;
    width?: number;
    reflowText?: boolean;
    tab?: number;
  }

  export default class TerminalRenderer {
    constructor(options?: TerminalRendererOptions);
  }
}
