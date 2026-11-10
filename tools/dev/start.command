#!/bin/zsh -l
export PATH="$HOME/.npm-global/bin:$HOME/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
export CARGO_BUILD_JOBS=4
export CARGO_TERM_PROGRESS_WHEN=never
cd "${0:A:h}/../../frontend" || exit 1
log_dir="$HOME/Library/Logs/TingDev"
mkdir -p "$log_dir"
if lsof -n -iTCP:3118 -sTCP:LISTEN >/dev/null 2>&1; then
  print 'Ting 开发服务已在运行。请使用已有窗口；如窗口已关闭，请先在原启动终端按 Control + C，再启动。'
  read '?按回车关闭此窗口。'
  exit 0
fi
print '正在构建并启动 Ting Dev。界面构建可能需要一些时间。'
print "日志保存到：$log_dir/startup.log"
print '请保持本终端开启；结束时按 Control + C。本启动方式不会因后台源码修改自动重启，更新后请手动重启。'
setopt pipefail
pnpm build 2>&1 | tee "$log_dir/build.log"
if (( $? != 0 )); then
  print "界面构建失败，日志：$log_dir/build.log"
  read '?按回车关闭。'
  exit 1
fi
pnpm tauri dev --no-watch --features metal --config ../tools/dev/tauri.desktop.json 2>&1 | tee "$log_dir/startup.log"
result=$?
if (( result != 0 && result != 130 )); then
  read '?启动失败，请保留日志。按回车关闭。'
fi
exit $result
