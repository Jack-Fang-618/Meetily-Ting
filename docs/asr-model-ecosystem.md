# Ting ASR 模型生态调查

日期：2026-10-22。状态：官方资料与源码调查；没有下载新模型、调用付费 API 或进行性能实测。用户提供的调研是候选框架，不作为已验证事实。

## 选型框架

采用两类部署来源：Managed Cloud（供应商托管）与 Self-hosted（本机、局域网或自己的远程服务器）。另记数据边界 device / LAN / remote；自建远程服务器并不等于数据不离开电脑。

四种场景：实时转录、文件转录、会后重识别、人工辅助校订。前两种是输入方式，后两种是产品工作流。

三个层次：Provider 负责调用具体模型；转录编排负责音频、分段、时间对齐和说话人；Ting 工作台负责上下文、审查、回听与修订。统一结果格式不意味着所有模型必须经过相同分段流程。

## 云端：聚焦阿里，但按准确 model ID 分能力

官方文档已列出 `qwen-audio-3.0-asr-flash-filetrans` 和 `qwen-audio-3.1-asr-flash-filetrans`。因此 3.1 不再是“尚无文档的候选”，但账号权限、地域和实际返回结果仍未验证。Filetrans 是提交任务后轮询，输入采用 file_urls；parameters 即使为空也要传。实现要解决音频上传、临时 URL、任务恢复和结果获取，不能把本地路径直接交给 API。[官方 HTTP 文档](https://www.alibabacloud.com/help/zh/model-studio/fun-asr-recorded-speech-recognition-http-api)

Streaming、Message 与 Qwen3-ASR-Flash-Realtime 不能仅凭名称互换。官方实时指南中 Message 也走 WebSocket；Streaming 有句级和词级时间戳，而 qwen3-asr-flash-realtime 当前不返回时间戳。中间结果可能尚无结束时间，应按句 ID 更新，不能每次追加一段。[实时指南](https://help.aliyun.com/en/model-studio/real-time-speech-recognition-user-guide)

本轮不锁定价格、并发和文件上限；接入时按选定型号、账号与地域核对。Filetrans 的说话人字段、时间戳粒度及限制也必须用该型号的响应验证，不能从其他阿里型号推断。Audio Realtime 语音对话不列入第一阶段 ASR 范围。

## 本地候选

| 候选 | 已核实的依据 | Ting 的处理建议／未验证项 |
| --- | --- | --- |
| Qwen3-ASR 0.6B / 1.7B | 官方提供两档模型，支持粤语；官方流式路径依赖 vLLM，流式不返回时间戳；独立 ForcedAligner 提供字词对齐 | 第一优先；先验证文件转录，再评估实时路径 |
| MLX Qwen3-ASR | mlx-audio 已有 Qwen3-ASR 与 ForcedAligner 示例 | 适合 M1 首轮验证；速度、峰值内存、长音频和流式能力均待本机测量 |
| Qwen3 粤语 LoRA | 已找到具体 Cantonese written LoRA；需要基座模型 | 不是独立完整模型；书面语目标可能不同于忠实粤语逐字稿，必须检查有没有改写 |
| BuzzASR/cantonese | 模型卡提供 Transformers 用法，标记 Whisper 系列和 MIT | 不等于能直接放进 whisper.cpp；检查配置、tokenizer 与转换兼容性后再考虑原生集成 |
| MERaLiON-3-3B-ASR | 区域多语及粤英混合；卡片推荐 vLLM；使用专门公开许可证 | 不是粤语专用模型；托管 API 的流式／说话人能力不能直接算作开放权重能力；暂作自建服务器候选 |
| Fun-ASR-Nano / SenseVoiceSmall | FunASR 是工具包；不同 checkpoint 有不同语言、时间戳和实时能力 | 次优先对照；不要把工具包支持实时理解成每个模型都支持实时 |
| 现有 Whisper / Parakeet | 当前软件已有本地调用与下载流程 | 保留作为集成回归基线，不因此认定它们适合粤语 |

来源：[Qwen 官方](https://github.com/QwenLM/Qwen3-ASR)、[MLX 示例](https://github.com/Blaizzy/mlx-audio/blob/main/mlx_audio/stt/models/qwen3_asr/README.md)、[粤语 LoRA](https://huggingface.co/JackyHoCL/Qwen3-ASR-1.7B-cantonese-written-lora)、[BuzzASR](https://huggingface.co/BuzzASR/cantonese)、[MERaLiON](https://huggingface.co/MERaLiON/MERaLiON-3-3B-ASR)、[FunASR](https://github.com/modelscope/FunASR)。资料访问日期均为 2026-10-22。

模型卡的自报成绩不构成我们的排名。开放权重、工具包开源、允许再分发是不同问题；打包前逐项检查许可证及模型 revision。此次没有完成完整许可证审查。

## 统一评测，不继续无限扩展候选

首轮：Qwen3-ASR 0.6B 的 MLX 实现、1.7B（内存允许时）、一个实际可用的阿里 Filetrans 型号，以及现有 Whisper 基线。锁定 runtime/model revision、量化、语言提示与参数。

准备经用户同意使用的香港粤语、粤英普通话混合、多人及噪声片段；先用短片段定位问题，再用一至两小时录音测试稳定性。云端样本必须获得上传授权。

- 质量：粤语口语字保留、人名术语、漏句、凭空添加、跨语言切换；中文 CER、英文 WER 分开记录，注明繁简和标点归一化规则。
- 效率：冷启动／模型加载与纯推理分别计时；实时路径记录首字和最终句延迟，文件路径记录处理时间／音频时长。
- 资源：M1 峰值内存、swap、持续运行情况；云端记录实际费用及上传／存储成本，不只看模型单价。
- 定位：时间戳误差、分段边界、重叠语音；说话人单独评估，缺失能力明确标记。
- 人工成本：校订所需时间。原始 ASR 与 LLM 校订分别评分，避免用“更通顺”掩盖听错。

具体实施顺序见 [路线图](implementation-roadmap.md)。
