# Texas Hold'em Poker - 德州扑克

基于 Python + C++ 的本地多人德州扑克游戏。

---

## 项目结构

```
texas-poker/
├── index.html          # 游戏主界面
├── login-in.html      # 用户登录界面
├── room.html          # 房间选择界面
├── style.css          # 统一样式
│
├── server/                    # Python 后端服务
│   ├── app.py               # HTTP 服务器入口（路由定义 + 数据库初始化）
│   ├── server.py            # 核心 HTTP 服务器（多线程连接处理）
│   ├── config.py            # 配置模块（端口、路径、MIME、CORS）
│   ├── request.py           # HTTP 请求解析模块
│   ├── response.py          # HTTP 响应构建模块
│   ├── router.py            # 路由机制（支持参数路由 :param）
│   ├── static_handler.py    # 静态资源服务模块
│   ├── middleware.py        # 中间件（日志、CORS、XSS防护、请求限制）
│   ├── errors.py            # HTTP 错误异常体系
│   ├── hand_eval.py         # C++ 牌型库 Python 封装
│   ├── benchmark.py         # 性能测试脚本
│   ├── main.py              # WebSocket 游戏服务入口
│   ├── game.py              # 游戏逻辑与状态机
│   ├── player.py            # 玩家类
│   └── deck.py              # 牌堆管理
│
├── engine/                    # C++ 手牌评估引擎
│   ├── CMakeLists.txt        # 构建配置
│   ├── hand_eval.h           # 头文件
│   ├── hand_eval.cpp         # 牌型判断实现
│   └── bind.cpp              # Python 绑定
│
└── docs/                      # 项目文档
    ├── 前端文档.md            # 前端实现文档
    ├── 后端架构.md            # 游戏状态机与架构
    ├── 后端实现教程.md        # 后端实现完整教程
    ├── 后端接口文档.md        # REST API 接口文档
    ├── 综合技术文档.md        # 全栈技术参考
    └── 数据结构.md            # 数据结构定义
```

---

## 文档索引

### 新手入门

| 文档 | 说明 | 优先级 |
|------|------|--------|
| [后端实现教程.md](docs/后端实现教程.md) | 完整的从零开始实现教程 | ⭐⭐⭐ |
| [前端文档.md](docs/前端文档.md) | 前端交互与数据流说明 | ⭐⭐ |

### 技术规格

| 文档 | 说明 | 优先级 |
|------|------|--------|
| [后端架构.md](docs/后端架构.md) | 游戏状态机、流程控制 | ⭐⭐⭐ |
| [后端接口文档.md](docs/后端接口文档.md) | REST API 接口规范 | ⭐⭐⭐ |
| [数据结构.md](docs/数据结构.md) | 数据模型定义 | ⭐⭐⭐ |
| [综合技术文档.md](docs/综合技术文档.md) | 全栈技术参考 | ⭐⭐ |

---

## 游戏规则（当前版本）

- **手牌**: 2 张
- **公共牌**: 5 张
- **玩家数**: 最多 8 人
- **初始筹码**: 1000
- **盲注**: 小盲 10 / 大盲 20
- **游戏阶段**: idle → preflop → flop → turn → river → showdown → idle

---

## 快速开始

### 1. 安装依赖

```bash
pip install websockets
```

### 2. 构建 C++ 引擎

**Windows（Visual Studio）：**

```bash
cd engine
cmake -B build -G "Visual Studio 16 2019"
cmake --build build --config Release
copy build\Release\hand_eval.dll ..\server\
```

**Windows（MSYS2-MinGW）：**

```bash
cd engine
cmake -B build -G "MinGW Makefiles"
cmake --build build
copy build\hand_eval.dll ..\server\
```

**Linux/Mac：**

```bash
cd engine
cmake -B build
cmake --build build
cp build/libhand_eval.so ../server/
```

### 3. 启动 HTTP 服务器（REST API + 静态资源）

```bash
cd server
python app.py
# 服务地址: http://127.0.0.1:9001
```

### 4. 启动 WebSocket 服务器（游戏实时通信）

```bash
cd server
python main.py
# 服务地址: ws://127.0.0.1:9002
```

### 5. 访问游戏

浏览器打开 `http://127.0.0.1:9001/login-in.html` 即可开始游戏。

---

## 牌型等级（9 最高，0 最低）

| 等级 | 牌型 |
|------|------|
| 9 | 皇家同花顺 Royal Flush |
| 8 | 同花顺 Straight Flush |
| 7 | 四条 Four of a Kind |
| 6 | 葫芦 Full House |
| 5 | 同花 Flush |
| 4 | 顺子 Straight |
| 3 | 三条 Three of a Kind |
| 2 | 两对 Two Pair |
| 1 | 一对 One Pair |
| 0 | 高牌 High Card |

---

## 技术栈

- **后端**: Python 3.8+, WebSocket (websockets 10.x+), C++11 (手牌评估)
- **HTTP服务**: Python socket 标准库（多线程）
- **数据库**: SQLite 3.x
- **前端**: HTML5, CSS3, JavaScript
- **构建**: CMake 3.10+, clang++

---

## 更新日志

- **2026-05-16**: 全面更新项目文档，修正数据结构、接口定义、卡牌对象格式，确保文档与代码一致
- **2026-05-15**: 新增 HTTP 服务器与 REST API，双服务架构（HTTP:9001 + WS:9002）
- **2026-05-10**: 调整为标准 2 手牌 + 5 公共牌模式，恢复 river 阶段
- **早期**: 初始版本实现
