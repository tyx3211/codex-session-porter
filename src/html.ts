import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";

export interface HtmlRenderOptions {
  title: string;
}

interface RenderedTurn {
  html: string;
  id: string;
  promptLabel: string | null;
  role: "assistant" | "developer" | "summary" | "user";
}

const USER_HEADING = /^用户(?:（|$)/u;
const DEVELOPER_HEADING = /^开发者(?:（|$)/u;
const SUMMARY_HEADING = /^上下文压缩摘要(?:（|$)/u;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function headingText(tokens: readonly Token[], index: number): string {
  if (tokens[index]?.type !== "heading_open") return "";
  const inline = tokens[index + 1];
  return inline?.type === "inline" ? inline.content.trim() : "";
}

function isTurnHeading(tokens: readonly Token[], index: number): boolean {
  return tokens[index]?.type === "heading_open" && tokens[index]?.tag === "h2";
}

function turnRole(heading: string): RenderedTurn["role"] {
  if (USER_HEADING.test(heading)) return "user";
  if (DEVELOPER_HEADING.test(heading)) return "developer";
  if (SUMMARY_HEADING.test(heading)) return "summary";
  return "assistant";
}

function plainInlineText(token: Token | undefined): string {
  if (!token) return "";
  if (!token.children) return token.content;

  return token.children
    .map((child) => {
      if (child.type === "text" || child.type === "code_inline") return child.content;
      if (child.type === "image") return child.content || child.attrGet("alt") || "";
      if (child.type === "softbreak" || child.type === "hardbreak") return " ";
      return "";
    })
    .join("");
}

function promptLabel(tokens: readonly Token[], start: number, end: number, promptNumber: number): string {
  for (let index = start + 3; index < end; index += 1) {
    if (tokens[index]?.type !== "inline") continue;

    const label = plainInlineText(tokens[index]).replace(/\s+/gu, " ").trim();
    if (!label) continue;

    const characters = Array.from(label);
    return characters.length > 88 ? `${characters.slice(0, 88).join("")}...` : label;
  }

  return `Prompt ${promptNumber}`;
}

function createMarkdownRenderer(): MarkdownIt {
  const markdown = new MarkdownIt({
    breaks: true,
    html: false,
    linkify: false,
    typographer: false,
  });

  const fallbackLinkOpen = markdown.renderer.rules.link_open;
  markdown.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
    const href = tokens[index]?.attrGet("href") || "";
    if (/^https?:\/\//iu.test(href)) {
      tokens[index]?.attrSet("target", "_blank");
      tokens[index]?.attrSet("rel", "noopener noreferrer");
    }

    return fallbackLinkOpen
      ? fallbackLinkOpen(tokens, index, options, env, renderer)
      : renderer.renderToken(tokens, index, options);
  };

  return markdown;
}

function splitTurns(markdown: MarkdownIt, tokens: Token[]): { introHtml: string; turns: RenderedTurn[] } {
  const firstTurnIndex = tokens.findIndex((_, index) => isTurnHeading(tokens, index));
  const introTokens = firstTurnIndex < 0 ? tokens : tokens.slice(0, firstTurnIndex);

  if (introTokens[0]?.type === "heading_open" && introTokens[0]?.tag === "h1") {
    introTokens.splice(0, 3);
  }

  const introHtml = markdown.renderer.render(introTokens, markdown.options, {});
  if (firstTurnIndex < 0) return { introHtml, turns: [] };

  const starts: number[] = [];
  for (let index = firstTurnIndex; index < tokens.length; index += 1) {
    if (isTurnHeading(tokens, index)) starts.push(index);
  }

  let promptNumber = 0;
  const turns = starts.map((start, turnIndex): RenderedTurn => {
    const end = starts[turnIndex + 1] ?? tokens.length;
    const heading = headingText(tokens, start);
    const role = turnRole(heading);
    if (role === "user") promptNumber += 1;

    const id = role === "user" ? `prompt-${promptNumber}` : `turn-${turnIndex + 1}`;
    const segment = tokens.slice(start, end);
    const rendered = markdown.renderer.render(segment, markdown.options, {});

    return {
      html: rendered,
      id,
      promptLabel: role === "user" ? promptLabel(tokens, start, end, promptNumber) : null,
      role,
    };
  });

  return { introHtml, turns };
}

export function renderHtmlFromMarkdown(markdownText: string, options: HtmlRenderOptions): string {
  const markdown = createMarkdownRenderer();
  const tokens = markdown.parse(markdownText, {});
  const { introHtml, turns } = splitTurns(markdown, tokens);
  const prompts = turns.filter((turn): turn is RenderedTurn & { promptLabel: string } => turn.promptLabel !== null);

  const navigation = prompts.length
    ? prompts
        .map(
          (prompt, index) =>
            `<a class="prompt-link" data-prompt-link data-prompt-search="${escapeHtml(prompt.promptLabel.toLowerCase())}" href="#${prompt.id}"><span class="prompt-number">${index + 1}</span><span>${escapeHtml(prompt.promptLabel)}</span></a>`,
        )
        .join("\n")
    : '<p class="empty-prompts">未找到用户 Prompt</p>';

  const conversation = turns.length
    ? turns
        .map(
          (turn) =>
            `<section id="${turn.id}" class="turn turn-${turn.role}"${turn.role === "user" ? " data-prompt-section" : ""}>${turn.html}</section>`,
        )
        .join("\n")
    : '<p class="empty-conversation">此会话没有可导出的对话内容。</p>';

  const title = escapeHtml(options.title || "Codex Session");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <link rel="icon" href="data:,">
  <title>${title} - Codex Session</title>
  <style>
    :root {
      color-scheme: light;
      --page: #f4f6f7;
      --paper: #ffffff;
      --sidebar: #172126;
      --sidebar-text: #edf3f1;
      --sidebar-muted: #aebdb8;
      --text: #1d292f;
      --muted: #64737a;
      --border: #d7dfe2;
      --accent: #087f72;
      --accent-soft: #e4f3f0;
      --code: #f0f3f4;
      --quote: #b87718;
    }

    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body {
      margin: 0;
      background: var(--page);
      color: var(--text);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 16px;
      line-height: 1.7;
      letter-spacing: 0;
    }

    .layout { display: grid; grid-template-columns: 304px minmax(0, 1fr); min-height: 100vh; }
    .sidebar {
      position: sticky;
      top: 0;
      height: 100vh;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      background: var(--sidebar);
      color: var(--sidebar-text);
      border-right: 1px solid #26363d;
    }
    .sidebar-header { padding: 26px 22px 18px; border-bottom: 1px solid #304148; }
    .product-label { margin: 0 0 5px; color: #73d4c7; font-size: 12px; font-weight: 700; text-transform: uppercase; }
    .sidebar h1 { margin: 0; font-size: 19px; line-height: 1.35; overflow-wrap: anywhere; }
    .prompt-search {
      width: 100%;
      margin-top: 18px;
      padding: 9px 11px;
      border: 1px solid #496068;
      border-radius: 6px;
      background: #111a1e;
      color: var(--sidebar-text);
      font: inherit;
      font-size: 14px;
      outline: none;
    }
    .prompt-search:focus { border-color: #73d4c7; box-shadow: 0 0 0 2px #73d4c733; }
    .prompt-search::placeholder { color: var(--sidebar-muted); }
    .prompt-list { overflow-y: auto; padding: 12px 10px 24px; }
    .prompt-link {
      display: grid;
      grid-template-columns: 28px minmax(0, 1fr);
      gap: 8px;
      align-items: start;
      padding: 10px 11px;
      border-left: 3px solid transparent;
      border-radius: 4px;
      color: var(--sidebar-muted);
      text-decoration: none;
      font-size: 13px;
      line-height: 1.45;
    }
    .prompt-link:hover { background: #223139; color: var(--sidebar-text); }
    .prompt-link.active { border-left-color: #73d4c7; background: #293c42; color: #ffffff; }
    .prompt-number { color: #73d4c7; font-variant-numeric: tabular-nums; font-weight: 700; }
    .empty-prompts { margin: 14px; color: var(--sidebar-muted); font-size: 14px; }

    main { min-width: 0; }
    .reader { width: min(100%, 1040px); margin: 0 auto; padding: 48px 64px 96px; }
    .document-header { padding-bottom: 30px; border-bottom: 1px solid var(--border); }
    .eyebrow { color: var(--accent); font-size: 12px; font-weight: 800; text-transform: uppercase; }
    .document-header h1 { margin: 6px 0 18px; font-size: 32px; line-height: 1.25; overflow-wrap: anywhere; }
    .document-meta { color: var(--muted); font-size: 13px; }
    .document-meta ul { padding-left: 20px; }
    .document-meta hr { display: none; }

    .conversation { background: var(--paper); border-left: 1px solid var(--border); border-right: 1px solid var(--border); }
    .turn { scroll-margin-top: 24px; padding: 30px 42px; border-bottom: 1px solid var(--border); overflow-wrap: anywhere; }
    .turn:last-child { border-bottom: 0; }
    .turn-user { background: var(--accent-soft); border-left: 4px solid var(--accent); }
    .turn-developer, .turn-summary { background: #fff8e9; border-left: 4px solid var(--quote); }
    .turn h2 { margin: 0 0 16px; font-size: 18px; line-height: 1.4; }
    .turn h3 { margin: 28px 0 12px; font-size: 16px; }
    .turn h4 { margin: 22px 0 10px; font-size: 15px; }
    .turn p { margin: 0 0 16px; }
    .turn p:last-child { margin-bottom: 0; }
    .turn a { color: var(--accent); text-underline-offset: 3px; }
    .turn img { max-width: 100%; height: auto; }
    .turn blockquote { margin: 18px 0; padding: 2px 18px; border-left: 4px solid var(--quote); color: var(--muted); }
    .turn code, .document-meta code { padding: 2px 5px; border-radius: 4px; background: var(--code); font-family: "Cascadia Code", Consolas, monospace; font-size: 0.9em; overflow-wrap: anywhere; word-break: break-word; }
    .turn pre { margin: 18px 0; padding: 17px 19px; overflow: auto; border: 1px solid var(--border); border-radius: 6px; background: var(--code); line-height: 1.55; }
    .turn pre code { padding: 0; border-radius: 0; background: transparent; font-size: 13px; overflow-wrap: normal; word-break: normal; white-space: pre; }
    .turn table { display: block; max-width: 100%; overflow-x: auto; border-collapse: collapse; }
    .turn th, .turn td { padding: 8px 11px; border: 1px solid var(--border); text-align: left; }
    .turn th { background: var(--code); }
    .empty-conversation { padding: 32px 42px; color: var(--muted); }

    @media (prefers-color-scheme: dark) {
      :root {
        color-scheme: dark;
        --page: #111719;
        --paper: #172024;
        --text: #e6edeb;
        --muted: #a9b7b3;
        --border: #334147;
        --accent: #62cfc0;
        --accent-soft: #17312f;
        --code: #101719;
        --quote: #dda74f;
      }
      .turn-developer, .turn-summary { background: #2a2418; }
    }

    @media (max-width: 760px) {
      .layout { display: block; }
      .sidebar { position: relative; height: auto; max-height: 42vh; border-right: 0; border-bottom: 1px solid #304148; }
      .sidebar-header { padding: 18px 18px 14px; }
      .prompt-list { max-height: 24vh; }
      .reader { padding: 30px 16px 64px; }
      .document-header h1 { font-size: 26px; }
      .turn { padding: 24px 20px; }
    }

    @media print {
      .layout { display: block; }
      .sidebar { display: none; }
      .reader { width: 100%; padding: 0; }
      .conversation { border: 0; }
      .turn { break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="layout">
    <aside class="sidebar" aria-label="用户 Prompt 导航">
      <div class="sidebar-header">
        <p class="product-label">Codex Session</p>
        <h1>${title}</h1>
        <input class="prompt-search" type="search" placeholder="搜索 Prompt" aria-label="搜索用户 Prompt" data-prompt-filter>
      </div>
      <nav class="prompt-list" data-role="prompt-navigation">${navigation}</nav>
    </aside>
    <main>
      <article class="reader">
        <header class="document-header">
          <span class="eyebrow">Conversation Export</span>
          <h1>${title}</h1>
          <div class="document-meta">${introHtml}</div>
        </header>
        <div class="conversation">${conversation}</div>
      </article>
    </main>
  </div>
  <script>
    (() => {
      const links = Array.from(document.querySelectorAll('[data-prompt-link]'));
      const sections = Array.from(document.querySelectorAll('[data-prompt-section]'));
      const filter = document.querySelector('[data-prompt-filter]');

      const activate = (id) => {
        for (const link of links) {
          const active = link.getAttribute('href') === '#' + id;
          link.classList.toggle('active', active);
          if (active) link.setAttribute('aria-current', 'true');
          else link.removeAttribute('aria-current');
        }
      };

      if (sections.length > 0 && 'IntersectionObserver' in window) {
        const observer = new IntersectionObserver((entries) => {
          const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
          if (visible[0]) activate(visible[0].target.id);
        }, { rootMargin: '-10% 0px -72% 0px', threshold: 0 });
        sections.forEach((section) => observer.observe(section));
      } else if (sections[0]) {
        activate(sections[0].id);
      }

      filter?.addEventListener('input', () => {
        const query = filter.value.trim().toLocaleLowerCase();
        for (const link of links) {
          link.hidden = query.length > 0 && !link.dataset.promptSearch.includes(query);
        }
      });
    })();
  </script>
</body>
</html>
`;
}
