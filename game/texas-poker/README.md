# Texas Hold'em Poker - 德州扑克

基于 Python + C++ 的德州扑克游戏完整实现。

---

## 项目结构

```
texas-poker/
├── index.html          # 游戏前端界面
├── login-in.html      # 用户登录界面
├── style.css          # 样式文件
├── database.sqlite    # SQLite 数据库初始化脚本
├── main.py            # 入口文件
├── game.py            # 游戏逻辑
├── player.py          # 玩家类
├── deck.py            # 牌堆管理
│
├── engine/                    # C++ 手牌评估引擎
│   ├── CMakeLists.txt        # 构建配置
│   ├── hand_eval.h           # 头文件
│   ├── hand_eval.cpp         # 评估算法实现
│   ├── bind.cpp              # Python 绑定
│   ├── test.cpp              # 手动测试工具
│   └── card_encoding_reference.md  # 扑克牌编码参考
│
└── docs/                      # 项目文档
    ├── 后端实现教程.md         # 后端实现完整教程
    ├── 后端架构.md            # 游戏状态机与架构
    ├── 数据结构.md            # 数据结构定义
    └── 前端文档.md            # 前端实现文档
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
| [数据结构.md](docs/数据结构.md) | 数据模型定义 | ⭐⭐⭐ |
| [engine/card_encoding_reference.md](engine/card_encoding_reference.md) | 牌编码与牌型等级说明 | ⭐⭐ |

---

## 游戏规则（当前版本）

- **手牌**: 2 张
- **公共牌**: 5 张
- **游戏阶段**: idle → preflop → flop → turn → river → showdown → idle

---

## 快速开始

### 1. 安装依赖

```bash
pip install websockets
```

### 2. 初始化数据库

```bash
sqlite3 texas_poker.db < database.sqlite
```

### 3. 构建 C++ 引擎

```bash
cd engine
cmake -B build
cmake --build build
# 或手动编译
clang++ -shared -fPIC -o hand_eval.dll hand_eval.cpp
```

### 4. 运行测试

```bash
cd engine
./test
```

### 5. 启动服务器

```bash
python main.py
```

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

- **后端**: Python 3, WebSocket, C++ (手牌评估)
- **前端**: HTML5, CSS3, JavaScript
- **构建**: CMake, clang++

---

## 更新日志

- **2026-05-10**: 调整为标准 2 手牌 + 5 公共牌模式，恢复 river 阶段
- **早期**: 初始版本实现
