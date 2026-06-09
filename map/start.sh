#!/bin/bash
# map - 启动 Nginx 服务
# 用法: bash start.sh

SERVICE="nginx"

if systemctl is-active --quiet $SERVICE; then
    echo "[OK] $SERVICE 已经在运行中"
    echo "      访问 http://47.103.145.220/map/"
    exit 0
fi

echo "[*] 正在启动 $SERVICE..."
systemctl start $SERVICE

if systemctl is-active --quiet $SERVICE; then
    echo "[OK] $SERVICE 启动成功"
    echo "     访问 http://47.103.145.220/map/"
else
    echo "[ERROR] $SERVICE 启动失败，请检查日志：journalctl -u $SERVICE -n 50"
    exit 1
fi
