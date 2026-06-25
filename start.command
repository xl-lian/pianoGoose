#!/bin/bash
# 双击启动 pianoGoose：起一个本地服务器并打开浏览器
cd "$(dirname "$0")" || exit 1
PORT=8000
# 端口被占用就顺延
while lsof -i :$PORT >/dev/null 2>&1; do PORT=$((PORT+1)); done
echo "🎹 pianoGoose 正在 http://localhost:$PORT 运行 — 关闭此窗口即可停止"
( sleep 1; open "http://localhost:$PORT" ) &
exec python3 -m http.server $PORT
