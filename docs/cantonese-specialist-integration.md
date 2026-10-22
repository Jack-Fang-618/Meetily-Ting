# 三类粤语候选的接入可行性

调查日期：2026-10-22。目标环境：Ting / Tauri Rust，Mac M1、16GB 内存。

本轮核对了发布者模型卡、实际配置／文件清单、运行库代码，以及 Ting 的模型加载入口。没有下载大权重、执行第三方模型代码或做推理。下列难度是工程判断，不是性能实测。

## 结论

| 候选 | 在当前 Mac 本地接入 | 推荐路径 | 决策 |
| --- | --- | --- | --- |
| BuzzASR/cantonese | 相对最方便，转换尚未验证 | HF Whisper 权重 → whisper.cpp GGML → 现有 WhisperEngine | 提升为优先转换验证候选 |
| Qwen3 Cantonese LoRA 0.6B / 1.7B | 中等，需要合并／转换验证 | 对应基座 + adapter → 合并完整权重 → MLX → Qwen Provider | 与原版 Qwen 同一轮比较，优先小模型验证 |
| MERaLiON-3-3B-ASR | M1 路径不成熟；自建 GPU 服务对接较方便 | CUDA + 官方卡片链接的服务包 → HTTP STT Provider | 保留服务器候选，不列为 M1 首版默认 |

这修正了此前“其他本地家族暂不扩入首轮”的过早收窄：BuzzASR 与具体粤语 LoRA 应进入首轮可行性比较；比较通过才纳入应用下载菜单。

## 1. BuzzASR：比之前判断更接近现有引擎

准确仓库：[BuzzASR/cantonese](https://huggingface.co/BuzzASR/cantonese)，调查 revision `cb8f9659c0d5e9ea0ae84d652f49e209bebb1fec`。

模型卡明确该粤语 checkpoint 使用 Whisper 原 tokenizer 的普通微调，不是替换 tokenizer 的变体。不能把整个 BuzzASR 家族论文中的方法泛化到这个 checkpoint。它是单语粤语模型；粤英混说应另测，不能以粤语分数推断。

实际配置检查：

- `architectures=WhisperForConditionalGeneration`，32 层 encoder/decoder，128 mel bins，词表 51866。
- HF 元数据为约 1.543B 个 FP16 参数，纯权重估算约 3.09 GB（十进制），不等于运行内存。
- 与 openai/whisper-large-v3 对比，vocab.json、merges.txt、added_tokens.json 内容一致。JSON 排序归一化后比较 SHA-256；merges 按原始字节比较。
- preprocessor 配置只有 `dither: 0.0` 与基座缺省值这一差异；仍需运行时检查音频预处理等价。
- generation 配置含 language=yue、task=transcribe；不能因权重转换成功就假设解码配置也迁移了。

核查地址：[config](https://huggingface.co/BuzzASR/cantonese/blob/main/config.json)、[generation config](https://huggingface.co/BuzzASR/cantonese/blob/main/generation_config.json)、[文件元数据](https://huggingface.co/api/models/BuzzASR/cantonese)。

whisper.cpp 已提供读取 Hugging Face Whisper 模型的 [convert-h5-to-ggml.py](https://github.com/ggml-org/whisper.cpp/blob/master/models/convert-h5-to-ggml.py)，内部使用 WhisperForConditionalGeneration.from_pretrained，读取 vocab/config 并输出 GGML。由此推断转换路线可行性较高；尚不能称为已经兼容。

具体接法：

1. 开发阶段固定 revision，先转 FP16 GGML，和 Transformers 参考结果比较；通过后再尝试量化。
2. 应用仍走 `localWhisper`，增加独立模型 ID，例如 `buzz-cantonese`，不覆盖标准 large-v3。
3. 修改 `frontend/src-tauri/src/config.rs:18` 模型目录、`whisper_engine/whisper_engine.rs:1073` 下载映射及前端展示。发现逻辑只认目录，放入任意 .bin 不会自动显示。
4. 给该模型保存粤语／转录设置。当前 engine 使用自适应 beam search，与模型卡示例的解码策略不同；应对齐或明确记录差异，不能承诺复现卡片分数。
5. 复用 VAD 分段与录音时间；先验证片段转录，不承诺真正流式或准确字级时间。

优势是最终客户端有望不增加 Python runtime；转换由开发者完成。阻断条件：转换加载失败、明显漏字或混合语言退化、M1 延迟不可接受。模型卡标记 MIT，正式再分发仍需保留对应模型与基座说明。

## 2. Qwen3 Cantonese LoRA：可以共用 Qwen 路线，但不是下载 adapter 就能用

本轮确认的具体版本：

- [JackyHoCL/Qwen3-ASR-1.7B-cantonese-written-lora](https://huggingface.co/JackyHoCL/Qwen3-ASR-1.7B-cantonese-written-lora)，revision `26379e97cafba3fd9b6f1e7ff030fbefc8dbea9f`。
- [JackyHoCL/Qwen3-ASR-0.6B-cantonese-written-lora](https://huggingface.co/JackyHoCL/Qwen3-ASR-0.6B-cantonese-written-lora)。网页工具未能打开，直接 HTTPS 获取发布者 README 成功；未做权重校验，不将搜索摘要当验证。

1.7B 的 adapter_config 指向 Qwen/Qwen3-ASR-1.7B，rank=16、alpha=32，作用于 thinker 下语言模型的 attention/MLP。0.6B 必须配 0.6B 基座，不能交叉使用。两张卡片分别描述约 70MB／40MB adapter；这些不是完整模型大小。

这组版本以香港立法会的书面记录训练，适合列为会议候选；是否忠实保留口语、语气词和自我纠正需实测。卡片还说明用 test/dev 选 checkpoint，因此不把自报 test 改善当独立公正排名。

作者给出的 Transformers 路线要求 qwen-asr==0.0.6、transformers==4.57.6 和 PEFT，提醒新版本类布局不同；1.7B 示例仍引用旧 adapter 仓库名，不能直接复制运行。应使用已核查的实际仓库，固定依赖并检查全部 adapter keys 成功加载。

### 对 M1 推荐的工程路径

开发阶段加载未量化基座和正确 adapter，用 PEFT 合并成完整权重，再用 mlx-audio 转换／量化。PEFT 有 [merge_and_unload](https://huggingface.co/docs/peft/en/package_reference/lora) 能力；mlx-audio 有 [转换器](https://github.com/Blaizzy/mlx-audio/blob/7cc680b2bea1e8ef34b1a78ee4ff389953aebe40/mlx_audio/convert.py) 和 [Qwen3-ASR 权重映射](https://github.com/Blaizzy/mlx-audio/blob/7cc680b2bea1e8ef34b1a78ee4ff389953aebe40/mlx_audio/stt/models/qwen3_asr/qwen3_asr.py)。组合起来是待验证方案，尚未合并或转换此粤语权重。

先比较基座＋adapter 与合并模型，再比较合并模型与 MLX 版本，最后量化，避免多步同时变化后无法定位退化。不要直接将 HF adapter 放到量化 MLX 模型目录当作已生效。

mlx-audio 的 mega_asr 模块有 PEFT adapter 读取代码，但它不是此粤语模型的开箱支持；本轮不建议为热切换 adapter 额外扩展功能。源码中的 stream_transcribe 是对输入音频切块并逐 token 输出，也不能直接等同持续麦克风会话。

接入 Ting 后与原版 Qwen 共用本地进程 Provider，只增加模型配置／下载资产。最终普通用户选择“Qwen 粤语版”，不需要自行合并权重。相比 BuzzASR，额外工程主要是 MLX 运行环境和转换验证；一旦基础 Qwen 接通，后续添加合并模型的成本应较低。

补充候选 gtomato/ft-qwen3-asr-1.7b-peftlora-v1 的搜索记录声称已有合并模型，但本轮直接访问及元数据 API 均返回 401；原因未判定，不列为现在可下载方案。

## 3. MERaLiON：服务接口方便，M1 部署不方便

准确版本：[MERaLiON/MERaLiON-3-3B-ASR](https://huggingface.co/MERaLiON/MERaLiON-3-3B-ASR)，revision `9f226d738dee62c60a2f43b0ab7b9a2585a132c3`。它是覆盖粤语和混合语言的区域多语 ASR。

实际 config 是自定义 MERaLiON3ASRForConditionalGeneration，包含 Whisper 音频部分与 Gemma2 文字部分，不是能直接交给 whisper.cpp 的完整 Whisper 模型。元数据约 3.307B BF16 参数，纯权重约 6.61GB，不含激活、缓存及框架。

卡片链接的 [meralion-3-asr 服务包](https://github.com/YingxuH/MERaLiON-3-ASR) 已提供 `POST /v1/audio/transcriptions`，有文件分块处理。Ting 可新增 HTTP STT 适配器，发送 multipart 文件、解析 text。此路线方便的是客户端接入，不是本机部署。

源码核查的关键限制：

- [pyproject.toml](https://github.com/YingxuH/MERaLiON-3-ASR/blob/af26fcdf3e45b33512d12492e8b9df5f82fae8bd/pyproject.toml) 将 vLLM 作为直接依赖，不是选择 Transformers 后就不安装它。
- [Transformers backend](https://github.com/YingxuH/MERaLiON-3-ASR/blob/af26fcdf3e45b33512d12492e8b9df5f82fae8bd/src/meralion_3_asr/backends/transformers_backend.py) 默认 CUDA，否则 CPU；没有自动 MPS 路径，非 CUDA 默认 float32。
- 按参数量估算，默认 FP32 仅权重就约 13.23GB。对 16GB Mac，剩余系统与运行空间很紧；这不是实测 OOM，也不证明手动低精度／MPS 一定不可行。
- 若要 M1 支持，需要隔离 CUDA 依赖，尝试显式 device/dtype 并验证算子与内存，或开发／找到经过验证的 MLX 实现。本轮检查的 mlx-audio 源码树没有 MERaLiON 模块。

建议先保留为自己的 CUDA 服务器候选。官方卡片展示的 80GB GPU 环境不是已验证的最低硬件要求，不据此宣称必须 80GB。服务端返回纯文本时不能捏造词时间；30 秒分块边界只属于粗定位。托管 API 的实时／说话人宣传不能直接算作开放权重功能。

许可证为 MERaLiON 专门许可证，未完成再分发／商用条款审查；不要与 MIT／Apache 模型混同。

## 实施建议与验证门槛

下一轮技术试验优先做 BuzzASR → GGML，以及 Qwen 粤语 0.6B → 合并 → MLX；与原版 Qwen 使用同一组经授权的粤语、粤英混合样本。这两条路线分别复用已有 Whisper 引擎和计划新增的 Qwen 引擎，不为每个 checkpoint 新造一套 Provider。

每条路径须验证：加载、实际输出、静音、漏段／截断、混合语言、持续处理延迟及峰值内存。没有这些结果之前，只称“接入可行性较高”，不称“已跑通”。说话人和上下文精修仍不在本轮范围。

本轮只更新研究文档，现有应用行为未变。
