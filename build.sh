#!/bin/bash
set -e

# hospital-rounds をビルド（リポジトリルートに成果物を直接配置）
cd hospital-rounds
npm install
npm run build
cd ..

# ソースを削除してビルド成果物で置き換え
cp -r hospital-rounds/dist _hr_built
rm -rf hospital-rounds
mv _hr_built hospital-rounds

echo "Build complete."
