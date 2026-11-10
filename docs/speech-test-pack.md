# 可重复使用的语音测试包 v1

位置：`experiments/speech-test-pack-v1/`（音频不进 Git，不随应用打包）。30 个 WAV，约 7.31 分钟、22.25 MB（含派生长音频）。
生成：`.ting-runtime/bin/python tools/evaluation/prepare_speech_pack.py`。
脚本依赖已有 `experiments/cantonese/public-eval/pack/` 粤语包；其他素材从固定版本 FLEURS 流式提取，不下载完整语料库。

| 文件夹 | 数量 | 用途和来源 |
| --- | --- | --- |
| 01-English | 8 | 英语真人朗读，FLEURS en_us |
| 02-Mandarin | 8 | 普通话真人朗读，FLEURS cmn_hans_cn |
| 03-Cantonese-Read | 8 | 香港粤语朗读，书面中文参考稿，FLEURS yue_hant_hk |
| 04-Cantonese-English-NC | 5 | 自然粤语口语夹英文，WSYue-ASR-eval |
| 05-Long-Regression | 1 | 英文原声拼接超过 60 秒，检查分段、漏尾和时间戳 |

每个 WAV 旁有同名 TXT。manifest.json 记录来源、源文件 ID、时长、SHA-256、许可和改动；sources/ 保留 FLEURS 原始数据卡及 TSV。FLEURS 固定版本为 `70bb2e84b976b7e960aa89f1c648e09c59f894dd`，每个语言取压缩包顺序中的前八段。粤英五段按参考稿筛选，包含 channel、link、ready、design 等英文词；未逐段听审，不视为人工认证的质量标签。

这里“粤语书面语”指**用粤语朗读书面文本**。将自然粤语口语整理成书面中文是另一种输出任务，需另外评估，不能和忠实逐字转录混算。

## 怎么测试

1. 上传 01-English 任意 WAV，选原版 Qwen3-ASR 0.6B、Audio language = English，检查结果保持英文。
2. 同一文件再选 Auto，检查是否仍为英文，保存两份结果。
3. 普通话选对应语言；粤语朗读与粤英混合先选 Auto。同一文件分别用原版、粤语微调版比较。
4. 上传 05-Long-Regression/English-over-60s.wav，检查无 60 秒限制错误、尾句齐全、时间戳递增。
5. 播放同一 WAV 测系统声音；避免麦克风同时收进扬声器声音。采集链路和文件导入分开记录。

记录日期、应用 Git 提交、模型 ID、语言选项、文件名、耗时、错误/漏句/换语言、输出文本。标点、大小写和繁简体差异与真正错词分开看。

## 许可与边界

- [FLEURS 官方](https://huggingface.co/datasets/google/fleurs)：CC BY 4.0，作者 FLEURS 团队 / Google；保留归属及改动说明。
- [WSYue-ASR-eval 官方](https://huggingface.co/datasets/ASLP-lab/WSYue-ASR-eval)：WenetSpeech-Yue 团队、AISHELL 标注；CC BY-NC 4.0，仅用于非商业研究评测。商业产品开发用途是否符合 NC 须另行确认，不随商业产品分发，不作为商业演示素材。
- 此包是小规模开发回归样本，不是代表性基准或准确率排名；不能保证模型未训练过这些公开语料。
- 朗读与自然口语分组评估；没有标定噪声、多人重叠或真实粤普句内切换。
- 长音频是原声拼接，片段间加 0.5 秒静音，附时间映射，不冒充真实长会议。其他单段音频未改动。
