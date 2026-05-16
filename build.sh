#!/bin/bash
set -e

mkdir -p dist/medical dist/personal

# サイトページをコピー
cp index.html dist/index.html
cp medical/index.html dist/medical/index.html
cp personal/index.html dist/personal/index.html

# hospital-rounds をビルドして dist/hospital-rounds/ に配置
cd hospital-rounds
npm install
npm run build
cd ..
cp -r hospital-rounds/dist/. dist/hospital-rounds/

echo "Build complete → dist/"
