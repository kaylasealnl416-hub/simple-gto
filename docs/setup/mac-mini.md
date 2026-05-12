# Mac mini 本机恢复说明

## 项目位置

- 本机目录：`/Users/sunda/Documents/AiCodingProjects/simple-gto`
- GitHub 仓库：`kaylasealnl416-hub/simple-gto`
- 默认分支：`main`

## 验证

```sh
bun run verify
```

该命令会运行规则测试，并检查浏览器入口能否打包。

## 预览

```sh
bun run serve
```

默认地址：

- Mac 本机：`http://localhost:4173`
- 手机同 Wi-Fi：以脚本输出的局域网地址为准

## 一键打开

```sh
bash scripts/launch-local-mac.sh
```

脚本会复用已启动的本地服务；如果服务未启动，会自动启动并打开 `http://127.0.0.1:4173/#autostart`。

如果脚本启动了新服务，需要保持终端窗口运行；停止服务按 `Ctrl+C`。
