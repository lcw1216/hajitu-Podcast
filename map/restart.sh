#!/bin/bash
# map - 重启 Nginx 服务（含配置检查）
# 用法: bash restart.sh

SERVICE="nginx"

echo "[*] 正在检查 Nginx 配置..."
if ! nginx -t 2>&1; then
    echo "[ERROR] Nginx 配置有误，放弃重启"
    exit 1
fi

if ! systemctl is-active --quiet $SERVICE; then
    echo "[WARN] $SERVICE 未运行，将直接启动"
    systemctl start $SERVICE
else
    echo "[*] 正在重载配置并重启 $SERVICE..."
    systemctl restart $SERVICE
fi

sleep 1

if systemctl is-active --quiet $SERVICE; then
    echo "[OK] $SERVICE 重启成功"
    echo "     访问 http://47.103.145.220/map/"
else
    echo "[ERROR] $SERVICE 重启失败"
    journalctl -u $SERVICE -n 20 --no-pager
    exit 1
fi
