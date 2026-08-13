/**
 * Turn a guide into a PDF that can be handed to somebody as one file.
 *
 *   node scripts/make-pdf.mjs 使用指南.md 拍摄指南.md
 *
 * The guides are Markdown with relative image paths, which is right for the
 * repo and wrong for everything else: mail one of them to a contributor and
 * the screenshots are eight broken links. So the images go in as base64 and
 * the whole thing prints to a single file.
 *
 * Markdown is converted here rather than by a library because the machine has
 * neither pandoc nor a Markdown package, and these two documents use a small,
 * known set of constructs. The parser handles exactly those; it is not a
 * CommonMark implementation and does not pretend to be one. Rendering is done
 * by Edge in headless mode, which is present on any Windows 11 box and brings
 * its own CJK fonts.
 */
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, basename, extname } from 'node:path';

const EDGE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p));
if (!EDGE) {
  console.error('找不到 Edge，无法打印 PDF。');
  process.exit(1);
}

const escapeHtml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Inline spans. Code first, so nothing inside backticks is touched again. */
const inline = (text, baseDir) => {
  const codes = [];
  let s = text.replace(/`([^`]+)`/g, (_, code) => {
    codes.push(`<code>${escapeHtml(code)}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });

  s = escapeHtml(s);

  s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) => {
    const file = resolve(baseDir, src);
    if (!existsSync(file)) {
      console.warn(`  图片缺失，跳过：${src}`);
      return '';
    }
    const type = extname(file).slice(1).toLowerCase() === 'jpg' ? 'jpeg' : extname(file).slice(1).toLowerCase();
    const data = readFileSync(file).toString('base64');
    return `<img src="data:image/${type};base64,${data}" alt="${alt}">`;
  });

  /*
   * A link to a sibling guide cannot be followed from a PDF, so it becomes
   * plain text -- and it names the PDF, since that is the file the reader
   * holding this one actually has.
   */
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) =>
    /^https?:/.test(href) ? `<a href="${href}">${label}</a>` : `<b>${label.replace(/\.md$/, '.pdf')}</b>`,
  );

  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^\w*])\*([^*]+)\*(?=[^\w*]|$)/g, '$1<em>$2</em>');

  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)]);
};

const convert = (markdown, baseDir) => {
  const lines = markdown.split(/\r?\n/);
  const out = [];
  let i = 0;

  /** Blocks that stack: ul, ol, blockquote. Closed when the shape changes. */
  const open = [];
  const closeTo = (depth) => {
    while (open.length > depth) out.push(`</${open.pop()}>`);
  };

  while (i < lines.length) {
    let line = lines[i];

    // Fenced code.
    if (/^\s*```/.test(line)) {
      closeTo(0);
      const body = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
      i++;
      out.push(`<pre><code>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }

    if (!line.trim()) {
      // A blank line ends a paragraph but not a list -- these guides indent
      // continuation lines under numbered steps and expect them to stay there.
      i++;
      continue;
    }

    if (/^\s*---+\s*$/.test(line)) {
      closeTo(0);
      out.push('<hr>');
      i++;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      closeTo(0);
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2], baseDir)}</h${level}>`);
      i++;
      continue;
    }

    // Table: a pipe row followed by a separator row.
    if (/^\s*\|/.test(line) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] ?? '')) {
      closeTo(0);
      const cells = (row) =>
        row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const body = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) body.push(cells(lines[i++]));
      out.push(
        '<table><thead><tr>' +
          head.map((c) => `<th>${inline(c, baseDir)}</th>`).join('') +
          '</tr></thead><tbody>' +
          body
            .map((r) => `<tr>${r.map((c) => `<td>${inline(c, baseDir)}</td>`).join('')}</tr>`)
            .join('') +
          '</tbody></table>',
      );
      continue;
    }

    // Blockquote, possibly indented under a list item.
    const quote = /^\s*>\s?(.*)$/.exec(line);
    if (quote) {
      const body = [];
      while (i < lines.length) {
        const q = /^\s*>\s?(.*)$/.exec(lines[i]);
        if (!q) break;
        body.push(q[1]);
        i++;
      }
      // Paragraph breaks inside a quote are blank quote lines.
      const paras = body
        .join('\n')
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter(Boolean);
      out.push(
        `<blockquote>${paras.map((p) => `<p>${inline(p.replace(/\n/g, ' '), baseDir)}</p>`).join('')}</blockquote>`,
      );
      continue;
    }

    const bullet = /^(\s*)[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      const depth = bullet[1].length >= 2 ? 2 : 1;
      while (open.length > depth) out.push(`</${open.pop()}>`);
      while (open.length < depth) {
        out.push('<ul>');
        open.push('ul');
      }
      const task = /^\[([ xX])\]\s+(.*)$/.exec(bullet[2]);
      const text = task
        ? `<span class="box">${task[1].trim() ? '☑' : '☐'}</span> ${inline(task[2], baseDir)}`
        : inline(bullet[2], baseDir);
      out.push(`<li${task ? ' class="task"' : ''}>${text}</li>`);
      i++;
      continue;
    }

    const numbered = /^(\s*)(\d+)\.\s+(.*)$/.exec(line);
    if (numbered) {
      const depth = numbered[1].length >= 2 ? 2 : 1;
      while (open.length > depth) out.push(`</${open.pop()}>`);
      while (open.length < depth) {
        out.push(`<ol start="${numbered[2]}">`);
        open.push('ol');
      }
      out.push(`<li>${inline(numbered[3], baseDir)}</li>`);
      i++;
      continue;
    }

    // Anything else is a paragraph. Indented ones belong to the open list item.
    const indented = /^\s{2,}\S/.test(line);
    const body = [line.trim()];
    i++;
    while (i < lines.length && lines[i].trim() && !/^\s*([-*>#]|\d+\.|\||```)/.test(lines[i])) {
      body.push(lines[i].trim());
      i++;
    }
    if (!indented) closeTo(0);
    out.push(`<p>${inline(body.join(' '), baseDir)}</p>`);
  }

  closeTo(0);
  return out.join('\n');
};

const CSS = `
@page { size: A4; margin: 16mm 15mm 18mm; }
* { box-sizing: border-box; }
body {
  font: 10.5pt/1.75 "Microsoft YaHei", "Segoe UI", system-ui, sans-serif;
  color: #16191d; margin: 0;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
h1 { font-size: 20pt; margin: 0 0 4mm; letter-spacing: -0.01em; }
h2 {
  font-size: 14pt; margin: 9mm 0 3mm; padding-top: 2.5mm;
  border-top: 2px solid #16191d; break-after: avoid;
}
h3 { font-size: 11.5pt; margin: 6mm 0 2mm; break-after: avoid; }
h1 + p, h2 + p, h3 + p { margin-top: 0; }
p { margin: 0 0 2.6mm; orphans: 2; widows: 2; }
strong { font-weight: 700; }
hr { border: 0; border-top: 1px solid #d8dce2; margin: 6mm 0; }
a { color: #16191d; }

code {
  font: 0.88em/1 "Cascadia Mono", Consolas, monospace;
  background: #eef1f4; padding: 1px 4px; border-radius: 3px;
}
pre {
  background: #f5f7f9; border-left: 3px solid #c3cad3;
  padding: 3mm 4mm; margin: 0 0 3mm; break-inside: avoid;
  font: 9pt/1.6 "Cascadia Mono", Consolas, monospace; white-space: pre-wrap;
}
pre code { background: none; padding: 0; font-size: 1em; }

table { border-collapse: collapse; width: 100%; margin: 0 0 3.5mm; font-size: 9.5pt; }
th, td { border: 1px solid #ccd2da; padding: 1.6mm 2.4mm; text-align: left; vertical-align: top; }
th { background: #eef1f4; font-weight: 700; }
tr { break-inside: avoid; }

blockquote {
  margin: 0 0 3mm; padding: 2.5mm 4mm; background: #f7f4ec;
  border-left: 3px solid #c9a227; break-inside: avoid;
}
blockquote p:last-child { margin-bottom: 0; }

ul, ol { margin: 0 0 3mm; padding-left: 6mm; }
li { margin-bottom: 1.2mm; }
li.task { list-style: none; margin-left: -5mm; }
.box { font-size: 1.15em; margin-right: 1mm; }

img {
  display: block; max-width: 100%; margin: 3mm auto 4mm;
  border: 1px solid #d8dce2; break-inside: avoid;
}
`;

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: node scripts/make-pdf.mjs <file.md> [more.md ...]');
  process.exit(1);
}

const stage = mkdtempSync(join(tmpdir(), 'jptc-pdf-'));

for (const file of files) {
  const source = resolve(file);
  const markdown = readFileSync(source, 'utf8');
  const title = (/^#\s+(.*)$/m.exec(markdown)?.[1] ?? basename(source)).replace(/[*`]/g, '');
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>${escapeHtml(title)}</title><style>${CSS}</style></head>
<body>${convert(markdown, dirname(source))}</body></html>`;

  const htmlPath = join(stage, `${basename(source, '.md')}.html`);
  writeFileSync(htmlPath, html, 'utf8');

  const pdfPath = source.replace(/\.md$/, '.pdf');
  execFileSync(EDGE, [
    '--headless=new',
    '--disable-gpu',
    '--no-pdf-header-footer',
    `--print-to-pdf=${pdfPath}`,
    `file:///${htmlPath.replace(/\\/g, '/')}`,
  ], { stdio: 'pipe' });

  const size = readFileSync(pdfPath).length;
  console.log(`${basename(pdfPath)}  ${(size / 1024).toFixed(0)} KB   (html ${htmlPath})`);
}
