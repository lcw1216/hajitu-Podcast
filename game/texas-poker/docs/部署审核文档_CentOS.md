# Texas Poker 项目 CentOS 部署审核文档

> **审核日期**: 2026-05-16  
> **项目版本**: v1.0  
> **目标环境**: CentOS 7/8/9  
> **审核人**: 项目开发团队

---

## 目录

1. [服务器环境准备检查清单](#1-服务器环境准备检查清单)
2. [项目部署前需修复的问题汇总](#2-项目部署前需修复的问题汇总)
3. [部署流程与注意事项](#3-部署流程与注意事项)
4. [性能与安全优化建议](#4-性能与安全优化建议)

---

## 1. 服务器环境准备检查清单

### 1.1 CentOS 操作系统版本兼容性验证

| 检查项 | 最低要求 | 推荐版本 | 验证命令 | 状态 |
|--------|----------|----------|----------|------|
| 操作系统 | CentOS 7 | CentOS 8 Stream / CentOS 9 Stream | `cat /etc/redhat-release` | ⚠️ 需验证 |
| 内核版本 | 3.10+ | 4.18+ | `uname -r` | ⚠️ 需验证 |
| glibc 版本 | 2.17+ | 2.28+ | `ldd --version` | ⚠️ 需验证 |

**兼容性说明**:

- 项目使用 Python 3.13，CentOS 7 默认 glibc 2.17，Python 3.13 要求 glibc 2.17+，理论上兼容但建议 CentOS 8+
- C++ 引擎使用 ctypes FFI 加载 `.so` 动态库，需确保 glibc ABI 兼容
- `random.SystemRandom()` 依赖 `/dev/urandom`，CentOS 默认可用

### 1.2 必要系统依赖安装状态

#### Python 环境

```bash
# 检查 Python 版本（需要 3.10+）
python3 --version

# CentOS 7 默认 Python 2.7，需手动安装 Python 3
# 方案一：编译安装
sudo yum groupinstall "Development Tools"
sudo yum install openssl-devel bzip2-devel libffi-devel zlib-devel readline-devel sqlite-devel
cd /usr/src
sudo curl -O https://www.python.org/ftp/python/3.13.7/Python-3.13.7.tgz
sudo tar xzf Python-3.13.7.tgz
cd Python-3.13.7
sudo ./configure --enable-optimizations --prefix=/usr/local
sudo make altinstall

# 方案二：使用 IUS 仓库（CentOS 7）
sudo yum install https://repo.ius.io/ius-release-el7.rpm
sudo yum install python313
```

#### Python 依赖包

```bash
# 核心依赖（项目无 requirements.txt，需手动安装）
pip3.13 install bcrypt websockets pytest

# 版本要求
# bcrypt >= 4.0 （密码哈希）
# websockets >= 12.0 （WebSocket 服务器）
# pytest >= 8.0 （测试，可选）
```

| 依赖包 | 最低版本 | 用途 | 安装验证 |
|--------|----------|------|----------|
| `bcrypt` | 4.0+ | 密码哈希存储 | `python3 -c "import bcrypt; print(bcrypt.__version__)"` |
| `websockets` | 12.0+ | WebSocket 服务 | `python3 -c "import websockets; print(websockets.__version__)"` |
| `pytest` | 8.0+ | 自动化测试 | `python3 -c "import pytest; print(pytest.__version__)"` |

#### C++ 编译工具链（引擎构建）

```bash
# 安装 CMake 和 GCC
sudo yum install cmake gcc gcc-c++ make

# 验证
cmake --version   # >= 3.14
g++ --version     # 支持 C++17
```

#### SQLite

```bash
# CentOS 自带 SQLite，检查版本
sqlite3 --version   # 需要 3.8+ 以支持 WAL 模式

# CentOS 7 默认 SQLite 3.7.17，WAL 模式需 3.8+
# 如版本不足，需升级：
sudo yum install sqlite-devel
```

### 1.3 防火墙配置与端口开放

| 端口 | 协议 | 服务 | 开放范围 | 配置命令 |
|------|------|------|----------|----------|
| 9001 | TCP | HTTP API + 静态文件 | 外网可访问 | `sudo firewall-cmd --permanent --add-port=9001/tcp` |
| 9002 | TCP | WebSocket 游戏服务 | 外网可访问 | `sudo firewall-cmd --permanent --add-port=9002/tcp` |
| 22 | TCP | SSH（管理） | 仅内网 | 默认已开放 |

```bash
# 查看防火墙状态
sudo firewall-cmd --state

# 开放端口
sudo firewall-cmd --permanent --add-port=9001/tcp
sudo firewall-cmd --permanent --add-port=9002/tcp
sudo firewall-cmd --reload

# 验证
sudo firewall-cmd --list-ports

# 如使用 iptables（CentOS 6/7 替代方案）
sudo iptables -A INPUT -p tcp --dport 9001 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 9002 -j ACCEPT
sudo service iptables save
```

**SELinux 配置**:

```bash
# 检查 SELinux 状态
getenforce

# 如为 Enforcing，需允许服务绑定端口
sudo semanage port -a -t http_port_t -p tcp 9001
sudo semanage port -a -t http_port_t -p tcp 9002

# 或临时设为 Permissive（不推荐生产环境）
sudo setenforce 0
```

### 1.4 服务器资源评估

| 资源 | 最低配置 | 推荐配置 | 评估依据 |
|------|----------|----------|----------|
| CPU | 1 核 | 2 核+ | HTTP 多线程 + WebSocket 异步 |
| 内存 | 512 MB | 1 GB+ | Python 进程 + SQLite 缓存 + 游戏状态 |
| 磁盘 | 1 GB | 5 GB+ | 日志、数据库、静态资源（含 54 张扑克图片） |
| 网络 | 1 Mbps | 10 Mbps+ | WebSocket 实时通信 |

**资源消耗估算**:

- 单个 Python HTTP 进程：约 30-50 MB 内存
- 单个 WebSocket 进程：约 20-40 MB 内存
- 每个活跃游戏房间：约 1-5 MB 内存
- SQLite 数据库：随用户量增长，1万用户约 10-50 MB
- C++ 引擎 DLL：约 1-5 MB

---

## 2. 项目部署前需修复的问题汇总

### 2.1 🔴 严重（Critical）— 必须修复

#### C-01: HOST 绑定 127.0.0.1 无法外部访问

**文件**: `server/config.py` (第8行), `server/main.py` (第13-14行)

```python
# 当前代码（仅本地访问）
HOST = "127.0.0.1"
```

**问题**: 服务器绑定到 `127.0.0.1`，外部客户端无法连接。

**修复方案**: 使用环境变量控制绑定地址：

```python
import os

HOST = os.environ.get("POKER_HOST", "127.0.0.1")
PORT = int(os.environ.get("POKER_HTTP_PORT", "9001"))
```

`main.py` 同理：

```python
HOST = os.environ.get("POKER_WS_HOST", "127.0.0.1")
PORT = int(os.environ.get("POKER_WS_PORT", "9002"))
```

部署时设置 `POKER_HOST=0.0.0.0`。

---

#### C-02: CORS 配置硬编码为 localhost

**文件**: `server/config.py` (第39行)

```python
CORS_ORIGINS = ["http://127.0.0.1:9001", "http://localhost:9001"]
```

**问题**: 部署到服务器后，前端域名变更，CORS 校验将全部失败。

**修复方案**:

```python
CORS_ORIGINS = os.environ.get(
    "POKER_CORS_ORIGINS",
    "http://127.0.0.1:9001,http://localhost:9001"
).split(",")
```

---

#### C-03: 前端 API 地址硬编码为 localhost

**文件**: `app.js` (第2行)

```javascript
var API_BASE = "http://127.0.0.1:9001";
```

**问题**: 部署后前端无法连接后端 API。

**修复方案**: 动态获取当前域名：

```javascript
var API_BASE = window.location.protocol + "//" + window.location.hostname + ":9001";
```

或使用环境变量注入：

```javascript
var API_BASE = window.POKER_API_BASE || (window.location.protocol + "//" + window.location.host);
```

---

#### C-04: WebSocket URL 硬编码为 localhost

**文件**: `server/app.py` (`game_config` 接口)

```python
"ws_url": "ws://127.0.0.1:9002",
```

**问题**: 客户端获取的 WebSocket 地址无法连接。

**修复方案**:

```python
"ws_url": os.environ.get("POKER_WS_URL", "ws://127.0.0.1:9002"),
```

---

#### C-05: Cookie Secure 标志设为 False

**文件**: `server/app.py` (login 函数)

```python
resp.set_cookie("token", token, max_age=..., http_only=True, secure=False, same_site="strict")
```

**问题**: 生产环境应启用 HTTPS，Cookie 的 `Secure` 标志必须为 `True`，否则 token 可被中间人截获。

**修复方案**: 根据环境动态设置：

```python
is_production = os.environ.get("POKER_ENV") == "production"
resp.set_cookie("token", token, max_age=...,
                http_only=True, secure=is_production, same_site="strict")
```

---

#### C-06: C++ 引擎 .so 文件需在 CentOS 上重新编译

**文件**: `server/hand_eval.py`, `engine/`

**问题**: 当前 `hand_eval.dll` 为 Windows 编译产物，CentOS 需要 `.so` 文件。且编译环境的 glibc 版本必须与目标服务器一致或更低。

**修复方案**: 在目标 CentOS 服务器上编译：

```bash
cd /path/to/project/engine
mkdir -p build && cd build
cmake ..
make
cp libhand_eval.so /path/to/project/server/
```

---

### 2.2 🟠 高（High）— 强烈建议修复

#### H-01: 数据库路径不可配置

**文件**: `server/config.py` (第36行)

```python
DB_PATH = os.path.join(BASE_DIR, "poker.db")
```

**问题**: 无法将数据库放置在独立磁盘或备份目录。

**修复方案**:

```python
DB_PATH = os.environ.get("POKER_DB_PATH", os.path.join(BASE_DIR, "poker.db"))
```

---

#### H-02: 缺少 requirements.txt

**问题**: 项目无依赖声明文件，部署时无法一键安装依赖。

**修复方案**: 创建 `requirements.txt`：

```
bcrypt>=4.0
websockets>=12.0
pytest>=8.0
```

---

#### H-03: 日志未输出到文件

**文件**: `server/app.py`, `server/main.py`

**问题**: 当前日志仅输出到 stdout，服务以 systemd 运行时日志分散，不便于排查和审计。

**修复方案**: 添加 `RotatingFileHandler`：

```python
import logging
from logging.handlers import RotatingFileHandler

log_dir = os.environ.get("POKER_LOG_DIR", "/var/log/poker")
os.makedirs(log_dir, exist_ok=True)

file_handler = RotatingFileHandler(
    os.path.join(log_dir, "app.log"),
    maxBytes=10 * 1024 * 1024,  # 10MB
    backupCount=5
)
file_handler.setFormatter(logging.Formatter(config.LOG_FORMAT))
logging.getLogger().addHandler(file_handler)
```

---

#### H-04: SQLite 不适合高并发生产环境

**文件**: `server/app.py` (get_db 函数)

**问题**: SQLite 的写锁机制在并发场景下性能有限，WAL 模式下并发写入仍受限。

**建议**: 
- 短期：确保 WAL 模式已启用（当前已启用），设置合理的 busy_timeout
- 中期：评估迁移到 PostgreSQL 或 MySQL

---

#### H-05: 速率限制基于内存存储

**文件**: `server/rate_limit.py`

**问题**: 速率限制数据存储在进程内存中，HTTP 和 WebSocket 是独立进程，速率限制不共享。服务重启后限制重置。

**修复方案**: 使用 Redis 共享速率限制状态，或接受当前限制（两个进程各自独立计数）。

---

#### H-06: 缺少 HTTPS/TLS 配置

**问题**: 当前 HTTP 和 WebSocket 均为明文传输，token 和密码可被中间人截获。

**修复方案**: 使用 Nginx 反向代理 + Let's Encrypt 证书（详见部署流程章节）。

---

#### H-07: 信号处理在 CentOS 上可能不完整

**文件**: `server/main.py` (第236-241行)

```python
loop.add_signal_handler(signal.SIGINT, signal_handler)
loop.add_signal_handler(signal.SIGTERM, signal_handler)
```

**问题**: `add_signal_handler` 在某些 CentOS Python 版本中可能抛出 `NotImplementedError`（当前已 try-except，但需确认优雅退出机制）。

**验证**: 确认 `SIGTERM` 能正常触发关闭流程。

---

### 2.3 🟡 中（Medium）— 建议修复

#### M-01: SECRET_KEY 缺失

**问题**: Token 使用 `uuid.uuid4()` 生成，无服务端密钥签名，理论上可被预测。

**建议**: 引入 `SECRET_KEY` 环境变量，使用 HMAC 签名 token。

---

#### M-02: 数据库连接未设置超时回收

**文件**: `server/app.py` (get_db 函数)

**问题**: 线程本地连接永不关闭，长时间空闲可能导致 SQLite 连接失效。

**建议**: 添加连接存活检查或定期重建。

---

#### M-03: 静态文件缓存策略过于激进

**文件**: `server/static_handler.py` (第48行)

```python
resp.set_header("cache-control", "public, max-age=3600")
```

**问题**: HTML 文件缓存 1 小时，更新后用户可能看不到最新版本。

**建议**: HTML 文件设为 `no-cache`，静态资源使用文件 hash 做版本号。

---

#### M-04: 缺少健康检查端点的详细信息

**文件**: `server/app.py` (health 函数)

**问题**: 当前 `/api/health` 仅返回 `{"status": "healthy", "uptime": "running"}`，缺少数据库连接状态、内存使用等关键指标。

**建议**: 添加数据库连通性检查和进程资源使用信息。

---

#### M-05: 错误信息泄露内部细节

**文件**: `server/server.py` (第147行)

```python
logger.exception(f"Unexpected error handling {client_address}: {e}")
```

**问题**: 500 错误的详细堆栈记录在服务端日志中，但需确保不会通过 API 响应泄露给客户端（当前返回通用 "Internal Server Error"，已安全）。

---

### 2.4 🟢 低（Low）— 可选优化

| 编号 | 问题 | 文件 | 说明 |
|------|------|------|------|
| L-01 | `database.sqlite` 文件存在于项目根目录 | 根目录 | 旧数据库文件，应删除避免混淆 |
| L-02 | `poker.db-shm`/`poker.db-wal` 残留 | server/ | SQLite WAL 临时文件，部署前应清理 |
| L-03 | 前端 `style.css` 未做压缩 | 根目录 | 生产环境应使用 minified 版本 |
| L-04 | 图片资源未做 CDN 分发 | picture/ | 54 张 PNG 可通过 CDN 加速 |
| L-05 | 缺少 `.env.example` 文件 | 项目根目录 | 应提供环境变量模板 |

---

## 3. 部署流程与注意事项

### 3.1 详细部署步骤

#### 步骤 1: 系统准备

```bash
# 更新系统
sudo yum update -y

# 安装基础工具
sudo yum install -y git curl wget vim

# 安装 Python 3.13（以编译安装为例）
sudo yum groupinstall -y "Development Tools"
sudo yum install -y openssl-devel bzip2-devel libffi-devel \
    zlib-devel readline-devel sqlite-devel xz-devel

cd /usr/src
sudo wget https://www.python.org/ftp/python/3.13.7/Python-3.13.7.tgz
sudo tar xzf Python-3.13.7.tgz
cd Python-3.13.7
sudo ./configure --enable-optimizations --prefix=/usr/local
sudo make -j$(nproc) altinstall
sudo ln -sf /usr/local/bin/python3.13 /usr/local/bin/python3

# 验证
python3 --version
```

#### 步骤 2: 创建部署用户和目录

```bash
# 创建专用用户（非 root 运行）
sudo useradd -r -s /sbin/nologin poker
sudo mkdir -p /opt/texas-poker
sudo mkdir -p /var/log/poker
sudo mkdir -p /var/lib/poker

# 设置权限
sudo chown -R poker:poker /opt/texas-poker
sudo chown -R poker:poker /var/log/poker
sudo chown -R poker:poker /var/lib/poker
```

#### 步骤 3: 获取代码

```bash
cd /opt/texas-poker
sudo -u poker git clone <repository_url> .

# 或使用 rsync 从构建机同步
# rsync -avz --exclude='*.db' --exclude='__pycache__' ./ user@server:/opt/texas-poker/
```

#### 步骤 4: 编译 C++ 引擎

```bash
cd /opt/texas-poker/engine
sudo -u poker mkdir -p build && cd build
sudo -u poker cmake ..
sudo -u poker make
sudo -u poker cp libhand_eval.so /opt/texas-poker/server/
```

#### 步骤 5: 安装 Python 依赖

```bash
cd /opt/texas-poker
python3 -m pip install --user bcrypt websockets

# 或使用虚拟环境（推荐）
python3 -m venv /opt/texas-poker/venv
source /opt/texas-poker/venv/bin/activate
pip install bcrypt websockets
```

#### 步骤 6: 配置环境变量

```bash
# 创建环境变量文件
sudo -u poker cat > /opt/texas-poker/.env << 'EOF'
POKER_ENV=production
POKER_HOST=0.0.0.0
POKER_HTTP_PORT=9001
POKER_WS_HOST=0.0.0.0
POKER_WS_PORT=9002
POKER_DB_PATH=/var/lib/poker/poker.db
POKER_LOG_DIR=/var/log/poker
POKER_CORS_ORIGINS=https://your-domain.com,https://www.your-domain.com
POKER_WS_URL=wss://your-domain.com/ws
POKER_TOKEN_EXPIRE_HOURS=24
EOF

# 设置文件权限（仅 poker 用户可读）
sudo chmod 600 /opt/texas-poker/.env
sudo chown poker:poker /opt/texas-poker/.env
```

#### 步骤 7: 初始化数据库

```bash
cd /opt/texas-poker/server
sudo -u poker python3 -c "
import config
# 需先修改 config.py 读取环境变量
# 然后执行初始化
from app import init_db
init_db()
print('Database initialized at', config.DB_PATH)
"
```

#### 步骤 8: 配置 Nginx 反向代理

```bash
sudo yum install -y nginx
```

创建 Nginx 配置文件 `/etc/nginx/conf.d/poker.conf`:

```nginx
upstream poker_http {
    server 127.0.0.1:9001;
}

upstream poker_ws {
    server 127.0.0.1:9002;
}

server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate     /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    # 静态文件和 API
    location / {
        proxy_pass http://poker_http;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket
    location /ws {
        proxy_pass http://poker_ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }
}
```

```bash
# 安装 Let's Encrypt 证书
sudo yum install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com

# 启动 Nginx
sudo systemctl enable nginx
sudo systemctl start nginx
```

#### 步骤 9: 配置 systemd 服务

**HTTP 服务** `/etc/systemd/system/poker-http.service`:

```ini
[Unit]
Description=Texas Poker HTTP Server
After=network.target

[Service]
Type=simple
User=poker
Group=poker
WorkingDirectory=/opt/texas-poker/server
EnvironmentFile=/opt/texas-poker/.env
ExecStart=/opt/texas-poker/venv/bin/python app.py
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

# 安全限制
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/poker /var/log/poker
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

**WebSocket 服务** `/etc/systemd/system/poker-ws.service`:

```ini
[Unit]
Description=Texas Poker WebSocket Server
After=network.target poker-http.service

[Service]
Type=simple
User=poker
Group=poker
WorkingDirectory=/opt/texas-poker/server
EnvironmentFile=/opt/texas-poker/.env
ExecStart=/opt/texas-poker/venv/bin/python main.py
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/poker /var/log/poker
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

```bash
# 加载并启动服务
sudo systemctl daemon-reload
sudo systemctl enable poker-http poker-ws
sudo systemctl start poker-http poker-ws

# 检查状态
sudo systemctl status poker-http poker-ws
```

### 3.2 数据迁移方案

#### 从开发环境迁移

```bash
# 1. 导出用户数据（如已有生产数据）
sqlite3 /path/to/dev/poker.db ".dump users" > users_export.sql
sqlite3 /path/to/dev/poker.db ".dump rooms" > rooms_export.sql

# 2. 在生产环境导入
sqlite3 /var/lib/poker/poker.db < users_export.sql
sqlite3 /var/lib/poker/poker.db < rooms_export.sql

# 3. 验证数据完整性
sqlite3 /var/lib/poker/poker.db "SELECT COUNT(*) FROM users;"
sqlite3 /var/lib/poker/poker.db "SELECT COUNT(*) FROM rooms;"
```

#### 数据库备份策略

```bash
# 创建备份脚本 /opt/texas-poker/backup.sh
#!/bin/bash
BACKUP_DIR="/var/lib/poker/backups"
DATE=$(date +%Y%m%d_%H%M%S)
mkdir -p $BACKUP_DIR

# SQLite 安全备份（使用 .backup 命令而非文件拷贝）
sqlite3 /var/lib/poker/poker.db ".backup ${BACKUP_DIR}/poker_${DATE}.db"

# 保留最近 7 天备份
find $BACKUP_DIR -name "poker_*.db" -mtime +7 -delete

echo "Backup completed: poker_${DATE}.db"
```

```bash
# 添加 cron 定时任务（每小时备份）
sudo -u poker crontab -e
# 添加: 0 * * * * /opt/texas-poker/backup.sh >> /var/log/poker/backup.log 2>&1
```

### 3.3 服务自启动配置方法

```bash
# 启用开机自启
sudo systemctl enable poker-http
sudo systemctl enable poker-ws

# 验证自启状态
sudo systemctl is-enabled poker-http
sudo systemctl is-enabled poker-ws

# 手动控制
sudo systemctl start poker-http poker-ws    # 启动
sudo systemctl stop poker-http poker-ws     # 停止
sudo systemctl restart poker-http poker-ws  # 重启
sudo systemctl reload poker-http poker-ws   # 重载配置（需代码支持）

# 查看日志
sudo journalctl -u poker-http -f            # 实时跟踪 HTTP 日志
sudo journalctl -u poker-ws -f              # 实时跟踪 WS 日志
sudo journalctl -u poker-http --since today # 今日日志
```

### 3.4 部署后的验证测试步骤

#### 自动化验证脚本

```bash
#!/bin/bash
# /opt/texas-poker/verify.sh

set -e
API_URL="http://127.0.0.1:9001"
WS_URL="ws://127.0.0.1:9002"

echo "=== Texas Poker 部署验证 ==="

# 1. HTTP 健康检查
echo -n "[1/6] HTTP 健康检查... "
HEALTH=$(curl -s $API_URL/api/health | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])" 2>/dev/null)
if [ "$HEALTH" = "healthy" ]; then echo "✅ PASS"; else echo "❌ FAIL"; exit 1; fi

# 2. 注册测试
echo -n "[2/6] 用户注册... "
REG=$(curl -s -X POST $API_URL/api/register \
  -H "Content-Type: application/json" \
  -H "X-Forwarded-For: 10.0.0.200" \
  -d '{"username":"deploy_test_'$RANDOM'","password":"test123456"}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('ok',''))" 2>/dev/null)
if [ "$REG" = "True" ]; then echo "✅ PASS"; else echo "❌ FAIL"; exit 1; fi

# 3. 登录测试
echo -n "[3/6] 用户登录... "
LOGIN=$(curl -s -X POST $API_URL/api/login \
  -H "Content-Type: application/json" \
  -H "X-Forwarded-For: 10.0.0.200" \
  -d '{"username":"deploy_test_'$RANDOM'","password":"wrong"}' \
  -w "%{http_code}" -o /dev/null 2>/dev/null)
if [ "$LOGIN" = "401" ]; then echo "✅ PASS"; else echo "❌ FAIL (expected 401, got $LOGIN)"; exit 1; fi

# 4. 静态文件服务
echo -n "[4/6] 静态文件服务... "
STATIC=$(curl -s -o /dev/null -w "%{http_code}" $API_URL/login-in.html 2>/dev/null)
if [ "$STATIC" = "200" ]; then echo "✅ PASS"; else echo "❌ FAIL"; exit 1; fi

# 5. CORS 头检查
echo -n "[5/6] CORS 配置... "
CORS=$(curl -s -I -X OPTIONS $API_URL/api/health \
  -H "Origin: https://your-domain.com" 2>/dev/null | grep -i "access-control-allow-origin" | wc -l)
if [ "$CORS" -ge 1 ]; then echo "✅ PASS"; else echo "⚠️ WARNING (CORS header not found)"; fi

# 6. 安全头检查
echo -n "[6/6] 安全响应头... "
SEC=$(curl -s -I $API_URL/api/health 2>/dev/null)
echo "$SEC" | grep -qi "x-content-type-options" && echo "✅ PASS" || echo "⚠️ WARNING"

echo ""
echo "=== 验证完成 ==="
```

#### 手动验证清单

| 序号 | 验证项 | 操作 | 预期结果 |
|------|--------|------|----------|
| 1 | 页面加载 | 浏览器访问 `https://your-domain.com/login-in.html` | 登录页面正常显示 |
| 2 | 用户注册 | 填写用户名和密码，点击注册 | 注册成功，跳转登录 |
| 3 | 用户登录 | 输入凭据登录 | 登录成功，Cookie 中含 HttpOnly token |
| 4 | 房间列表 | 进入房间大厅 | 房间列表正常显示 |
| 5 | 创建房间 | 创建新房间 | 房间创建成功 |
| 6 | WebSocket 连接 | 加入房间 | 控制台显示 WebSocket 连接成功 |
| 7 | 游戏流程 | 两人开始游戏 | 下注、发牌、摊牌流程正常 |
| 8 | HTTPS | 检查浏览器地址栏 | 绿色锁标识，无混合内容警告 |

### 3.5 回滚机制与应急预案

#### 代码回滚

```bash
# Git 回滚
cd /opt/texas-poker
sudo -u poker git log --oneline -5          # 查看最近提交
sudo -u poker git checkout <stable_commit>  # 回滚到稳定版本

# 重启服务
sudo systemctl restart poker-http poker-ws
```

#### 数据库回滚

```bash
# 停止服务
sudo systemctl stop poker-http poker-ws

# 恢复最近备份
LATEST_BACKUP=$(ls -t /var/lib/poker/backups/poker_*.db | head -1)
cp $LATEST_BACKUP /var/lib/poker/poker.db

# 重启服务
sudo systemctl start poker-http poker-ws
```

#### 应急联系人与流程

| 级别 | 场景 | 处理方式 | 预期恢复时间 |
|------|------|----------|-------------|
| P0 | 服务完全不可用 | 重启服务 → 回滚代码 → 恢复备份 | < 15 分钟 |
| P1 | 核心功能异常 | 重启服务 → 降级运行 | < 30 分钟 |
| P2 | 非核心功能异常 | 记录问题 → 修复代码 → 灰度发布 | < 2 小时 |
| P3 | 性能下降 | 扩容 → 优化代码 | < 4 小时 |

---

## 4. 性能与安全优化建议

### 4.1 系统资源分配建议

#### 文件描述符限制

```bash
# 查看当前限制
ulimit -n

# 增加限制（/etc/security/limits.conf）
sudo bash -c 'cat >> /etc/security/limits.conf << EOF
poker soft nofile 65535
poker hard nofile 65535
EOF'

# systemd 服务内设置（已包含在 service 文件中）
# LimitNOFILE=65535
```

#### 内核参数优化

```bash
# /etc/sysctl.d/poker.conf
sudo bash -c 'cat > /etc/sysctl.d/poker.conf << EOF
# TCP 优化
net.core.somaxconn = 4096
net.ipv4.tcp_max_syn_backlog = 4096
net.ipv4.tcp_tw_reuse = 1
net.ipv4.tcp_fin_timeout = 15

# WebSocket 长连接优化
net.ipv4.tcp_keepalive_time = 600
net.ipv4.tcp_keepalive_intvl = 30
net.ipv4.tcp_keepalive_probes = 10

# 文件描述符
fs.file-max = 100000
EOF'

sudo sysctl -p /etc/sysctl.d/poker.conf
```

#### SQLite 性能优化

```python
# 在 get_db() 中添加 PRAGMA 优化
conn.execute("PRAGMA journal_mode=WAL")       # 已有
conn.execute("PRAGMA synchronous=NORMAL")      # 减少写延迟
conn.execute("PRAGMA cache_size=-64000")        # 64MB 缓存
conn.execute("PRAGMA busy_timeout=5000")        # 5秒忙等超时
conn.execute("PRAGMA temp_store=MEMORY")        # 临时表存内存
```

### 4.2 安全加固措施

#### 文件权限设置

```bash
# 项目文件权限
sudo chmod -R 750 /opt/texas-poker
sudo chown -R poker:poker /opt/texas-poker

# 数据库文件（仅 poker 用户可读写）
sudo chmod 600 /var/lib/poker/poker.db
sudo chown poker:poker /var/lib/poker/poker.db

# 环境变量文件（含敏感配置）
sudo chmod 600 /opt/texas-poker/.env
sudo chown poker:poker /opt/texas-poker/.env

# 日志目录
sudo chmod 750 /var/log/poker
sudo chown poker:poker /var/log/poker

# C++ 引擎库（只读）
sudo chmod 444 /opt/texas-poker/server/hand_eval.so
```

#### SSH 安全配置

```bash
# /etc/ssh/sshd_config
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
AllowUsers admin@10.0.0.0/8   # 仅内网 SSH
MaxAuthTries 3
ClientAliveInterval 300
ClientAliveCountMax 2

sudo systemctl restart sshd
```

#### 应用层安全清单

| 安全项 | 当前状态 | 加固建议 |
|--------|----------|----------|
| 密码存储 | ✅ bcrypt 哈希 | 已安全，无需修改 |
| Token 传输 | ✅ HttpOnly Cookie | 生产环境启用 Secure 标志 |
| Token 过期 | ✅ 24小时过期 | 可根据需求缩短 |
| CORS 限制 | ✅ 白名单机制 | 部署时更新为生产域名 |
| XSS 防护 | ✅ 安全头 + DOM 操作 | 已安全 |
| CSRF 防护 | ✅ SameSite=strict | 已安全 |
| 速率限制 | ✅ 登录5次/分, 注册3次/5分 | 考虑 Nginx 层限制 |
| 输入验证 | ✅ 房间名/密码/金额 | 已安全 |
| SQL 注入 | ✅ 参数化查询 | 已安全 |
| 路径遍历 | ✅ normpath 检查 | 已安全 |

#### Nginx 安全头

```nginx
# 在 server 块中添加
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header X-XSS-Protection "1; mode=block" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;" always;
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

# 隐藏 Nginx 版本
server_tokens off;
```

#### Nginx 速率限制

```nginx
# 在 http 块中
limit_req_zone $binary_remote_addr zone=api_limit:10m rate=10r/s;
limit_req_zone $binary_remote_addr zone=auth_limit:10m rate=2r/s;

# 在 location 块中
location /api/login {
    limit_req zone=auth_limit burst=5 nodelay;
    proxy_pass http://poker_http;
}

location /api/register {
    limit_req zone=auth_limit burst=3 nodelay;
    proxy_pass http://poker_http;
}

location /api/ {
    limit_req zone=api_limit burst=20 nodelay;
    proxy_pass http://poker_http;
}
```

### 4.3 监控告警配置方法

#### 系统级监控（Prometheus + Node Exporter）

```bash
# 安装 Node Exporter
sudo yum install -y prometheus-node-exporter
sudo systemctl enable --now prometheus-node-exporter

# 关键监控指标
# - node_cpu_seconds_total (CPU 使用率)
# - node_memory_MemAvailable_bytes (可用内存)
# - node_disk_io_time_seconds_total (磁盘 I/O)
# - node_network_transmit_bytes_total (网络流量)
```

#### 应用级监控脚本

```bash
#!/bin/bash
# /opt/texas-poker/monitor.sh

ALERT_EMAIL="admin@your-domain.com"
LOG_FILE="/var/log/poker/monitor.log"

# 检查服务状态
check_service() {
    if ! systemctl is-active --quiet $1; then
        echo "[$(date)] CRITICAL: $1 is DOWN" >> $LOG_FILE
        sudo systemctl restart $1
        echo "[$(date)] ACTION: Attempted restart of $1" >> $LOG_FILE
    fi
}

# 检查 HTTP 响应
check_http() {
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:9001/api/health)
    if [ "$HTTP_CODE" != "200" ]; then
        echo "[$(date)] WARNING: HTTP health check returned $HTTP_CODE" >> $LOG_FILE
    fi
}

# 检查磁盘空间
check_disk() {
    USAGE=$(df -h /var/lib/poker | awk 'NR==2{print $5}' | tr -d '%')
    if [ "$USAGE" -gt 80 ]; then
        echo "[$(date)] WARNING: Disk usage at ${USAGE}%" >> $LOG_FILE
    fi
}

# 检查内存
check_memory() {
    MEM_AVAIL=$(free -m | awk 'NR==2{print $7}')
    if [ "$MEM_AVAIL" -lt 100 ]; then
        echo "[$(date)] WARNING: Available memory below 100MB (${MEM_AVAIL}MB)" >> $LOG_FILE
    fi
}

check_service poker-http
check_service poker-ws
check_http
check_disk
check_memory
```

```bash
# 添加 cron（每分钟检查）
sudo -u poker crontab -e
# 添加: * * * * * /opt/texas-poker/monitor.sh
```

#### 日志轮转配置

```bash
# /etc/logrotate.d/poker
sudo bash -c 'cat > /etc/logrotate.d/poker << EOF
/var/log/poker/*.log {
    daily
    rotate 30
    compress
    delaycompress
    missingok
    notifempty
    create 0640 poker poker
    sharedscripts
    postrotate
        systemctl reload poker-http >/dev/null 2>&1 || true
        systemctl reload poker-ws >/dev/null 2>&1 || true
    endpostrotate
}
EOF'
```

---

## 附录 A: 部署前修改清单汇总

| 优先级 | 编号 | 修改文件 | 修改内容 | 工作量 |
|--------|------|----------|----------|--------|
| 🔴 Critical | C-01 | config.py, main.py | HOST/PORT 改为环境变量 | 小 |
| 🔴 Critical | C-02 | config.py | CORS_ORIGINS 改为环境变量 | 小 |
| 🔴 Critical | C-03 | app.js | API_BASE 动态获取 | 小 |
| 🔴 Critical | C-04 | app.py | ws_url 改为环境变量 | 小 |
| 🔴 Critical | C-05 | app.py | Cookie Secure 标志动态化 | 小 |
| 🔴 Critical | C-06 | engine/ | CentOS 编译 .so | 中 |
| 🟠 High | H-01 | config.py | DB_PATH 改为环境变量 | 小 |
| 🟠 High | H-02 | 新建 | 创建 requirements.txt | 小 |
| 🟠 High | H-03 | app.py, main.py | 添加文件日志 Handler | 中 |
| 🟠 High | H-06 | Nginx | 配置 HTTPS 反向代理 | 中 |
| 🟡 Medium | M-01 | app.py | 引入 SECRET_KEY | 中 |
| 🟡 Medium | M-02 | app.py | 数据库连接存活检查 | 小 |
| 🟡 Medium | M-03 | static_handler.py | HTML 文件 no-cache | 小 |
| 🟡 Medium | M-04 | app.py | 健康检查增加 DB 连通性 | 小 |
| 🟢 Low | L-05 | 新建 | 创建 .env.example | 小 |

## 附录 B: 快速部署命令参考

```bash
# 一键部署（假设已完成代码修改）
cd /opt/texas-poker/engine && mkdir -p build && cd build && cmake .. && make && cp libhand_eval.so ../server/
cd /opt/texas-poker && python3 -m venv venv && source venv/bin/activate && pip install bcrypt websockets
sudo systemctl daemon-reload && sudo systemctl enable poker-http poker-ws
sudo systemctl start poker-http poker-ws
sudo systemctl status poker-http poker-ws
```
