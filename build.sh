#!/bin/bash
set -e

# apex (snishi-code.com) は静的サイトのみ。ビルド工程は無い。
# Cloudflare Pages の build command がこのファイルを呼んでも安全なように
# no-op を置いている (出力ディレクトリはリポジトリルート = . を指す)。
# index.html / shared.css / site-links.js をそのまま配信する。

echo "apex is static — no build step. Serving repository root as-is."
