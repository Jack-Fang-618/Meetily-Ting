# 本地粤语模型接入（开发版）

## 当前范围与决策

先安装并试用一个模型：**Qwen3-ASR 0.6B，MLX 8-bit 版**。不自动下载其他权重。保留 Qwen3-ASR 1.7B、两个 Qwen3 Cantonese Written LoRA 和 BuzzASR 的按需准备入口；MERaLiON 暂缓。云端 API、说话人识别、上下文精修不在本次改动范围。

MLX 是 Apple Silicon 的计算框架，mlx-audio 提供 Qwen 的识别实现；它不是 Whisper 或 Parakeet 模型。新增的 `localQwen` STT Provider 通过本地 Python 子进程接入现有录音、导入、重新转录流程。音频以 16 kHz 单声道片段传给进程，推理禁止 Hugging Face 联网。时间戳来自现有音频分段，不是 Qwen 字级对齐；未提供置信度时不显示伪造分数。

## 使用

开发环境初始化：在仓库根目录执行 `bash tools/cantonese/setup.sh`（需 uv）。安装运行库不会自动下载模型。

打开转录设置，选择「本地粤语 · Qwen / BuzzASR」，在 Qwen3-ASR 0.6B 旁点击「使用」。成功加载后才保存配置。语言可选「Cantonese / 粵語」或自动识别。录音、导入文件与重新转录均有 Qwen 路由。

命令行单独准备：

```sh
.ting-runtime/bin/python tools/cantonese/prepare.py \
  --model qwen3-asr-0.6b \
  --root "$HOME/Library/Application Support/com.ting.dev/models/cantonese"
```

安装目录：`~/Library/Application Support/com.ting.dev/models/cantonese/qwen3-asr-0.6b`。本机成品约 964 MiB；Python 运行库、HF 缓存另占空间。其他模型未下载。目录中的 `ting-ready.json` 记录固定模型版本；加载前检查该记录。

## 已验证与待验证

- 已完成 Qwen3-ASR 0.6B 下载和离线加载。
- 用 macOS Sinji 本地合成约 12.14 秒粤语，成功转录。首次加载加转录约 7.74 秒，仅为冒烟测试，不是性能基准。
- 静音输入返回空文本；未使用用户真实录音进行测试。
- 本次输出含简体字，没有自动繁体规范化。
- 1.7B、LoRA 合并量化及 BuzzASR 转换尚未实机验证，界面明确标记实验状态。首次转换可能明显增加内存和临时磁盘占用。
- Qwen 当前按段处理，不宣称原生流式或持续实时达标。长会议、复杂粤英混合内容需下一轮测试。
- 运行环境目前依赖此源码目录和 Python 虚拟环境，只支持 Apple Silicon 开发机。面向普通用户的安装包仍需打包运行时、管理模型删除/取消下载，并验证发布流程。

## 实现与验证入口

模型固定版本：`tools/cantonese/catalog.json`。准备脚本只下载用户选定的模型；LoRA 在本机合并量化，BuzzASR 转换为现有 Whisper 引擎可读的 GGML。转换工具固定提交并校验 SHA-256。

Rust Provider：`frontend/src-tauri/src/audio/transcription/mlx_provider.rs`。子进程串行请求，单请求超时 300 秒；失败后销毁进程，下次请求重启。模型准备/切换与录音、导入、重新转录互斥。

可重复运行的安装后通信测试（不下载模型）：

```sh
cd frontend/src-tauri
TING_TEST_MODEL_ROOT="$HOME/Library/Application Support/com.ting.dev/models/cantonese" \
  cargo test --locked --features metal --lib mlx_provider::tests -- --include-ignored
```

该测试检查静音、未知模型拒绝和失败后恢复。界面检查用 `pnpm exec tsc --noEmit`，后端检查用 `cargo check --locked --features metal`。

## 粤语微调 0.6B 准备错误修复与公开测试包

用户在前端安装 qwen3-yue-0.6b 时遇到合并子进程退出。已离线复现：原始生成配置 `do_sample=false` 配合 `temperature=1e-6`，在 Transformers 4.57.6 保存配置时触发严格校验；并非下载损坏。保存前将贪心解码下不使用的温度恢复为默认值 1.0，不启用随机采样。已成功重跑合并、MLX 8-bit 转换与离线加载。

准备流程新增：下载前检查运行库导入和可用磁盘空间；子进程完整日志保存到模型根目录的 `logs/`；错误显示尾部原因及日志路径；前端避免将同一个失败重复显示。其余未实测模型仍不能宣称已验证。此类预检不能保证消除网络、内存或上游格式变化引起的全部失败。

公开测试素材来自 https://huggingface.co/datasets/ASLP-lab/WSYue-ASR-eval 的 Long 分包（约 207 MB），CC BY-NC 4.0。开发机 `experiments/cantonese/public-eval/pack` 已提取 30 段、约 10.03 分钟，附 WAV、TXT、原始 TextGrid、SHA-256 清单与来源说明。音频不提交 Git，也不随产品分发。英文分组按文本启发式筛选，不代表已人工标定噪声或粤普切换。

重建测试包：`python3 tools/cantonese/make_eval_pack.py experiments/cantonese/public-eval/source experiments/cantonese/public-eval/pack`。
安装后测试：用 `.ting-runtime/bin/python tools/cantonese/smoke_test.py --root <模型目录> --model <ID> --audio <16kHz单声道WAV> --report <JSON路径>`；检查非空语音输出及静音无输出，不能替代准确率评测。

## 2026-10-27：实时录音长片段被拒绝

启动日志确认连续语音段为 982240、2118880、1193920 个 16 kHz 样本（61.39、132.43、74.62 秒），超过 Python worker 原先的 60 秒硬限制。导入已有 25 秒拆段，但实时 VAD 可以输出更长片段。

Qwen worker 现在统一验证一维及有限值，再以最多 25 秒的窗口处理；在窗口末尾 5 秒内寻找低能量边界。切片覆盖全部输入且无重叠，结果按顺序组合，静音片段不送模型。格式错误与 NaN/Inf 错误分别提示。内部拆段仍使用外层原始时间范围，并不增加字级时间戳；持续语音的字幕延迟还取决于上游 VAD 何时发出片段。

回归检查：` .ting-runtime/bin/python -m unittest discover -s tools/cantonese -p 'test_audio_segments.py'`，覆盖日志中三个长度、边界长度、样本完整性、结果顺序和无效数据。公开音频拼接成长于 60 秒的样本进行真实模型通信测试，素材及结果在 ignored experiments/cantonese 中。

只修改 Python worker，无需重编 Rust。正在运行的 worker 需结束当前录音后正常卸载，下次加载才使用新代码；不为应用修复而打断正在录制的会议。已经失败的旧片段不会自动补写，可在保留原音频的前提下使用重新转录。
