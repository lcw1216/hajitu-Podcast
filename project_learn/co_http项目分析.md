# co_http 项目分析文档

> 本文档对 `d:\gitproject\game-template\co_http-master\co_http-master` 项目进行架构与功能总结。

---

## 一、项目概述

**co_http** 是小彭老师为便于同学们学习网络编程知识，从零开始研发的一款**教学用**、基于 **C++17 回调函数**的**异步 HTTP 服务器**。该项目是小彭老师上一代协程版 `co_async` 的"回调简化版"，专门解决以下问题：

- 协程版 `co_async` 难以理解
- C++20 协程在 GCC 9.3.0 / Ubuntu 20.04 上支持不佳
- 学生无法专注学习网络知识本身

**项目最新一期**实现了一个基于**长轮询 (Long Polling)** 的异步聊天服务器，是学习 C++ 网络异步编程、HTTP 协议、epoll 多路复用的优秀教学案例。

- 仓库地址：https://github.com/archibate/co_http
- 作者编译环境：GCC 9.3.0 + Ubuntu 20.04 LTS
- 监听端口：默认 `8080`

---

## 二、项目结构

```
co_http-master/
├── CMakeLists.txt              # 构建配置（C++17、Release、Wall/Wextra 警告）
├── README.md                   # 原始项目说明
├── .gitignore                  # 仅忽略 build/ 目录
│
├── 核心头文件（无 .cpp 源码，采用头文件库风格）
│   ├── io_context.hpp          # 基于 epoll 的事件循环 + 异步文件描述符
│   ├── timer_context.hpp       # 基于 std::multimap 的定时器堆
│   ├── stop_source.hpp         # 可取消异步操作的"停止令牌"
│   ├── callback.hpp            # 单次/多次触发的类型擦除回调包装器
│   ├── bytes_buffer.hpp        # 字节缓冲区（bytes_view/bytes_buffer）
│   ├── expected.hpp            # 简易的 std::expected 占位实现
│   ├── enum_magic.hpp          # 编译期枚举字符串名解析
│   ├── string_map.hpp          # std::map<std::string, std::string> 别名
│   ├── file_utils.hpp          # file_get_content / file_put_content
│   ├── reflect.hpp             # REFLECT 宏 + JSON 序列化/反序列化
│   ├── http_codec.hpp          # HTTP/1.1 报文编/解码器
│   ├── http_server.hpp         # 异步 HTTP 服务器（含路由器）
│   └── http_client.hpp         # 异步 HTTP 客户端（带连接池）
│
├── 入口源文件
│   ├── sample_server.cpp       # 最小 HTTP 服务器示例（/ 路径回声）
│   ├── sample_client.cpp       # 最小 HTTP 客户端示例
│   └── chat_server.cpp         # ★ 异步长轮询聊天室服务器（重点示例）
│
├── static/                     # 静态资源（供聊天服务器使用）
│   ├── index.html              # 聊天界面（jQuery AJAX + 长轮询）
│   ├── jquery.min.js           # 前端依赖
│   └── favicon.ico
│
└── include/                    # 第三方/附属头
    ├── bearssl.h               # BearSSL 主头（TLS 支持的占位接口）
    ├── bearssl_*.h             # BearSSL 各子模块头
    ├── sha1.hpp
    └── bearssl/                # BearSSL 完整源码（已展开）
        ├── bearssl.hpp
        ├── impl.hpp
        ├── inner.h
        └── impl/               # 编解码、哈希、对称/非对称密码、SSL 实现
            ├── codec/          # 编码转换（16/32/64 位大小端）
            ├── hash/           # MD5 / SHA1 / SHA2 / GHASH
            ├── int/            # 大整数运算（i15/i31/i32/i62）
            ├── mac/            # HMAC
            ├── rand/           # 随机数（HMAC_DRBG）
            ├── rsa/            # RSA 签名/加密
            ├── ec/             # 椭圆曲线 ECDSA
            ├── ssl/            # SSL/TLS 协议状态机
            └── symcipher/      # AES / ChaCha20 / DES 等对称密码
```

---

## 三、整体架构

项目采用了**经典的 Reactor + 回调链**异步模型，整体可划分为以下几层（自下而上）：

```
┌──────────────────────────────────────────────────────────────┐
│  业务层：sample_server.cpp / sample_client.cpp / chat_server.cpp │
└───────────────────────┬──────────────────────────────────────┘
                        │
┌───────────────────────▼──────────────────────────────────────┐
│  协议层：http_server.hpp / http_client.hpp / http_codec.hpp  │
│  （路由器、URL 解析、HTTP/1.1 编解码、Content-Length 处理）   │
└───────────────────────┬──────────────────────────────────────┘
                        │
┌───────────────────────▼──────────────────────────────────────┐
│  传输层：io_context.hpp（epoll） + async_file + timer_context │
│  （非阻塞 socket、边沿触发、可取消的回调型 stop_source）      │
└───────────────────────┬──────────────────────────────────────┘
                        │
┌───────────────────────▼──────────────────────────────────────┐
│  基础设施：callback / bytes_buffer / expected / reflect      │
│  （类型擦除回调、字节视图、错误传播、JSON 反射）              │
└──────────────────────────────────────────────────────────────┘
```

### 3.1 事件循环（io_context）

`io_context` 继承自 `timer_context`，使用 **Linux epoll** 实现多路复用。

- `join()` 是主循环。每次迭代：
  1. 先通过 `timer_context::duration_to_next_timer()` 触发所有已到期的定时器，并计算下一个定时器的等待时长。
  2. 把这个时长作为 `epoll_pwait`（或 `epoll_pwait2`）的超时参数。
  3. 唤醒后，回调所有就绪事件。
- 通过 `EPOLLONESHOT` 标志，实现"一次性事件通知"，避免与"同一个 fd 多消费者"的竞态。
- 支持两种触发模式 `USE_LEVEL_TRIGGER`：默认采用 **ET（边沿触发）** + 非阻塞读写循环。

### 3.2 异步文件描述符（async_file）

`async_file` 包装一个非阻塞 socket fd，提供三类异步原语：

- `async_read(buf, cb, stop)` — 等待 `EPOLLIN` 事件
- `async_write(buf, cb, stop)` — 等待 `EPOLLOUT` 事件
- `async_accept(addr, cb, stop)` — 服务端接受连接
- `async_connect(addr, cb, stop)` — 客户端建立连接

每个操作都接受一个 `stop_source`，调用者可以**主动取消**尚未完成的 IO。

### 3.3 回调系统（callback）

- `callback<Args...>` 是基于虚函数 + `std::unique_ptr` 的**类型擦除**回调。
- 默认**只能调用一次**（one-shot）：调用后内部指针自动置空，防止双重回调。
- 通过 `multishot_call_t` 哨兵可改为**可重复调用**。
- 支持 `get_address() / leak_address() / from_address()`，在 epoll 上下文（`event.data.ptr` 只能存指针）下保活回调。

### 3.4 HTTP 编解码（http_codec）

- **头部解析器 `http11_header_parser`**：基于 `\r\n` 与 `\r\n\r\n` 切分；自动把键转小写实现大小写不敏感；`Content-Length` 自动识别。
- **基础解析器 `_http_base_parser`**：管理"是否解析完头"与"是否读满 body"两阶段。
- **请求/响应解析器**：`http_request_parser` 拆出 method + url；`http_response_parser` 拆出 status code。
- **写入器**：`http_request_writer` / `http_response_writer`，流式构造 HTTP 报文到 `bytes_buffer`。

### 3.5 HTTP 服务器（http_server）

- 用法（3 行启动）：
  ```cpp
  auto server = http_server::make();
  server->get_router().route("/", [](http_server::http_request &req) {
      req.write_response(200, "hello");
  });
  server->do_start("0.0.0.0", "8080");
  ```
- 内部组件：
  - `http_router`：用 `std::map<string, callback>` 维护精确匹配的路径 → 处理函数映射。
  - `http_connection_handler`：每个连接一个；状态机为 **read → parse → handle → write → reset → read** 的循环。
  - **10 秒空闲超时**：每次 `do_read()` 同时挂载一个 10 秒定时器（`timer_context`），超时自动关连接。

### 3.6 HTTP 客户端（http_client）

- 支持 **URL 解析**（`_http_url_parser`）：自动拆出 scheme / host / port / path。
- 支持**连接池**（`m_conn_pool`）：以 `scheme + hostname` 为 key，复用已建立的连接。
- 完整流程：解析 URL → 创建/取出连接 → `async_connect` → 写请求 → 读响应 → 回调。

---

## 四、核心功能

### 4.1 简单回声服务器（`sample_server.cpp`）

- `GET /`：回显"你的请求是 [...]，共 N 字节"。
- 演示**最简路由注册 + 响应构造**。

### 4.2 简单 HTTP 客户端（`sample_client.cpp`）

- 串行两次 `GET http://142857.red`，演示**连接复用**与**回调链**。

### 4.3 异步长轮询聊天室（`chat_server.cpp`）★

这是项目最核心、最具教学价值的示例。

#### 4.3.1 路由设计

| 路径 | 方法 | 功能 |
| --- | --- | --- |
| `/` | GET | 返回 `static/index.html` 聊天界面 |
| `/favicon.ico` | GET | 返回浏览器图标 |
| `/send` | POST | 接收 `{user, content}` JSON，追加到全局 `messages` 列表，并**取消所有正在等待的 /recv** |
| `/recv` | POST | 接收 `{first}` 客户端已收消息数；若有新消息立即返回，否则**挂起 3 秒**长轮询 |

#### 4.3.2 关键机制

1. **全局消息列表**：`std::vector<Message>` 进程级单例。`Message` 含 `user` / `content` 两个字段，并通过 `REFLECT(user, content)` 自动获得 JSON 序列化/反序列化能力。
2. **唤醒等待者**：
   ```cpp
   stop_source recv_timeout_stop = stop_source::make(); // 全局
   // /send 路由里：
   messages.push_back(...);
   recv_timeout_stop.request_stop();   // 立即唤醒
   recv_timeout_stop = stop_source::make(); // 准备下一次唤醒
   ```
   每当有新消息到达，先 `request_stop()` 触发一个被取消回调的"假回调"，让所有挂起的 /recv 立即返回；再创建新的 stop_source 供下次 /recv 使用。
3. **长轮询语义**：当客户端没有新消息时，`/recv` 不立刻返回，而是通过 `io_context::get().set_timeout(3s, ...)` 在 3 秒后由定时器触发响应，实现"伪推送"。

#### 4.3.3 前端（`static/index.html`）

- 使用 jQuery 3.7.1 发起 AJAX。
- 客户端 `messages_first` 记录已收消息数，每次 `/recv` 成功后再递归 `poll()` 发起下一个长轮询。
- 提交用 `$.post("send", ...)`，回车键也可触发发送。
- `escapeHtml()` 防 XSS 注入。
- 自家消息用绿色高亮（`.message-current-user`）。

#### 4.3.4 反射 + JSON（`reflect.hpp`）

`REFLECT(user, content);` 这一个宏展开后，会在类内生成一个模板成员函数 `REFLECT__MEMBERS`，遍历每个字段调用 `reflector("字段名", 字段引用)`。`reflect::json_encode<T>` 和 `reflect::json_decode<T>` 借助这个机制**无需手写序列化代码**，是 C++ 模板元编程 + 预处理器宏的精彩应用。

### 4.4 BearSSL 集成（`include/bearssl/`）

- 项目内**携带了完整的 BearSSL C 库**（打包成 `.hpp` 形式）。
- BearSSL 是**轻量级、嵌入式友好**的 TLS 实现（由 Thomas Pornin 开发），代码无依赖、纯 C、单文件可裁剪。
- 仓库内提供的头文件覆盖了：
  - 编码/解码、整型大数运算
  - 哈希（MD5 / SHA-1 / SHA-2）、HMAC
  - 对称密码（AES / ChaCha20）
  - 公钥密码（RSA、ECDSA、Curve25519）
  - SSL/TLS 协议（client / server / 状态机）
- `include/bearssl.h` 集中包含并通过 `#pragma GCC diagnostic` 屏蔽 BearSSL 内部的编译警告，**对外只暴露干净的 C++ 接口**。
- `README` 中提到"下一期想做 https"，所以这部分是为未来 **HTTPS** 预留的依赖。

---

## 五、关键技术点与设计亮点

| 主题 | 做法 |
| --- | --- |
| **异步风格** | 回调链（continuation-passing style），不依赖 C++20 协程 |
| **多路复用** | Linux epoll + EPOLLET（边沿触发）+ EPOLLONESHOT |
| **超时控制** | 每次 IO 同时挂一个 `stop_source` 定时器，超时即关连接 |
| **请求取消** | `stop_source` + 回调接管，可在任意阶段终止正在进行的操作 |
| **HTTP 协议** | 1.1 文本协议手动解析，无第三方库依赖 |
| **响应构造** | `bytes_buffer` + 流式 `begin_header/write_header/end_header/write_body` |
| **错误处理** | 自制 `expected<T>`（错误码为负），`convert_error<T>()` 自动把 POSIX 错误转为 `expected` |
| **数据序列化** | `REFLECT` 宏 + 模板反射 + 手写 JSON 解析器 |
| **类型擦除** | `callback<Args...>` 用虚函数实现可移动、可一次性调用的回调 |
| **编译期元编程** | `enum_magic.hpp` 通过 `__PRETTY_FUNCTION__` 在编译期拿到枚举字符串名 |
| **构建系统** | CMake `file(GLOB ... CONFIGURE_DEPENDS *.cpp)` 自动包含所有顶层 .cpp 作为可执行目标 |

---

## 六、构建与运行

```bash
# 1. 配置
cmake -B build -DCMAKE_BUILD_TYPE=Release

# 2. 编译（会生成 chat_server / sample_server / sample_client 三个可执行文件）
cmake --build build

# 3. 启动聊天服务器（默认监听 0.0.0.0:8080）
cd build
./chat_server

# 4. 浏览器访问
#   http://127.0.0.1:8080
#   （注意 README 提示用 https://127.0.0.1:8080，但目前是 HTTP 端口）
```

> 编译时如遇到 `epoll_pwait2` 相关报错，CMakeLists.txt 已经有 `check_symbol_exists` 自动 fallback 到 `epoll_pwait`，不需要手动处理。

---

## 七、教学价值与适用读者

适合以下场景：

1. **C++ 进阶学习者**：想理解现代 C++ 在系统编程中的实战（模板、虚函数、移动语义、RAII）。
2. **网络编程入门者**：想从零读懂 epoll 异步服务器的状态机和回调链。
3. **协议实现爱好者**：HTTP/1.1 文本协议的最小可用实现。
4. **想写 C++ 协程项目但环境受限**的人：用纯回调模拟"协程"的写法。

### 推荐的阅读顺序

1. `bytes_buffer.hpp` → 最小工具
2. `expected.hpp` → 错误传播
3. `callback.hpp` → 类型擦除回调（重点）
4. `stop_source.hpp` + `timer_context.hpp` → 异步取消与定时
5. `io_context.hpp` → epoll 事件循环（核心）
6. `http_codec.hpp` → 协议编解码
7. `http_server.hpp` / `http_client.hpp` → 完整客户端/服务器
8. `chat_server.cpp` → 综合示例（长轮询 + JSON + 反射）

---

## 八、可能的改进方向（与项目自述一致）

作者在 README 中明确提到：

- **下一期投票方向**：数据库 / https / websocket
- 当前实现特点：**无数据库、无 TLS、无 WebSocket**

社区可拓展点：

- 把 `messages` 替换为 SQLite/LevelDB 持久化
- 用 `include/bearssl` 给服务器加 HTTPS（已预留依赖）
- 用原生 WebSocket 升级 `chat_server`（替代长轮询）
- 增加线程池（目前是单线程 `epoll`）
- 支持更丰富的路由匹配（参数、通配符）
- 加入连接优雅关闭与 `Connection: keep-alive` 复用

---

## 九、总结

`co_http` 是一个**不到 2000 行 C++ 头文件 + 100 行入口**的小型项目，但涵盖了：

- epoll 异步 IO
- 回调式异步编程
- HTTP/1.1 协议
- JSON 反射序列化
- 模板元编程与宏展开
- BearSSL 集成（为 HTTPS 留口）

非常适合作为**网络编程的进阶教学项目**，特别是面向"想从协程切换到回调"或"想用 C++17 写异步服务"的开发者参考学习。
