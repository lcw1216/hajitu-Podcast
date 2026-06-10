SERVICE="nginx"

if ! systemctl is-active --quiet $SERVICE; then
    echo "[OK] $SERVICE 已经停止"
    exit 0
fi

echo "[*] 正在停止 $SERVICE..."
systemctl stop $SERVICE

if systemctl is-active --quiet $SERVICE; then
    echo "[ERROR] $SERVICE 停止失败，尝试强制停止..."
    systemctl kill $SERVICE 2>/dev/null
    sleep 1
    if systemctl is-active --quiet $SERVICE; then
        echo "[ERROR] $SERVICE 仍无法停止，请手动检查"
        exit 1
    fi
fi

echo "[OK] $SERVICE 已停止"
