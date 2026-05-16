#!/usr/bin/env python3
"""Generate docs HTML from Markdown (Obsidian-flavoured)."""
import os, re, html as htmllib
from pathlib import Path

SRC  = Path("docs-src/hospital-rounds")
DEST = Path("docs/hospital-rounds")

PAGES = [
    ("01_はじめに.md",          "はじめに"),
    ("02_ホーム画面.md",         "ホーム画面"),
    ("03_詳細入力画面.md",       "詳細入力画面"),
    ("04_メモ・共有一覧.md",     "メモ・共有一覧"),
    ("05_QRコード.md",           "QRコード"),
    ("06_総覧・印刷.md",         "総覧・印刷"),
    ("07_設定.md",               "設定"),
    ("08_データの取込・出力.md", "データの取込・出力"),
    ("09_タグ機能.md",           "タグ機能"),
    ("10_部屋番号機能.md",       "部屋番号機能"),
    ("11_管理機能.md",           "管理機能（ベータ）"),
]

# ── Inline transformations ─────────────────────────────────────────────────

def inline(text):
    # Obsidian image: ![[name.webp|WxH]]
    text = re.sub(
        r'!\[\[([^\]|]+\.webp)(?:\|(\d+)x\d+)?\]\]',
        lambda m: (
            f'<img src="images/{m.group(1)}" loading="lazy" class="doc-img"'
            + (f' style="max-width:{m.group(2)}px"' if m.group(2) else '')
            + '>'
        ),
        text
    )
    # Standard image: ![alt](images/foo)
    text = re.sub(
        r'!\[([^\]]*)\]\(images/([^\)]+)\)',
        lambda m: f'<img src="images/{m.group(2)}" alt="{htmllib.escape(m.group(1))}" loading="lazy" class="doc-img">',
        text
    )
    # Link *.md → *.html
    text = re.sub(
        r'\[([^\]]+)\]\(([^\)]+)\.md\)',
        lambda m: f'<a href="{m.group(2)}.html">{m.group(1)}</a>',
        text
    )
    # External link
    text = re.sub(
        r'\[([^\]]+)\]\((https?://[^\)]+)\)',
        lambda m: f'<a href="{m.group(2)}" target="_blank" rel="noopener">{m.group(1)}</a>',
        text
    )
    # Bold
    text = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', text)
    # Inline code
    text = re.sub(r'`([^`]+)`', lambda m: f'<code>{htmllib.escape(m.group(1))}</code>', text)
    return text

# ── Block rendering ────────────────────────────────────────────────────────

def render_table(lines):
    rows = []
    for line in lines:
        cells = [c.strip() for c in line.strip().strip('|').split('|')]
        rows.append(cells)
    if len(rows) < 2:
        return ''
    parts = ['<div class="table-wrap"><table><thead><tr>']
    for cell in rows[0]:
        parts.append(f'<th>{inline(cell)}</th>')
    parts.append('</tr></thead><tbody>')
    for row in rows[2:]:  # skip separator row
        parts.append('<tr>')
        for cell in row:
            parts.append(f'<td>{inline(cell)}</td>')
        parts.append('</tr>')
    parts.append('</tbody></table></div>')
    return ''.join(parts)

def md_to_html(src):
    lines = src.split('\n')
    out = []
    i = 0

    while i < len(lines):
        line = lines[i]

        # Blank line
        if not line.strip():
            i += 1
            continue

        # Fenced code block
        if line.startswith('```'):
            code_lines = []
            i += 1
            while i < len(lines) and not lines[i].startswith('```'):
                code_lines.append(lines[i])
                i += 1
            i += 1
            code = htmllib.escape('\n'.join(code_lines))
            out.append(f'<pre><code>{code}</code></pre>')
            continue

        # Heading
        m = re.match(r'^(#{1,3})\s+(.+)', line)
        if m:
            level = len(m.group(1))
            content = inline(m.group(2))
            out.append(f'<h{level}>{content}</h{level}>')
            i += 1
            continue

        # Horizontal rule
        if re.match(r'^-{3,}\s*$', line):
            out.append('<hr>')
            i += 1
            continue

        # Table
        if line.startswith('|'):
            tbl = []
            while i < len(lines) and lines[i].startswith('|'):
                tbl.append(lines[i])
                i += 1
            out.append(render_table(tbl))
            continue

        # Blockquote
        if line.startswith('>'):
            bq = []
            while i < len(lines) and lines[i].startswith('>'):
                bq.append(lines[i][1:].strip())
                i += 1
            out.append(f'<blockquote><p>{inline(" ".join(bq))}</p></blockquote>')
            continue

        # Ordered list
        if re.match(r'^\d+\.\s', line):
            items = []
            while i < len(lines) and re.match(r'^\d+\.\s', lines[i]):
                text = re.sub(r'^\d+\.\s', '', lines[i])
                items.append(f'<li>{inline(text)}</li>')
                i += 1
            out.append('<ol>' + ''.join(items) + '</ol>')
            continue

        # Unordered list
        if re.match(r'^[-*]\s', line):
            items = []
            while i < len(lines) and re.match(r'^[-*]\s', lines[i]):
                items.append(f'<li>{inline(lines[i][2:])}</li>')
                i += 1
            out.append('<ul>' + ''.join(items) + '</ul>')
            continue

        # Paragraph (accumulate lines; images on own line become block-level)
        para = []
        while i < len(lines):
            l = lines[i]
            if (not l.strip()
                    or l.startswith(('```', '#', '|', '>'))
                    or re.match(r'^-{3,}\s*$', l)
                    or (re.match(r'^[-*]\s', l) and not para)
                    or (re.match(r'^\d+\.\s', l) and not para)):
                break
            # Obsidian image alone on a line → flush para then emit image block
            if re.match(r'^!\[\[', l) and not para:
                out.append(f'<p class="img-block">{inline(l)}</p>')
                i += 1
                break
            if re.match(r'^!\[\[', l) and para:
                out.append(f'<p>{inline(" ".join(para))}</p>')
                para = []
                out.append(f'<p class="img-block">{inline(l)}</p>')
                i += 1
                break
            para.append(l)
            i += 1
        if para:
            out.append(f'<p>{inline(" ".join(para))}</p>')

    return '\n'.join(out)

# ── HTML template ──────────────────────────────────────────────────────────

DOCS_CSS = """
.docs-wrap { max-width: 800px; margin: 0 auto; padding: 24px 16px 64px; }
.docs-breadcrumb { font-size: 13px; color: var(--muted); margin-bottom: 24px; }
.docs-breadcrumb a { color: var(--blue); text-decoration: none; }
.docs-breadcrumb a:hover { text-decoration: underline; }
.docs-body h1 { font-size: 1.6rem; font-weight: 700; margin: 0 0 24px; padding-bottom: 12px; border-bottom: 2px solid var(--border); }
.docs-body h2 { font-size: 1.2rem; font-weight: 700; margin: 36px 0 12px; padding-bottom: 6px; border-bottom: 1px solid var(--border); }
.docs-body h3 { font-size: 1rem; font-weight: 700; margin: 24px 0 8px; color: var(--blue); }
.docs-body p { margin: 0 0 14px; line-height: 1.75; }
.docs-body ul { margin: 0 0 14px 20px; }
.docs-body ol { margin: 0 0 14px 20px; }
.docs-body li { margin-bottom: 6px; line-height: 1.75; }
.docs-body hr { border: none; border-top: 1px solid var(--border); margin: 28px 0; }
.docs-body blockquote { margin: 14px 0; padding: 10px 16px; background: var(--blue-light); border-left: 3px solid var(--blue); border-radius: 0 6px 6px 0; }
.docs-body blockquote p { margin: 0; }
.docs-body code { background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-size: .875em; font-family: ui-monospace, monospace; }
.docs-body pre { background: #1e293b; color: #e2e8f0; padding: 16px; border-radius: 8px; overflow-x: auto; margin: 0 0 14px; }
.docs-body pre code { background: none; padding: 0; color: inherit; font-size: .85em; }
.docs-body strong { font-weight: 700; }
.table-wrap { overflow-x: auto; margin: 0 0 14px; }
.table-wrap table { width: 100%; border-collapse: collapse; font-size: .9rem; }
.table-wrap th { background: var(--blue-light); padding: 8px 12px; text-align: left; border-bottom: 2px solid var(--blue-border); white-space: nowrap; }
.table-wrap td { padding: 8px 12px; border-bottom: 1px solid var(--border); vertical-align: top; }
.table-wrap tr:last-child td { border-bottom: none; }
.img-block { text-align: center; margin: 16px 0; }
.doc-img { border-radius: 8px; border: 1px solid var(--border); box-shadow: var(--shadow); display: inline-block; max-width: 100%; height: auto; }
.docs-page-nav { display: flex; justify-content: space-between; gap: 12px; margin-top: 48px; padding-top: 24px; border-top: 1px solid var(--border); }
.docs-page-nav a { display: flex; align-items: center; gap: 6px; padding: 10px 16px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); text-decoration: none; color: var(--text); font-size: .9rem; transition: border-color .15s; }
.docs-page-nav a:hover { border-color: var(--blue); color: var(--blue); }
.docs-page-nav .prev::before { content: '←'; }
.docs-page-nav .next::after { content: '→'; }
.docs-toc { list-style: none; padding: 0; margin: 0; display: grid; gap: 10px; }
.docs-toc li a { display: flex; align-items: center; gap: 10px; padding: 14px 16px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); text-decoration: none; color: var(--text); transition: border-color .15s, box-shadow .15s; }
.docs-toc li a:hover { border-color: var(--blue); box-shadow: var(--shadow); }
.docs-toc .toc-num { font-size: .75rem; color: var(--muted); width: 20px; }
.docs-toc .toc-title { font-weight: 600; }
.docs-toc .toc-arrow { margin-left: auto; color: var(--muted); }
"""

def page_html(title, content_html, prev_page, next_page, app_name="回診"):
    prev_link = ''
    next_link = ''
    if prev_page:
        prev_link = f'<a class="prev" href="{prev_page[0]}.html">{prev_page[1]}</a>'
    if next_page:
        next_link = f'<a class="next" href="{next_page[0]}.html">{next_page[1]}</a>'
    page_nav = f'<nav class="docs-page-nav">{prev_link or "<span></span>"}{next_link or "<span></span>"}</nav>'

    return f"""<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{title} — {app_name} 説明書</title>
  <link rel="stylesheet" href="/shared.css">
  <style>{DOCS_CSS}</style>
</head>
<body>
  <header>
    <div class="header-inner">
      <div class="header-left">
        <a class="logo-mark" href="/">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
        </a>
        <a class="site-name" href="/" style="text-decoration:none;color:inherit;font-weight:600;font-size:.95rem;">snishi-code</a>
      </div>
    </div>
  </header>
  <main>
    <div class="docs-wrap">
      <div class="docs-breadcrumb">
        <a href="/medical/">医療用ツール</a> › <a href="/docs/hospital-rounds/">{app_name} 説明書</a> › {title}
      </div>
      <article class="docs-body">
        {content_html}
      </article>
      {page_nav}
    </div>
  </main>
  <footer>
    <div class="footer-inner">
      <span>© 2026 snishi-code. All rights reserved.</span>
    </div>
  </footer>
</body>
</html>"""

def index_html(pages):
    items = ''
    for i, (fname, title) in enumerate(pages, 1):
        slug = fname.replace('.md', '')
        items += f'''<li>
      <a href="{slug}.html">
        <span class="toc-num">{i:02d}</span>
        <span class="toc-title">{title}</span>
        <span class="toc-arrow">→</span>
      </a>
    </li>\n    '''

    return f"""<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>回診 説明書</title>
  <link rel="stylesheet" href="/shared.css">
  <style>{DOCS_CSS}</style>
</head>
<body>
  <header>
    <div class="header-inner">
      <div class="header-left">
        <a class="logo-mark" href="/">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
        </a>
        <a class="site-name" href="/" style="text-decoration:none;color:inherit;font-weight:600;font-size:.95rem;">snishi-code</a>
      </div>
    </div>
  </header>
  <main>
    <div class="docs-wrap">
      <div class="docs-breadcrumb">
        <a href="/medical/">医療用ツール</a> › 回診 説明書
      </div>
      <article class="docs-body">
        <h1>回診 — 説明書</h1>
        <p>各機能の使い方を説明します。</p>
        <ul class="docs-toc">
    {items}</ul>
      </article>
    </div>
  </main>
  <footer>
    <div class="footer-inner">
      <span>© 2026 snishi-code. All rights reserved.</span>
    </div>
  </footer>
</body>
</html>"""

# ── Main ───────────────────────────────────────────────────────────────────

def main():
    DEST.mkdir(parents=True, exist_ok=True)

    # Write index
    (DEST / "index.html").write_text(index_html(PAGES), encoding="utf-8")
    print("✓ index.html")

    # Write each page
    for idx, (fname, title) in enumerate(PAGES):
        src_path = SRC / fname
        if not src_path.exists():
            print(f"  skip (not found): {fname}")
            continue

        md_text = src_path.read_text(encoding="utf-8")
        body = md_to_html(md_text)

        prev_page = None
        next_page = None
        if idx > 0:
            pf, pt = PAGES[idx - 1]
            prev_page = (pf.replace('.md', ''), pt)
        if idx < len(PAGES) - 1:
            nf, nt = PAGES[idx + 1]
            next_page = (nf.replace('.md', ''), nt)

        out_name = fname.replace('.md', '.html')
        html = page_html(title, body, prev_page, next_page)
        (DEST / out_name).write_text(html, encoding="utf-8")
        print(f"✓ {out_name}")

    print(f"\nDone → {DEST}/")

if __name__ == "__main__":
    main()
