# map 服务管理命令

## 本地文件说明

```
D:\gitproject\map\
├── map.html          # 页面文件
├── map.jpg           # 背景图片
├── start.sh          # 启动 Nginx
├── stop.sh           # 停止 Nginx
├── restart.sh        # 重启 Nginx（自动检查配置）
└── commands.md       # 本文件
```

## 服务器上执行

登录服务器后，使用以下命令管理服务：

```bash
# 启动
bash /www/wwwroot/map/start.sh

# 停止
bash /www/wwwroot/map/stop.sh

# 重启（自动检查 Nginx 配置是否正确）
bash /www/wwwroot/map/restart.sh
```

## 本地连接服务器执行

```bash
# 启动
export DISPLAY=:0
export SSH_ASKPASS_REQUIRE=force
export SSH_ASKPASS="C:/Users/liangchongwei/.ssh/ssh-pass.bat"
C:/Windows/System32/OpenSSH/ssh.exe root@47.103.145.220 "bash /www/wwwroot/map/start.sh"

# 停止
C:/Windows/System32/OpenSSH/ssh.exe root@47.103.145.220 "bash /www/wwwroot/map/stop.sh"

# 重启
C:/Windows/System32/OpenSSH/ssh.exe root@47.103.145.220 "bash /www/wwwroot/map/restart.sh"
```

## 快捷 SSH 命令（带环境变量）

```bash
# 一行命令启动
export DISPLAY=:0 SSH_ASKPASS_REQUIRE=force SSH_ASKPASS="C:/Users/liangchongwei/.ssh/ssh-pass.bat" && C:/Windows/System32/OpenSSH/ssh.exe root@47.103.145.220 "bash /www/wwwroot/map/start.sh"
```

> **密码：** 20051216
> **访问地址：** http://47.103.145.220/map/
